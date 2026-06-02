// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/TreasureHunt.sol";

contract DeployTreasureHunt is Script {
  function run() external {
    uint256 deployerKey = vm.envUint("PRIVATE_KEY");
    address deployer = vm.addr(deployerKey);

    console.log("Deployer:", deployer);
    console.log("Balance:", deployer.balance);
    console.log("Network: Ethereum Sepolia (ChainID 11155111)");

    vm.startBroadcast(deployerKey);
    TreasureHunt game = new TreasureHunt();
    vm.stopBroadcast();

    console.log("TreasureHunt deployed at:", address(game));
    console.log("Block:", block.number);
    console.log("Verify at: https://sepolia.etherscan.io/address/", address(game));
  }
}
