// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CoachAgent} from "../src/CoachAgent.sol";

/**
 * What owning and renting a coach has to guarantee.
 *
 * The contract's job is authorisation, and the cases that matter are the ones
 * where somebody gets access they should not have, or keeps it after they
 * should have lost it. Those are the failures that cost a trainer their income
 * and a renter their trust, and neither is visible by reading the happy path.
 */
contract CoachAgentTest is Test {
    CoachAgent private coach;

    address private trainer = address(0xA11CE);
    address private athlete = address(0xB0B);
    address private stranger = address(0xCAFE);

    bytes32 private constant CONFIG = keccak256("encrypted coaching method v1");
    string private constant URI = "og://storage/root/abc123";

    function setUp() public {
        coach = new CoachAgent();
        // Grants are compared against the clock, so a chain that starts at zero
        // makes every expiry look like the distant future.
        vm.warp(1_700_000_000);
    }

    function _mint(address owner) private returns (uint256 tokenId) {
        vm.prank(owner);
        tokenId = coach.mint(CONFIG, URI);
    }

    // ------------------------------------------------------------------ mint

    function test_MintGivesOwnershipAndAConfig() public {
        uint256 id = _mint(trainer);

        assertEq(coach.ownerOf(id), trainer);

        (bytes32 hash_, string memory uri, uint64 version, uint64 updatedAt) = coach.coachOf(id);
        assertEq(hash_, CONFIG);
        assertEq(uri, URI);
        assertEq(version, 1, "a new coach starts at version one");
        assertEq(updatedAt, uint64(block.timestamp));
    }

    function test_MintRejectsAnEmptyConfig() public {
        // A coach pointing at nothing is a token that looks real and does
        // nothing, which is worse than a failed transaction.
        vm.prank(trainer);
        vm.expectRevert(CoachAgent.EmptyConfig.selector);
        coach.mint(bytes32(0), URI);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.EmptyConfig.selector);
        coach.mint(CONFIG, "");
    }

    function test_IdsAreDistinct() public {
        uint256 first = _mint(trainer);
        uint256 second = _mint(athlete);

        assertTrue(first != second);
        assertEq(coach.totalMinted(), 2);
    }

    // ---------------------------------------------------------------- evolve

    function test_EvolveRaisesTheVersionAndKeepsTheHistoryHonest() public {
        uint256 id = _mint(trainer);
        bytes32 next = keccak256("after ninety more sessions");

        vm.prank(trainer);
        coach.evolve(id, next, "og://storage/root/def456");

        (bytes32 hash_,, uint64 version,) = coach.coachOf(id);
        assertEq(hash_, next);
        assertEq(version, 2, "learning something must be visible on chain");
    }

    function test_OnlyTheOwnerCanEvolve() public {
        uint256 id = _mint(trainer);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.evolve(id, keccak256("mine now"), URI);
    }

    // ---------------------------------------------------------------- rental

    function test_TheOwnerAlwaysHasAccess() public {
        uint256 id = _mint(trainer);
        assertTrue(coach.hasAccess(id, trainer));
    }

    function test_AStrangerHasNoAccess() public {
        uint256 id = _mint(trainer);
        assertFalse(coach.hasAccess(id, stranger));
    }

    function test_GrantedAccessWorksUntilItExpires() public {
        uint256 id = _mint(trainer);
        uint64 expires = uint64(block.timestamp + 30 days);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, expires);

        assertTrue(coach.hasAccess(id, athlete), "a paid month must work");
        assertEq(coach.accessExpiry(id, athlete), expires);

        // The moment it lapses.
        vm.warp(expires + 1);
        assertFalse(coach.hasAccess(id, athlete), "an expired subscription is over");
    }

    function test_AccessEndsByItselfRatherThanWhenSomebodyRemembers() public {
        /*
         * The reason expiry is a parameter rather than a later revoke call. A
         * subscription that only ends when the trainer remembers to end it is a
         * subscription that quietly never ends, and it is the trainer who pays
         * for that in inference costs.
         */
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 1 days));

        vm.warp(block.timestamp + 8 days);
        assertFalse(coach.hasAccess(id, athlete));
    }

    function test_RevokeEndsAccessEarly() public {
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 30 days));
        assertTrue(coach.hasAccess(id, athlete));

        vm.prank(trainer);
        coach.revokeAccess(id, athlete);
        assertFalse(coach.hasAccess(id, athlete), "a refund must actually cut access");
    }

    function test_OnlyTheOwnerCanGrantOrRevoke() public {
        uint256 id = _mint(trainer);

        // Anybody granting themselves access is the whole business model gone.
        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.grantAccess(id, stranger, uint64(block.timestamp + 1 days));

        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 30 days));

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.revokeAccess(id, athlete);
    }

    function test_AGrantThatIsAlreadyOverIsRefused() public {
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.ExpiryInPast.selector);
        coach.grantAccess(id, athlete, uint64(block.timestamp));
    }

    // -------------------------------------------------------------- transfer

    function test_SellingACoachDoesNotSellItsRenters() public {
        /*
         * The one worth being careful about. A trainer who sells their coach
         * hands over the coach, not their client list — and the buyer must not
         * inherit an obligation to keep serving somebody else's customers, nor
         * those customers a claim on a coach they never bought.
         */
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 365 days));
        assertTrue(coach.hasAccess(id, athlete));

        vm.prank(trainer);
        coach.transferFrom(trainer, stranger, id);

        assertEq(coach.ownerOf(id), stranger);
        assertFalse(coach.hasAccess(id, athlete), "a year-long grant must not survive the sale");
        assertTrue(coach.hasAccess(id, stranger), "and the buyer owns it outright");
    }

    function test_ANewOwnerCanGrantAgainAfterATransfer() public {
        // The epoch bump must not leave the token in a state where grants stop
        // working — clearing the old ones is the goal, breaking the feature is not.
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.transferFrom(trainer, stranger, id);

        vm.prank(stranger);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 30 days));

        assertTrue(coach.hasAccess(id, athlete));
    }

    function test_TransferringTwiceDoesNotResurrectAnOldGrant() public {
        /*
         * An epoch that wrapped or reset would hand a long-expired customer
         * access back. Two hops and a return to the original owner is the
         * cheapest way to catch that.
         */
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 365 days));

        vm.prank(trainer);
        coach.transferFrom(trainer, stranger, id);
        vm.prank(stranger);
        coach.transferFrom(stranger, trainer, id);

        assertFalse(coach.hasAccess(id, athlete), "the original grant must stay dead");
    }

    // ------------------------------------------------------------ non-existent

    function test_AskingAboutACoachThatDoesNotExistReverts() public {
        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.coachOf(999);

        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.hasAccess(999, athlete);
    }

    // ----------------------------------------------------------------- fuzz

    function testFuzz_AccessIsExactlyTheGrantedWindow(uint32 duration, uint32 elapsed) public {
        duration = uint32(bound(duration, 1, 365 days));
        elapsed = uint32(bound(elapsed, 0, 400 days));

        uint256 id = _mint(trainer);
        uint64 expires = uint64(block.timestamp + duration);

        vm.prank(trainer);
        coach.grantAccess(id, athlete, expires);

        uint256 start = block.timestamp;
        vm.warp(start + elapsed);

        assertEq(
            coach.hasAccess(id, athlete),
            // The oracle for the assertion, in a test with a controlled clock.
            // forge-lint: disable-next-line(block-timestamp)
            block.timestamp < expires,
            "access must hold for exactly as long as it was paid for"
        );
    }

    function test_EvolveRejectsAnEmptyConfig() public {
        // Same trap as mint, on the path that runs far more often: a coach that
        // learns its way into pointing at nothing is silently broken.
        uint256 id = _mint(trainer);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.EmptyConfig.selector);
        coach.evolve(id, bytes32(0), URI);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.EmptyConfig.selector);
        coach.evolve(id, CONFIG, "");
    }

    function test_ActingOnACoachThatDoesNotExistReverts() public {
        vm.prank(trainer);
        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.evolve(404, CONFIG, URI);

        vm.prank(trainer);
        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.grantAccess(404, athlete, uint64(block.timestamp + 1 days));
    }

    // ---------------------------------------------------------------- renting

    uint256 private constant PRICE = 0.01 ether; // per day, in 0G

    function _listed(address owner) private returns (uint256 tokenId) {
        tokenId = _mint(owner);
        vm.prank(owner);
        coach.setRentalPrice(tokenId, PRICE);
    }

    function test_RentPaysTheTrainerAndGrantsAccessInOneTransaction() public {
        /*
         * The whole point of putting this on a chain. Split into "pay somewhere,
         * then wait to be granted", the renter trusts a stranger to remember and
         * the trainer fields refund demands. Here neither trusts the other.
         */
        uint256 id = _listed(trainer);
        uint256 before = trainer.balance;

        vm.deal(athlete, 1 ether);
        vm.prank(athlete);
        coach.rent{value: PRICE * 30}(id, 30);

        assertTrue(coach.hasAccess(id, athlete), "paid means access, same block");
        assertEq(trainer.balance - before, PRICE * 30, "and the trainer has the money, not us");
        assertEq(address(coach).balance, 0, "the contract must never hold anybody's funds");
    }

    function test_WrongPaymentBuysNothing() public {
        uint256 id = _listed(trainer);
        vm.deal(athlete, 1 ether);

        vm.prank(athlete);
        vm.expectRevert(abi.encodeWithSelector(CoachAgent.WrongPayment.selector, PRICE * 30));
        coach.rent{value: PRICE * 29}(id, 30);

        assertFalse(coach.hasAccess(id, athlete), "underpaying is not a discount");

        // Overpaying is refused too: a refund path is a second transfer and a
        // reentrancy surface, bought to support a mistake wallets do not make.
        vm.prank(athlete);
        vm.expectRevert(abi.encodeWithSelector(CoachAgent.WrongPayment.selector, PRICE * 30));
        coach.rent{value: PRICE * 31}(id, 30);
    }

    function test_ACoachWithNoPriceIsNotForRent() public {
        uint256 id = _mint(trainer);
        vm.deal(athlete, 1 ether);

        vm.prank(athlete);
        vm.expectRevert(CoachAgent.NotForRent.selector);
        coach.rent{value: PRICE}(id, 1);

        // But the owner can still comp somebody by hand — off-market is not
        // locked, it is simply not for sale.
        vm.prank(trainer);
        coach.grantAccess(id, athlete, uint64(block.timestamp + 1 days));
        assertTrue(coach.hasAccess(id, athlete));
    }

    function test_OnlyTheOwnerSetsThePrice() public {
        uint256 id = _mint(trainer);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.setRentalPrice(id, PRICE);
    }

    function test_RenewingEarlyExtendsRatherThanReplaces() public {
        // Paying for thirty more days on day twenty must leave forty, not
        // thirty. Losing paid days for renewing early punishes loyalty.
        uint256 id = _listed(trainer);
        vm.deal(athlete, 1 ether);

        vm.prank(athlete);
        coach.rent{value: PRICE * 30}(id, 30);
        uint64 firstExpiry = coach.accessExpiry(id, athlete);

        vm.warp(block.timestamp + 20 days);
        vm.prank(athlete);
        coach.rent{value: PRICE * 30}(id, 30);

        assertEq(
            coach.accessExpiry(id, athlete),
            firstExpiry + 30 days,
            "renewal stacks on what was already paid for"
        );
    }

    function test_ALapsedRentalStartsFromNowNotFromThePast() public {
        uint256 id = _listed(trainer);
        vm.deal(athlete, 1 ether);

        vm.prank(athlete);
        coach.rent{value: PRICE}(id, 1);

        // Long gone.
        vm.warp(block.timestamp + 90 days);
        vm.prank(athlete);
        coach.rent{value: PRICE * 10}(id, 10);

        // forge-lint: disable-next-line(block-timestamp)
        assertEq(coach.accessExpiry(id, athlete), uint64(block.timestamp + 10 days));
    }

    function test_ZeroOrAbsurdDurationIsRefused() public {
        uint256 id = _listed(trainer);
        vm.deal(athlete, 100 ether);

        vm.prank(athlete);
        vm.expectRevert(CoachAgent.BadDuration.selector);
        coach.rent{value: 0}(id, 0);

        vm.prank(athlete);
        vm.expectRevert(CoachAgent.BadDuration.selector);
        coach.rent{value: PRICE * 366}(id, 366);
    }

    function test_RentingANonexistentCoachReverts() public {
        vm.deal(athlete, 1 ether);
        vm.prank(athlete);
        vm.expectRevert(CoachAgent.NoSuchCoach.selector);
        coach.rent{value: PRICE}(999, 1);
    }

    function test_AnOwnerWhoCannotReceiveFailsTheRentalWhole() public {
        /*
         * If the payout cannot land, the rental must not happen at all. The
         * alternative is an athlete with access the trainer was never paid for
         * — or worse, money stuck in the contract, which holds nobody's funds
         * by design.
         */
        RejectsMoney wall = new RejectsMoney();
        vm.prank(address(wall));
        uint256 id = coach.mint(CONFIG, URI);
        vm.prank(address(wall));
        coach.setRentalPrice(id, PRICE);

        vm.deal(athlete, 1 ether);
        vm.prank(athlete);
        vm.expectRevert(CoachAgent.PayoutFailed.selector);
        coach.rent{value: PRICE}(id, 1);

        assertFalse(coach.hasAccess(id, athlete));
        assertEq(address(coach).balance, 0);
    }

    function test_PaidAccessStillDiesOnSale() public {
        // Same policy as hand grants: selling the coach hands over the coach,
        // not its subscribers. Stated in a test so the choice is visible.
        uint256 id = _listed(trainer);
        vm.deal(athlete, PRICE * 365);
        vm.prank(athlete);
        coach.rent{value: PRICE * 365}(id, 365);

        vm.prank(trainer);
        coach.transferFrom(trainer, stranger, id);

        assertFalse(coach.hasAccess(id, athlete));
    }

    function testFuzz_RentCostIsExactlyPriceTimesDays(uint256 pricePerDay, uint16 dayCount) public {
        pricePerDay = bound(pricePerDay, 1, 100 ether);
        dayCount = uint16(bound(dayCount, 1, 365));

        uint256 id = _mint(trainer);
        vm.prank(trainer);
        coach.setRentalPrice(id, pricePerDay);

        uint256 cost = pricePerDay * dayCount;
        vm.deal(athlete, cost);
        uint256 before = trainer.balance;

        vm.prank(athlete);
        coach.rent{value: cost}(id, dayCount);

        assertTrue(coach.hasAccess(id, athlete));
        assertEq(trainer.balance - before, cost);
        assertEq(address(coach).balance, 0);
    }

    // --------------------------------------------------------------- relayed

    /*
     * The point of all of this: somebody who has never heard of a wallet trains
     * in a gym, and a coach appears that they own. Their phone holds a key it
     * generated and never showed them; it signs; we pay the fee.
     */

    uint256 private constant DEVICE_KEY = 0xA11CE5EED;

    function _deviceAddress() private pure returns (address) {
        return vm.addr(DEVICE_KEY);
    }

    function _domainSeparator() private view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying, , ) =
            coach.eip712Domain();
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    chainId,
                    verifying
                )
            );
    }

    function _sign(uint256 key, bytes32 structHash) private view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mintStruct(address owner, uint256 nonce, uint256 deadline)
        private
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "MintCoach(address owner,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
                    ),
                    owner,
                    CONFIG,
                    keccak256(bytes(URI)),
                    nonce,
                    deadline
                )
            );
    }

    function test_ADeviceWithNoGasGetsACoachItOwns() public {
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _sign(DEVICE_KEY, _mintStruct(device, 0, deadline));

        // Submitted and paid for by somebody else entirely.
        vm.prank(stranger);
        uint256 id = coach.mintFor(device, CONFIG, URI, deadline, signature);

        assertEq(coach.ownerOf(id), device, "the coach belongs to the device, not the payer");
        assertEq(device.balance, 0, "which never held a coin");
        assertEq(coach.nonceOf(device), 1, "and the signature is spent");
    }

    function test_ARelayerCannotRedirectTheMintToItself() public {
        /*
         * The failure that would matter most. A relayer able to change the owner
         * is a relayer able to take every coach it is asked to pay for.
         */
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory signature = _sign(DEVICE_KEY, _mintStruct(device, 0, deadline));

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.WrongSignature.selector);
        coach.mintFor(stranger, CONFIG, URI, deadline, signature);
    }

    function test_ASignatureCannotBeUsedTwice() public {
        // The relayer is holding it. Replayable means it can mint again with a
        // signature the owner has already spent.
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _sign(DEVICE_KEY, _mintStruct(device, 0, deadline));

        vm.prank(stranger);
        coach.mintFor(device, CONFIG, URI, deadline, signature);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.WrongSignature.selector);
        coach.mintFor(device, CONFIG, URI, deadline, signature);
    }

    function test_AnExpiredSignatureIsRefused() public {
        // A signature captured from a queue must not work forever.
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _sign(DEVICE_KEY, _mintStruct(device, 0, deadline));

        vm.warp(deadline + 1);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.SignatureExpired.selector);
        coach.mintFor(device, CONFIG, URI, deadline, signature);
    }

    function test_ASignatureFromSomebodyElseIsRefused() public {
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;

        // Signed with a key that is not the device's.
        bytes memory forged = _sign(0xBADBEEF, _mintStruct(device, 0, deadline));

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.WrongSignature.selector);
        coach.mintFor(device, CONFIG, URI, deadline, forged);
    }

    function test_TheFlywheelEvolvesWithoutTheOwnerPayingOrWaiting() public {
        /*
         * Every few sessions the app records what the coach learned. The person
         * training confirms nothing, waits for nothing, and holds no coin.
         */
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory mintSignature = _sign(DEVICE_KEY, _mintStruct(device, 0, deadline));

        vm.prank(stranger);
        uint256 id = coach.mintFor(device, CONFIG, URI, deadline, mintSignature);

        bytes32 next = keccak256("after twenty more sessions");
        bytes32 evolveStruct = keccak256(
            abi.encode(
                keccak256(
                    "EvolveCoach(address owner,uint256 tokenId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
                ),
                device,
                id,
                next,
                keccak256(bytes(URI)),
                coach.nonceOf(device),
                deadline
            )
        );

        bytes memory evolveSignature = _sign(DEVICE_KEY, evolveStruct);

        vm.prank(stranger);
        coach.evolveFor(device, id, next, URI, deadline, evolveSignature);

        (, , uint64 version, ) = coach.coachOf(id);
        assertEq(version, 2, "the version rises, on chain, with nobody waiting");
    }

    function test_EvolveForRefusesASignerWhoIsNotTheOwner() public {
        address device = _deviceAddress();
        uint256 deadline = block.timestamp + 1 hours;
        uint256 id = _mint(trainer);

        bytes32 evolveStruct = keccak256(
            abi.encode(
                keccak256(
                    "EvolveCoach(address owner,uint256 tokenId,bytes32 configHash,bytes32 configURIHash,uint256 nonce,uint256 deadline)"
                ),
                device,
                id,
                CONFIG,
                keccak256(bytes(URI)),
                coach.nonceOf(device),
                deadline
            )
        );

        /*
         * Signed before the expectation is armed. `_sign` reads the domain from
         * the contract, and `vm.expectRevert` applies to the next call it sees —
         * so building the signature inline consumes the expectation on a call
         * that was never meant to revert, and the test passes for nothing.
         */
        bytes memory signature = _sign(DEVICE_KEY, evolveStruct);

        vm.prank(stranger);
        vm.expectRevert(CoachAgent.NotCoachOwner.selector);
        coach.evolveFor(device, id, CONFIG, URI, deadline, signature);
    }
}

/// @dev An owner that can hold the NFT but refuses every ether transfer — a
///      contract wallet with no receive function, which trainers will
///      eventually use.
contract RejectsMoney {
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }
}
