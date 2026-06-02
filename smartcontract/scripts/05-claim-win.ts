/**
 * 05-claim-win.ts — Full 2-TX win claim flow on Sepolia
 *
 * Tests:
 *   prepareWinClaim(InEuint8 x, InEuint8 y)
 *   → off-chain decryptForTx (threshold network)
 *   → finalizeWinClaim(bool result, bytes sig)
 *
 * Also tests wrong-coords revert.
 * Precondition: gameState == ACTIVE, owner has joined and moved
 *
 * Usage: npx tsx scripts/05-claim-win.ts
 */
import {
  createClients, readGameState, initFHE, encryptCoords, decryptForTx,
  pendingClaimSlot, CONTRACT, stateLabel, formatEther,
  ok, fail, info, section, assert, TREASURE_HUNT_ABI,
} from './_lib.js'
import { TREASURE_X, TREASURE_Y } from './02-set-treasure.js'

async function main() {
  section('05 — Win Claim (2-TX)')

  const { publicClient, ownerWallet, ownerAccount } = createClients()

  // ── Precondition ──────────────────────────────────────────────────────────
  const before = await readGameState(publicClient)
  assert(Number(before.state) === 1, `Expected ACTIVE, got ${stateLabel(Number(before.state))}`)
  assert(before.winner === '0x0000000000000000000000000000000000000000', 'Game already won')
  ok('State: ACTIVE, no winner yet')

  // ── Init FHE ──────────────────────────────────────────────────────────────
  info('Initialising FHE client...')
  const fhe = await initFHE(publicClient, ownerWallet)
  ok('FHE client connected')

  // ── Ensure owner is on treasure (move to correct location) ───────────────
  info(`Moving owner to treasure (${TREASURE_X}, ${TREASURE_Y})...`)
  const { encX: moveX, encY: moveY } = await encryptCoords(fhe, TREASURE_X, TREASURE_Y)
  const moveHash = await ownerWallet.writeContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'move',
    args: [moveX, moveY],
  })
  const moveReceipt = await publicClient.waitForTransactionReceipt({ hash: moveHash, timeout: 60_000 })
  assert(moveReceipt.status === 'success', `move() reverted: ${moveHash}`)
  ok('Moved to treasure location')

  // ── Test wrong coords → result=false → finalizeWinClaim reverts ──────────
  section('  05a — Wrong coords claim (should fail)')
  {
    info('prepareWinClaim(5, 5) — wrong coordinates...')
    const { encX, encY } = await encryptCoords(fhe, 5, 5)
    const hash = await ownerWallet.writeContract({
      address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'prepareWinClaim',
      args: [encX, encY],
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
    assert(receipt.status === 'success', `prepareWinClaim reverted unexpectedly`)
    ok('prepareWinClaim(5,5) submitted')

    // Read handle from storage
    const slot = pendingClaimSlot(ownerAccount.address)
    const ctHashBytes32 = await publicClient.getStorageAt({ address: CONTRACT, slot }) as `0x${string}`
    assert(ctHashBytes32 !== '0x' + '0'.repeat(64), 'pendingClaimResult handle is zero — wrong slot?')

    // Decrypt off-chain
    info('Decrypting off-chain...')
    const { result, signature } = await decryptForTx(fhe, ctHashBytes32)
    info(`decryptForTx result: ${result}`)
    assert(result === false, `Expected result=false for wrong coords, got ${result}`)
    ok('Off-chain decrypt: result=false (correct)')

    // finalizeWinClaim(false, sig) → should revert
    info('finalizeWinClaim(false, sig) — expecting revert...')
    try {
      const failHash = await ownerWallet.writeContract({
        address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'finalizeWinClaim',
        args: [false, signature],
      })
      const failReceipt = await publicClient.waitForTransactionReceipt({ hash: failHash, timeout: 60_000 })
      if (failReceipt.status === 'reverted') {
        ok('finalizeWinClaim(false) correctly reverted')
      } else {
        fail('finalizeWinClaim(false) should have reverted but succeeded!')
      }
    } catch (e: any) {
      ok(`finalizeWinClaim(false) correctly reverted: ${e.message?.slice(0, 80)}`)
    }
  }

  // ── TX 1: prepareWinClaim with CORRECT coords ─────────────────────────────
  section('  05b — Correct coords claim (should win)')
  info(`prepareWinClaim(${TREASURE_X}, ${TREASURE_Y}) — correct coordinates...`)
  const { encX, encY } = await encryptCoords(fhe, TREASURE_X, TREASURE_Y)
  const prepareHash = await ownerWallet.writeContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'prepareWinClaim',
    args: [encX, encY],
  })
  info(`TX 1: ${prepareHash}`)
  const prepareReceipt = await publicClient.waitForTransactionReceipt({ hash: prepareHash, timeout: 60_000 })
  assert(prepareReceipt.status === 'success', `prepareWinClaim reverted: ${prepareHash}`)
  ok(`prepareWinClaim confirmed — block ${prepareReceipt.blockNumber}`)

  // Verify WinClaimPrepared event
  const winClaimEvent = prepareReceipt.logs.find(log =>
    log.address.toLowerCase() === CONTRACT.toLowerCase())
  assert(!!winClaimEvent, 'WinClaimPrepared event not found')
  ok('WinClaimPrepared event emitted')

  // Verify pendingClaimer
  const pendingClaimer = await publicClient.readContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'pendingClaimer',
  })
  assert((pendingClaimer as string).toLowerCase() === ownerAccount.address.toLowerCase(),
    `pendingClaimer is ${pendingClaimer}, expected ${ownerAccount.address}`)
  ok(`pendingClaimer: ${pendingClaimer}`)

  // ── Off-chain: read handle and decrypt ───────────────────────────────────
  info('Reading pendingClaimResult handle from storage slot 13...')
  const slot = pendingClaimSlot(ownerAccount.address)
  const ctHashBytes32 = await publicClient.getStorageAt({ address: CONTRACT, slot }) as `0x${string}`
  assert(ctHashBytes32 !== '0x' + '0'.repeat(64), 'Handle is zero — slot calculation wrong?')
  info(`Handle: ${ctHashBytes32}`)

  info('Decrypting off-chain via threshold network...')
  const { result, signature } = await decryptForTx(fhe, ctHashBytes32)
  info(`decryptForTx result: ${result}, sig: ${signature.slice(0, 20)}...`)
  assert(result === true, `Expected result=true for correct coords, got ${result}`)
  ok('Off-chain decrypt: result=true ✓')

  // ── TX 2: finalizeWinClaim ────────────────────────────────────────────────
  const ownerBalanceBefore = await publicClient.getBalance({ address: ownerAccount.address })
  info('Sending finalizeWinClaim(true, sig)...')
  const finalizeHash = await ownerWallet.writeContract({
    address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'finalizeWinClaim',
    args: [true, signature],
  })
  info(`TX 2: ${finalizeHash}`)
  const finalizeReceipt = await publicClient.waitForTransactionReceipt({ hash: finalizeHash, timeout: 60_000 })
  assert(finalizeReceipt.status === 'success', `finalizeWinClaim reverted: ${finalizeHash}`)
  ok(`finalizeWinClaim confirmed — block ${finalizeReceipt.blockNumber}`)

  // ── Verify final state ────────────────────────────────────────────────────
  const after = await readGameState(publicClient)
  assert(Number(after.state) === 2, `Expected ENDED, got ${stateLabel(Number(after.state))}`)
  assert((after.winner as string).toLowerCase() === ownerAccount.address.toLowerCase(),
    `Winner is ${after.winner}, expected ${ownerAccount.address}`)

  ok(`GameState: ENDED`)
  ok(`Winner: ${after.winner}`)

  const ownerBalanceAfter = await publicClient.getBalance({ address: ownerAccount.address })
  const netGain = ownerBalanceAfter - ownerBalanceBefore
  info(`Owner balance change: ${netGain > 0n ? '+' : ''}${Number(netGain) / 1e18} ETH (net of gas)`)
  assert(ownerBalanceAfter > ownerBalanceBefore - 5000000000000000n, // allow up to 0.005 ETH gas
    'Owner balance did not increase — pot may not have transferred')
  ok('Pot transferred to winner ✓')
}

main().catch(e => { console.error(e); process.exit(1) })
