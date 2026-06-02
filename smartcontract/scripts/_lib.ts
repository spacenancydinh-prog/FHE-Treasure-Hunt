import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  keccak256,
  encodeAbiParameters,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Address,
} from 'viem'
import { sepolia as viemSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/node'
import { sepolia as cofheSepolia } from '@cofhe/sdk/chains'
import { Encryptable, FheTypes } from '@cofhe/sdk'
import { TREASURE_HUNT_ABI } from './abi.js'

// ─── Contract ────────────────────────────────────────────────────────────────

export const CONTRACT = (process.env.CONTRACT_ADDRESS ?? '0x0dF2F4E15FcF7B627B0C331C252F7113558a0E5E') as Address
export const CHAIN_ID = 11155111 // Ethereum Sepolia
export const ENTRY_FEE = parseEther('0.01')

// ─── Clients ─────────────────────────────────────────────────────────────────

export function createClients() {
  const pk1 = process.env.PRIVATE_KEY
  const pk2 = process.env.PRIVATE_KEY_2
  if (!pk1) throw new Error('PRIVATE_KEY not set in .env')
  if (!pk2) throw new Error('PRIVATE_KEY_2 not set in .env')
  if (!process.env.ETHEREUM_SEPOLIA_RPC) throw new Error('ETHEREUM_SEPOLIA_RPC not set in .env')

  const normPk = (k: string): Hex => (k.startsWith('0x') ? k : `0x${k}`) as Hex
  const ownerAccount  = privateKeyToAccount(normPk(pk1))
  const player2Account = privateKeyToAccount(normPk(pk2))

  const transport = http(process.env.ETHEREUM_SEPOLIA_RPC)

  const publicClient = createPublicClient({ chain: viemSepolia, transport })
  const ownerWallet  = createWalletClient({ account: ownerAccount,   chain: viemSepolia, transport })
  const player2Wallet = createWalletClient({ account: player2Account, chain: viemSepolia, transport })

  return { publicClient, ownerWallet, player2Wallet, ownerAccount, player2Account }
}

// ─── FHE client ──────────────────────────────────────────────────────────────

export async function initFHE(
  publicClient: PublicClient,
  walletClient: WalletClient,
) {
  const config = createCofheConfig({ supportedChains: [cofheSepolia] })
  const client = createCofheClient(config)
  await client.connect(publicClient as any, walletClient as any)
  // Ensure a self-permit exists for this account (needed for decryptForView / decryptForTx)
  await client.permits.getOrCreateSelfPermit()
  return client
}

// ─── Encrypt helpers ─────────────────────────────────────────────────────────

export async function encryptCoords(fhe: any, x: number, y: number) {
  const [encX, encY] = await fhe
    .encryptInputs([Encryptable.uint8(BigInt(x)), Encryptable.uint8(BigInt(y))])
    .execute()
  return { encX, encY }
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function readGameState(publicClient: PublicClient) {
  const [state, pot, playerCount, treasureSet, winner, owner, pendingClaimer] =
    await Promise.all([
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getGameState' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getPot' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'getPlayerCount' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'treasureSet' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'winner' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'owner' }),
      publicClient.readContract({ address: CONTRACT, abi: TREASURE_HUNT_ABI, functionName: 'pendingClaimer' }),
    ])
  return { state, pot, playerCount, treasureSet, winner, owner, pendingClaimer }
}

// ─── Storage slot: pendingClaimResult[addr] at slot 13 ───────────────────────
// mapping(address => ebool) pendingClaimResult is at storage slot 13
// slot for key = keccak256(abi.encode(key, uint256(13)))

export function pendingClaimSlot(addr: Address): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [addr, 13n],
  ))
}

// ─── Decrypt bucket (euint8 handle → uint8 bucket) ──────────────────────────

export async function decryptBucket(fhe: any, ctHashBytes32: Hex): Promise<bigint> {
  const ctHash = BigInt(ctHashBytes32)
  return await fhe
    .decryptForView(ctHash, FheTypes.Uint8)
    .withPermit()
    .execute() as bigint
}

// ─── Decrypt for tx (ebool handle → { result, signature }) ──────────────────

export async function decryptForTx(fhe: any, ctHashBytes32: Hex) {
  const ctHash = BigInt(ctHashBytes32)
  const res = await fhe.decryptForTx(ctHash).withPermit().execute()
  return {
    result: res.decryptedValue !== 0n,   // ebool: 0=false, 1=true
    signature: res.signature as Hex,
  }
}

// ─── Logging helpers ─────────────────────────────────────────────────────────

const STATE_LABELS = ['WAITING', 'ACTIVE', 'ENDED']
const BUCKET_LABELS = ['FROZEN', 'COLD', 'WARM', 'HOT']

export function stateLabel(n: number) { return STATE_LABELS[n] ?? `UNKNOWN(${n})` }
export function bucketLabel(n: bigint | number) { return BUCKET_LABELS[Number(n)] ?? `??(${n})` }

export function ok(msg: string)   { console.log(`  ✓ ${msg}`) }
export function fail(msg: string) { console.error(`  ✗ ${msg}`); process.exit(1) }
export function info(msg: string) { console.log(`  → ${msg}`) }
export function section(title: string) { console.log(`\n── ${title} ──`) }

export function assert(cond: boolean, msg: string) {
  if (!cond) fail(msg)
}

export { TREASURE_HUNT_ABI, Encryptable, FheTypes, formatEther }
export type { PublicClient, WalletClient, Address, Hex }
