// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title CoachAgent
 * @notice An AI coach you own, on 0G Chain.
 *
 * @dev **Why this exists.**
 *
 *      A workout app that stores everything locally has a problem it cannot
 *      solve on its own: nothing it holds is worth anything to anyone else. The
 *      coach that learned how you train over three years is a row in a browser
 *      database. Reinstall and it is gone. Switch apps and it never existed.
 *
 *      This makes the coach a thing that exists independently of the app. It is
 *      owned, it has a history, it can be handed to somebody else, and it can be
 *      rented out. None of those are possible against a local file.
 *
 *      **The rental case is the point.** Trainers today sell workout plans as
 *      PDFs over WhatsApp for a few thousand rupees. The PDF is screenshotted
 *      within a week and the trainer is paid once for something copied forever.
 *      A coach whose configuration is encrypted and whose access is granted per
 *      address, with an expiry, is the same sale without the leak.
 *
 * @dev **What this contract does and does not guarantee.**
 *
 *      It governs *authorisation*: who the chain says may use a coach, and until
 *      when. That is enforced here and is not bypassable.
 *
 *      It does not by itself guarantee *confidentiality*. The configuration
 *      pointed at below is encrypted and lives on 0G Storage; whether a renter
 *      can read it depends on where the decryption happens. Run inside a 0G
 *      Compute TEE, the renter sees output and never the method. Decrypt it in
 *      the renter's own browser and the protection is gone, whatever this
 *      contract says.
 *
 *      Stated plainly because the difference is the entire product claim, and a
 *      contract comment that overstates it would be the worst place to be wrong.
 */
