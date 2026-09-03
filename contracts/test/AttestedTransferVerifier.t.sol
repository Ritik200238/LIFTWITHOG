// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AttestedTransferVerifier} from "../src/AttestedTransferVerifier.sol";
import {CoachAgent} from "../src/CoachAgent.sol";
import {IERC7857} from "../src/interfaces/IERC7857.sol";

/**
 * The oracle, and every way a transfer can be forged that it is able to see.
 *
 * ERC-7857 exists for one moment — an agent changes hands and its encrypted
 * intelligence is re-encrypted to the buyer, so the seller's key stops being
 * useful. Everything else in the standard is bookkeeping around that. Until now
 * this contract shipped with `address(0)` as its verifier, so `iTransferFrom`
 * reverted on every call ever made: honest, and also the standard's central
 * mechanism not implemented.
 *
 * What the attestor is, said plainly and tested as such: a software key held by
 * the service that performs the re-encryption. It attests that it did the work.
 * That is weaker than a hardware quote, and the tests below therefore cover the
 * forgeries a signature check *can* catch — a different signer, a different
 * coach, a different destination, a swapped key, and a replay — rather than
 * implying anything about the enclave it is standing in for.
 */
contract AttestedTransferVerifierTest is Test {
    AttestedTransferVerifier private verifier;
    CoachAgent private coach;

    uint256 private attestorKey;
    address private attestor;

    address private seller = address(0xA11CE);
    address private buyer = address(0xB0B);
    address private stranger = address(0xBAD);

    bytes32 private constant CONFIG = keccak256("encrypted coaching method v1");
    string private constant URI = "og://storage/root/abc123";

    bytes private constant SEALED_KEY = hex"c0ffee";
    bytes private constant TARGET_PUBKEY = hex"02abcdef";

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

    /// A proof signed by whoever `key` is, over the given move.
    /**
     * @dev A nonce with an expiry packed into its top 64 bits.
     *
     * The verifier reads the high 64 bits of the nonce as a unix expiry — see
     * `AttestedTransferVerifier.expiryOf`. Tests that do not care about
     * freshness use this so their proofs are live; the ones that do care build
     * the nonce themselves.
     */
    function _live(uint256 nonce) internal view returns (uint256) {
        return _withExpiry(nonce, block.timestamp + 1 hours);
    }

    function _withExpiry(uint256 nonce, uint256 validUntil) internal pure returns (uint256) {
        return (validUntil << 192) | nonce;
    }

    function _proof(uint256 key, address from, address to, uint256 tokenId, uint256 nonce)
        private
        view
        returns (IERC7857.TransferValidityProof[] memory proofs)
    {
        return _proof(key, from, to, tokenId, nonce, SEALED_KEY, TARGET_PUBKEY);
    }

    function _proof(
        uint256 key,
        address from,
        address to,
        uint256 tokenId,
        uint256 nonce,
        bytes memory sealedKey,
        bytes memory targetPublicKey
    ) private view returns (IERC7857.TransferValidityProof[] memory proofs) {
        bytes32 hash = verifier.digest(from, to, tokenId, sealedKey, targetPublicKey, nonce);
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, signed);

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

    // ------------------------------------------------------- the happy path

    /**
     * The thing no other project in this field can currently do: an ERC-7857
     * transfer that moves the coach rather than reverting.
     */
    function test_AnAttestedTransferMovesTheCoach() public {
        uint256 id = _mint(seller);

        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(1));

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, proofs);

        assertEq(coach.ownerOf(id), buyer, "the coach did not move");
    }

    function test_TheTransferVoidsEveryGrantTheSellerHadMade() public {
        // Otherwise a seller rents access widely, sells, and hands the buyer
        // something a crowd still holds keys to.
        uint256 id = _mint(seller);

        vm.prank(seller);
        coach.authorizeUsage(id, stranger);
        assertTrue(coach.isAuthorizedUser(id, stranger));

        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(1));

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, proofs);

        assertFalse(coach.isAuthorizedUser(id, stranger), "a grant survived the sale");
    }

    // ------------------------------------------------------- the forgeries

    function test_SomebodyElsesSignatureIsRefused() public {
        uint256 id = _mint(seller);
        (, uint256 impostorKey) = makeAddrAndKey("impostor");
        IERC7857.TransferValidityProof[] memory proofs = _proof(impostorKey, seller, buyer, id, _live(1));

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    function test_AnAttestationForAnotherCoachIsRefused() public {
        uint256 mine = _mint(seller);
        uint256 theirs = _mint(stranger);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, theirs, _live(1));

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, mine, proofs);
    }

    function test_AnAttestationForAnotherBuyerIsRefused() public {
        // The one that matters commercially: re-pointing a genuine attestation
        // at a different destination would be a way to steal a paid-for sale.
        uint256 id = _mint(seller);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, stranger, id, _live(1));

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    /**
     * The attack a from/to/id signature walks straight into.
     *
     * The interesting part of a 7857 transfer is the key material, and a triple
     * of addresses says nothing about it. If the sealed key were outside the
     * signed message, an attestation for a genuine re-encryption could be
     * presented alongside *any* sealed key — including the one the seller still
     * holds, which is precisely the thing the standard exists to prevent.
     */
    function test_SwappingTheSealedKeyUnderAGenuineAttestationIsRefused() public {
        uint256 id = _mint(seller);

        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(1));
        proofs[0].ownershipProof.sealedKey = hex"deadbeef";

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    function test_SwappingTheTargetKeyIsRefused() public {
        uint256 id = _mint(seller);

        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(1));
        proofs[0].accessProof.targetPublicKey = hex"03999999";

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    function test_RubbishIsRefusedRatherThanReverting() public {
        // A malformed signature must be a "no", not an unexplained failure that
        // lets anybody turn a refused transfer into a crash.
        uint256 id = _mint(seller);

        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(1));
        proofs[0].ownershipProof.signature = hex"00";

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    // ------------------------------------------------------------- replay

    /**
     * The round trip, which is why the nonce is spent rather than only read.
     *
     * ERC-721's own authorization stops the same proof moving a coach twice in
     * a row — after the first move the seller no longer owns it. It does not
     * stop this: sell, buy back, and yesterday's attestation would bless today's
     * sale with no re-encryption behind it.
     */
    function test_AnAttestationCannotBeUsedTwiceEvenAfterTheCoachComesBack() public {
        uint256 id = _mint(seller);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(7));

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, proofs);
        assertEq(coach.ownerOf(id), buyer);

        // The coach returns by an ordinary sale.
        vm.prank(buyer);
        coach.transferFrom(buyer, seller, id);
        assertEq(coach.ownerOf(id), seller);

        vm.prank(seller);
        vm.expectRevert(CoachAgent.TransferProofRejected.selector);
        coach.iTransferFrom(seller, buyer, id, proofs);
    }

    function test_AFreshNonceWorksAfterASpentOne() public {
        // The other half: spending nonces must not brick the coach.
        uint256 id = _mint(seller);

        IERC7857.TransferValidityProof[] memory first = _proof(attestorKey, seller, buyer, id, _live(7));
        IERC7857.TransferValidityProof[] memory second = _proof(attestorKey, seller, buyer, id, _live(8));

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, first);

        vm.prank(buyer);
        coach.transferFrom(buyer, seller, id);

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, second);

        assertEq(coach.ownerOf(id), buyer);
    }

    // ------------------------------------------------------------ the shape

    function test_ThereIsNoAdminAndNoAttestorSwap() public view {
        /*
         * An attestor that could be replaced would be an admin key over
         * everybody's property under a different name. Asserted by absence:
         * the address is immutable and there is no setter to call.
         */
        assertEq(verifier.attestor(), attestor);
    }

    function test_AVerifierWithNoAttestorCannotBeDeployed() public {
        // address(0) recovers from malformed signatures, so an unset attestor
        // would accept rubbish as valid.
        vm.expectRevert(AttestedTransferVerifier.NoAttestor.selector);
        new AttestedTransferVerifier(address(0));
    }

    function test_ReadingAProofDoesNotSpendIt() public {
        uint256 id = _mint(seller);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, id, _live(3));

        assertTrue(verifier.verifyTransfer(seller, buyer, id, proofs), "a good proof did not read as good");
        assertTrue(verifier.verifyTransfer(seller, buyer, id, proofs), "reading it consumed it");

        vm.prank(seller);
        coach.iTransferFrom(seller, buyer, id, proofs);

        assertFalse(verifier.verifyTransfer(seller, buyer, id, proofs), "it survived being used");
    }

    function test_AnEmptyProofIsRefused() public {
        uint256 id = _mint(seller);
        IERC7857.TransferValidityProof[] memory none = new IERC7857.TransferValidityProof[](0);

        assertFalse(verifier.verifyTransfer(seller, buyer, id, none));

        vm.prank(seller);
        vm.expectRevert(AttestedTransferVerifier.NoProof.selector);
        coach.iTransferFrom(seller, buyer, id, none);
    }

    /* ------------------------------------------------------------------
       Freshness. An attestation vouches for a re-encryption that happened at
       a moment; these are the tests that stop it outliving that moment.
       ------------------------------------------------------------------ */

    function test_AnExpiredAttestationIsRefused() public {
        uint256 tokenId = _mint(seller);
        uint256 nonce = _withExpiry(77, block.timestamp + 10 minutes);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, tokenId, nonce);

        // Good now.
        assertTrue(verifier.verifyTransfer(seller, buyer, tokenId, proofs));

        vm.warp(block.timestamp + 11 minutes);

        // The same bytes, one minute past their stated life.
        assertFalse(verifier.verifyTransfer(seller, buyer, tokenId, proofs), "an expired proof read as good");
        assertFalse(verifier.attestTransfer(seller, buyer, tokenId, proofs), "an expired proof was accepted");
    }

    function test_AnExpiredProofIsNotSpentSoTheNonceStaysUsable() public {
        /*
         * Refusing must not consume the nonce. If it did, anybody could burn a
         * pending sale's nonce by submitting it one second late, and the honest
         * transfer would then fail as a replay.
         */
        uint256 tokenId = _mint(seller);
        uint256 nonce = _withExpiry(88, block.timestamp + 1 minutes);
        IERC7857.TransferValidityProof[] memory stale = _proof(attestorKey, seller, buyer, tokenId, nonce);

        vm.warp(block.timestamp + 2 minutes);
        assertFalse(verifier.attestTransfer(seller, buyer, tokenId, stale));
        assertFalse(verifier.spent(nonce), "a refused proof was marked spent");
    }

    function test_AnAttestationWithNoExpiryIsRefused() public {
        /*
         * Zero is refused rather than read as "never expires". Letting a
         * missing value mean the most permissive thing is how an unbounded
         * proof comes back by accident — and every proof written before this
         * change has a zero here.
         */
        uint256 tokenId = _mint(seller);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, tokenId, 99);

        assertEq(verifier.expiryOf(99), 0);
        assertFalse(verifier.verifyTransfer(seller, buyer, tokenId, proofs));
        assertFalse(verifier.attestTransfer(seller, buyer, tokenId, proofs));
    }

    function test_TheExpiryIsSignedSoItCannotBeExtended() public {
        /*
         * The load-bearing one. The expiry lives inside the nonce, and the
         * nonce is inside the digest — so moving the deadline changes the
         * message and the signature stops recovering to the attestor. A relayer
         * holding a valid proof cannot give it a longer life.
         */
        uint256 tokenId = _mint(seller);
        uint256 shortLived = _withExpiry(101, block.timestamp + 1 minutes);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, tokenId, shortLived);

        // Rewrite only the expiry, keeping the attestor's signature.
        proofs[0].ownershipProof.nonce = _withExpiry(101, block.timestamp + 3650 days);

        assertFalse(verifier.verifyTransfer(seller, buyer, tokenId, proofs), "an extended deadline was accepted");
    }

    function testFuzz_AProofIsGoodUntilItsSecondAndNotAfter(uint32 life, uint32 elapsed) public {
        life = uint32(bound(life, 1, 365 days));
        elapsed = uint32(bound(elapsed, 0, 2 * uint256(life)));

        uint256 tokenId = _mint(seller);
        uint256 start = block.timestamp;
        uint256 nonce = _withExpiry(uint256(life), start + life);
        IERC7857.TransferValidityProof[] memory proofs = _proof(attestorKey, seller, buyer, tokenId, nonce);

        vm.warp(start + elapsed);

        assertEq(
            verifier.verifyTransfer(seller, buyer, tokenId, proofs),
            elapsed <= life,
            "the boundary is not exactly the stated second"
        );
    }

    function testFuzz_TheExpiryReadBackIsTheExpiryPacked(uint64 validUntil, uint192 unique) public view {
        assertEq(verifier.expiryOf((uint256(validUntil) << 192) | uint256(unique)), validUntil);
    }
}
