/**
 * 06-reset.ts — Owner resets game after ENDED, verifies all state cleared
 *
 * Tests: resetGame()
 * Precondition: gameState == ENDED
 *
 * Usage: npx tsx scripts/06-reset.ts
 */
import {
  createClients, readGameState, CONTRACT, stateLabel, formatEther,
  ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'

async function main() {
  section('06 — Reset Game')

  const { publicClient, ownerWallet, ownerAccount, player2Account } = createClients()

  // ── Precondition ──────────────────────────────────────────────────────────
  const before = await readGameState(publicClient)
  assert(Number(before.state) === 2, `Expected ENDED, got ${stateLabel(Number(before.state))}. Run 05-claim-win.ts first.`)
  ok(`State: ENDED (${before.winner} won)`)

  // ── Non-owner reset should revert ─────────────────────────────────────────
  info('Verifying non-owner reset reverts...')
  const { player2Wallet } = createClients()
  try {
    const hash = await player2Wallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'resetGame',
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    if (receipt.status === 'reverted') {
      ok('Non-owner resetGame correctly reverted')
    } else {
      fail('Non-owner resetGame should have reverted but succeeded!')
    }
  } catch (e: any) {
    ok(`Non-owner resetGame correctly reverted: ${e.message?.slice(0, 60)}`)
  }

  // ── Owner resets ──────────────────────────────────────────────────────────
  info('Owner calling resetGame()...')
  const hash = await ownerWallet.writeContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'resetGame',
  })
  info(`TX: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  assert(receipt.status === 'success', `resetGame reverted: ${hash}`)
  ok(`Confirmed in block ${receipt.blockNumber} — gas ${receipt.gasUsed}`)

  // Verify GameReset event emitted
  const resetEvent = receipt.logs.find(log =>
    log.address.toLowerCase() === CONTRACT.toLowerCase())
  assert(!!resetEvent, 'GameReset event not found')
  ok('GameReset event emitted')

  // ── Verify all state cleared ───────────────────────────────────────────────
  const after = await readGameState(publicClient)

  assert(Number(after.state) === 0,  `gameState should be WAITING, got ${stateLabel(Number(after.state))}`)
  ok('gameState: WAITING')
  assert(after.playerCount === 0n,    `playerCount should be 0, got ${after.playerCount}`)
  ok('playerCount: 0')
  assert(after.treasureSet === false,  'treasureSet should be false')
  ok('treasureSet: false')
  assert(after.winner === '0x0000000000000000000000000000000000000000', `winner should be zero, got ${after.winner}`)
  ok('winner: cleared')
  assert(after.pendingClaimer === '0x0000000000000000000000000000000000000000', 'pendingClaimer should be zero')
  ok('pendingClaimer: cleared')
  assert(after.pot === 0n, `pot should be 0, got ${formatEther(after.pot as bigint)} ETH`)
  ok('pot: 0')

  const ownerJoined = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'hasJoined',
    args: [ownerAccount.address],
  })
  const p2Joined = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'hasJoined',
    args: [player2Account.address],
  })
  assert(ownerJoined === false, 'hasJoined(owner) should be false after reset')
  assert(p2Joined === false, 'hasJoined(player2) should be false after reset')
  ok('hasJoined: cleared for both players')

  const ownerMoves = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getMoveCount',
    args: [ownerAccount.address],
  })
  assert(ownerMoves === 0n, `getMoveCount(owner) should be 0, got ${ownerMoves}`)
  ok('moveCount: cleared')

  ok('\nAll state cleared — ready for new round')
}

main().catch(e => { console.error(e); process.exit(1) })
