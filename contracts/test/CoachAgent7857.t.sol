// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CoachAgent} from "../src/CoachAgent.sol";
import {IERC7857} from "../src/interfaces/IERC7857.sol";
import {IERC7857Authorize} from "../src/interfaces/IERC7857Authorize.sol";
import {ITransferProofVerifier} from "../src/interfaces/ITransferProofVerifier.sol";

/**
 * The ERC-7857 surface — what makes a coach an Agentic ID and not just an NFT.
 *
 * Two failure modes matter here. The first is drift: implementing something
 * 7857-ish whose selectors do not match the standard, so every indexer and
 * marketplace in the ecosystem sees a plain ERC-721. `supportsInterface` and
 * the vendored interfaces are tested against each other for exactly that.
 * The second is dishonesty: an iTransferFrom that "works" without a verifier
 * would claim re-encryption happened when nothing checked it. The contract
 * refuses instead, and that refusal is pinned here as behaviour, not left as
 * a comment.
 */

/// @dev The oracle as the tests need it: one that says yes, one that says no.
contract StubVerifier is ITransferProofVerifier {
    bool public immutable answer;

    constructor(bool answer_) {
        answer = answer_;
    }

    function verifyTransfer(
        address,
        address,
        uint256,
        IERC7857.TransferValidityProof[] calldata
    ) external view returns (bool) {
        return answer;
    }

    function attestTransfer(
        address,
        address,
        uint256,
        IERC7857.TransferValidityProof[] calldata
    ) external view returns (bool) {
        return answer;
    }
}

