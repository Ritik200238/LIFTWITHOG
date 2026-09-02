// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {AttestedTransferVerifier} from "../src/AttestedTransferVerifier.sol";
import {CoachAgent} from "../src/CoachAgent.sol";

/**
 * Deploy the verifier, then the coach that points at it.
 *
 *   PRIVATE_KEY=0x... ATTESTOR_ADDRESS=0x... \
 *     forge script script/Deploy.s.sol:Deploy --rpc-url og_testnet --broadcast
 *
 * `ATTESTOR_ADDRESS` is the address of the key that signs re-encryption
 * attestations — in this deployment, the coach service's own key, which is the
 * thing that performs the re-encryption and can therefore say it happened.
 * Falls back to the deployer when unset, which is right for a local run and
 * wrong for a real one, so it says so.
 *
 * Why the verifier is deployed at all: this script used to pass `address(0)`,
 * under which `iTransferFrom` reverted `VerifierNotConfigured` on every call
 * that would ever be made against it. That is honest, and it also means the one
 * mechanism ERC-7857 exists for was not implemented. The verifier is immutable
 * on the coach, so wiring it is a deployment decision and not a setting: there
 * is no admin who can point a live coach somewhere else afterwards.
 *
 * The addresses it prints are what the frontend and the API need.
 */
contract Deploy is Script {
    function run() external returns (CoachAgent coach, AttestedTransferVerifier verifier) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address attestor = vm.envOr("ATTESTOR_ADDRESS", deployer);

        if (attestor == deployer) {
            console.log("WARNING: no ATTESTOR_ADDRESS set, so the deployer is the attestor.");
            console.log("  Fine locally. On a real network set it to the coach service key.");
        }

        vm.startBroadcast(key);
        verifier = new AttestedTransferVerifier(attestor);
        coach = new CoachAgent(address(verifier));
        vm.stopBroadcast();

        /*
         * Asserted rather than assumed. A coach wired to the wrong verifier
         * cannot be repaired — the field is immutable — so the deploy either
         * proves the wiring here or is a migration nobody planned.
         */
        require(coach.transferVerifier() == address(verifier), "coach is not wired to the verifier");
        require(verifier.attestor() == attestor, "verifier has the wrong attestor");

        console.log("AttestedTransferVerifier:", address(verifier));
        console.log("  attestor:              ", attestor);
        console.log("CoachAgent:              ", address(coach));
        console.log("");
        console.log("Set VITE_COACH_ADDRESS and COACH_ADDRESS to the CoachAgent address.");
    }
}
