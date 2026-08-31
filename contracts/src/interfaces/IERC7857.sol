// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC7857 - Agentic ID Standard
 * @notice Interface for NFTs with privacy-preserving encrypted metadata (Intelligent Data).
 *         When transferred, encrypted data is re-encrypted for the new owner using
 *         cryptographic proofs verified by TEE or ZKP oracles.
 *
 * @dev Vendored verbatim from 0G's agenticID-examples reference implementation,
 *      so that this contract answers to the exact interface the rest of the 0G
 *      ecosystem compiles against — a re-typed copy that drifts by one field
 *      would produce different selectors and be 7857 in name only.
 */
interface IERC7857 {
    struct IntelligentData {
        string dataDescription;
        bytes32 dataHash;
    }

    struct AccessProof {
        bytes targetPublicKey;
        bytes signature;
    }

    struct OwnershipProof {
        bytes sealedKey;
        bytes signature;
        uint256 nonce;
    }

    struct TransferValidityProof {
        AccessProof accessProof;
        OwnershipProof ownershipProof;
    }

    event IntelligentDataSet(uint256 indexed tokenId, IntelligentData[] data);
    event IntelligentTransfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external;

    function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory);
}
