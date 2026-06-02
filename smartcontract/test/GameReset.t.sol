// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {CofheClient} from "@cofhe/foundry-plugin/contracts/CofheClient.sol";
import {Permission} from "@cofhe/mock-contracts/contracts/Permissioned.sol";
import "../src/TreasureHunt.sol";

contract GameResetTest is CofheTest {
    TreasureHunt public game;
    CofheClient public alice; // owner
    CofheClient public bob;
    CofheClient public charlie;

    // pendingClaimResult mapping is at storage slot 13
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

    function _setTreasure(uint8 x, uint8 y) internal {
        InEuint8 memory ex = alice.createInEuint8(x);
        InEuint8 memory ey = alice.createInEuint8(y);
        vm.prank(alice.account());
        game.setTreasure(ex, ey);
    }

    function _joinGame(CofheClient player) internal {
        vm.prank(player.account());
        game.joinGame{value: 0.01 ether}();
    }

    function _move(CofheClient player, uint8 x, uint8 y) internal {
        InEuint8 memory ex = player.createInEuint8(x);
        InEuint8 memory ey = player.createInEuint8(y);
        vm.prank(player.account());
        game.move(ex, ey);
    }

    function _getPendingClaimHandle(address addr) internal view returns (bytes32) {
        bytes32 slot = keccak256(abi.encode(addr, PENDING_CLAIM_SLOT));
        return vm.load(address(game), slot);
    }

    /// Full 2-TX win claim for correct coordinates
    function _claimWin(CofheClient player, uint8 x, uint8 y) internal {
        InEuint8 memory ex = player.createInEuint8(x);
        InEuint8 memory ey = player.createInEuint8(y);
        vm.prank(player.account());
        game.prepareWinClaim(ex, ey);

        bytes32 ctHash = _getPendingClaimHandle(player.account());
        Permission memory perm = player.permit_createSelf();
        (, uint256 decrypted, bytes memory sig) = player.decryptForTx_withPermit(ctHash, perm);

        vm.prank(player.account());
        game.finalizeWinClaim(decrypted != 0, sig);
    }

    /// Helper: set up a complete game (treasure set, 2 players joined, game ACTIVE)
    function _activateGame() internal {
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(7, 4);
        assertEq(uint8(game.getGameState()), 1, "Game should be ACTIVE");
    }

    /// Helper: reach ENDED state (bob wins at treasure coords 7,4)
    function _endGame() internal {
        _activateGame();
        _move(bob, 7, 4);
        _claimWin(bob, 7, 4);
        assertEq(uint8(game.getGameState()), 2, "Game should be ENDED");
    }

    // ─── Full end-to-end flow ─────────────────────────────────────────────────

    function test_FullGameFlow() public {
        // 1. Players join lobby first
        _joinGame(bob);
        assertEq(uint8(game.getGameState()), 0, "Still WAITING after 1 player");
        _joinGame(charlie);
        assertEq(uint8(game.getGameState()), 0, "Still WAITING - treasure not set yet");
        assertEq(game.getPot(), 0.02 ether);

        // 2. Owner sets treasure -> ACTIVE
        _setTreasure(7, 4);
        assertTrue(game.treasureSet());
        assertEq(uint8(game.getGameState()), 1, "Should be ACTIVE after treasure set");

        // 3. Bob moves and checks proximity
        _move(bob, 7, 4); // on treasure → HOT
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3)); // HOT

        // 4. Bob claims win (2-TX)
        uint256 bobBefore = bob.account().balance;
        _claimWin(bob, 7, 4);
        assertEq(game.winner(), bob.account());
        assertEq(uint8(game.getGameState()), 2);
        assertGt(bob.account().balance, bobBefore, "Bob should receive pot");

        // 5. Owner resets
        vm.prank(alice.account());
        game.resetGame();
        assertEq(uint8(game.getGameState()), 0);
        assertEq(game.getPlayerCount(), 0);
        assertFalse(game.treasureSet());
        assertFalse(game.hasJoined(bob.account()));
        assertFalse(game.hasJoined(charlie.account()));

        // 6. New round: players join first, then set treasure
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(15, 15);
        assertTrue(game.treasureSet());
        assertTrue(game.hasJoined(bob.account()));
    }

    // ─── resetGame access control ────────────────────────────────────────────

    function test_ResetGame_OnlyOwner() public {
        _endGame();

        vm.prank(bob.account());
        vm.expectRevert("Only owner can reset game");
        game.resetGame();

        vm.prank(charlie.account());
        vm.expectRevert("Only owner can reset game");
        game.resetGame();

        // Owner succeeds
        vm.prank(alice.account());
        game.resetGame();
        assertEq(uint8(game.getGameState()), 0);
    }

    function test_ResetGame_RequiresEnded_FromWaiting() public {
        // WAITING state
        vm.prank(alice.account());
        vm.expectRevert("Game must be ENDED to reset");
        game.resetGame();
    }

    function test_ResetGame_RequiresEnded_FromActive() public {
        _activateGame();
        vm.prank(alice.account());
        vm.expectRevert("Game must be ENDED to reset");
        game.resetGame();
    }

    // ─── resetGame clears all state ──────────────────────────────────────────

    function test_ResetGame_ClearsPlayers() public {
        _endGame();
        vm.prank(alice.account());
        game.resetGame();

        assertFalse(game.hasJoined(bob.account()));
        assertFalse(game.hasJoined(charlie.account()));
        assertEq(game.getPlayerCount(), 0);
        assertEq(game.getMoveCount(bob.account()), 0);
    }

    function test_ResetGame_ClearsPot() public {
        _endGame();
        // After endGame, pot was transferred → already 0
        vm.prank(alice.account());
        game.resetGame();
        assertEq(game.getPot(), 0);
    }

    function test_ResetGame_ClearsTreasure() public {
        _endGame();
        vm.prank(alice.account());
        game.resetGame();
        assertFalse(game.treasureSet());
    }

    function test_ResetGame_ClearsWinner() public {
        _endGame();
        assertEq(game.winner(), bob.account());
        vm.prank(alice.account());
        game.resetGame();
        assertEq(game.winner(), address(0));
    }

    function test_ResetGame_ClearsPendingClaimer() public {
        // Set up: game ENDED with a cleared pending claimer (finalizeWinClaim clears it)
        _endGame();
        assertEq(game.pendingClaimer(), address(0)); // already cleared by finalizeWinClaim
        vm.prank(alice.account());
        game.resetGame();
        assertEq(game.pendingClaimer(), address(0));
    }

    function test_ResetGame_EmitsGameReset() public {
        _endGame();
        vm.expectEmit(false, false, false, false);
        emit TreasureHunt.GameReset();
        vm.prank(alice.account());
        game.resetGame();
    }

    // ─── Post-reset: new game round works correctly ───────────────────────────

    function test_CanPlayAgainAfterReset() public {
        _endGame();
        vm.prank(alice.account());
        game.resetGame();

        // Start new round: players join first, then set treasure
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(20, 30);
        assertEq(uint8(game.getGameState()), 1, "New game should be ACTIVE");

        // Bob moves and checks proximity (treasure at 20,30)
        _move(bob, 21, 30); // dist=1 → HOT
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3), "dist=1 should be HOT in new round");

        // Bob claims win
        _claimWin(bob, 20, 30);
        assertEq(game.winner(), bob.account());
        assertEq(uint8(game.getGameState()), 2);
    }

    function test_OldPlayerDataClearedBeforeNewRound() public {
        // Bob moves in first round
        _activateGame();
        _move(bob, 7, 4);
        assertEq(game.getMoveCount(bob.account()), 1);

        _claimWin(bob, 7, 4);
        vm.prank(alice.account());
        game.resetGame();

        // Move count should be cleared
        assertEq(game.getMoveCount(bob.account()), 0);

        // Bob and charlie join again with fresh state
        _joinGame(bob);
        _joinGame(charlie);
        _setTreasure(5, 5);
        assertTrue(game.hasJoined(bob.account()));
        assertEq(game.getMoveCount(bob.account()), 0);
    }

    // ─── Multi-player scenarios ──────────────────────────────────────────────

    function test_CharlieWinsInstead() public {
        _activateGame(); // treasure at (7,4)
        _move(charlie, 7, 4); // charlie on treasure

        uint256 charlieBefore = charlie.account().balance;
        _claimWin(charlie, 7, 4);

        assertEq(game.winner(), charlie.account());
        assertGt(charlie.account().balance, charlieBefore);
        assertEq(uint8(game.getGameState()), 2);
    }

    function test_OnlyOneWinnerPerRound() public {
        _activateGame();
        _move(bob, 7, 4);
        _claimWin(bob, 7, 4);
        assertEq(game.winner(), bob.account());

        // Charlie cannot prepare a win claim after game is ENDED
        // (prepareWinClaim itself checks gameState == ACTIVE)
        InEuint8 memory cx = charlie.createInEuint8(7);
        InEuint8 memory cy = charlie.createInEuint8(4);
        vm.prank(charlie.account());
        vm.expectRevert("Game must be ACTIVE");
        game.prepareWinClaim(cx, cy);
    }
}
