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
    function verifyTransfer(
        address from,
        address to,
        uint256 tokenId,
        IERC7857.TransferValidityProof[] calldata proofs
    ) external view returns (bool);
}
