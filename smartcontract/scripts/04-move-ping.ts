/**
 * 04-move-ping.ts — Move to various positions and verify proximity buckets
 *
 * Tests: move(InEuint8 x, InEuint8 y) + checkProximity() + getLastBucket() + decryptForView
 * Precondition: gameState == ACTIVE, owner has joined
 *
 * Treasure is at (15, 20) as set by 02-set-treasure.ts
 * Bucket thresholds: HOT ≤ 2, WARM 3–5, COLD 6–8, FROZEN > 8
 *
 * Usage: npx tsx scripts/04-move-ping.ts
 */
import {
  createClients, initFHE, encryptCoords, decryptBucket, CONTRACT,
  stateLabel, bucketLabel, ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'
import { TREASURE_X, TREASURE_Y } from './02-set-treasure.js'

const TEST_POSITIONS = [
  { x: TREASURE_X,      y: TREASURE_Y,      expectedBucket: 3, label: 'HOT  (dist=0, ON treasure)' },
  { x: TREASURE_X + 1,  y: TREASURE_Y + 1,  expectedBucket: 3, label: 'HOT  (dist=2)' },
  { x: TREASURE_X + 3,  y: TREASURE_Y,      expectedBucket: 2, label: 'WARM (dist=3)' },
  { x: TREASURE_X + 5,  y: TREASURE_Y,      expectedBucket: 2, label: 'WARM (dist=5)' },
  { x: TREASURE_X + 6,  y: TREASURE_Y,      expectedBucket: 1, label: 'COLD (dist=6)' },
  { x: TREASURE_X + 8,  y: TREASURE_Y,      expectedBucket: 1, label: 'COLD (dist=8)' },
  { x: 0,               y: 0,               expectedBucket: 0, label: 'FROZEN (dist=35)' },
]

async function main() {
  section('04 — Move + Proximity Ping')

  const { publicClient, ownerWallet, ownerAccount } = createClients()

  // ── Precondition ──────────────────────────────────────────────────────────
  const state = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getGameState',
  })
  assert(Number(state) === 1, `Expected ACTIVE, got ${stateLabel(Number(state))}`)
  ok('GameState: ACTIVE')

  // ── Init FHE ──────────────────────────────────────────────────────────────
  info('Initialising FHE client...')
  const fhe = await initFHE(publicClient, ownerWallet)
  ok('FHE client connected')

  // ── Test each position ────────────────────────────────────────────────────
  let passed = 0
  for (const pos of TEST_POSITIONS) {
    info(`\n  Testing (${pos.x}, ${pos.y}) — expected ${pos.label}`)

    // move()
    const { encX, encY } = await encryptCoords(fhe, pos.x, pos.y)
    const moveHash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'move',
      args: [encX, encY],
    })
    const moveReceipt = await publicClient.waitForTransactionReceipt({ hash: moveHash, timeout: 60_000 })
    assert(moveReceipt.status === 'success', `move() reverted: ${moveHash}`)

    // checkProximity()
    const pingHash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'checkProximity',
    })
    const pingReceipt = await publicClient.waitForTransactionReceipt({ hash: pingHash, timeout: 60_000 })
    assert(pingReceipt.status === 'success', `checkProximity() reverted: ${pingHash}`)

    // getLastBucket() → decrypt off-chain
    const ctHashBytes32 = await publicClient.readContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getLastBucket',
      account: ownerAccount.address,
    }) as `0x${string}`

    const bucket = await decryptBucket(fhe, ctHashBytes32)
    const label = bucketLabel(bucket)

    if (Number(bucket) === pos.expectedBucket) {
      ok(`(${pos.x}, ${pos.y}) → bucket=${bucket} (${label}) ✓`)
      passed++
    } else {
      console.error(`  ✗ (${pos.x}, ${pos.y}) → expected ${pos.expectedBucket}, got ${bucket} (${label})`)
    }
  }

  console.log(`\n  Result: ${passed}/${TEST_POSITIONS.length} positions matched expected bucket`)
  assert(passed === TEST_POSITIONS.length, `${TEST_POSITIONS.length - passed} positions did not match`)
  ok('All proximity checks passed')

  // ── Verify revert: checkProximity before move (new player) ───────────────
  // (skip — player2 has not moved, this test is in full-flow.ts)
}

main().catch(e => { console.error(e); process.exit(1) })
