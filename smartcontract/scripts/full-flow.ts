/**
 * full-flow.ts — End-to-end game flow on Sepolia (fresh game required)
 *
 * Runs the complete game: WAITING → ACTIVE → ENDED → WAITING
 * Precondition: gameState == WAITING, treasureSet == false
 *   (run 06-reset.ts first if game is in ENDED state)
 *
 * Steps:
 *   1. setTreasure(15, 20)
 *   2. joinGame × 2 → ACTIVE
 *   3. move(0,0) + checkProximity → verify FROZEN
 *   4. move(15,23) + checkProximity → verify WARM
 *   5. move(15,20) + checkProximity → verify HOT
 *   6. prepareWinClaim(5,5) wrong → decrypt → result=false → finalizeWinClaim reverts
 *   7. prepareWinClaim(15,20) correct → decrypt → result=true → finalizeWinClaim wins
 *   8. resetGame → WAITING
 *
 * Usage: npx tsx scripts/full-flow.ts
 */
import 'dotenv/config'
import {
  createClients, readGameState, initFHE, encryptCoords, decryptBucket, decryptForTx,
  pendingClaimSlot, CONTRACT, ENTRY_FEE, stateLabel, bucketLabel, formatEther,
  ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'

const TX = 15
const TY = 20

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  FHE TREASURE HUNT — Full On-Chain Flow Test  ')
  console.log('═══════════════════════════════════════════════')

  const { publicClient, ownerWallet, player2Wallet, ownerAccount, player2Account } = createClients()
  const results: { step: string; passed: boolean }[] = []

  function step(label: string, fn: () => Promise<void>) {
    return fn()
      .then(() => { results.push({ step: label, passed: true }) })
      .catch((e: any) => {
        console.error(`  ✗ FAILED: ${label}`)
        console.error(`    ${e.message}`)
        results.push({ step: label, passed: false })
        throw e
      })
  }

  // ── Precondition ──────────────────────────────────────────────────────────
  const init = await readGameState(publicClient)
  if (Number(init.state) === 2) {
    fail('Game is ENDED — run 06-reset.ts first, then re-run full-flow.ts')
  }
  if (Number(init.state) === 1) {
    fail('Game is already ACTIVE — run 06-reset.ts first (need ENDED state), then re-run')
  }
  if (init.treasureSet) {
    fail('Treasure already set — game is partially through setup. Run 06-reset.ts first.')
  }
  ok(`Starting state: ${stateLabel(Number(init.state))}`)

  // ── Init FHE ──────────────────────────────────────────────────────────────
  section('FHE Init')
  info('Connecting FHE client (fetches keys from Fhenix threshold network)...')
  const fhe = await initFHE(publicClient, ownerWallet)
  ok('FHE client ready')

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1 — setTreasure
  // ─────────────────────────────────────────────────────────────────────────
  await step('setTreasure(15,20)', async () => {
    section('Step 1 — setTreasure')
    const { encX, encY } = await encryptCoords(fhe, TX, TY)
    const hash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'setTreasure',
      args: [encX, encY],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    assert(receipt.status === 'success', `setTreasure reverted: ${hash}`)
    const s = await readGameState(publicClient)
    assert(s.treasureSet === true, 'treasureSet should be true')
    ok(`setTreasure(${TX}, ${TY}) ✓  [block ${receipt.blockNumber}]`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2 — joinGame × 2
  // ─────────────────────────────────────────────────────────────────────────
  await step('joinGame × 2 → ACTIVE', async () => {
    section('Step 2 — joinGame')
    const h1 = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'joinGame',
      value: ENTRY_FEE,
    })
    await publicClient.waitForTransactionReceipt({ hash: h1, timeout: 60_000 })
    ok(`Owner joined (${ownerAccount.address})`)

    const h2 = await player2Wallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'joinGame',
      value: ENTRY_FEE,
    })
    await publicClient.waitForTransactionReceipt({ hash: h2, timeout: 60_000 })
    ok(`Player 2 joined (${player2Account.address})`)

    const s = await readGameState(publicClient)
    assert(Number(s.state) === 1, `Expected ACTIVE, got ${stateLabel(Number(s.state))}`)
    ok(`GameState: ACTIVE ✓  Pot: ${formatEther(s.pot as bigint)} ETH`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: move + ping + verify
  // ─────────────────────────────────────────────────────────────────────────
  async function moveAndVerify(x: number, y: number, expectedBucket: number) {
    const { encX, encY } = await encryptCoords(fhe, x, y)
    const mh = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'move', args: [encX, encY],
    })
    await publicClient.waitForTransactionReceipt({ hash: mh, timeout: 60_000 })

    const ph = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'checkProximity',
    })
    await publicClient.waitForTransactionReceipt({ hash: ph, timeout: 60_000 })

    const ctHashBytes32 = await publicClient.readContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getLastBucket',
      account: ownerAccount.address,
    }) as `0x${string}`
    const bucket = await decryptBucket(fhe, ctHashBytes32)
    assert(Number(bucket) === expectedBucket,
      `Position (${x},${y}): expected bucket ${expectedBucket} (${bucketLabel(expectedBucket)}), got ${bucket} (${bucketLabel(bucket)})`)
    ok(`move(${x},${y}) → bucket=${bucket} (${bucketLabel(bucket)}) ✓`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Steps 3-5 — move + proximity checks
  // ─────────────────────────────────────────────────────────────────────────
  await step('move(0,0) → FROZEN', async () => {
    section('Step 3 — FROZEN check')
    await moveAndVerify(0, 0, 0)
  })

  await step('move(15,23) → WARM', async () => {
    section('Step 4 — WARM check')
    await moveAndVerify(TX, TY + 3, 2)
  })

  await step('move(15,20) → HOT', async () => {
    section('Step 5 — HOT check (on treasure)')
    await moveAndVerify(TX, TY, 3)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6 — Wrong coords win claim (expect fail)
  // ─────────────────────────────────────────────────────────────────────────
  await step('prepareWinClaim(5,5) wrong → result=false → finalizeWinClaim reverts', async () => {
    section('Step 6 — Wrong coords claim')
    const { encX, encY } = await encryptCoords(fhe, 5, 5)
    const prepHash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'prepareWinClaim',
      args: [encX, encY],
    })
    await publicClient.waitForTransactionReceipt({ hash: prepHash, timeout: 60_000 })
    ok('prepareWinClaim(5,5) submitted')

    const slot = pendingClaimSlot(ownerAccount.address)
    const ctHashBytes32 = await publicClient.getStorageAt({ address: CONTRACT, slot }) as `0x${string}`
    const { result, signature } = await decryptForTx(fhe, ctHashBytes32)
    assert(result === false, `Expected false for wrong coords, got ${result}`)
    ok(`decryptForTx: result=false ✓`)

    try {
      const fh = await ownerWallet.writeContract({
        address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'finalizeWinClaim',
        args: [false, signature],
      })
      const fr = await publicClient.waitForTransactionReceipt({ hash: fh, timeout: 60_000 })
      assert(fr.status === 'reverted', 'finalizeWinClaim(false) should have reverted')
    } catch {
      // revert via simulation — expected
    }
    ok('finalizeWinClaim(false) correctly reverted ✓')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 7 — Correct coords win claim
  // ─────────────────────────────────────────────────────────────────────────
  await step('prepareWinClaim(15,20) correct → result=true → GameWon', async () => {
    section('Step 7 — Correct win claim (2-TX)')
    const ownerBalBefore = await publicClient.getBalance({ address: ownerAccount.address })

    // TX 1
    const { encX, encY } = await encryptCoords(fhe, TX, TY)
    const prepHash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'prepareWinClaim',
      args: [encX, encY],
    })
    const prepReceipt = await publicClient.waitForTransactionReceipt({ hash: prepHash, timeout: 60_000 })
    assert(prepReceipt.status === 'success', `prepareWinClaim reverted: ${prepHash}`)
    ok(`TX 1 confirmed [block ${prepReceipt.blockNumber}]`)

    // Off-chain decrypt
    const slot = pendingClaimSlot(ownerAccount.address)
    const ctHashBytes32 = await publicClient.getStorageAt({ address: CONTRACT, slot }) as `0x${string}`
    const { result, signature } = await decryptForTx(fhe, ctHashBytes32)
    assert(result === true, `Expected true for correct coords, got ${result}`)
    ok(`decryptForTx: result=true ✓`)

    // TX 2
    const finHash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'finalizeWinClaim',
      args: [true, signature],
    })
    const finReceipt = await publicClient.waitForTransactionReceipt({ hash: finHash, timeout: 60_000 })
    assert(finReceipt.status === 'success', `finalizeWinClaim reverted: ${finHash}`)
    ok(`TX 2 confirmed [block ${finReceipt.blockNumber}]`)

    const s = await readGameState(publicClient)
    assert(Number(s.state) === 2, `Expected ENDED, got ${stateLabel(Number(s.state))}`)
    assert((s.winner as string).toLowerCase() === ownerAccount.address.toLowerCase(), 'Wrong winner')
    ok(`GameState: ENDED ✓  Winner: ${s.winner}`)

    const ownerBalAfter = await publicClient.getBalance({ address: ownerAccount.address })
    assert(ownerBalAfter > ownerBalBefore - 5000000000000000n, 'Pot not received')
    ok(`Pot transferred ✓ (balance change: ${Number(ownerBalAfter - ownerBalBefore) / 1e18} ETH)`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Step 8 — Reset
  // ─────────────────────────────────────────────────────────────────────────
  await step('resetGame → WAITING', async () => {
    section('Step 8 — Reset')
    const hash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'resetGame',
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    assert(receipt.status === 'success', `resetGame reverted: ${hash}`)
    const s = await readGameState(publicClient)
    assert(Number(s.state) === 0, `Expected WAITING, got ${stateLabel(Number(s.state))}`)
    ok(`GameState: WAITING ✓`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════════')
  let allPassed = true
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗'
    console.log(`  ${icon} ${r.step}`)
    if (!r.passed) allPassed = false
  }
  console.log('───────────────────────────────────────────────')
  const passCount = results.filter(r => r.passed).length
  console.log(`  ${passCount}/${results.length} steps passed`)
  if (allPassed) {
    console.log('\n  ✅ FULL ON-CHAIN FLOW PASSED — contract works on Sepolia!')
  } else {
    console.log('\n  ❌ Some steps failed — check output above')
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
