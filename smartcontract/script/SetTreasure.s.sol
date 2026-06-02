// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/TreasureHunt.sol";

contract SetTreaureScript is Script {
  address constant TREASURE_HUNT = 0x242dbbb9c3D0978d4ff2CF923dF2DDec1b92137C;

  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");

    vm.startBroadcast(deployerKey);

    // Mock encrypted values (for local testing with mock FHE)
    InEuint8 memory treasureX = InEuint8({
      ctHash: 123456789,
      securityZone: 0,
      utype: 8,
      signature: hex"00"
    });

    InEuint8 memory treasureY = InEuint8({
      ctHash: 987654321,
      securityZone: 0,
      utype: 8,
      signature: hex"00"
    });

    TreasureHunt(TREASURE_HUNT).setTreasure(treasureX, treasureY);

    vm.stopBroadcast();

    console.log("Treasure set!");
  }
}