contract CoachAgent is ERC721, EIP712 {
    /// @notice A coach's encrypted brain, as it stands right now.
    struct Coach {
        /// @dev keccak256 of the ciphertext. What integrity is checked against.
        bytes32 configHash;
        /// @dev Where the ciphertext lives on 0G Storage.
        string configURI;
        /// @dev Bumped every time the coach learns something. Never resets.
        uint64 version;
        uint64 updatedAt;
    }

    uint256 private _nextId = 1;

    mapping(uint256 tokenId => Coach) private _coaches;

    /**
     * @dev Which "generation" of access a token is on.
     *
     * Selling a coach must not carry its renters across with it — the new owner
     * inherits the coach, not the previous owner's customers. Rather than walk a
     * list of addresses on every transfer, which is unbounded gas and therefore
     * a way to make a token untransferable, each transfer bumps this counter and
     * every grant from before it stops matching.
     */
    mapping(uint256 tokenId => uint64) private _epoch;

    /// @dev keccak256(tokenId, epoch, user) => unix seconds at which access ends.
    mapping(bytes32 grant => uint64 expiresAt) private _access;

    /**
     * @dev Price for one day of access, in wei of 0G. Zero means not for rent —
     *      the owner can still `grantAccess` by hand, so a trainer can comp a
     *      friend without putting the coach on the market.
     */
    mapping(uint256 tokenId => uint256) private _pricePerDay;

    event CoachMinted(uint256 indexed tokenId, address indexed owner, bytes32 configHash);
    event CoachEvolved(uint256 indexed tokenId, uint64 indexed version, bytes32 configHash);
    event AccessGranted(uint256 indexed tokenId, address indexed user, uint64 expiresAt);
    event AccessRevoked(uint256 indexed tokenId, address indexed user);
    event RentalPriceSet(uint256 indexed tokenId, uint256 pricePerDay);
    event Rented(uint256 indexed tokenId, address indexed renter, uint64 expiresAt, uint256 paid);

    error NotCoachOwner();
    error NoSuchCoach();
    error EmptyConfig();
    error ExpiryInPast();
    error NotForRent();
    error WrongPayment(uint256 required);
    error BadDuration();
    error PayoutFailed();

    constructor() ERC721("OG_FITNESS Coach", "COACH") EIP712("OG_FITNESS Coach", "1") {}

    // ------------------------------------------------------------- relayed

    /**
     * @dev What a device signs to have a coach minted for it.
     *
     * The app generates a key on the phone and never shows it to anybody. That
     * address owns the coach; it simply has no gas, and telling somebody to
     * install a wallet and fund it before they can have a coach is the end of
     * the conversation for all but a handful of people.
     *
     * So the device signs and anybody may submit. The signature names the owner,
     * so a relayer can pay the fee and cannot redirect the result.
     */
    bytes32 private constant MINT_TYPEHASH =
        keccak256("MintCoach(address owner,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)");

    bytes32 private constant EVOLVE_TYPEHASH =
        keccak256(
            "EvolveCoach(address owner,uint256 tokenId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
        );

    /// @dev Signed messages used, per signer. Only ever increases.
    mapping(address signer => uint256) private _nonces;

    error SignatureExpired();
    error WrongSignature();

    /// @notice The nonce this address must sign its next message with.
    function nonceOf(address signer) external view returns (uint256) {
        return _nonces[signer];
    }

    /**
     * @notice Mint a coach for `owner`, paid for by whoever submits this.
     *
     * @dev The owner is named in the signed message rather than recovered into,
     *      which is the same shape as an ERC-2612 permit and for the same
     *      reason: the nonce is the owner's, and a digest cannot be built from
     *      an address that has not been recovered yet.
     *
     *      The coach goes to `owner` and nowhere else. A relayer able to
     *      redirect the mint would be a relayer able to take every coach it was
     *      asked to pay for.
     */
    function mintFor(
        address owner,
        bytes32 configHash,
        string calldata configURI,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        if (configHash == bytes32(0) || bytes(configURI).length == 0) revert EmptyConfig();

        _useSignature(
            owner,
            keccak256(
                abi.encode(
                    MINT_TYPEHASH,
                    owner,
                    configHash,
                    keccak256(bytes(configURI)),
                    _nonces[owner],
                    deadline
                )
            ),
            deadline,
            signature
        );

        tokenId = _nextId++;
        _safeMint(owner, tokenId);

        _coaches[tokenId] = Coach({
            configHash: configHash,
            configURI: configURI,
            version: 1,
            updatedAt: uint64(block.timestamp)
        });

        emit CoachMinted(tokenId, owner, configHash);
    }

    /**
     * @notice Record what a coach learned, paid for by whoever submits this.
     *
     * @dev This is the flywheel: the app evolves a coach in the background every
     *      few sessions, and the person training never waits for a chain, never
     *      confirms anything, and never needs a coin. The signature is produced
     *      by the key their device already holds.
     */
    function evolveFor(
        address owner,
        uint256 tokenId,
        bytes32 configHash,
        string calldata configURI,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (configHash == bytes32(0) || bytes(configURI).length == 0) revert EmptyConfig();

        address current = _ownerOf(tokenId);
        if (current == address(0)) revert NoSuchCoach();
        // Signed by somebody who is not the owner is not an authorisation.
        if (current != owner) revert NotCoachOwner();

        _useSignature(
            owner,
            keccak256(
                abi.encode(
                    EVOLVE_TYPEHASH,
                    owner,
                    tokenId,
                    configHash,
                    keccak256(bytes(configURI)),
                    _nonces[owner],
                    deadline
                )
            ),
            deadline,
            signature
        );

        Coach storage coach = _coaches[tokenId];
        coach.configHash = configHash;
        coach.configURI = configURI;
        coach.version += 1;
        coach.updatedAt = uint64(block.timestamp);

        emit CoachEvolved(tokenId, coach.version, configHash);
    }

    /**
     * @dev Check a signature, then spend it.
     *
     * The nonce is consumed whether or not what follows succeeds, because a
     * signature that can be presented twice is a signature that can be replayed
     * — and the whole point of relaying is that somebody else is holding it.
     */
    function _useSignature(
        address owner,
        bytes32 structHash,
        uint256 deadline,
        bytes calldata signature
    ) private {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert SignatureExpired();

        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != owner) revert WrongSignature();

        _nonces[owner] += 1;
    }

    // ------------------------------------------------------------------ mint

    /**
     * @notice Bring a coach into existence.
     * @param configHash keccak256 of the encrypted configuration.
     * @param configURI  Where that ciphertext lives on 0G Storage.
     *
     * Permissionless on purpose. Anybody may own a coach, and gating it behind a
     * role would put this app back in the position of deciding whose training
     * history is allowed to exist.
     */
    function mint(bytes32 configHash, string calldata configURI) external returns (uint256 tokenId) {
        if (configHash == bytes32(0) || bytes(configURI).length == 0) revert EmptyConfig();

        tokenId = _nextId++;
        _safeMint(msg.sender, tokenId);

        _coaches[tokenId] = Coach({
            configHash: configHash,
            configURI: configURI,
            version: 1,
            updatedAt: uint64(block.timestamp)
        });

        emit CoachMinted(tokenId, msg.sender, configHash);
    }

    // ---------------------------------------------------------------- evolve

    /**
     * @notice Record that the coach has learned something.
     *
     * @dev The version only ever goes up, and every version is an event. That is
     *      what makes "this coach has trained with me for two years" a claim
     *      somebody can check rather than a sentence in an app.
     */
    function evolve(uint256 tokenId, bytes32 configHash, string calldata configURI) external {
        _requireOwner(tokenId);
        if (configHash == bytes32(0) || bytes(configURI).length == 0) revert EmptyConfig();

        Coach storage coach = _coaches[tokenId];
        coach.configHash = configHash;
        coach.configURI = configURI;
        coach.version += 1;
        coach.updatedAt = uint64(block.timestamp);

        emit CoachEvolved(tokenId, coach.version, configHash);
    }

    // ---------------------------------------------------------------- rental

    /**
     * @notice Let somebody else use this coach until a given moment.
     *
     * @dev An expiry rather than an open grant that has to be taken back.
     *      A subscription that ends by default is the one that ends; a
     *      subscription that ends when the trainer remembers to revoke it is a
     *      subscription that quietly never ends.
     */
    function grantAccess(uint256 tokenId, address user, uint64 expiresAt) external {
        _requireOwner(tokenId);
        // A validator can nudge the timestamp by a handful of seconds. This is a
        // subscription measured in weeks, so the only thing that leeway can do
        // is reject a grant that was already expiring as it was written.
        // forge-lint: disable-next-line(block-timestamp)
        if (expiresAt <= block.timestamp) revert ExpiryInPast();

        _access[_grantKey(tokenId, user)] = expiresAt;
        emit AccessGranted(tokenId, user, expiresAt);
    }

    /// @notice End somebody's access before its expiry.
    function revokeAccess(uint256 tokenId, address user) external {
        _requireOwner(tokenId);

        delete _access[_grantKey(tokenId, user)];
        emit AccessRevoked(tokenId, user);
    }

    // --------------------------------------------------------------- payment

    /**
     * @notice Put this coach on the market, or take it off with a price of zero.
     * @param pricePerDay Wei of 0G for one day of access.
     */
    function setRentalPrice(uint256 tokenId, uint256 pricePerDay) external {
        _requireOwner(tokenId);
        _pricePerDay[tokenId] = pricePerDay;
        emit RentalPriceSet(tokenId, pricePerDay);
    }

    /// @notice What a day of this coach costs. Zero means it is not for rent.
    function rentalPrice(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        return _pricePerDay[tokenId];
    }

    /**
     * @notice Rent this coach: pay, and the access exists before the block ends.
     *
     * @dev Payment and authorisation are one transaction on purpose. Split
     *      across two — pay the trainer somewhere, then wait for them to call
     *      `grantAccess` — the renter is trusting a stranger to remember, and
     *      the trainer is fielding refund demands from people they cannot see.
     *      Here neither trusts the other, and there is no "us" in the middle
     *      holding anybody's money: the payment forwards to the owner in the
     *      same transaction that grants the access.
     *
     *      Renting again extends the existing window rather than replacing it,
     *      so renewing early never costs the days already paid for.
     *
     *      The exact amount is required, not a minimum. A refund path for
     *      overpayment is a second value transfer and a reentrancy surface,
     *      bought to support a mistake a wallet will not make.
     */
    function rent(uint256 tokenId, uint256 dayCount) external payable {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert NoSuchCoach();

        uint256 price = _pricePerDay[tokenId];
        if (price == 0) revert NotForRent();
        if (dayCount == 0 || dayCount > 365) revert BadDuration();

        uint256 cost = price * dayCount;
        if (msg.value != cost) revert WrongPayment(cost);

        bytes32 key = _grantKey(tokenId, msg.sender);
        uint64 current = _access[key];
        // A renewal extends what is left; a lapsed or first rental starts now.
        // A validator can nudge the clock by seconds against a window of days.
        // forge-lint: disable-next-line(block-timestamp)
        uint64 startFrom = current > block.timestamp ? current : uint64(block.timestamp);
        // dayCount is capped at 365 above, so this is at most ~31.5 million and
        // cannot truncate a uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiresAt = startFrom + uint64(dayCount * 1 days);

        _access[key] = expiresAt;
        emit Rented(tokenId, msg.sender, expiresAt, msg.value);
        emit AccessGranted(tokenId, msg.sender, expiresAt);

        /*
         * Interaction last, after every state change, so a hostile owner
         * contract re-entering sees the rental already recorded. If the owner
         * cannot receive funds at all, the rental fails whole rather than
         * taking money for access the payer got but the trainer was never
         * paid for.
         */
        (bool paid, ) = owner.call{value: msg.value}("");
        if (!paid) revert PayoutFailed();
    }

    /**
     * @notice May this address use this coach right now?
     *
     * @dev What an executor checks before running the thing. The owner always
     *      may; everybody else needs an unexpired grant from the current epoch.
     */
    function hasAccess(uint256 tokenId, address user) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        if (_ownerOf(tokenId) == user) return true;

        // Same reasoning: a few seconds either side of a month-long grant is not
        // a meaningful attack, and there is no better clock on chain.
        // forge-lint: disable-next-line(block-timestamp)
        return _access[_grantKey(tokenId, user)] > block.timestamp;
    }

    /// @notice When this address's access ends, or zero if it has none.
    function accessExpiry(uint256 tokenId, address user) external view returns (uint64) {
        return _access[_grantKey(tokenId, user)];
    }

    // ----------------------------------------------------------------- reads

    /// @notice The coach as it currently stands.
    function coachOf(uint256 tokenId)
        external
        view
        returns (bytes32 configHash, string memory configURI, uint64 version, uint64 updatedAt)
    {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();

        Coach storage coach = _coaches[tokenId];
        return (coach.configHash, coach.configURI, coach.version, coach.updatedAt);
    }

    /// @notice How many coaches exist. Ids run from 1 to this number.
    function totalMinted() external view returns (uint256) {
        return _nextId - 1;
    }

    // -------------------------------------------------------------- internal

    function _requireOwner(uint256 tokenId) private view {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert NoSuchCoach();
        if (owner != msg.sender) revert NotCoachOwner();
    }

    function _grantKey(uint256 tokenId, address user) private view returns (bytes32) {
        return keccak256(abi.encode(tokenId, _epoch[tokenId], user));
    }

    /**
     * @dev Every transfer starts a new generation of access.
     *
     * Selling a coach hands over the coach, never the previous owner's client
     * list. Bumping a counter does that in constant gas; walking a list of
     * granted addresses would let a coach with enough renters become impossible
     * to transfer at all.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);

        // Not on mint, where there is nothing to carry over.
        if (from != address(0)) _epoch[tokenId] += 1;
    }
}