contract CoachAgent7857Test is Test {
    CoachAgent private coach;

    address private trainer = address(0xA11CE);
    address private athlete = address(0xB0B);
    address private executor = address(0xE7);
    address private buyer = address(0xDEAD);

    bytes32 private constant CONFIG = keccak256("encrypted coaching method v1");
    string private constant URI = "og://storage/root/abc123";

    IERC7857.TransferValidityProof[] private noProofs;

    function setUp() public {
        coach = new CoachAgent(address(0));
        vm.warp(1_700_000_000);
    }

    function _mint(address owner) private returns (uint256 tokenId) {
        vm.prank(owner);
        tokenId = coach.mint(CONFIG, URI);
    }

    // ---------------------------------------------------------- interfaces

    function test_DeclaresBothStandardsAndStillERC721() public view {
        assertTrue(coach.supportsInterface(type(IERC7857).interfaceId), "not an ERC-7857");
        assertTrue(coach.supportsInterface(type(IERC7857Authorize).interfaceId), "authorization extension missing");
        assertTrue(coach.supportsInterface(0x80ac58cd), "stopped being an ERC-721");
        assertTrue(coach.supportsInterface(0x01ffc9a7), "stopped answering ERC-165");
        assertFalse(coach.supportsInterface(0xffffffff), "claims the interface ERC-165 forbids");
    }

    /**
     * The control the README and /verify show a reader, pinned here too.
     *
     * `0xdeadbeef` is not an interface anybody implements, so a correct contract
     * says no — and a stub written to look compliant, answering `true` to
     * whatever it is handed, passes every assertion above and fails only this
     * one. Without it, four green ticks prove that `supportsInterface` exists.
     *
     * It is the same id we invite somebody to `cast call` for themselves, on
     * purpose: a control asserted in the test suite and a different one shown to
     * the reader would mean neither is the one under test.
     */
    function test_TheControlIdIsFalse() public view {
        assertFalse(coach.supportsInterface(0xdeadbeef), "control id must be false");
    }

    /**
     * The declared ids match the vendored interfaces, byte for byte.
     *
     * `supportsInterface` returning true for a constant somebody typed is worth
     * nothing if the constant drifted from the standard. These compare the
     * hardcoded selectors against the ones solc computes from 0G's own
     * interface files.
     */
    function test_TheInterfaceIdsHaveNotDrifted() public pure {
        assertEq(type(IERC7857).interfaceId, bytes4(0x4b396f04), "ERC-7857 id drifted");
        assertEq(type(IERC7857Authorize).interfaceId, bytes4(0x35d39512), "7857 Authorize id drifted");
    }

    // ----------------------------------------------------- intelligent data

    function test_TheBrainIsTheIntelligentData() public {
        uint256 id = _mint(trainer);

        IERC7857.IntelligentData[] memory data = coach.getIntelligentDatas(id);

        assertEq(data.length, 1, "a coach has exactly one brain");
        assertEq(data[0].dataHash, CONFIG, "the hash is not the config hash");
        // The description must say where the ciphertext lives — that is the
        // pointer an executor follows to fetch it from 0G Storage.
        assertTrue(bytes(data[0].dataDescription).length > 0);
    }

    function test_EvolvingUpdatesTheIntelligentData() public {
        uint256 id = _mint(trainer);
        bytes32 evolved = keccak256("encrypted coaching method v2");

        vm.prank(trainer);
        coach.evolve(id, evolved, "og://storage/root/def456");

        assertEq(coach.getIntelligentDatas(id)[0].dataHash, evolved, "the brain hash did not follow the evolve");
    }

    /**
     * The standard's event, on the path that actually creates coaches.
     *
     * `mint` announced the intelligent data and `mintFor` did not — and
     * `mintFor` is the relayed path, which is how every coach in the product is
     * made, because it is the one that works without holding a coin. So an
     * indexer following ERC-7857 saw the coaches nobody has and missed the
     * coaches everybody has. Asserted as an event rather than by reading state,
     * because an indexer cannot read state it was never told to look at.
     */
    function test_RelayedMintAnnouncesTheIntelligentData() public {
        (address owner, uint256 key) = makeAddrAndKey("relayed-owner");
        uint256 expectedId = coach.totalMinted() + 1;

        bytes memory signature = _signMint(owner, key, CONFIG, URI);

        vm.recordLogs();
        coach.mintFor(owner, CONFIG, URI, block.timestamp + 1 hours, signature);

        assertTrue(_sawIntelligentDataSet(expectedId), "mintFor did not announce the intelligent data");
    }

    /// The mirror of the same gap: `evolveFor` announced it, `evolve` did not.
    function test_DirectEvolveAnnouncesTheIntelligentData() public {
        uint256 id = _mint(trainer);

        vm.recordLogs();
        vm.prank(trainer);
        coach.evolve(id, keccak256("v2"), "og://storage/root/def456");

        assertTrue(_sawIntelligentDataSet(id), "evolve did not announce the intelligent data");
    }

    /// Was `IntelligentDataSet` emitted for this coach in the recorded logs?
    function _sawIntelligentDataSet(uint256 tokenId) private returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // Taken from the vendored interface rather than written out. Spelling it
        // by hand got the struct's field order backwards — the signature is
        // `(string,bytes32)` — and the test failed against a contract that was
        // emitting correctly, which is the wrong way round for a test to be wrong.
        bytes32 wanted = IERC7857.IntelligentDataSet.selector;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 1 && logs[i].topics[0] == wanted) {
                if (uint256(logs[i].topics[1]) == tokenId) return true;
            }
        }
        return false;
    }

    /// An EIP-712 signature over the relayed-mint message, as a device produces it.
    function _signMint(address owner, uint256 key, bytes32 configHash, string memory uri)
        private
        view
        returns (bytes memory)
    {
        (, string memory name, string memory version, uint256 chainId, address verifying, , ) =
            coach.eip712Domain();

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
                    "MintCoach(address owner,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
                ),
                owner,
                configHash,
                keccak256(bytes(uri)),
                coach.nonceOf(owner),
                block.timestamp + 1 hours
            )
        );

        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked(hex"1901", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_NoCoachNoData() public {
        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.getIntelligentDatas(999);
    }

    // -------------------------------------------------------- authorization

    function test_AuthorizedExecutorCanUseButNotOwn() public {
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.authorizeUsage(id, executor);

        assertTrue(coach.isAuthorizedUser(id, executor), "authorization did not grant usage");
        assertEq(coach.ownerOf(id), trainer, "authorization moved ownership");
    }

    function test_AuthorizationOutlivesEverySubscription() public {
        // 7857 usage is open-ended: it ends by revocation, not by clock.
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.authorizeUsage(id, executor);

        vm.warp(block.timestamp + 3650 days);
        assertTrue(coach.isAuthorizedUser(id, executor), "an open-ended grant expired");
    }

    function test_RevocationIsImmediate() public {
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.authorizeUsage(id, executor);
        vm.prank(trainer);
        coach.revokeAuthorization(id, executor);

        assertFalse(coach.isAuthorizedUser(id, executor), "a revoked executor still has usage");
    }

    function test_OnlyTheOwnerAuthorizes() public {
        uint256 id = _mint(trainer);

        vm.prank(athlete);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.authorizeUsage(id, athlete);
    }

    function test_TheListShowsWhoIsLiveRightNow() public {
        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, 1 wei);

        // One open-ended executor, one 2-day renter.
        vm.prank(trainer);
        coach.authorizeUsage(id, executor);
        vm.deal(athlete, 10);
        vm.prank(athlete);
        coach.rent{value: 2}(id, 2);

        address[] memory now_ = coach.authorizedUsersOf(id);
        assertEq(now_.length, 2, "both grants should be listed while live");

        // Three days on, the rental has lapsed and only the executor remains.
        vm.warp(block.timestamp + 3 days);
        address[] memory later = coach.authorizedUsersOf(id);
        assertEq(later.length, 1, "an expired rental is still listed");
        assertEq(later[0], executor);
    }

    function test_SellingClearsTheListToo() public {
        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.authorizeUsage(id, executor);

        vm.prank(trainer);
        coach.transferFrom(trainer, buyer, id);

        assertEq(coach.authorizedUsersOf(id).length, 0, "a sale left the old owner's executors live");
        assertFalse(coach.isAuthorizedUser(id, executor), "an executor survived the sale");
    }

    function test_BatchAuthorizesEveryListedCoach() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = _mint(trainer);
        ids[1] = _mint(trainer);
        ids[2] = _mint(trainer);

        vm.prank(trainer);
        coach.batchAuthorizeUsage(ids, executor);

        for (uint256 i = 0; i < ids.length; i++) {
            assertTrue(coach.isAuthorizedUser(ids[i], executor), "one coach in the batch was skipped");
        }
    }

    function test_BatchStopsAtACoachYouDoNotOwn() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = _mint(trainer);
        ids[1] = _mint(athlete);   // not the caller's

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.batchAuthorizeUsage(ids, executor);

        // The revert unwinds the whole batch — no half-applied grants.
        assertFalse(coach.isAuthorizedUser(ids[0], executor), "a reverted batch left a grant behind");
    }

    // -------------------------------------------------- intelligent transfer

    function test_WithoutAnOracleItRefusesRatherThanPretends() public {
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.VerifierNotConfigured.selector);
        coach.iTransferFrom(trainer, buyer, id, noProofs);

        assertEq(coach.ownerOf(id), trainer, "a refused transfer still moved the coach");
    }

    function test_ARejectedProofMovesNothing() public {
        CoachAgent guarded = new CoachAgent(address(new StubVerifier(false)));
        vm.prank(trainer);
        uint256 id = guarded.mint(CONFIG, URI);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        guarded.iTransferFrom(trainer, buyer, id, noProofs);

        assertEq(guarded.ownerOf(id), trainer);
    }

    function test_AVerifiedTransferMovesTheCoachAndVoidsEveryGrant() public {
        CoachAgent verified = new CoachAgent(address(new StubVerifier(true)));
        vm.prank(trainer);
        uint256 id = verified.mint(CONFIG, URI);
        vm.prank(trainer);
        verified.authorizeUsage(id, executor);

        vm.expectEmit(true, true, true, true, address(verified));
        emit IERC7857.IntelligentTransfer(trainer, buyer, id);
        vm.prank(trainer);
        verified.iTransferFrom(trainer, buyer, id, noProofs);

        assertEq(verified.ownerOf(id), buyer, "the verified transfer did not move the coach");
        assertFalse(verified.isAuthorizedUser(id, executor), "the seller's executor survived");
    }

    function test_TheOracleCannotOverrideTheOwner() public {
        // A verifier that approves everything still cannot move a coach its
        // owner did not consent to move: ERC-721 authorization runs after it.
        CoachAgent verified = new CoachAgent(address(new StubVerifier(true)));
        vm.prank(trainer);
        uint256 id = verified.mint(CONFIG, URI);

        vm.prank(athlete);   // not the owner, not approved
        vm.expectRevert();
        verified.iTransferFrom(trainer, buyer, id, noProofs);

        assertEq(verified.ownerOf(id), trainer);
    }
}
