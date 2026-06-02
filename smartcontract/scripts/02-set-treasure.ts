/**
 * 02-set-treasure.ts — Owner sets encrypted treasure coordinates on Sepolia
 *
 * Tests: setTreasure(InEuint8 x, InEuint8 y)
 * Precondition: gameState == WAITING, treasureSet == false
 *
 * Usage: npx tsx scripts/02-set-treasure.ts
 * Treasure coords: X=15, Y=20 (fixed so later scripts can verify proximity correctly)
 */
import {
  createClients, readGameState, initFHE, encryptCoords, CONTRACT,
  stateLabel, ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'

export const TREASURE_X = 15
export const TREASURE_Y = 20

async function main() {
  section('02 — Set Treasure')

  const { publicClient, ownerWallet, ownerAccount } = createClients()

  // ── Precondition check ────────────────────────────────────────────────────
  const before = await readGameState(publicClient)
  const stateNum = Number(before.state)
  assert(stateNum === 0, `Expected WAITING state, got ${stateLabel(stateNum)}`)
  assert(!before.treasureSet, 'Treasure already set — run 06-reset.ts first')
  ok(`State: WAITING, treasure not set`)

  // ── Test: non-owner cannot set treasure ───────────────────────────────────
  // (skip if player2 == owner; just note it)
  info('Skipping non-owner revert test (requires separate tx from player2 wallet)')

  // ── Init FHE ──────────────────────────────────────────────────────────────
  info('Initialising FHE client (fetching keys from threshold network)...')
  const fhe = await initFHE(publicClient, ownerWallet)
  ok('FHE client connected')

  // ── Encrypt coordinates ───────────────────────────────────────────────────
  info(`Encrypting treasure coords (${TREASURE_X}, ${TREASURE_Y})...`)
  const { encX, encY } = await encryptCoords(fhe, TREASURE_X, TREASURE_Y)
  ok('Coordinates encrypted')

  // ── Send transaction ──────────────────────────────────────────────────────
  info('Sending setTreasure() tx...')
  const hash = await ownerWallet.writeContract({
    address: CONTRACT,
    abi: TREASURE_HUNT_ABI,
    functionName: 'setTreasure',
    args: [encX, encY],
  })
  info(`TX: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
  assert(receipt.status === 'success', `TX reverted: ${hash}`)
  ok(`Confirmed in block ${receipt.blockNumber} — gas used: ${receipt.gasUsed}`)

  // ── Verify GameCreated event ──────────────────────────────────────────────
  const gameCreatedLog = receipt.logs.find(log =>
    log.address.toLowerCase() === CONTRACT.toLowerCase() && log.topics.length > 1)
  assert(!!gameCreatedLog, 'GameCreated event not found in receipt')
  ok('GameCreated event emitted')

  // ── Verify on-chain state ─────────────────────────────────────────────────
  const after = await readGameState(publicClient)
  assert(after.treasureSet === true, 'treasureSet still false after tx')
  ok(`treasureSet: true`)
  info(`GameState: ${stateLabel(Number(after.state))} (unchanged until 2 players join)`)
}

// Only run when executed directly, not when imported
const isMain = process.argv[1]?.endsWith('02-set-treasure.ts') || process.argv[1]?.endsWith('02-set-treasure.js')
if (isMain) main().catch(e => { console.error(e); process.exit(1) })
