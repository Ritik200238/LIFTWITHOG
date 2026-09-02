// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC7857} from "./interfaces/IERC7857.sol";
import {IERC7857Authorize} from "./interfaces/IERC7857Authorize.sol";
import {IERC7857Cloneable} from "./interfaces/IERC7857Cloneable.sol";
import {ITransferProofVerifier} from "./interfaces/ITransferProofVerifier.sol";

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
contract CoachAgent is ERC721, EIP712, IERC7857, IERC7857Authorize, IERC7857Cloneable {
    using EnumerableSet for EnumerableSet.AddressSet;

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

    /**
     * @dev What a coach costs to clone, and where each clone came from.
     *
     *      Renting a coach borrows a trainer's method for a while. Cloning takes
     *      a copy that then trains on somebody else's data and diverges — which
     *      is what actually happens when a person buys a programme, and what the
     *      rental model cannot express.
     *
     *      `_parentOf` is the part that makes it an economy rather than a copy
     *      button: the descent is on chain, permanently, so a trainer whose
     *      method spreads through three generations of clones can prove it.
     */
    mapping(uint256 tokenId => uint256) private _clonePrice;
    mapping(uint256 childId => uint256 parentId) private _parentOf;

    /**
     * @dev Everyone ever granted access to a coach, for `authorizedUsersOf`.
     *
     *      Validity still lives in `_access` under the current epoch — this set
     *      is only the enumeration the 7857 extension asks for. Entries whose
     *      grant expired or predates a transfer are filtered out by the view
     *      rather than deleted, because deleting them would put a loop over
     *      renters inside `_update` and hand back the unbounded-transfer
     *      problem the epoch design exists to avoid.
     */
    mapping(uint256 tokenId => EnumerableSet.AddressSet) private _grantees;

    /**
     * @dev The TEE/ZKP oracle behind iTransferFrom, or zero for none yet.
     *      Immutable on purpose — see ITransferProofVerifier for the argument.
     */
    address public immutable transferVerifier;

    /// @dev A grant that outlives any subscription: 7857 authorization is
    ///      open-ended by definition, revoked rather than expiring.
    uint64 private constant OPEN_ENDED = type(uint64).max;

    event CoachMinted(uint256 indexed tokenId, address indexed owner, bytes32 configHash);
    event CoachEvolved(uint256 indexed tokenId, uint64 indexed version, bytes32 configHash);
    event AccessGranted(uint256 indexed tokenId, address indexed user, uint64 expiresAt);
    event AccessRevoked(uint256 indexed tokenId, address indexed user);
    event RentalPriceSet(uint256 indexed tokenId, uint256 pricePerDay);
    event Rented(uint256 indexed tokenId, address indexed renter, uint64 expiresAt, uint256 paid);
    event ClonePriceSet(uint256 indexed tokenId, uint256 price);
    event CoachCloned(uint256 indexed parentId, uint256 indexed childId, address indexed owner, uint256 paid);

    error NotCoachOwner();
    error NoSuchCoach();
    error EmptyConfig();
    error ExpiryInPast();
    error NotForRent();
    error WrongPayment(uint256 required);
    error BadDuration();
    error PayoutFailed();
    error NotCloneable();
    error CloneOfNothing();

    /**
     * @dev The v1 deployment at 0xE6CAcDcf1D370E64041Ac9e42D0550A78014259A was
     *      born "OG_FITNESS Coach" and keeps that name forever — an EIP-712
     *      domain is part of a contract's identity, not a label. This is v2:
     *      a fresh deployment under the product's real name, adding the
     *      ERC-7857 surface. The app's signing domain moves with the address,
     *      in the same commit, so the two can never disagree.
     *
     * @param verifier The TEE/ZKP transfer oracle, or zero to deploy with
     *        intelligent transfers honestly disabled until one exists.
     */
    constructor(address verifier) ERC721("LIFTWITHOG Coach", "COACH") EIP712("LIFTWITHOG Coach", "1") {
        transferVerifier = verifier;
    }

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

    bytes32 private constant PRICE_TYPEHASH =
        keccak256("SetRentalPrice(address owner,uint256 tokenId,uint256 pricePerDay,uint256 nonce,uint256 deadline)");

    bytes32 private constant CLONE_PRICE_TYPEHASH =
        keccak256("SetClonePrice(address owner,uint256 tokenId,uint256 price,uint256 nonce,uint256 deadline)");

    bytes32 private constant CLONE_TYPEHASH =
        keccak256(
            "CloneCoach(address owner,uint256 parentId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
        );

    bytes32 private constant EVOLVE_TYPEHASH =
        keccak256(
            "EvolveCoach(address owner,uint256 tokenId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
        );

    /// @dev Signed messages used, per signer. Only ever increases.
    mapping(address signer => uint256) private _nonces;

    error SignatureExpired();
    error WrongSignature();
    error VerifierNotConfigured();
    error TransferProofRejected();

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

        /*
         * The ERC-7857 event, on the path that actually creates coaches.
         *
         * `mint` emitted this and `mintFor` did not — and `mintFor` is how every
         * coach in the product is made, because it is the relayed path that lets
         * somebody own one without holding a coin. So an indexer following the
         * standard saw the intelligent data of the coaches nobody has, and none
         * of the coaches everybody has.
         */
        emit IntelligentDataSet(tokenId, _intelligentDataOf(tokenId));
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
        emit IntelligentDataSet(tokenId, _intelligentDataOf(tokenId));
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

    /**
     * @notice List a coach for rent, or take it off, without holding gas.
     *
     * @dev The gap this closes: `setRentalPrice` is owner-only, and the owner
     *      of a coach minted through this contract is a key on somebody's
     *      phone that has never held a token. Without a relayed path, the one
     *      thing a trainer needs to do to earn — name a price — was the one
     *      thing the gasless design made impossible, and listing a coach meant
     *      installing a wallet and funding it.
     *
     *      Same shape as mintFor: the owner is named in the signed message and
     *      checked against the token's actual owner, so a relayer can pay the
     *      fee and cannot price somebody else's coach.
     */
    function setRentalPriceFor(
        address owner,
        uint256 tokenId,
        uint256 pricePerDay,
        uint256 deadline,
        bytes calldata signature
    ) external {
        address current = _ownerOf(tokenId);
        if (current == address(0)) revert NoSuchCoach();
        if (current != owner) revert NotCoachOwner();

        _useSignature(
            owner,
            keccak256(abi.encode(PRICE_TYPEHASH, owner, tokenId, pricePerDay, _nonces[owner], deadline)),
            deadline,
            signature
        );

        _pricePerDay[tokenId] = pricePerDay;
        emit RentalPriceSet(tokenId, pricePerDay);
    }

    // ----------------------------------------------------------------- clone

    /**
     * @notice Offer this coach for cloning, at a price. Zero withdraws the offer.
     *
     * @dev Renting borrows a method for a while; cloning takes a copy that then
     *      trains on somebody else's data and diverges. That is what actually
     *      happens when a person buys a programme, and the rental model cannot
     *      express it — the copy has to become theirs, and has to stop being the
     *      trainer's problem, while the trainer keeps the credit.
     */
    function setClonePrice(uint256 tokenId, uint256 price) external {
        _requireOwner(tokenId);
        _clonePrice[tokenId] = price;
        emit ClonePriceSet(tokenId, price);
    }

    /// @notice The same, signed by a device that holds no coin.
    function setClonePriceFor(
        address owner,
        uint256 tokenId,
        uint256 price,
        uint256 deadline,
        bytes calldata signature
    ) external {
        address current = _ownerOf(tokenId);
        if (current == address(0)) revert NoSuchCoach();
        if (current != owner) revert NotCoachOwner();

        _useSignature(
            owner,
            keccak256(abi.encode(CLONE_PRICE_TYPEHASH, owner, tokenId, price, _nonces[owner], deadline)),
            deadline,
            signature
        );

        _clonePrice[tokenId] = price;
        emit ClonePriceSet(tokenId, price);
    }

    /**
     * @notice Take a copy of a coach, pay its trainer, and start your own line.
     *
     * @dev The economic centre of this contract, and the thing rentals cannot do.
     *      A trainer's method spreads; every copy records where it came from; the
     *      trainer's credit is on chain through every generation and cannot be
     *      edited out by whoever holds a clone three steps down.
     *
     *      The child is a **new coach with its own brain**, not a pointer at the
     *      parent's. The caller supplies a `configHash` and `configURI` of their
     *      own — in practice the parent's method re-sealed for the new owner, the
     *      same operation an intelligent transfer performs — so a clone diverges
     *      from its parent the first time it learns and the parent's later
     *      versions never reach it. Cloning is not a subscription by another name.
     *
     *      Payment is forwarded to the parent's owner inside this call, exactly
     *      as `rent` does, and this contract never holds it.
     *
     *      Relayed like everything else here: the new owner is named in the
     *      signed message, so whoever submits it can pay the fee and cannot take
     *      the clone.
     */
    function cloneFor(
        address owner,
        uint256 parentId,
        bytes32 configHash,
        string calldata configURI,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (uint256 tokenId) {
        address parentOwner = _ownerOf(parentId);
        if (parentOwner == address(0)) revert NoSuchCoach();
        if (configHash == bytes32(0) || bytes(configURI).length == 0) revert EmptyConfig();

        uint256 price = _clonePrice[parentId];
        if (price == 0) revert NotCloneable();
        if (msg.value != price) revert WrongPayment(price);

        _useSignature(
            owner,
            keccak256(
                abi.encode(
                    CLONE_TYPEHASH,
                    owner,
                    parentId,
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

        // Written before the payout, so a re-entrant parent owner cannot observe
        // a clone that exists without a recorded parent.
        _parentOf[tokenId] = parentId;

        emit CoachMinted(tokenId, owner, configHash);
        emit IntelligentDataSet(tokenId, _intelligentDataOf(tokenId));
        emit CoachCloned(parentId, tokenId, owner, msg.value);

        // Last, as in `rent`: the contract is an authorisation ledger and holds
        // nothing, so the money leaves in the same call that brought it.
        (bool paid, ) = payable(parentOwner).call{value: msg.value}("");
        if (!paid) revert PayoutFailed();
    }

    /// @notice What cloning this coach costs, or zero if it is not on offer.
    function clonePrice(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        return _clonePrice[tokenId];
    }

    /// @notice Which coach this one was cloned from, or zero if it is an original.
    function parentOf(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        return _parentOf[tokenId];
    }

    /**
     * @notice How far down a line of descent this coach sits. An original is 1.
     *
     * @dev Bounded by `maxDepth` rather than walking until it stops, because the
     *      chain of parents is written by users and a view that walks it without
     *      a limit is a view that can be made to exceed the call gas cap — which
     *      would make a coach's own lineage permanently unreadable.
     */
    function generationOf(uint256 tokenId, uint256 maxDepth) external view returns (uint256 generation, bool complete) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();

        generation = 1;
        uint256 at = tokenId;

        for (uint256 i = 0; i < maxDepth; i++) {
            uint256 parent = _parentOf[at];
            if (parent == 0) return (generation, true);
            generation += 1;
            at = parent;
        }

        return (generation, false);
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
        emit IntelligentDataSet(tokenId, _intelligentDataOf(tokenId));
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

        // The mirror of the gap in `mintFor`: `evolveFor` announced the new
        // intelligent data and this did not, so the two ways of learning the
        // same thing told an indexer different stories.
        emit IntelligentDataSet(tokenId, _intelligentDataOf(tokenId));
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
        _grantees[tokenId].add(user);
        emit AccessGranted(tokenId, user, expiresAt);
    }

    /// @notice End somebody's access before its expiry.
    function revokeAccess(uint256 tokenId, address user) external {
        _requireOwner(tokenId);

        delete _access[_grantKey(tokenId, user)];
        _grantees[tokenId].remove(user);
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
        _grantees[tokenId].add(msg.sender);
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
        return _hasAccess(tokenId, user);
    }

    /// @dev Shared by hasAccess and the ERC-7857 authorization views.
    function _hasAccess(uint256 tokenId, address user) private view returns (bool) {
        if (_ownerOf(tokenId) == user) return true;

        // Same reasoning: a few seconds either side of a month-long grant is not
        // a meaningful attack, and there is no better clock on chain.
        // forge-lint: disable-next-line(block-timestamp)
        return _access[_grantKey(tokenId, user)] > block.timestamp;
    }

    /// @notice When this address's access ends, or zero if it has none.
    /// @dev Reverts for a coach that does not exist, like every other view here.
    ///      Alone among them it used to answer zero, which reads as "no access"
    ///      — the same answer a real coach gives — so a caller with a wrong id
    ///      was told a plausible thing instead of that the id was wrong.
    function accessExpiry(uint256 tokenId, address user) external view returns (uint64) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
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

    // -------------------------------------------------- ERC-7857 Agentic ID

    /**
     * @notice The coach's encrypted brain, in the words of the standard.
     *
     * @dev This is not an adapter bolted on for a checklist: the coach was
     *      already an ERC-7857-shaped thing — a token whose value is encrypted
     *      data at a URI, with a hash to hold the ciphertext to, and usage
     *      grants that let others run it without owning it. This surface says
     *      so in the vocabulary the rest of the 0G ecosystem indexes.
     */
    function getIntelligentDatas(uint256 tokenId) external view returns (IntelligentData[] memory) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        return _intelligentDataOf(tokenId);
    }

    /// @dev Shared by the view and the two events that announce data changes.
    function _intelligentDataOf(uint256 tokenId) private view returns (IntelligentData[] memory data) {
        Coach storage coach = _coaches[tokenId];
        data = new IntelligentData[](1);
        data[0] = IntelligentData({
            dataDescription: string.concat(
                "AES-256-GCM encrypted coaching profile, version ",
                Strings.toString(coach.version),
                ", ciphertext on 0G Storage at ",
                coach.configURI
            ),
            dataHash: coach.configHash
        });
    }

    /**
     * @notice Transfer with proof that the brain was re-encrypted for the buyer.
     *
     * @dev Verification is delegated to the immutable oracle. Deployed with
     *      none, this reverts rather than pretending: an iTransferFrom that
     *      checks nothing would look identical on the surface and be a lie
     *      underneath. Plain transferFrom keeps working either way — it hands
     *      over the token and voids every grant, it just cannot promise the
     *      buyer a re-encrypted brain.
     */
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external {
        if (transferVerifier == address(0)) revert VerifierNotConfigured();
        /*
         * `attestTransfer`, not `verifyTransfer`: the attestation is spent here,
         * not merely read. ERC-721's authorization already stops the same proof
         * moving the coach twice in a row, but not the round trip — sell and buy
         * back, and yesterday's attestation would bless today's sale with no
         * re-encryption behind it.
         */
        if (!ITransferProofVerifier(transferVerifier).attestTransfer(from, to, tokenId, proofs)) {
            revert TransferProofRejected();
        }

        // Ordinary ERC-721 authorization still applies — the oracle attests to
        // re-encryption, it does not replace the owner's consent.
        transferFrom(from, to, tokenId);
        emit IntelligentTransfer(from, to, tokenId);
    }

    /**
     * @notice Let an executor use this coach without owning it, until revoked.
     *
     * @dev 7857 authorization is open-ended where a rental expires: it is the
     *      grant for your own devices and agents, not the subscription. Both
     *      end the moment the coach is sold — the epoch bump voids them
     *      together.
     */
    function authorizeUsage(uint256 tokenId, address user) external {
        _requireOwner(tokenId);

        _access[_grantKey(tokenId, user)] = OPEN_ENDED;
        _grantees[tokenId].add(user);
        emit UsageAuthorized(tokenId, user);
        emit AccessGranted(tokenId, user, OPEN_ENDED);
    }

    /// @notice Take an executor's usage back.
    function revokeAuthorization(uint256 tokenId, address user) external {
        _requireOwner(tokenId);

        delete _access[_grantKey(tokenId, user)];
        _grantees[tokenId].remove(user);
        emit UsageRevoked(tokenId, user);
        emit AccessRevoked(tokenId, user);
    }

    /// @notice May this address run the coach right now? Owner, renter or authorized.
    function isAuthorizedUser(uint256 tokenId, address user) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();
        return _hasAccess(tokenId, user);
    }

    /**
     * @notice Everyone whose grant is good right now.
     *
     * @dev A view that filters rather than storage that prunes: expired
     *      rentals and grants voided by a sale simply stop appearing. The set
     *      they linger in costs nothing to read past, and leaving it unpruned
     *      is what keeps transfers constant-gas.
     */
    function authorizedUsersOf(uint256 tokenId) external view returns (address[] memory users) {
        if (_ownerOf(tokenId) == address(0)) revert NoSuchCoach();

        EnumerableSet.AddressSet storage all = _grantees[tokenId];
        uint256 total = all.length();

        uint256 live = 0;
        address[] memory scratch = new address[](total);
        for (uint256 i = 0; i < total; i++) {
            address user = all.at(i);
            // forge-lint: disable-next-line(block-timestamp)
            if (_access[_grantKey(tokenId, user)] > block.timestamp) {
                scratch[live++] = user;
            }
        }

        users = new address[](live);
        for (uint256 i = 0; i < live; i++) {
            users[i] = scratch[i];
        }
    }

    /// @notice The same open-ended grant, across several coaches at once.
    function batchAuthorizeUsage(uint256[] calldata tokenIds, address user) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            _requireOwner(tokenId);

            _access[_grantKey(tokenId, user)] = OPEN_ENDED;
            _grantees[tokenId].add(user);
            emit UsageAuthorized(tokenId, user);
            emit AccessGranted(tokenId, user, OPEN_ENDED);
        }
    }

    /**
     * @notice The standard's clone: an attested copy, to somebody else.
     *
     * @dev The 7857 spelling of what `cloneFor` does commercially. This one is
     *      gated on the same attestation an intelligent transfer needs — the
     *      copy's brain must have been re-encrypted for the receiver, and the
     *      verifier says whether it was — and takes no payment, because the
     *      standard does not describe one.
     *
     *      Both exist on purpose. `iCloneFrom` is what an indexer, a marketplace
     *      or another 7857 contract expects to find. `cloneFor` is the path this
     *      product actually uses: relayed, so the new owner needs no coin, and
     *      priced, so the trainer is paid.
     */
    function iCloneFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external returns (uint256 newTokenId) {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert NoSuchCoach();
        if (owner != from) revert NotCoachOwner();

        // Ordinary ERC-721 authorisation still applies: the oracle attests to
        // re-encryption, it does not replace the owner's consent to copy.
        if (msg.sender != from && !isApprovedForAll(from, msg.sender) && getApproved(tokenId) != msg.sender) {
            revert NotCoachOwner();
        }

        if (transferVerifier == address(0)) revert VerifierNotConfigured();
        if (!ITransferProofVerifier(transferVerifier).attestTransfer(from, to, tokenId, proofs)) {
            revert TransferProofRejected();
        }

        Coach storage parent = _coaches[tokenId];

        newTokenId = _nextId++;
        _safeMint(to, newTokenId);

        /*
         * The copy points at the parent's ciphertext for exactly as long as it
         * takes the new owner to evolve it, which re-seals under their own key.
         * That is the honest reading of "clone" here: the same brain, then two
         * histories.
         */
        _coaches[newTokenId] = Coach({
            configHash: parent.configHash,
            configURI: parent.configURI,
            version: 1,
            updatedAt: uint64(block.timestamp)
        });

        _parentOf[newTokenId] = tokenId;

        emit CoachMinted(newTokenId, to, parent.configHash);
        emit IntelligentDataSet(newTokenId, _intelligentDataOf(newTokenId));
        emit CoachCloned(tokenId, newTokenId, to, 0);
        emit IntelligentClone(from, to, tokenId, newTokenId);
    }

    /// @notice This token speaks ERC-721 and ERC-7857, core, authorization and cloning.
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC7857).interfaceId
            || interfaceId == type(IERC7857Authorize).interfaceId
            || interfaceId == type(IERC7857Cloneable).interfaceId
            || super.supportsInterface(interfaceId);
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
