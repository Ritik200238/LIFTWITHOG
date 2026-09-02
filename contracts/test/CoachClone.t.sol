// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AttestedTransferVerifier} from "../src/AttestedTransferVerifier.sol";
import {CoachAgent} from "../src/CoachAgent.sol";
import {IERC7857} from "../src/interfaces/IERC7857.sol";
import {IERC7857Cloneable} from "../src/interfaces/IERC7857Cloneable.sol";

/**
 * The clone economy — what renting cannot express.
 *
 * Renting borrows a trainer's method for a while. Cloning takes a copy that then
 * trains on somebody else's data and diverges, which is what actually happens
 * when a person buys a programme: the copy becomes theirs, stops being the
 * trainer's problem, and the trainer keeps the credit.
 *
 * The credit is the part that has to be on chain, and the part these tests are
 * mostly about. A lineage that can be edited by whoever holds a clone three
 * generations down is not attribution, it is a label.
 */
contract CoachCloneTest is Test {
    CoachAgent private coach;
    AttestedTransferVerifier private verifier;

    uint256 private attestorKey;
    address private attestor;

    address private trainer = address(0xA11CE);
    address private athlete = address(0xB0B);
    address private stranger = address(0xBAD);

    bytes32 private constant CONFIG = keccak256("encrypted coaching method v1");
    bytes32 private constant RESEALED = keccak256("the same method, sealed for the athlete");
    string private constant URI = "og://storage/root/abc123";
    string private constant CHILD_URI = "og://storage/root/child";

    uint256 private constant PRICE = 0.05 ether;

    function setUp() public {
        (attestor, attestorKey) = makeAddrAndKey("attestor");
        verifier = new AttestedTransferVerifier(attestor);
        coach = new CoachAgent(address(verifier));
        vm.warp(1_700_000_000);
    }

    function _mint(address owner) private returns (uint256 tokenId) {
        vm.prank(owner);
        tokenId = coach.mint(CONFIG, URI);
    }

    function _listed(address owner) private returns (uint256 tokenId) {
        tokenId = _mint(owner);
        vm.prank(owner);
        coach.setClonePrice(tokenId, PRICE);
    }

    // ------------------------------------------------------------ the sale

    function test_CloningPaysTheTrainerAndTheContractKeepsNothing() public {
        /*
         * The contract is an authorisation ledger, not a treasury. A balance
         * left in it is money the trainer cannot withdraw — there is no withdraw
         * function — so it would be stuck for good.
         */
        uint256 parent = _listed(trainer);
        uint256 before = trainer.balance;

        (address owner, uint256 key) = makeAddrAndKey("clone-owner");
        bytes memory signature = _signClone(owner, key, parent, RESEALED, CHILD_URI);

        vm.deal(athlete, PRICE);
        vm.prank(athlete);
        uint256 child = coach.cloneFor{value: PRICE}(owner, parent, RESEALED, CHILD_URI, block.timestamp + 1 hours, signature);

        assertEq(trainer.balance - before, PRICE, "the trainer was not paid in full");
        assertEq(address(coach).balance, 0, "the contract kept some of the payment");
        assertEq(coach.ownerOf(child), owner, "the clone went to the wrong address");
    }

    function test_ThePayerIsNotTheOwnerUnlessTheSignatureSaysSo() public {
        /*
         * The gasless property, on the path where money also moves. Whoever
         * submits the transaction pays the fee *and* the clone price, and still
         * cannot take the coach: the owner is a field inside the signed message.
         */
        uint256 parent = _listed(trainer);

        (address owner, uint256 key) = makeAddrAndKey("clone-owner");
        bytes memory signature = _signClone(owner, key, parent, RESEALED, CHILD_URI);

        vm.deal(stranger, PRICE);
        vm.prank(stranger);
        uint256 child = coach.cloneFor{value: PRICE}(owner, parent, RESEALED, CHILD_URI, block.timestamp + 1 hours, signature);

        assertEq(coach.ownerOf(child), owner, "the submitter took the clone");
        assertTrue(coach.ownerOf(child) != stranger);
    }

    function test_ACoachNotOfferedForCloningCannotBeCloned() public {
        uint256 parent = _mint(trainer);

        (address owner, uint256 key) = makeAddrAndKey("clone-owner");
        bytes memory signature = _signClone(owner, key, parent, RESEALED, CHILD_URI);

        vm.deal(athlete, PRICE);
        vm.prank(athlete);
        vm.expectRevert(CoachAgent.NotCloneable.selector);
        coach.cloneFor{value: PRICE}(owner, parent, RESEALED, CHILD_URI, block.timestamp + 1 hours, signature);
    }

    function test_OnlyTheExactPriceBuysAClone() public {
        uint256 parent = _listed(trainer);

        (address owner, uint256 key) = makeAddrAndKey("clone-owner");
        bytes memory signature = _signClone(owner, key, parent, RESEALED, CHILD_URI);

        vm.deal(athlete, PRICE);
        vm.prank(athlete);
        vm.expectRevert(abi.encodeWithSelector(CoachAgent.WrongPayment.selector, PRICE));
        coach.cloneFor{value: PRICE - 1}(owner, parent, RESEALED, CHILD_URI, block.timestamp + 1 hours, signature);
    }

    function test_WithdrawingTheOfferStopsFurtherClones() public {
        // A trainer must be able to stop selling. Zero is the withdrawal.
        uint256 parent = _listed(trainer);

        vm.prank(trainer);
        coach.setClonePrice(parent, 0);

        (address owner, uint256 key) = makeAddrAndKey("clone-owner");
        bytes memory signature = _signClone(owner, key, parent, RESEALED, CHILD_URI);

        vm.deal(athlete, PRICE);
        vm.prank(athlete);
        vm.expectRevert(CoachAgent.NotCloneable.selector);
        coach.cloneFor{value: PRICE}(owner, parent, RESEALED, CHILD_URI, block.timestamp + 1 hours, signature);
    }

    function test_OnlyTheOwnerPricesACoachForCloning() public {
        uint256 parent = _mint(trainer);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.setClonePrice(parent, PRICE);
    }

    // --------------------------------------------------------- the lineage

    function test_TheDescentIsRecordedAndCannotBeEditedOut() public {
        /*
         * The reason this is an economy rather than a copy button. A trainer
         * whose method spreads through three generations can prove it, and the
         * holder of a third-generation clone cannot remove the attribution —
         * there is no function that writes `_parentOf` except cloning.
         */
        uint256 first = _listed(trainer);
        uint256 second = _cloneOf(first, "gen2");

        vm.prank(coach.ownerOf(second));
        coach.setClonePrice(second, PRICE);
        uint256 third = _cloneOf(second, "gen3");

        assertEq(coach.parentOf(second), first, "the second generation lost its parent");
        assertEq(coach.parentOf(third), second, "the third generation lost its parent");
        assertEq(coach.parentOf(first), 0, "an original claims a parent");

        (uint256 generation, bool complete) = coach.generationOf(third, 10);
        assertEq(generation, 3, "the third generation is not reported as the third");
        assertTrue(complete, "the walk did not reach an original");
    }

    function test_LineageSurvivesTheCoachBeingSold() public {
        // Attribution is about where a method came from, not who holds it now.
        uint256 parent = _listed(trainer);
        uint256 child = _cloneOf(parent, "sold");

        address owner = coach.ownerOf(child);
        vm.prank(owner);
        coach.transferFrom(owner, stranger, child);

        assertEq(coach.ownerOf(child), stranger);
        assertEq(coach.parentOf(child), parent, "selling a clone erased where it came from");
    }

    function test_AWalkThatRunsOutOfDepthSaysSoRatherThanLying() public {
        /*
         * The chain of parents is written by users, so a view that walks it
         * without a bound is one somebody can make exceed the call gas cap —
         * which would make a coach's own lineage permanently unreadable.
         */
        uint256 first = _listed(trainer);
        uint256 second = _cloneOf(first, "gen2");

        (uint256 generation, bool complete) = coach.generationOf(second, 1);

        assertEq(generation, 2);
        assertFalse(complete, "a truncated walk reported itself as complete");
    }

    function test_ACloneStartsItsOwnHistory() public {
        /*
         * Not a subscription by another name. The child carries its own brain
         * and its own version counter, so it diverges the first time it learns
         * and the parent's later versions never reach it.
         */
        uint256 parent = _listed(trainer);

        vm.prank(trainer);
        coach.evolve(parent, keccak256("parent v2"), "og://storage/parent-v2");

        uint256 child = _cloneOf(parent, "own-history");

        (bytes32 childHash, , uint64 childVersion, ) = coach.coachOf(child);
        (bytes32 parentHash, , uint64 parentVersion, ) = coach.coachOf(parent);

        assertEq(childVersion, 1, "a clone inherited a version count it did not earn");
        assertEq(parentVersion, 2);
        assertTrue(childHash != parentHash, "the clone points at the parent's brain");
    }

    // ------------------------------------------------- the standard's clone

    function test_TheStandardsCloneIsDeclaredAndWorks() public {
        uint256 parent = _mint(trainer);

        IERC7857.TransferValidityProof[] memory proofs =
            _proof(attestorKey, trainer, athlete, parent, 1);

        vm.prank(trainer);
        uint256 child = coach.iCloneFrom(trainer, athlete, parent, proofs);

        assertEq(coach.ownerOf(child), athlete);
        assertEq(coach.ownerOf(parent), trainer, "cloning moved the original");
        assertEq(coach.parentOf(child), parent);
        assertTrue(coach.supportsInterface(type(IERC7857Cloneable).interfaceId), "Cloneable is not declared");
    }

    function test_TheStandardsCloneRefusesAForgedAttestation() public {
        uint256 parent = _mint(trainer);
        (, uint256 impostorKey) = makeAddrAndKey("impostor");

        IERC7857.TransferValidityProof[] memory proofs =
            _proof(impostorKey, trainer, athlete, parent, 1);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iCloneFrom(trainer, athlete, parent, proofs);
    }

    function test_SomebodyElseCannotCloneYourCoach() public {
        uint256 parent = _mint(trainer);

        IERC7857.TransferValidityProof[] memory proofs =
            _proof(attestorKey, trainer, stranger, parent, 1);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.iCloneFrom(trainer, stranger, parent, proofs);
    }

    // ----------------------------------------------------------- helpers

    /** Buy a clone of `parent`, returning the new token id. */
    function _cloneOf(uint256 parent, string memory salt) private returns (uint256 child) {
        (address owner, uint256 key) = makeAddrAndKey(salt);
        bytes memory signature = _signClone(owner, key, parent, keccak256(bytes(salt)), CHILD_URI);

        vm.deal(athlete, PRICE);
        vm.prank(athlete);
        child = coach.cloneFor{value: PRICE}(
            owner, parent, keccak256(bytes(salt)), CHILD_URI, block.timestamp + 1 hours, signature
        );
    }

    function _signClone(address owner, uint256 key, uint256 parentId, bytes32 configHash, string memory uri)
        private
        view
        returns (bytes memory)
    {
        (, string memory name, string memory version, uint256 chainId, address verifying, , ) = coach.eip712Domain();

        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "CloneCoach(address owner,uint256 parentId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
                ),
                owner,
                parentId,
                configHash,
                keccak256(bytes(uri)),
                coach.nonceOf(owner),
                block.timestamp + 1 hours
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked(hex"1901", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _proof(uint256 key, address from, address to, uint256 tokenId, uint256 nonce)
        private
        view
        returns (IERC7857.TransferValidityProof[] memory proofs)
    {
        bytes memory sealedKey = hex"c0ffee";
        bytes memory targetPublicKey = hex"02abcdef";

        bytes32 hash = verifier.digest(from, to, tokenId, sealedKey, targetPublicKey, nonce);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)));

        proofs = new IERC7857.TransferValidityProof[](1);
        proofs[0] = IERC7857.TransferValidityProof({
            accessProof: IERC7857.AccessProof({targetPublicKey: targetPublicKey, signature: ""}),
            ownershipProof: IERC7857.OwnershipProof({
                sealedKey: sealedKey,
                signature: abi.encodePacked(r, s, v),
                nonce: nonce
            })
        });
    }
}
