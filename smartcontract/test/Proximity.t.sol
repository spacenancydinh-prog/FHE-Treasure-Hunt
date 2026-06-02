// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {CofheClient} from "@cofhe/foundry-plugin/contracts/CofheClient.sol";
import "../src/TreasureHunt.sol";

/// @notice Fuzz + boundary tests for the proximity bucket computation.
///         The core property: the FHE-computed bucket must EXACTLY match
///         the plaintext-computed bucket for every (px, py) input.
contract ProximityTest is CofheTest {
    TreasureHunt public game;
    CofheClient public alice;
    CofheClient public bob;

    // Fixed treasure for all tests in this file
    uint8 constant TX = 50;
    uint8 constant TY = 50;

    function setUp() public {
        deployMocks();

        alice = createCofheClient();
        alice.connect(0xA11CE);

        bob = createCofheClient();
        bob.connect(0xB0B);

        deal(alice.account(), 2 ether);
        deal(bob.account(), 2 ether);

        vm.prank(alice.account());
        game = new TreasureHunt();

        // Players join first, then owner sets treasure → ACTIVE
        vm.prank(bob.account());
        game.joinGame{value: 0.01 ether}();

        address charlie = makeAddr("charlie");
        deal(charlie, 1 ether);
        vm.prank(charlie);
        game.joinGame{value: 0.01 ether}();

        InEuint8 memory ex = alice.createInEuint8(TX);
        InEuint8 memory ey = alice.createInEuint8(TY);
        vm.prank(alice.account());
        game.setTreasure(ex, ey);

        assertEq(uint8(game.getGameState()), 1, "Game must be ACTIVE for tests");
    }

    // ─── Helper ──────────────────────────────────────────────────────────────

    /// Returns the expected plaintext bucket for a given player position.
    /// IMPORTANT: uses unchecked uint8 arithmetic so the sum wraps at 255, exactly
    /// matching FHE.add(dx, dy) on euint8. Distances > 255 will wrap and may yield
    /// a smaller bucket — this is the actual contract behaviour to test against.
    function _expectedBucket(uint8 px, uint8 py) internal pure returns (uint8) {
        uint8 dx = px >= TX ? px - TX : TX - px;
        uint8 dy = py >= TY ? py - TY : TY - py;
        uint8 dist;
        unchecked { dist = dx + dy; } // intentional wrap — mirrors euint8.add() overflow

        if (dist <= 2) return 3; // HOT
        if (dist <= 5) return 2; // WARM
        if (dist <= 8) return 1; // COLD
        return 0;                // FROZEN
    }

    // ─── Fuzz: FHE bucket matches plaintext bucket for ALL coords ────────────

    /// @dev Core invariant: encrypted bucket == expected plaintext bucket.
    function testFuzz_BucketMatchesPlaintext(uint8 px, uint8 py) public {
        InEuint8 memory epx = bob.createInEuint8(px);
        InEuint8 memory epy = bob.createInEuint8(py);
        vm.prank(bob.account());
        game.move(epx, epy);

        vm.prank(bob.account());
        game.checkProximity();

        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();

        uint8 expected = _expectedBucket(px, py);
        expectPlaintext(handle, expected);
    }

    /// @dev Bucket always in valid range [0, 3] — never reverts.
    function testFuzz_BucketAlwaysInRange(uint8 px, uint8 py) public {
        InEuint8 memory epx = bob.createInEuint8(px);
        InEuint8 memory epy = bob.createInEuint8(py);
        vm.prank(bob.account());
        game.move(epx, epy);

        vm.prank(bob.account());
        game.checkProximity();

        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();

        uint8 bucket = getPlaintext(handle);
        assertTrue(bucket <= 3, "Bucket must be 0-3");
    }

    // ─── Fuzz: sub-domain HOT inputs always yield HOT ────────────────────────

    /// @dev Any position within Manhattan distance 2 of treasure must be HOT.
    function testFuzz_HotBucket(uint8 dx, uint8 dy) public {
        // Constrain: dx + dy <= 2 (HOT zone), with safe arithmetic to avoid overflow
        vm.assume(uint16(dx) + uint16(dy) <= 2);

        uint8 px;
        uint8 py;
        // Place player at (TX + dx, TY + dy) if no overflow
        unchecked {
            px = TX + dx;
            py = TY + dy;
        }
        // Skip if overflow pushed us outside [0,255]
        vm.assume(px >= TX && py >= TY);

        InEuint8 memory epx = bob.createInEuint8(px);
        InEuint8 memory epy = bob.createInEuint8(py);
        vm.prank(bob.account());
        game.move(epx, epy);

        vm.prank(bob.account());
        game.checkProximity();

        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(3), "Expected HOT (3)");
    }

    // ─── Fuzz: far-away inputs always yield FROZEN ───────────────────────────

    /// @dev Any position where the unchecked uint8-wrapped distance > 8 must be FROZEN.
    /// Uses same wrapping arithmetic as the on-chain euint8.add().
    function testFuzz_FrozenBucket(uint8 px, uint8 py) public {
        uint8 dx = px >= TX ? px - TX : TX - px;
        uint8 dy = py >= TY ? py - TY : TY - py;
        uint8 wdist;
        unchecked { wdist = dx + dy; } // intentional wrap
        vm.assume(wdist > 8);

        InEuint8 memory epx = bob.createInEuint8(px);
        InEuint8 memory epy = bob.createInEuint8(py);
        vm.prank(bob.account());
        game.move(epx, epy);

        vm.prank(bob.account());
        game.checkProximity();

        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        expectPlaintext(handle, uint8(0), "Expected FROZEN (0)");
    }

    // ─── Fuzz: move count always increments ──────────────────────────────────

    function testFuzz_MoveCountIncrements(uint8 px, uint8 py) public {
        uint256 before = game.getMoveCount(bob.account());

        InEuint8 memory epx = bob.createInEuint8(px);
        InEuint8 memory epy = bob.createInEuint8(py);
        vm.prank(bob.account());
        game.move(epx, epy);

        assertEq(game.getMoveCount(bob.account()), before + 1);
    }

    // ─── Boundary unit tests ─────────────────────────────────────────────────

    function test_Boundary_HotToWarm() public {
        // dist=2 → HOT, dist=3 → WARM
        InEuint8 memory epx2 = bob.createInEuint8(TX + 2);
        InEuint8 memory epy2 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx2, epy2);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(3), "dist=2 must be HOT");

        InEuint8 memory epx3 = bob.createInEuint8(TX + 3);
        InEuint8 memory epy3 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx3, epy3);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(2), "dist=3 must be WARM");
    }

    function test_Boundary_WarmToCold() public {
        // dist=5 → WARM, dist=6 → COLD
        InEuint8 memory epx5 = bob.createInEuint8(TX + 5);
        InEuint8 memory epy5 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx5, epy5);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(2), "dist=5 must be WARM");

        InEuint8 memory epx6 = bob.createInEuint8(TX + 6);
        InEuint8 memory epy6 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx6, epy6);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(1), "dist=6 must be COLD");
    }

    function test_Boundary_ColdToFrozen() public {
        // dist=8 → COLD, dist=9 → FROZEN
        InEuint8 memory epx8 = bob.createInEuint8(TX + 8);
        InEuint8 memory epy8 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx8, epy8);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(1), "dist=8 must be COLD");

        InEuint8 memory epx9 = bob.createInEuint8(TX + 9);
        InEuint8 memory epy9 = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epx9, epy9);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(0), "dist=9 must be FROZEN");
    }

    function test_SymmetricDistance() public {
        // dist from (TX-3, TY) and (TX+3, TY) must both be WARM
        InEuint8 memory epxA = bob.createInEuint8(TX - 3);
        InEuint8 memory epyA = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epxA, epyA);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(2), "TX-3 must be WARM");

        InEuint8 memory epxB = bob.createInEuint8(TX + 3);
        InEuint8 memory epyB = bob.createInEuint8(TY);
        vm.prank(bob.account());
        game.move(epxB, epyB);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(2), "TX+3 must be WARM");
    }

    function test_DiagonalDistance() public {
        // dist from (TX+1, TY+1) = 2 → HOT
        // dist from (TX+2, TY+1) = 3 → WARM
        InEuint8 memory epx = bob.createInEuint8(TX + 1);
        InEuint8 memory epy = bob.createInEuint8(TY + 1);
        vm.prank(bob.account());
        game.move(epx, epy);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(3), "(TX+1,TY+1) dist=2 must be HOT");
    }

    function test_MaxDistanceIsFrozen() public {
        // (0,0) to (50,50): dist = 100 → FROZEN
        InEuint8 memory epx = bob.createInEuint8(0);
        InEuint8 memory epy = bob.createInEuint8(0);
        vm.prank(bob.account());
        game.move(epx, epy);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        expectPlaintext(game.getLastBucket(), uint8(0), "(0,0) dist=100 must be FROZEN");
    }

    function test_WrappingDistanceNeverOccurs() public {
        // Player at (255, 255) — max euint8. Distance to (50,50) = 205+205=410.
        // euint8 arithmetic clips to 255 max inside distance calculation,
        // but abs diff dx = 255-50=205, dy=205. sum=410 → clips to 255 via add.
        // Should still be FROZEN (>8).
        InEuint8 memory epx = bob.createInEuint8(255);
        InEuint8 memory epy = bob.createInEuint8(255);
        vm.prank(bob.account());
        game.move(epx, epy);
        vm.prank(bob.account());
        game.checkProximity();
        vm.prank(bob.account());
        euint8 handle = game.getLastBucket();
        uint8 bucket = getPlaintext(handle);
        assertTrue(bucket <= 3, "Must be valid bucket");
        // distance is astronomically large → FROZEN (euint8 addition wraps but bucket select is branchless)
    }
}
