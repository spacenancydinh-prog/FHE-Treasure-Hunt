/**
 * 01-verify.ts — Verify contract deployment on Sepolia
 *
 * Checks contract is deployed, reads current state, confirms owner matches PRIVATE_KEY.
 * Run FIRST before any other test script.
 *
 * Usage: npx tsx scripts/01-verify.ts
 */
import {
  createClients, readGameState, CONTRACT, CHAIN_ID,
  stateLabel, formatEther, ok, fail, info, section, assert,
} from './_lib.js'

async function main() {
  section('01 — Verify Deployment')

  const { publicClient, ownerAccount } = createClients()

  // ── Contract has code ─────────────────────────────────────────────────────
  const code = await publicClient.getCode({ address: CONTRACT })
  assert(!!code && code !== '0x', `No contract code at ${CONTRACT}`)
  ok(`Contract deployed at ${CONTRACT}`)

  // ── Network ───────────────────────────────────────────────────────────────
  const chainId = await publicClient.getChainId()
  assert(chainId === CHAIN_ID, `Wrong network: got chainId ${chainId}, expected ${CHAIN_ID} (Sepolia)`)
  ok(`Network: Ethereum Sepolia (chainId ${chainId})`)

  // ── Read contract state ───────────────────────────────────────────────────
  const s = await readGameState(publicClient)
  const stateNum = Number(s.state)

  info(`GameState:    ${stateLabel(stateNum)} (${stateNum})`)
  info(`TreasureSet:  ${s.treasureSet}`)
  info(`PlayerCount:  ${s.playerCount}`)
  info(`Pot:          ${formatEther(s.pot as bigint)} ETH`)
  info(`Winner:       ${s.winner}`)
  info(`Owner:        ${s.owner}`)
  info(`PendingClaim: ${s.pendingClaimer}`)

  // ── Owner matches PRIVATE_KEY ─────────────────────────────────────────────
  const ownerAddr = ownerAccount.address.toLowerCase()
  const contractOwner = (s.owner as string).toLowerCase()
  assert(ownerAddr === contractOwner,
    `Owner mismatch: PRIVATE_KEY address is ${ownerAddr}, contract owner is ${contractOwner}`)
  ok(`Owner matches PRIVATE_KEY wallet`)

  // ── Wallet balances ───────────────────────────────────────────────────────
  const balance = await publicClient.getBalance({ address: ownerAccount.address })
  info(`Owner balance: ${formatEther(balance)} ETH`)
  if (balance < 20000000000000000n) { // < 0.02 ETH
    console.warn('  ⚠ Low balance — need at least 0.02 ETH + gas to run full flow')
  }

  ok('Verification passed — contract ready')
}

main().catch(e => { console.error(e); process.exit(1) })
