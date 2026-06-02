// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {CofheClient} from "@cofhe/foundry-plugin/contracts/CofheClient.sol";
import {Permission} from "@cofhe/mock-contracts/contracts/Permissioned.sol";
import {Vm} from "forge-std/Vm.sol";
import "../src/TreasureHunt.sol";

contract TreasureHuntTest is CofheTest {
    TreasureHunt public game;
    CofheClient public alice; // owner / deployer
    CofheClient public bob;
    CofheClient public charlie;

    // pendingClaimResult is the 14th declared variable → storage slot 13
    // Layout: treasureX(0) treasureY(1) owner(2) players(3) playerX(4)
    //         playerY(5) playerLastBucket(6) playerMoveCount(7)
    //         playerList(8) playerCount(9) gameState(10) pot(11)
    //         winner+treasureSet packed(12) pendingClaimResult(13) pendingClaimer(14)
    uint256 constant PENDING_CLAIM_SLOT = 13;

    function setUp() public {
        deployMocks();

        alice = createCofheClient();
        alice.connect(0xA11CE);

        bob = createCofheClient();
        bob.connect(0xB0B);

        charlie = createCofheClient();
        charlie.connect(0xCCCE);

        deal(alice.account(), 2 ether);
        deal(bob.account(), 2 ether);
        deal(charlie.account(), 2 ether);

        vm.prank(alice.account());
        game = new TreasureHunt();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /// Set treasure (owner = alice)
    function _setTreasure(uint8 x, uint8 y) internal {
        InEuint8 memory ex = alice.createInEuint8(x);
        InEuint8 memory ey = alice.createInEuint8(y);
        vm.prank(alice.account());
        game.setTreasure(ex, ey);
    }

    /// Join game from a CofheClient
    function _joinGame(CofheClient player) internal {
        vm.prank(player.account());
        game.joinGame{value: 0.01 ether}();
    }

    /// Move player to position
    function _move(CofheClient player, uint8 x, uint8 y) internal {
        InEuint8 memory ex = player.createInEuint8(x);
        InEuint8 memory ey = player.createInEuint8(y);
        vm.prank(player.account());
        game.move(ex, ey);
    }

    /// Activate the game: bob + charlie join first, then owner sets treasure → ACTIVE
    function _activateGame() internal {
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(5, 5);
        assertEq(uint8(game.getGameState()), 1, "Game should be ACTIVE");
    }

    /// Read pendingClaimResult[addr] handle from private storage
    function _getPendingClaimHandle(address addr) internal view returns (bytes32) {
        bytes32 slot = keccak256(abi.encode(addr, PENDING_CLAIM_SLOT));
        return vm.load(address(game), slot);
    }

    /// Full 2-TX win claim: prepareWinClaim → decrypt → finalizeWinClaim
    /// Only valid for CORRECT coordinates (reverts otherwise).
    function _claimWin(CofheClient player, uint8 x, uint8 y) internal {
        // TX 1
        InEuint8 memory ex = player.createInEuint8(x);
        InEuint8 memory ey = player.createInEuint8(y);
        vm.prank(player.account());
        game.prepareWinClaim(ex, ey);

        // Off-chain: read sealed handle, decrypt with permit
        bytes32 ctHash = _getPendingClaimHandle(player.account());
        Permission memory perm = player.permit_createSelf();
        (, uint256 decrypted, bytes memory sig) = player.decryptForTx_withPermit(ctHash, perm);

        // TX 2
        vm.prank(player.account());
        game.finalizeWinClaim(decrypted != 0, sig);
    }

    // ─── Initialization ───────────────────────────────────────────────────────

    function test_GameInitialization() public {
        assertEq(uint8(game.getGameState()), 0);
        assertEq(game.getPlayerCount(), 0);
        assertEq(game.getPot(), 0);
        assertEq(game.owner(), alice.account());
        assertEq(game.winner(), address(0));
        assertFalse(game.treasureSet());
    }

    // ─── setTreasure ─────────────────────────────────────────────────────────

    function test_SetTreasure() public {
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(10, 20);
        assertTrue(game.treasureSet());
        assertEq(uint8(game.getGameState()), 1); // ACTIVE — setTreasure triggers transition
    }

    function test_SetTreasure_RevertIfNotEnoughPlayers() public {
        // 0 players → revert
        InEuint8 memory ex = alice.createInEuint8(5);
        InEuint8 memory ey = alice.createInEuint8(5);
        vm.prank(alice.account());
        vm.expectRevert("Need at least 2 players to start");
        game.setTreasure(ex, ey);

        // 1 player → still revert
        _joinGame(bob);
        ex = alice.createInEuint8(5);
        ey = alice.createInEuint8(5);
        vm.prank(alice.account());
        vm.expectRevert("Need at least 2 players to start");
        game.setTreasure(ex, ey);
    }

    function test_SetTreasure_EmitsGameCreated() public {
        _joinGame(bob);
        _joinGame(charlie);
        vm.recordLogs();
        _setTreasure(10, 20);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 expectedSig = keccak256("GameCreated(address)");
        bool found = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(game) &&
                logs[i].topics.length > 1 &&
                logs[i].topics[0] == expectedSig) {
                address emittedOwner = address(uint160(uint256(logs[i].topics[1])));
                assertEq(emittedOwner, alice.account(), "Wrong owner in GameCreated");
                found = true;
                break;
            }
        }
        assertTrue(found, "GameCreated event not emitted by game contract");
    }

    function test_SetTreasure_RevertIfNotOwner() public {
        InEuint8 memory ex = bob.createInEuint8(10);
        InEuint8 memory ey = bob.createInEuint8(20);
        vm.prank(bob.account());
        vm.expectRevert("Only owner can set treasure");
        game.setTreasure(ex, ey);
    }

    function test_SetTreasure_RevertIfAlreadySet() public {
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(10, 20);
        // Game is now ACTIVE — state check fires before treasure check
        InEuint8 memory ex = alice.createInEuint8(1);
        InEuint8 memory ey = alice.createInEuint8(1);
        vm.prank(alice.account());
        vm.expectRevert("Game must be in WAITING state");
        game.setTreasure(ex, ey);
    }

    function test_SetTreasure_RevertIfNotWaiting() public {
        _activateGame(); // transitions to ACTIVE
        InEuint8 memory ex = alice.createInEuint8(1);
        InEuint8 memory ey = alice.createInEuint8(1);
        vm.prank(alice.account());
        vm.expectRevert("Game must be in WAITING state");
        game.setTreasure(ex, ey);
    }

    // ─── joinGame ─────────────────────────────────────────────────────────────

    function test_JoinGame() public {
        _joinGame(bob); // no treasure needed — players join first
        assertTrue(game.hasJoined(bob.account()));
        assertEq(game.getPlayerCount(), 1);
        assertEq(game.getPot(), 0.01 ether);
        assertEq(uint8(game.getGameState()), 0); // WAITING — treasure not set yet
    }

    function test_JoinGame_TransitionToActive() public {
        // Players join first, then owner sets treasure → ACTIVE
        _joinGame(bob);
        _joinGame(charlie);
        assertEq(uint8(game.getGameState()), 0); // still WAITING before treasure
        _setTreasure(5, 5);
        assertEq(uint8(game.getGameState()), 1);
        assertEq(game.getPot(), 0.02 ether);
    }

    function test_JoinGame_NoTransitionWithoutTreasure() public {
        // 2 players but treasure not set yet → stays WAITING
        _joinGame(bob);
        _joinGame(charlie);
        assertEq(uint8(game.getGameState()), 0);
    }

    function test_JoinGame_EmitsPlayerJoined() public {
        vm.expectEmit(true, false, false, true);
        emit TreasureHunt.PlayerJoined(bob.account(), 1);
        _joinGame(bob);
    }

    function test_JoinGame_RevertIfWrongFee_Low() public {
        vm.prank(bob.account());
        vm.expectRevert("Entry fee must be exactly 0.01 ETH");
        game.joinGame{value: 0.005 ether}();
    }

    function test_JoinGame_RevertIfWrongFee_High() public {
        vm.prank(bob.account());
        vm.expectRevert("Entry fee must be exactly 0.01 ETH");
        game.joinGame{value: 0.02 ether}();
    }

    function test_JoinGame_RevertIfAlreadyJoined() public {
        _joinGame(bob);
        vm.prank(bob.account());
        vm.expectRevert("Player already joined");
        game.joinGame{value: 0.01 ether}();
    }

    function test_JoinGame_RevertIfNotWaiting() public {
        _activateGame();
        address dave = makeAddr("dave");
        deal(dave, 1 ether);
        vm.prank(dave);
        vm.expectRevert("Game must be in WAITING state");
        game.joinGame{value: 0.01 ether}();
    }

    function test_JoinGame_RevertIfFull() public {
        // Do NOT set treasure — game stays WAITING even with 16 players
        // (setTreasure required for WAITING→ACTIVE transition)
        for (uint256 i = 0; i < 16; i++) {
            address p = address(uint160(0xDEAD + i));
            deal(p, 1 ether);
            vm.prank(p);
            game.joinGame{value: 0.01 ether}();
        }
        address overflow = makeAddr("overflow");
        deal(overflow, 1 ether);
        vm.prank(overflow);
        vm.expectRevert("Game is full");
        game.joinGame{value: 0.01 ether}();
    }

    // ─── move ─────────────────────────────────────────────────────────────────

    function test_Move() public {
        _activateGame();
        _move(bob, 3, 7);
        assertEq(game.getMoveCount(bob.account()), 1);
    }

    function test_Move_IncreasesMoveCount() public {
        _activateGame();
        _move(bob, 3, 7);
        _move(bob, 4, 8);
        assertEq(game.getMoveCount(bob.account()), 2);
    }

    function test_Move_EmitsPlayerMoved() public {
        _activateGame();
        InEuint8 memory ex = bob.createInEuint8(3);
        InEuint8 memory ey = bob.createInEuint8(7);
        vm.expectEmit(true, false, false, false);
        emit TreasureHunt.PlayerMoved(bob.account());
        vm.prank(bob.account());
        game.move(ex, ey);
    }

    function test_Move_RevertIfNotPlayer() public {
        _activateGame();
        CofheClient dave = createCofheClient();
        dave.connect(0xDADE);
        deal(dave.account(), 1 ether);
        InEuint8 memory ex = dave.createInEuint8(3);
        InEuint8 memory ey = dave.createInEuint8(7);
        vm.prank(dave.account());
        vm.expectRevert("Player must have joined");
        game.move(ex, ey);
    }

    function test_Move_RevertIfNotActive() public {
        _joinGame(bob); // only 1 player, no treasure → WAITING
        InEuint8 memory ex = bob.createInEuint8(3);
        InEuint8 memory ey = bob.createInEuint8(7);
        vm.prank(bob.account());
        vm.expectRevert("Game must be ACTIVE");
        game.move(ex, ey);
    }

    // ─── checkProximity ──────────────────────────────────────────────────────

    // Treasure at (5,5). Bucket mapping:
    //   HOT=3  dist ≤ 2 : (7,5) dist=2, (5,6) dist=1, (5,5) dist=0
    //   WARM=2 dist 3–5 : (8,5) dist=3, (10,5) dist=5
    //   COLD=1 dist 6–8 : (11,5) dist=6, (13,5) dist=8
    //   FROZEN=0 dist>8 : (14,5) dist=9

    function test_CheckProximity_Hot_Boundary() public {
        _activateGame();
        _move(bob, 7, 5); // dist = |7-5| + 0 = 2 → HOT
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3), "Expected HOT (3) at dist=2");
    }

    function test_CheckProximity_Hot_OnTreasure() public {
        _activateGame();
        _move(bob, 5, 5); // dist = 0 → HOT
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3), "Expected HOT (3) at dist=0");
    }

    function test_CheckProximity_Warm() public {
        _activateGame();
        _move(bob, 8, 5); // dist = 3 → WARM
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(2), "Expected WARM (2) at dist=3");
    }

    function test_CheckProximity_Warm_Boundary() public {
        _activateGame();
        _move(bob, 10, 5); // dist = 5 → WARM boundary
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(2), "Expected WARM (2) at dist=5");
    }

    function test_CheckProximity_Cold() public {
        _activateGame();
        _move(bob, 11, 5); // dist = 6 → COLD
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(1), "Expected COLD (1) at dist=6");
    }

    function test_CheckProximity_Cold_Boundary() public {
        _activateGame();
        _move(bob, 13, 5); // dist = 8 → COLD boundary
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(1), "Expected COLD (1) at dist=8");
    }

    function test_CheckProximity_Frozen() public {
        _activateGame();
        _move(bob, 14, 5); // dist = 9 → FROZEN
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(0), "Expected FROZEN (0) at dist=9");
    }

    function test_CheckProximity_EmitsEvent() public {
        _activateGame();
        _move(bob, 7, 5);
        vm.expectEmit(true, false, false, false);
        emit TreasureHunt.ProximityChecked(bob.account());
        vm.prank(bob.account());
        game.checkProximity();
    }

    function test_CheckProximity_RevertBeforeMove() public {
        _activateGame();
        vm.prank(bob.account());
        vm.expectRevert("Must move before checking proximity");
        game.checkProximity();
    }

    function test_CheckProximity_RevertIfNotPlayer() public {
        _activateGame();
        CofheClient dave = createCofheClient();
        dave.connect(0xDADE);
        vm.prank(dave.account());
        vm.expectRevert("Player must have joined");
        game.checkProximity();
    }

    function test_CheckProximity_RevertIfNotActive() public {
        _joinGame(bob); // 1 player, no treasure → WAITING
        vm.prank(bob.account());
        vm.expectRevert("Game must be ACTIVE");
        game.checkProximity();
    }

    // ─── getLastBucket ───────────────────────────────────────────────────────

    function test_GetLastBucket_ReturnsHandle() public {
        _activateGame();
        _move(bob, 5, 5);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        // handle should decode as HOT
        expectPlaintext(handle, uint8(3));
    }

    function test_GetLastBucket_RevertIfNotPlayer() public {
        _activateGame();
        CofheClient dave = createCofheClient();
        dave.connect(0xDADE);
        vm.prank(dave.account());
        vm.expectRevert("Player must have joined");
        game.getLastBucket();
    }

    // ─── prepareWinClaim ─────────────────────────────────────────────────────

    function test_PrepareWinClaim_SetsPendingClaimer() public {
        _activateGame();
        _move(bob, 5, 5);
        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);
        assertEq(game.pendingClaimer(), bob.account());
    }

    function test_PrepareWinClaim_EmitsEvent() public {
        _activateGame();
        _move(bob, 5, 5);
        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.expectEmit(true, false, false, false);
        emit TreasureHunt.WinClaimPrepared(bob.account());
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);
    }

    function test_PrepareWinClaim_AllowsResubmit() public {
        // Bob can overwrite his own pending claim
        _activateGame();
        _move(bob, 5, 5);
        InEuint8 memory ex1 = bob.createInEuint8(10);
        InEuint8 memory ey1 = bob.createInEuint8(10);
        vm.prank(bob.account());
        game.prepareWinClaim(ex1, ey1);

        InEuint8 memory ex2 = bob.createInEuint8(5);
        InEuint8 memory ey2 = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(ex2, ey2); // should not revert
        assertEq(game.pendingClaimer(), bob.account());
    }

    function test_PrepareWinClaim_RevertIfNotPlayer() public {
        _activateGame();
        CofheClient dave = createCofheClient();
        dave.connect(0xDADE);
        InEuint8 memory ex = dave.createInEuint8(5);
        InEuint8 memory ey = dave.createInEuint8(5);
        vm.prank(dave.account());
        vm.expectRevert("Player must have joined");
        game.prepareWinClaim(ex, ey);
    }

    function test_PrepareWinClaim_RevertIfNotActive() public {
        _joinGame(bob); // 1 player, no treasure → WAITING
        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.prank(bob.account());
        vm.expectRevert("Game must be ACTIVE");
        game.prepareWinClaim(ex, ey);
    }

    function test_PrepareWinClaim_RevertIfAnotherPending() public {
        _activateGame();
        // bob prepares first
        _move(bob, 5, 5);
        InEuint8 memory bx = bob.createInEuint8(5);
        InEuint8 memory by_ = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(bx, by_);

        // charlie tries to prepare → should revert (bob is pending)
        _move(charlie, 5, 5);
        InEuint8 memory cx = charlie.createInEuint8(5);
        InEuint8 memory cy = charlie.createInEuint8(5);
        vm.prank(charlie.account());
        vm.expectRevert("Another win claim in progress");
        game.prepareWinClaim(cx, cy);
    }

    // ─── finalizeWinClaim ────────────────────────────────────────────────────

    function test_FinalizeWinClaim_Success() public {
        _activateGame();
        _move(bob, 5, 5);

        uint256 bobBalanceBefore = bob.account().balance;
        uint256 potBefore = game.getPot();

        _claimWin(bob, 5, 5);

        assertEq(game.winner(), bob.account(), "Bob should be winner");
        assertEq(uint8(game.getGameState()), 2, "Game should be ENDED");
        assertEq(game.pot(), 0, "Pot should be 0 after payout");
        assertEq(bob.account().balance, bobBalanceBefore + potBefore, "Bob should receive pot");
    }

    function test_FinalizeWinClaim_EmitsGameWon() public {
        _activateGame();
        _move(bob, 5, 5);

        // TX 1
        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);

        bytes32 ctHash = _getPendingClaimHandle(bob.account());
        Permission memory perm = bob.permit_createSelf();
        (, uint256 decrypted, bytes memory sig) = bob.decryptForTx_withPermit(ctHash, perm);

        // TX 2 — expect event
        vm.expectEmit(true, false, false, false);
        emit TreasureHunt.GameWon(bob.account());
        vm.prank(bob.account());
        game.finalizeWinClaim(decrypted != 0, sig);
    }

    function test_FinalizeWinClaim_WrongCoords_Reverts() public {
        _activateGame();
        _move(bob, 10, 10); // not at treasure (5,5)

        InEuint8 memory ex = bob.createInEuint8(10);
        InEuint8 memory ey = bob.createInEuint8(10);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);

        bytes32 ctHash = _getPendingClaimHandle(bob.account());
        Permission memory perm = bob.permit_createSelf();
        (, uint256 decrypted, bytes memory sig) = bob.decryptForTx_withPermit(ctHash, perm);

        assertEq(decrypted, 0, "Decrypted result should be false (wrong coords)");

        vm.prank(bob.account());
        vm.expectRevert("Coordinates are not the treasure location");
        game.finalizeWinClaim(false, sig);
    }

    function test_FinalizeWinClaim_InvalidSignature_Reverts() public {
        _activateGame();
        _move(bob, 5, 5);

        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);

        // Mock verifier throws InvalidSignature() (ECDSA error) before our require string
        vm.prank(bob.account());
        vm.expectRevert(abi.encodeWithSignature("InvalidSignature()"));
        game.finalizeWinClaim(true, bytes("garbage_signature"));
    }

    function test_FinalizeWinClaim_RevertIfNoPending() public {
        _activateGame();
        vm.prank(bob.account());
        vm.expectRevert("No pending claim for this address");
        game.finalizeWinClaim(true, bytes(""));
    }

    function test_FinalizeWinClaim_RevertIfCallerNotPendingClaimer() public {
        _activateGame();
        _move(bob, 5, 5);

        InEuint8 memory ex = bob.createInEuint8(5);
        InEuint8 memory ey = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);

        // charlie tries to finalize bob's pending claim
        vm.prank(charlie.account());
        vm.expectRevert("No pending claim for this address");
        game.finalizeWinClaim(true, bytes(""));
    }

    // ─── Wrong-claim flow (E2E: wrong coords → retry) ────────────────────────

    /// @notice After wrong coords, pendingClaimer stays set and game stays ACTIVE.
    ///         The frontend skips TX2 when decrypted result is false.
    function test_WrongClaim_PendingClaimerRetains() public {
        _activateGame();
        _move(bob, 10, 10); // not at treasure (5,5)

        InEuint8 memory ex = bob.createInEuint8(10);
        InEuint8 memory ey = bob.createInEuint8(10);
        vm.prank(bob.account());
        game.prepareWinClaim(ex, ey);

        // Decrypt off-chain — should yield false (wrong coords)
        bytes32 ctHash = _getPendingClaimHandle(bob.account());
        Permission memory perm = bob.permit_createSelf();
        (, uint256 decrypted, ) = bob.decryptForTx_withPermit(ctHash, perm);

        // Frontend: result=false → skip TX2 (finalizeWinClaim never called)
        assertEq(decrypted, 0, "Wrong coords: decrypted must be 0 (false)");

        // State: pendingClaimer stays set, game still ACTIVE
        assertEq(game.pendingClaimer(), bob.account(), "pendingClaimer should still be bob");
        assertEq(uint8(game.getGameState()), 1, "Game must still be ACTIVE");
        assertEq(game.winner(), address(0), "No winner yet");
    }

    /// @notice After a wrong claim (TX2 skipped), the same player can retry immediately
    ///         by calling prepareWinClaim again — the contract allows overwriting own pending.
    function test_WrongClaim_ThenCorrectClaim() public {
        _activateGame();

        // Step 1: Bob claims wrong coords (10,10) — frontend skips TX2
        _move(bob, 10, 10);
        {
            InEuint8 memory ex = bob.createInEuint8(10);
            InEuint8 memory ey = bob.createInEuint8(10);
            vm.prank(bob.account());
            game.prepareWinClaim(ex, ey);
            // Frontend: decrypt → false → no TX2 → pendingClaimer=bob still set
        }
        assertEq(game.pendingClaimer(), bob.account(), "pendingClaimer set after wrong claim");

        // Step 2: Bob moves to correct position and retries (prepareWinClaim overwrites own pending)
        _move(bob, 5, 5);
        _claimWin(bob, 5, 5);

        assertEq(game.winner(), bob.account(), "Bob wins after retry");
        assertEq(uint8(game.getGameState()), 2, "Game ENDED after correct claim");
        assertEq(game.pendingClaimer(), address(0), "pendingClaimer cleared on win");
    }

    /// @notice While pendingClaimer is set (wrong claim, TX2 skipped), other players cannot claim.
    ///         The pending claimer themselves can retry.
    function test_WrongClaim_OtherPlayersBlocked() public {
        _activateGame();

        // Bob makes a wrong claim (frontend skips TX2)
        _move(bob, 10, 10);
        InEuint8 memory bx = bob.createInEuint8(10);
        InEuint8 memory by_ = bob.createInEuint8(10);
        vm.prank(bob.account());
        game.prepareWinClaim(bx, by_);
        assertEq(game.pendingClaimer(), bob.account());

        // Charlie is blocked — bob's pending claim is still active
        _move(charlie, 5, 5);
        InEuint8 memory cx = charlie.createInEuint8(5);
        InEuint8 memory cy = charlie.createInEuint8(5);
        vm.prank(charlie.account());
        vm.expectRevert("Another win claim in progress");
        game.prepareWinClaim(cx, cy);

        // Bob is NOT blocked — can overwrite his own pending claim
        _move(bob, 5, 5);
        InEuint8 memory bx2 = bob.createInEuint8(5);
        InEuint8 memory by2 = bob.createInEuint8(5);
        vm.prank(bob.account());
        game.prepareWinClaim(bx2, by2); // should not revert
        assertEq(game.pendingClaimer(), bob.account(), "Bob still pendingClaimer after retry");
    }

    // ─── ACL: both arms of FHE.select must be valid ──────────────────────────

    function test_BothArms_CheckProximity_OnTreasure() public {
        _activateGame();
        _move(bob, 5, 5); // dist=0 → isHot=true (HOT arm)
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3));
    }

    function test_BothArms_CheckProximity_FarFromTreasure() public {
        _activateGame();
        _move(bob, 255, 255); // dist > 8 → FROZEN arm
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(0));
    }

    // ─── View functions ──────────────────────────────────────────────────────

    function test_ViewFunctions() public {
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(5, 5);

        assertEq(game.getPot(), 0.02 ether);
        assertEq(game.getPlayerCount(), 2);
        assertEq(uint8(game.getGameState()), 1);
        assertTrue(game.hasJoined(bob.account()));
        assertFalse(game.hasJoined(makeAddr("nobody")));
        assertEq(game.getMoveCount(bob.account()), 0);

        _move(bob, 3, 3);
        assertEq(game.getMoveCount(bob.account()), 1);
    }

    // ─── resetGame ───────────────────────────────────────────────────────────

    function test_ResetGame_OnlyOwner() public {
        _activateGame();
        _claimWin(bob, 5, 5);
        assertEq(uint8(game.getGameState()), 2);

        vm.prank(bob.account());
        vm.expectRevert("Only owner can reset game");
        game.resetGame();
    }

    function test_ResetGame_RequiresEnded() public {
        _activateGame();
        vm.prank(alice.account());
        vm.expectRevert("Game must be ENDED to reset");
        game.resetGame();
    }

    function test_ResetGame_ClearsState() public {
        _activateGame();
        _claimWin(bob, 5, 5);

        vm.prank(alice.account());
        game.resetGame();

        assertEq(uint8(game.getGameState()), 0);
        assertEq(game.getPlayerCount(), 0);
        assertEq(game.getPot(), 0);
        assertFalse(game.treasureSet());
        assertEq(game.winner(), address(0));
        assertEq(game.pendingClaimer(), address(0));
        assertFalse(game.hasJoined(bob.account()));
        assertFalse(game.hasJoined(charlie.account()));
        assertEq(game.getMoveCount(bob.account()), 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Burner Wallet Tests
// ─────────────────────────────────────────────────────────────────────────────

contract BurnerWalletTest is CofheTest {
    TreasureHunt public game;
    CofheClient public alice; // owner
    CofheClient public bob;   // player
    CofheClient public charlie; // burner key (controlled by bob)

    function setUp() public {
        deployMocks();

        alice = createCofheClient();
        alice.connect(0xA11CE);

        bob = createCofheClient();
        bob.connect(0xB0B);

        charlie = createCofheClient();
        charlie.connect(0xCCCE);

        deal(alice.account(), 2 ether);
        deal(bob.account(), 2 ether);
        deal(charlie.account(), 2 ether);

        vm.prank(alice.account());
        game = new TreasureHunt();
    }

    function _activateGame() internal {
        vm.prank(alice.account());
        game.joinGame{value: 0.01 ether}();
        vm.prank(bob.account());
        game.joinGame{value: 0.01 ether}();

        InEuint8 memory tx_ = alice.createInEuint8(5);
        InEuint8 memory ty_ = alice.createInEuint8(5);
        vm.prank(alice.account());
        game.setTreasure(tx_, ty_);
    }

    /// @notice Burner authorized by player can submit moves on player's behalf
    function test_Burner_AuthorizeAndMove() public {
        _activateGame();

        // Save addresses before prank — vm.prank is consumed by external calls (e.g. .account())
        address bobAddr     = bob.account();
        address charlieAddr = charlie.account();

        vm.prank(bobAddr);
        game.authorizeBurner(charlieAddr);
        assertEq(game.burnerToPlayer(charlieAddr), bobAddr);

        // Burner (charlie) creates FHE inputs with its own client — proof must match tx submitter
        InEuint8 memory px = charlie.createInEuint8(3);
        InEuint8 memory py = charlie.createInEuint8(4);
        vm.prank(charlieAddr);
        game.move(px, py);

        // Move attributed to bob, not charlie
        assertEq(game.getMoveCount(bobAddr), 1);
        assertEq(game.getMoveCount(charlieAddr), 0);
    }

    /// @notice PlayerMoved event emits player address (bob), not burner (charlie)
    function test_Burner_EventEmitsPlayer() public {
        _activateGame();

        address bobAddr     = bob.account();
        address charlieAddr = charlie.account();

        vm.prank(bobAddr);
        game.authorizeBurner(charlieAddr);

        // Burner creates its own FHE inputs
        InEuint8 memory px = charlie.createInEuint8(3);
        InEuint8 memory py = charlie.createInEuint8(4);

        vm.expectEmit(true, false, false, false);
        emit TreasureHunt.PlayerMoved(bobAddr);

        vm.prank(charlieAddr);
        game.move(px, py);
    }

    /// @notice Unregistered burner (no authorization) reverts
    function test_Burner_UnauthorizedReverts() public {
        _activateGame();
        address charlieAddr = charlie.account();
        // charlie is NOT authorized as bob's burner — uses its own FHE inputs
        InEuint8 memory px = charlie.createInEuint8(3);
        InEuint8 memory py = charlie.createInEuint8(4);
        vm.prank(charlieAddr);
        vm.expectRevert("Player must have joined");
        game.move(px, py);
    }

    /// @notice authorizeBurner requires caller to be a registered player
    function test_Burner_AuthorizeRequiresJoined() public {
        _activateGame();
        address charlieAddr = charlie.account();
        // charlie never joined, cannot authorize a burner
        vm.prank(charlieAddr);
        vm.expectRevert("Player must have joined");
        game.authorizeBurner(address(0xDEAD));
    }
}
