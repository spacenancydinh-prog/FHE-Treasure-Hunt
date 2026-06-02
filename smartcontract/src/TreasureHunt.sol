// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract TreasureHunt {
  enum GameState {
    WAITING,
    ACTIVE,
    ENDED
  }

  uint256 public constant ENTRY_FEE = 0.01 ether;
  uint256 public constant MAX_PLAYERS = 16;
  uint256 public constant MIN_PLAYERS = 2;

  // Encrypted treasure coordinates
  euint8 private treasureX;
  euint8 private treasureY;

  // Player tracking
  address public owner;
  mapping(address => bool) public players;
  mapping(address => euint8) private playerX;
  mapping(address => euint8) private playerY;
  mapping(address => euint8) private playerLastBucket; // sealed proximity result per player
  mapping(address => uint256) public playerMoveCount;
  address[] private playerList;
  uint256 public playerCount;

  // Game state
  GameState public gameState;
  uint256 public pot;
  address public winner;
  bool public treasureSet;

  // Win claim state (2-transaction pattern)
  // pendingClaimResult mapping base is at storage slot 13 — do NOT reorder above vars
  mapping(address => ebool) private pendingClaimResult; // isOnTreasure handle per claimer
  mapping(address => bool) public hasPendingClaim;      // true while TX1 done but TX2 not yet submitted

  // Burner wallet delegation — player authorizes a local key to submit moves on their behalf
  mapping(address => address) public burnerToPlayer; // burner  → player
  mapping(address => address) public playerToBurner; // player  → burner (for cleanup on reset) [FIX H2]

  // Events
  event GameCreated(address indexed owner);
  event PlayerJoined(address indexed player, uint256 playerCount);
  event PlayerMoved(address indexed player);
  event ProximityChecked(address indexed player); // bucket is sealed — fetch via getLastBucket()
  event WinClaimPrepared(address indexed claimer); // call decryptForTx off-chain, then finalizeWinClaim
  event ClaimFailed(address indexed claimer);      // wrong coords — hasPendingClaim cleared
  event GameWon(address indexed winner);
  event GameReset();
  event BurnerAuthorized(address indexed player, address indexed burner);

  constructor() {
    owner = msg.sender;
    gameState = GameState.WAITING;
    treasureSet = false;
    playerCount = 0;
    pot = 0;
    winner = address(0);
  }

  function setTreasure(InEuint8 calldata x, InEuint8 calldata y) external {
    require(msg.sender == owner, "Only owner can set treasure");
    require(gameState == GameState.WAITING, "Game must be in WAITING state");
    require(!treasureSet, "Treasure already set");
    require(playerCount >= MIN_PLAYERS, "Need at least 2 players to start");

    treasureX = FHE.asEuint8(x);
    treasureY = FHE.asEuint8(y);

    FHE.allowThis(treasureX);
    FHE.allowThis(treasureY);

    treasureSet = true;
    gameState = GameState.ACTIVE;

    emit GameCreated(owner);
  }

  function joinGame() external payable {
    require(msg.value == ENTRY_FEE, "Entry fee must be exactly 0.01 ETH");
    require(gameState == GameState.WAITING, "Game must be in WAITING state");
    require(!players[msg.sender], "Player already joined");
    require(playerCount < MAX_PLAYERS, "Game is full");

    players[msg.sender] = true;
    playerList.push(msg.sender);
    playerCount++;
    pot += msg.value;

    emit PlayerJoined(msg.sender, playerCount);
  }

  function authorizeBurner(address burner) external {
    require(players[msg.sender], "Player must have joined");
    require(burner != address(0), "Invalid burner address");

    // FIX H2: Clear previous burner mapping before registering a new one
    address prevBurner = playerToBurner[msg.sender];
    if (prevBurner != address(0)) {
      delete burnerToPlayer[prevBurner];
    }

    burnerToPlayer[burner] = msg.sender;
    playerToBurner[msg.sender] = burner;
    emit BurnerAuthorized(msg.sender, burner);
  }

  function move(InEuint8 calldata x, InEuint8 calldata y) external {
    require(gameState == GameState.ACTIVE, "Game must be ACTIVE");
    // Resolve burner → player: direct player or authorized burner key
    address player = players[msg.sender] ? msg.sender : burnerToPlayer[msg.sender];
    require(players[player], "Player must have joined");

    playerX[player] = FHE.asEuint8(x);
    playerY[player] = FHE.asEuint8(y);
    playerMoveCount[player]++;

    FHE.allowThis(playerX[player]);
    FHE.allowThis(playerY[player]);

    emit PlayerMoved(player);
  }

  function checkProximity() external returns (euint8) {
    require(gameState == GameState.ACTIVE, "Game must be ACTIVE");
    require(players[msg.sender], "Player must have joined");
    require(playerMoveCount[msg.sender] > 0, "Must move before checking proximity");

    euint8 pxVal = playerX[msg.sender];
    euint8 pyVal = playerY[msg.sender];
    euint8 txVal = treasureX;
    euint8 tyVal = treasureY;

    // Absolute difference via select — prevents euint8 underflow wrapping
    euint8 dx = FHE.select(
      FHE.gte(pxVal, txVal),
      FHE.sub(pxVal, txVal),
      FHE.sub(txVal, pxVal)
    );

    euint8 dy = FHE.select(
      FHE.gte(pyVal, tyVal),
      FHE.sub(pyVal, tyVal),
      FHE.sub(tyVal, pyVal)
    );

    // Manhattan distance (fully encrypted)
    euint8 distance = FHE.add(dx, dy);

    // Bucket thresholds are public game rules — trivialEncrypt of constants is intentional
    // HOT ≤ 2, WARM ≤ 5, COLD ≤ 8, FROZEN > 8
    ebool isHot  = FHE.lte(distance, FHE.asEuint8(2));
    ebool isWarm = FHE.lte(distance, FHE.asEuint8(5));
    ebool isCold = FHE.lte(distance, FHE.asEuint8(8));

    euint8 bucket = FHE.select(isHot,  FHE.asEuint8(3),
                   FHE.select(isWarm, FHE.asEuint8(2),
                   FHE.select(isCold, FHE.asEuint8(1),
                                      FHE.asEuint8(0))));

    // Grant ACL before emit (hard rule: allow* before emit/return)
    playerLastBucket[msg.sender] = bucket;
    FHE.allowThis(bucket);   // contract can reuse handle
    FHE.allowSender(bucket); // caller decrypts off-chain via decryptForView()

    emit ProximityChecked(msg.sender);
    return bucket;
  }

  // Call after checkProximity() tx confirms, then use decryptForView(handle, FheTypes.Uint8)
  function getLastBucket() external view returns (euint8) {
    require(players[msg.sender], "Player must have joined");
    return playerLastBucket[msg.sender];
  }

  // TX 1 of 2: Submit coordinates, compute encrypted comparison
  // After this tx: call decryptForTx(pendingClaimResult handle).withPermit().execute()
  // to get (result: bool, signature: bytes), then call finalizeWinClaim(result, signature)
  function prepareWinClaim(InEuint8 calldata x, InEuint8 calldata y) external {
    require(gameState == GameState.ACTIVE, "Game must be ACTIVE");
    require(players[msg.sender], "Player must have joined");
    require(treasureSet, "Treasure must be set");
    require(winner == address(0), "Game already won");
    require(playerMoveCount[msg.sender] > 0, "Must move before claiming");
    // Allow re-entry: player can submit a new claim if their previous one is no longer pending
    require(!hasPendingClaim[msg.sender], "Claim already in progress - finalize first");

    euint8 pxVal = FHE.asEuint8(x);
    euint8 pyVal = FHE.asEuint8(y);

    ebool isX = FHE.eq(pxVal, treasureX);
    ebool isY = FHE.eq(pyVal, treasureY);
    ebool isOnTreasure = FHE.and(isX, isY);

    // Grant ACL before emit
    pendingClaimResult[msg.sender] = isOnTreasure;
    FHE.allowThis(isOnTreasure);          // contract needs handle for verifyDecryptResult
    FHE.allow(isOnTreasure, msg.sender);  // claimer decrypts via decryptForTx().withPermit()

    hasPendingClaim[msg.sender] = true;

    emit WinClaimPrepared(msg.sender);
  }

  // TX 2 of 2: Submit decryption proof and finalize win
  // result + signature come from: decryptForTx(handle).withPermit().execute()
  function finalizeWinClaim(bool result, bytes calldata signature) external {
    require(gameState == GameState.ACTIVE, "Game must be ACTIVE");
    require(hasPendingClaim[msg.sender], "No pending claim for this address");
    require(winner == address(0), "Game already won");

    ebool isOnTreasure = pendingClaimResult[msg.sender];

    // Verify the CoFHE network's decryption signature
    require(
      FHE.verifyDecryptResult(isOnTreasure, result, signature),
      "Invalid decryption proof"
    );

    // Clear pending claim state BEFORE branching on result (CEI pattern)
    hasPendingClaim[msg.sender] = false;
    pendingClaimResult[msg.sender] = ebool.wrap(bytes32(0));

    if (!result) {
      emit ClaimFailed(msg.sender);
      return;
    }

    // CEI pattern — clear pot before external call
    uint256 prize = pot;
    pot = 0;
    winner = msg.sender;
    gameState = GameState.ENDED;

    (bool success, ) = payable(msg.sender).call{value: prize}("");
    require(success, "Transfer failed");

    emit GameWon(msg.sender);
  }

  // Owner can clear a stuck pending claim (e.g. player lost their signature between TX1 and TX2)
  function cancelPendingClaim(address claimer) external {
    require(msg.sender == owner, "Only owner");
    require(hasPendingClaim[claimer], "No pending claim for this address");
    hasPendingClaim[claimer] = false;
    pendingClaimResult[claimer] = ebool.wrap(bytes32(0));
    emit ClaimFailed(claimer);
  }

  function resetGame() external {
    require(msg.sender == owner, "Only owner can reset game");
    require(gameState == GameState.ENDED, "Game must be ENDED to reset");

    // FIX H1: Zero encrypted treasure coordinates (stale handles must not persist)
    treasureX = euint8.wrap(bytes32(0));
    treasureY = euint8.wrap(bytes32(0));

    // FIX H2: Clear burner mappings alongside player data
    for (uint256 i = 0; i < playerList.length; i++) {
      address playerAddr = playerList[i];
      address burner = playerToBurner[playerAddr];
      if (burner != address(0)) {
        delete burnerToPlayer[burner];
        delete playerToBurner[playerAddr];
      }
      delete players[playerAddr];
      delete playerMoveCount[playerAddr];
      hasPendingClaim[playerAddr] = false;
      pendingClaimResult[playerAddr] = ebool.wrap(bytes32(0));
      playerX[playerAddr] = euint8.wrap(bytes32(0));
      playerY[playerAddr] = euint8.wrap(bytes32(0));
      playerLastBucket[playerAddr] = euint8.wrap(bytes32(0));
    }
    delete playerList;

    gameState = GameState.WAITING;
    playerCount = 0;
    pot = 0;
    treasureSet = false;
    winner = address(0);

    emit GameReset();
  }

  // View functions
  function getPot() external view returns (uint256) {
    return pot;
  }

  function getPlayerCount() external view returns (uint256) {
    return playerCount;
  }

  function getGameState() external view returns (GameState) {
    return gameState;
  }

  function hasJoined(address player) external view returns (bool) {
    return players[player];
  }

  function getMoveCount(address player) external view returns (uint256) {
    return playerMoveCount[player];
  }
}
