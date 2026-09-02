// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC7857} from "./IERC7857.sol";

/**
 * @title The oracle that makes an intelligent transfer honest.
 *
 * @notice ERC-7857's whole point is that when an agent changes hands, its
 *         encrypted brain is re-encrypted to the buyer — and somebody neutral
 *         attests that actually happened. That somebody is a TEE or ZKP oracle
 *         standing behind this interface.
 *
 * @dev The verifier address is set at deployment and immutable. There is no
 *      admin who can swap it later, for the same reason the rest of this
 *      contract has no owner role: a coach is somebody's property, and property
 *      whose rules can be changed under it by a third party is custody wearing
 *      a costume. When 0G's production verifier ships, pointing at it is a new
 *      deployment that owners migrate to by choice.
 */
interface ITransferProofVerifier {
    /**
     * @notice Read-only: would this attestation be accepted right now?
     *
     * @dev For anybody wanting to check a proof without consuming it — a
     *      marketplace previewing a sale, or a person verifying one after the
     *      fact. It deliberately does not spend the nonce, so it must not be
     *      what a token contract relies on.
     */
    function verifyTransfer(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof[] calldata proofs
    ) external view returns (bool);

    /**
     * @notice The same check, consuming the attestation so it works once.
     *
     * @dev This is the one a token contract calls, and it is not `view` for a
     *      reason worth stating. ERC-721's own authorization stops the obvious
     *      replay: once the coach has moved, `from` no longer owns it. It does
     *      not stop the round trip — sell a coach, buy it back, and the original
     *      attestation is valid again, so the second sale can be waved through
     *      with the first sale's proof and no re-encryption behind it. Marking
     *      the nonce spent is what closes that, and marking anything is a write.
     */
    function attestTransfer(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof[] calldata proofs
    ) external returns (bool);
}
