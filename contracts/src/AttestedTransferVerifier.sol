// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC7857} from "./interfaces/IERC7857.sol";
import {ITransferProofVerifier} from "./interfaces/ITransferProofVerifier.sol";

/**
 * @title The oracle that says a coach's brain was really re-encrypted.
 *
 * @notice ERC-7857 exists for one moment: an agent changes hands, and its
 *         encrypted intelligence is re-encrypted to the buyer so the seller's
 *         copy of the key stops being useful. The standard leaves *who attests
 *         that* to a verifier. This is that verifier.
 *
 *         What it checks, per transfer:
 *
 *           1. the attestor signed this exact move — from, to, and which coach;
 *           2. the signature covers the sealed key the buyer will actually use
 *              and the public key it was sealed to, so a valid attestation for
 *              one re-encryption cannot be presented for a different one;
 *           3. the nonce in the proof has not been used before, so a transfer
 *              cannot be replayed to move a coach back.
 *
 * @dev **The attestor is a software key, not hardware.** It runs in the same
 *      service that performs the re-encryption, and it is trusted to sign only
 *      after it has done so. That is weaker than a TEE quote and it is said here
 *      rather than in a README, because a verifier that implies more assurance
 *      than it has is worse than no verifier: it launders an unchecked claim
 *      into an on-chain one. When 0G's production TEE verifier ships, this
 *      contract is replaced by pointing a new CoachAgent deployment at it.
 *
 *      What it is not is a pretence. The alternative shipped previously was
 *      `address(0)`, under which `iTransferFrom` reverted on every call forever
 *      — which is honest, and also means the standard's central mechanism was
 *      not implemented. This one moves coaches, and refuses the four ways a
 *      transfer can be forged that a signature check can actually see.
 *
 *      No owner, no pause, no upgrade, matching the contract it serves. The
 *      attestor is immutable: an attestor that could be swapped is an admin key
 *      over everybody's property, wearing a different name.
 */
