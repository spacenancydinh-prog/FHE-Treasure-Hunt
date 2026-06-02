/**
 * 03-join-game.ts — Two wallets join, game transitions to ACTIVE
 *
 * Tests: joinGame() payable
 * Precondition: gameState == WAITING, treasureSet == true
 *
 * Usage: npx tsx scripts/03-join-game.ts
 */
import {
  createClients, readGameState, CONTRACT, ENTRY_FEE,
  stateLabel, formatEther, ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'

async function main() {
  section('03 — Join Game (2 players)')

  const { publicClient, ownerWallet, player2Wallet, ownerAccount, player2Account } = createClients()

  // ── Precondition ──────────────────────────────────────────────────────────
  const before = await readGameState(publicClient)
  assert(Number(before.state) === 0, `Expected WAITING, got ${stateLabel(Number(before.state))}`)
  assert(before.treasureSet === true, 'Treasure not set — run 02-set-treasure.ts first')
  ok(`State: WAITING, treasure set`)

  // ── Player 1 (owner) joins ────────────────────────────────────────────────
  const p1Joined = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'hasJoined',
    args: [ownerAccount.address],
  })
  if (p1Joined) {
    ok(`Owner already joined (${ownerAccount.address})`)
  } else {
    info(`Owner joining (${ownerAccount.address})...`)
    const hash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'joinGame',
      value: ENTRY_FEE,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    assert(receipt.status === 'success', `joinGame (owner) reverted: ${hash}`)
    ok(`Owner joined — block ${receipt.blockNumber}, gas ${receipt.gasUsed}`)
  }

  const mid = await readGameState(publicClient)
  info(`PlayerCount after owner join: ${mid.playerCount}`)

  // ── Player 2 joins ────────────────────────────────────────────────────────
  const p2Joined = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'hasJoined',
    args: [player2Account.address],
  })
  if (p2Joined) {
    ok(`Player 2 already joined (${player2Account.address})`)
  } else {
    info(`Player 2 joining (${player2Account.address})...`)
    const hash = await player2Wallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'joinGame',
      value: ENTRY_FEE,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    assert(receipt.status === 'success', `joinGame (player2) reverted: ${hash}`)
    ok(`Player 2 joined — block ${receipt.blockNumber}, gas ${receipt.gasUsed}`)
  }

  // ── Verify final state ────────────────────────────────────────────────────
  const after = await readGameState(publicClient)
  const stateNum = Number(after.state)
  assert(stateNum === 1, `Expected ACTIVE, got ${stateLabel(stateNum)}`)
  assert(after.playerCount >= 2n, `playerCount ${after.playerCount} < 2`)
  assert(after.pot >= ENTRY_FEE * 2n, `pot ${formatEther(after.pot as bigint)} ETH < 0.02 ETH`)

  ok(`GameState: ACTIVE`)
  ok(`PlayerCount: ${after.playerCount}`)
  ok(`Pot: ${formatEther(after.pot as bigint)} ETH`)

  // ── Verify join revert for duplicate ─────────────────────────────────────
  info('Verifying duplicate join reverts...')
  try {
    await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'joinGame',
      value: ENTRY_FEE,
    })
    fail('Duplicate joinGame should have reverted')
  } catch (e: any) {
    ok(`Duplicate join correctly reverted: ${e.message?.slice(0, 60)}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
