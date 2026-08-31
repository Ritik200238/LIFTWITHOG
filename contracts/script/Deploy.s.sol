// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {CoachAgent} from "../src/CoachAgent.sol";

/**
 * Deploy CoachAgent to 0G Galileo.
 *
 *   PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url og_testnet --broadcast
 *
 * The address it prints is what the frontend needs in VITE_COACH_ADDRESS.
 */
contract Deploy is Script {
    function run() external returns (CoachAgent coach) {
        uint256 key = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(key);
        coach = new CoachAgent(address(0));
        vm.stopBroadcast();

        console.log("CoachAgent deployed at:", address(coach));
        console.log("Set VITE_COACH_ADDRESS to that value.");
    }
}