contract AttestedTransferVerifier is ITransferProofVerifier {
    using ECDSA for bytes32;

    /// @notice The key whose signature makes a re-encryption believable.
    address public immutable attestor;

    /**
     * @notice Nonces already spent, per attestor signature.
     * @dev Replay is the one attack a stateless verifier cannot see. Without
     *      this, the attestation for a sale is a bearer token: anybody who saw
     *      it on chain could present it again to move the coach a second time.
     */
    mapping(uint256 nonce => bool used) public spent;

    /**
     * @notice How an expiry is carried inside a nonce.
     *
     * @dev The proof struct is `IERC7857.OwnershipProof`, vendored verbatim from
     *      0G, and it has three fields: a sealed key, a signature, and a
     *      `uint256 nonce`. There is nowhere to put a validity window, and
     *      adding one would mean editing the vendored interface — which changes
     *      selectors and makes this 7857 in name only.
     *
     *      So the nonce carries both, the way Permit2 packs a word and a bit
     *      into one: the top 64 bits are a unix expiry, the bottom 192 are the
     *      unique part. The digest already covers the whole nonce, so the
     *      expiry is signed by the attestor without a single byte of interface
     *      change, and cannot be edited by whoever relays the proof.
     *
     *      Why it matters: without it an attestation is good forever. The
     *      re-encryption it vouches for happened at a moment, and a proof that
     *      outlives that moment by a year is a bearer token sitting in public
     *      calldata. Spending the nonce stops it being used twice; the expiry
     *      stops it being used *late* — a proof signed for a sale that never
     *      settled cannot be presented next year against the same pair of
     *      addresses.
     *
     *      It does not solve attestor key compromise. Nothing here does: a
     *      stolen key mints fresh proofs with fresh expiries. That is the
     *      accepted cost of having no admin who can rotate it, and it is stated
     *      plainly in SECURITY.md rather than implied away here.
     */
    uint256 private constant NONCE_BITS = 192;

    /// @notice The expiry packed into a nonce, as unix seconds.
    /// @dev Shifting by 192 leaves at most 64 bits, so the cast cannot truncate.
    // forge-lint: disable-next-line(unsafe-typecast)
    function expiryOf(uint256 nonce) public pure returns (uint64) {
        return uint64(nonce >> NONCE_BITS);
    }

    error NoAttestor();
    error NoProof();

    event TransferAttested(address indexed from, address indexed to, uint256 indexed tokenId, uint256 nonce);

    constructor(address attestor_) {
        if (attestor_ == address(0)) revert NoAttestor();
        attestor = attestor_;
    }

    /**
     * @notice Is this re-encryption attested, and is it fresh?
     *
     * @dev Not a view, despite the interface: spending the nonce is a write, and
     *      it has to be, or the check is advisory. `ITransferProofVerifier`
     *      declares `view`, so `CoachAgent` calls this through that interface and
     *      solidity would forbid the state change — which is why the coach
     *      contract calls `attestTransfer` below instead, and this stays as the
     *      read-only half for anybody wanting to check without spending.
     */
    function verifyTransfer(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof[] calldata proofs
    ) external view returns (bool) {
        if (proofs.length == 0) return false;

        IERC7857.TransferValidityProof calldata proof = proofs[0];
        if (spent[proof.ownershipProof.nonce]) return false;
        if (_expired(proof.ownershipProof.nonce)) return false;

        return _signedByAttestor(from, to, tokenId, proof);
    }

    /**
     * @notice The same check, spending the nonce so it cannot be reused.
     *
     * @dev Returns rather than reverts, so the calling token contract decides
     *      what a failed attestation means to the person in front of it.
     */
    function attestTransfer(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof[] calldata proofs
    ) external returns (bool) {
        if (proofs.length == 0) revert NoProof();

        IERC7857.TransferValidityProof calldata proof = proofs[0];
        uint256 nonce = proof.ownershipProof.nonce;

        if (spent[nonce]) return false;
        if (_expired(nonce)) return false;
        if (!_signedByAttestor(from, to, tokenId, proof)) return false;

        spent[nonce] = true;
        emit TransferAttested(from, to, tokenId, nonce);
        return true;
    }

    /**
     * @dev The message the attestor signs.
     *
     *      Every field that could be substituted is in it. Binding the sealed
     *      key and the target public key is what stops an attestation for a
     *      genuine re-encryption being reused to bless a different one — the
     *      attack a naive `sign(from, to, tokenId)` walks straight into, because
     *      the interesting part of a 7857 transfer is precisely the key material
     *      that a from/to/id triple says nothing about.
     *
     *      `address(this)` and `block.chainid` are in the hash so an attestation
     *      cannot be carried to another chain or another verifier deployment.
     */
    function digest(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata targetPublicKey,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    from,
                    to,
                    tokenId,
                    keccak256(sealedKey),
                    keccak256(targetPublicKey),
                    nonce
                )
            );
    }

    /**
     * @dev Is this proof past its stated moment?
     *
     * A zero expiry is refused rather than treated as "never expires". An
     * unbounded attestation is the thing this exists to remove, and letting the
     * absence of a value mean the most permissive reading is how that comes
     * back by accident.
     */
    function _expired(uint256 nonce) private view returns (bool) {
        uint64 validUntil = expiryOf(nonce);
        if (validUntil == 0) return true;
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > validUntil;
    }

    function _signedByAttestor(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof calldata proof
    ) private view returns (bool) {
        bytes32 hash = digest(
            from,
            to,
            tokenId,
            proof.ownershipProof.sealedKey,
            proof.accessProof.targetPublicKey,
            proof.ownershipProof.nonce
        );

        /*
         * `tryRecover`, not `recover`: a malformed signature is a false answer
         * here, not a revert. A verifier that reverts on rubbish lets anybody
         * turn a refused transfer into an unexplained failure.
         */
        (address signer, ECDSA.RecoverError err, ) =
            MessageHashUtils.toEthSignedMessageHash(hash).tryRecover(proof.ownershipProof.signature);

        return err == ECDSA.RecoverError.NoError && signer == attestor;
    }
}
