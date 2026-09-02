// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CoachAgent} from "../src/CoachAgent.sol";

/**
 * The same guarantees, argued against every input rather than a chosen one.
 *
 * The hand-written suite next door picks the cases a person thinks of. That is
 * exactly its weakness: a rental priced at 3 wei for 365 days, an expiry one
 * second away, a renewal made in the last second of the old window — nobody
 * writes those down, and each is a real transaction somebody can send.
 *
 * Everything below is a property rather than an example. If a property can be
 * broken by any input the fuzzer can reach, the trainer loses income or the
 * renter loses access they paid for, and the test says which input did it.
 */
contract CoachAgentFuzzTest is Test {
    CoachAgent private coach;

    address private trainer = address(0xA11CE);
    address private athlete = address(0xB0B);

    bytes32 private constant CONFIG = keccak256("encrypted coaching method v1");
    string private constant URI = "og://storage/root/abc123";

    function setUp() public {
        coach = new CoachAgent(address(0));
        vm.warp(1_700_000_000);
    }

    function _mint(address owner) private returns (uint256 tokenId) {
        vm.prank(owner);
        tokenId = coach.mint(CONFIG, URI);
    }

    /// An address that can actually receive ETH, which a random fuzzed address may not.
    function _payableActor(address candidate) private view returns (bool) {
        return candidate != address(0)
            && candidate != address(coach)
            && candidate.code.length == 0
            && uint160(candidate) > 0x0a; // precompiles
    }

    // ------------------------------------------------------------- renting

    /**
     * Whatever the price and the length, the trainer is paid the whole amount
     * and the contract keeps none of it.
     *
     * The contract is an authorisation ledger, not a treasury. A balance left
     * sitting in it is money somebody paid that the trainer cannot withdraw —
     * there is no withdraw function, so it would be stuck for good.
     */
    function testFuzz_TheTrainerIsPaidEverythingAndTheContractKeepsNothing(
        uint128 pricePerDay,
        uint16 dayCount
    ) public {
        pricePerDay = uint128(bound(pricePerDay, 1, 1e20));
        dayCount = uint16(bound(dayCount, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, pricePerDay);

        uint256 cost = uint256(pricePerDay) * dayCount;
        uint256 before = trainer.balance;

        vm.deal(athlete, cost);
        vm.prank(athlete);
        coach.rent{value: cost}(id, dayCount);

        assertEq(trainer.balance - before, cost, "trainer was not paid in full");
        assertEq(address(coach).balance, 0, "the contract kept some of the payment");
    }

    /// Any amount that is not the exact cost buys nothing at all.
    function testFuzz_OnlyTheExactPriceBuysAccess(
        uint128 pricePerDay,
        uint16 dayCount,
        uint256 offered
    ) public {
        pricePerDay = uint128(bound(pricePerDay, 1, 1e20));
        dayCount = uint16(bound(dayCount, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, pricePerDay);

        uint256 cost = uint256(pricePerDay) * dayCount;
        vm.assume(offered != cost);
        offered = bound(offered, 0, 1e24);
        vm.assume(offered != cost);

        vm.deal(athlete, offered);
        vm.prank(athlete);
        vm.expectRevert(abi.encodeWithSelector(CoachAgent.WrongPayment.selector, cost));
        coach.rent{value: offered}(id, dayCount);

        assertFalse(coach.hasAccess(id, athlete), "underpaying still granted access");
    }

    /// Zero days, or more than a year, is not a rental.
    function testFuzz_DurationStaysInsideItsBounds(uint256 dayCount) public {
        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, 1 ether);

        vm.assume(dayCount == 0 || dayCount > 365);
        // Keep the cost representable; the duration check comes first anyway.
        dayCount = dayCount == 0 ? 0 : bound(dayCount, 366, 1e6);

        vm.deal(athlete, 1e24);
        vm.prank(athlete);
        vm.expectRevert(CoachAgent.BadDuration.selector);
        coach.rent{value: dayCount * 1 ether}(id, dayCount);
    }

    /**
     * Renewing never costs days already paid for.
     *
     * The renewal branch is the one place the contract chooses between two
     * clocks, and choosing the wrong one silently shortens a rental somebody
     * paid for. Fuzzed over how far into the first window the renewal lands.
     */
    function testFuzz_RenewingExtendsAndNeverShortens(
        uint16 firstDays,
        uint16 secondDays,
        uint32 waitSeconds
    ) public {
        firstDays = uint16(bound(firstDays, 1, 365));
        secondDays = uint16(bound(secondDays, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, 1 wei);

        vm.deal(athlete, 1e6);
        vm.prank(athlete);
        coach.rent{value: firstDays}(id, firstDays);
        uint64 firstExpiry = coach.accessExpiry(id, athlete);

        // Anywhere inside the first window, including its final second.
        waitSeconds = uint32(bound(waitSeconds, 0, uint256(firstDays) * 1 days - 1));
        vm.warp(block.timestamp + waitSeconds);

        vm.prank(athlete);
        coach.rent{value: secondDays}(id, secondDays);
        uint64 secondExpiry = coach.accessExpiry(id, athlete);

        assertEq(
            secondExpiry,
            firstExpiry + uint64(uint256(secondDays) * 1 days),
            "renewing did not add the full second window to the first"
        );
        assertGt(secondExpiry, firstExpiry, "renewing moved the expiry backwards");
    }

    /// Access ends exactly when it says it does — not a second early or late.
    function testFuzz_AccessEndsAtItsStatedSecond(uint16 dayCount) public {
        dayCount = uint16(bound(dayCount, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, 1 wei);

        vm.deal(athlete, 1e6);
        vm.prank(athlete);
        coach.rent{value: dayCount}(id, dayCount);

        uint64 expiry = coach.accessExpiry(id, athlete);

        vm.warp(expiry - 1);
        assertTrue(coach.hasAccess(id, athlete), "access ended before it was paid to");

        vm.warp(expiry);
        assertFalse(coach.hasAccess(id, athlete), "access outlived its expiry");
    }

    // -------------------------------------------------------------- minting

    /// Every mint gives a distinct id, and its owner holds exactly what they minted.
    function testFuzz_EveryMintIsItsOwnCoach(uint8 howMany) public {
        howMany = uint8(bound(howMany, 1, 40));

        uint256 previous;
        for (uint256 i = 0; i < howMany; i++) {
            // i is bounded to 40, so this can never truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            address owner = address(uint160(0x1000 + i));
            uint256 id = _mint(owner);

            assertGt(id, previous, "token ids stopped increasing");
            assertEq(coach.ownerOf(id), owner, "a coach went to the wrong owner");
            (, , uint64 version, ) = coach.coachOf(id);
            assertEq(version, 1, "a fresh coach did not start at version 1");
            previous = id;
        }
    }

    /// A coach's version only ever climbs, one step at a time.
    function testFuzz_VersionsOnlyClimb(uint8 evolutions) public {
        evolutions = uint8(bound(evolutions, 1, 30));

        uint256 id = _mint(trainer);
        (, , uint64 seen, ) = coach.coachOf(id);

        for (uint256 i = 0; i < evolutions; i++) {
            vm.prank(trainer);
            coach.evolve(id, keccak256(abi.encode("v", i)), URI);

            (, , uint64 climbed, ) = coach.coachOf(id);
            assertEq(climbed, seen + 1, "a version skipped or repeated");
            seen = climbed;
        }
    }

    // ------------------------------------------------------------- transfer

    /**
     * Selling a coach takes every grant with it.
     *
     * Otherwise a trainer could rent access widely, sell the coach, and leave
     * the buyer owning something a crowd still has keys to.
     */
    function testFuzz_SellingClearsEveryGrant(uint8 renterCount, uint16 dayCount) public {
        renterCount = uint8(bound(renterCount, 1, 12));
        dayCount = uint16(bound(dayCount, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, 1 wei);

        address[] memory renters = new address[](renterCount);
        for (uint256 i = 0; i < renterCount; i++) {
            // i is bounded to 12, so this can never truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            renters[i] = address(uint160(0x2000 + i));
            vm.deal(renters[i], 1e6);
            vm.prank(renters[i]);
            coach.rent{value: dayCount}(id, dayCount);
            assertTrue(coach.hasAccess(id, renters[i]), "a paid rental gave no access");
        }

        address buyer = address(0xDEAD);
        vm.prank(trainer);
        coach.transferFrom(trainer, buyer, id);

        for (uint256 i = 0; i < renterCount; i++) {
            assertFalse(coach.hasAccess(id, renters[i]), "a grant survived the sale");
        }
        assertTrue(coach.hasAccess(id, buyer), "the new owner cannot use what they bought");
        assertFalse(coach.hasAccess(id, trainer), "the seller kept access");
    }

    /// Nobody who never paid, and was never granted, has access — whoever they are.
    function testFuzz_StrangersNeverHaveAccess(address stranger) public {
        vm.assume(_payableActor(stranger));
        vm.assume(stranger != trainer);

        uint256 id = _mint(trainer);

        assertFalse(coach.hasAccess(id, stranger), "an unrelated address had access");
        assertEq(coach.accessExpiry(id, stranger), 0, "an unrelated address had an expiry");
    }
}

/**
 * The handler the invariant runner drives.
 *
 * Invariant testing calls these in random order with random arguments, then
 * checks the properties below still hold. The point is the sequences nobody
 * would script: rent, transfer, rent again, revoke, evolve, transfer back.
 */
contract CoachHandler is Test {
    CoachAgent public coach;

    uint256[] public tokens;
    address[] public actors;
    uint256 public totalPaidIn;

    constructor(CoachAgent target) {
        coach = target;
        for (uint256 i = 0; i < 5; i++) {
            // i is bounded to 5, so this can never truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            address a = address(uint160(0x5000 + i));
            actors.push(a);
            vm.deal(a, 100 ether);
        }
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function mint(uint256 seed) external {
        address owner = _actor(seed);
        vm.prank(owner);
        tokens.push(coach.mint(keccak256(abi.encode(seed)), "og://x"));
    }

    function setPrice(uint256 tokenSeed, uint96 price) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        vm.prank(coach.ownerOf(id));
        coach.setRentalPrice(id, bound(price, 0, 1 ether));
    }

    function rent(uint256 tokenSeed, uint256 actorSeed, uint16 dayCount) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        uint256 price = coach.rentalPrice(id);
        if (price == 0) return;

        uint256 days_ = bound(dayCount, 1, 365);
        uint256 cost = price * days_;
        address renter = _actor(actorSeed);
        if (renter.balance < cost) return;

        vm.prank(renter);
        coach.rent{value: cost}(id, days_);
        totalPaidIn += cost;
    }

    /**
     * Offer a coach for cloning, sometimes.
     *
     * `bound(price, 0, …)` deliberately includes zero, which withdraws the
     * offer — so the sequences include a coach listed, cloned, delisted, and
     * cloned again by somebody who did not notice.
     */
    function setClonePrice(uint256 tokenSeed, uint96 price) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        vm.prank(coach.ownerOf(id));
        coach.setClonePrice(id, bound(price, 0, 1 ether));
    }

    /**
     * Buy a clone.
     *
     * The second path on which money moves through this contract, and therefore
     * the second one the "never holds funds" invariant has to cover. Added with
     * cloning rather than after it: an invariant that only watches the paths it
     * watched yesterday is an invariant about yesterday.
     */
    function cloneCoach(uint256 tokenSeed, uint256 actorSeed, uint256 keySeed) external {
        if (tokens.length == 0) return;
        uint256 parent = tokens[tokenSeed % tokens.length];

        uint256 price = coach.clonePrice(parent);
        if (price == 0) return;

        address payer = _actor(actorSeed);
        if (payer.balance < price) return;

        (address owner, uint256 key) = makeAddrAndKey(string(abi.encodePacked("clone", vm.toString(keySeed))));

        bytes32 configHash = keccak256(abi.encode(keySeed, parent));
        bytes memory signature = _signClone(owner, key, parent, configHash);

        vm.prank(payer);
        try coach.cloneFor{value: price}(owner, parent, configHash, "og://clone", block.timestamp + 1 hours, signature)
        returns (uint256 child) {
            tokens.push(child);
            totalPaidIn += price;
        } catch {
            // A nonce already spent for this owner, most often. Not a property
            // failure — the run simply continues with the next call.
        }
    }

    function _signClone(address owner, uint256 key, uint256 parentId, bytes32 configHash)
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
                keccak256(bytes("og://clone")),
                coach.nonceOf(owner),
                block.timestamp + 1 hours
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked(hex"1901", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function transfer(uint256 tokenSeed, uint256 actorSeed) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        address from = coach.ownerOf(id);
        address to = _actor(actorSeed);
        if (from == to) return;

        vm.prank(from);
        coach.transferFrom(from, to, id);
    }

    function evolve(uint256 tokenSeed, uint256 seed) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        vm.prank(coach.ownerOf(id));
        coach.evolve(id, keccak256(abi.encode(seed)), "og://y");
    }

    function revoke(uint256 tokenSeed, uint256 actorSeed) external {
        if (tokens.length == 0) return;
        uint256 id = tokens[tokenSeed % tokens.length];
        vm.prank(coach.ownerOf(id));
        coach.revokeAccess(id, _actor(actorSeed));
    }

    function warp(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1, 30 days));
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

/**
 * What must be true after any sequence of calls at all.
 */
contract CoachAgentInvariantTest is Test {
    CoachAgent private coach;
    CoachHandler private handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        coach = new CoachAgent(address(0));
        handler = new CoachHandler(coach);
        targetContract(address(handler));
    }

    /**
     * The contract never holds money.
     *
     * Every payment is forwarded to the owner inside the same call, and there
     * is no withdraw function — so a non-zero balance here is money that is
     * stuck for the life of the contract. This is the invariant that would
     * catch a refund path, a fee cut, or a reordered payout.
     */
    function invariant_ContractNeverHoldsFunds() public view {
        assertEq(address(coach).balance, 0, "the contract is holding somebody's payment");
    }

    /// A coach that exists has a version, and it is never zero.
    function invariant_EveryCoachHasAVersion() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.tokens(i);
            (, , uint64 version, ) = coach.coachOf(id);
            assertGt(version, 0, "a minted coach has no version");
        }
    }

    /// The owner can always use their own coach, whatever happened before.
    function invariant_OwnersAlwaysHaveAccess() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.tokens(i);
            assertTrue(coach.hasAccess(id, coach.ownerOf(id)), "an owner lost access to their own coach");
        }
    }

    /**
     * Access and its expiry never disagree.
     *
     * `hasAccess` and `accessExpiry` are read by different parts of the app —
     * the executor gates on one, the UI shows the other. If they can ever
     * disagree, somebody is told they have access they cannot use, or the
     * reverse.
     */
    function invariant_AccessAgreesWithItsExpiry() public view {
        uint256 tokenCount = handler.tokenCount();
        uint256 actorCount = handler.actorCount();

        for (uint256 i = 0; i < tokenCount; i++) {
            uint256 id = handler.tokens(i);
            address owner = coach.ownerOf(id);

            for (uint256 j = 0; j < actorCount; j++) {
                address who = handler.actors(j);
                if (who == owner) continue; // the owner needs no grant

                bool has = coach.hasAccess(id, who);
                // The invariant is exactly that these two clocks agree.
                // forge-lint: disable-next-line(block-timestamp)
                bool unexpired = coach.accessExpiry(id, who) > block.timestamp;
                assertEq(has, unexpired, "access and expiry disagree");
            }
        }
    }

    /// Ids are handed out once each, so no two coaches can collide.
    function invariant_TokenIdsAreUnique() public view {
        uint256 count = handler.tokenCount();
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = i + 1; j < count; j++) {
                assertTrue(handler.tokens(i) != handler.tokens(j), "the same id was minted twice");
            }
        }
    }
}
