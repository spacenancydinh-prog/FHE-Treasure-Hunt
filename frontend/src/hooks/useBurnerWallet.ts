import { useState, useCallback, useRef, useEffect } from 'react'
import { usePublicClient, useReadContract, useWriteContract, useSendTransaction, useSignMessage } from 'wagmi'
import { createWalletClient, http, keccak256, toBytes, parseGwei, type WalletClient } from 'viem'
import { sepolia } from 'wagmi/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { Encryptable } from '@cofhe/sdk'
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web'
import { sepolia as cofheSepolia } from '@cofhe/sdk/chains'
import { CONTRACT_ADDRESS, ZERO_ADDRESS } from '../lib/contract'
import { TREASURE_HUNT_ABI } from '../lib/abi'

type FheClient = Awaited<ReturnType<typeof createCofheClient>>

// Fixed message — same wallet always derives same burner key
function buildSignMessage(address: string) {
  return `FHE Treasure Hunt — Authorize Session Key\n\nThis signature creates a temporary move wallet. No transaction is sent and no ETH is spent.\n\nWallet: ${address}\nContract: ${CONTRACT_ADDRESS}`
}

export function useBurnerWallet(playerAddress: `0x${string}` | undefined) {
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { sendTransactionAsync } = useSendTransaction()
  const { signMessageAsync } = useSignMessage()

  // null until user signs to derive — deterministic from wallet signature
  const [burnerKey, setBurnerKey] = useState<`0x${string}` | null>(null)
  const isDerived = burnerKey !== null

  const burnerAccount = burnerKey ? privateKeyToAccount(burnerKey) : null
  const burnerAddress = (burnerAccount?.address ?? ZERO_ADDRESS) as `0x${string}`

  const burnerClientRef = useRef<WalletClient | null>(null)
  const fheRef = useRef<FheClient | null>(null)
  const [fheReady, setFheReady] = useState(false)

  // Rebuild viem WalletClient whenever burner key is set
  useEffect(() => {
    if (!burnerAccount) return
    burnerClientRef.current = createWalletClient({
      account: burnerAccount,
      chain: sepolia,
      transport: http(import.meta.env.VITE_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'),
    })
    fheRef.current = null
    setFheReady(false)
  }, [burnerKey])

  // Derive burner key by signing a fixed message — no storage, fully deterministic
  const deriveSessionKey = useCallback(async () => {
    if (!playerAddress) throw new Error('Wallet not connected')
    const sig = await signMessageAsync({ message: buildSignMessage(playerAddress) })
    const key = keccak256(toBytes(sig)) as `0x${string}`
    setBurnerKey(key)
    return key
  }, [signMessageAsync, playerAddress])

  // Check if this burner is already registered on-chain for this player
  const { data: mappedPlayer, refetch: refetchAuth } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: TREASURE_HUNT_ABI,
    functionName: 'burnerToPlayer',
    args: [burnerAddress],
    query: { enabled: !!playerAddress && isDerived },
  })

  const isAuthorized =
    isDerived &&
    !!playerAddress &&
    !!mappedPlayer &&
    (mappedPlayer as string).toLowerCase() === playerAddress.toLowerCase()

  // Initialize FHE client for the burner wallet
  const initBurnerFHE = useCallback(async () => {
    if (fheRef.current && fheReady) return fheRef.current
    if (!publicClient || !burnerClientRef.current) throw new Error('Burner not ready')
    const config = createCofheConfig({ supportedChains: [cofheSepolia] })
    const client = createCofheClient(config)
    await client.connect(publicClient as any, burnerClientRef.current as any)
    await client.permits.getOrCreateSelfPermit()
    fheRef.current = client
    setFheReady(true)
    return client
  }, [publicClient, fheReady])

  // Encrypt coordinates using burner's FHE client
  const encryptCoords = useCallback(async (x: number, y: number) => {
    const fhe = await initBurnerFHE()
    const [encX, encY] = await fhe.encryptInputs([
      Encryptable.uint8(BigInt(x)),
      Encryptable.uint8(BigInt(y)),
    ]).execute()
    return { encX, encY }
  }, [initBurnerFHE])

  // Submit move TX using burner wallet — no MetaMask popup
  const moveWithBurner = useCallback(async (encX: unknown, encY: unknown): Promise<`0x${string}`> => {
    const client = burnerClientRef.current
    if (!client || !publicClient || !burnerAccount) throw new Error('Burner client not ready')
    // Use minimal priority fee — Sepolia validators don't need high tips
    const block = await publicClient.getBlock({ blockTag: 'latest' })
    const baseFee = block.baseFeePerGas ?? parseGwei('2')
    const maxPriorityFeePerGas = parseGwei('1')
    const maxFeePerGas = baseFee * 15n / 10n + maxPriorityFeePerGas // baseFee × 1.5 + 1 gwei
    return client.writeContract({
      address: CONTRACT_ADDRESS,
      abi: TREASURE_HUNT_ABI,
      functionName: 'move',
      args: [encX as any, encY as any],
      chain: sepolia,
      account: burnerAccount,
      maxPriorityFeePerGas,
      maxFeePerGas,
    })
  }, [burnerAccount, publicClient])

  // One-time MetaMask TX: register this burner address on-chain
  const authorizeBurner = useCallback(async () => {
    return writeContractAsync({
      address: CONTRACT_ADDRESS,
      abi: TREASURE_HUNT_ABI,
      functionName: 'authorizeBurner',
      args: [burnerAddress],
    })
  }, [writeContractAsync, burnerAddress])

  // Burner ETH balance
  const [burnerBalance, setBurnerBalance] = useState<bigint>(0n)

  const refetchBalance = useCallback(() => {
    if (!publicClient || !isDerived) return
    publicClient.getBalance({ address: burnerAddress }).then(setBurnerBalance).catch(() => {})
  }, [publicClient, burnerAddress, isDerived])

  useEffect(() => { refetchBalance() }, [publicClient, burnerAddress])

  useEffect(() => {
    const id = setInterval(refetchBalance, 30_000)
    return () => clearInterval(id)
  }, [refetchBalance])

  // Send ETH from player's MetaMask to burner
  const fundBurner = useCallback(async (amountWei: bigint): Promise<`0x${string}`> => {
    return sendTransactionAsync({ to: burnerAddress, value: amountWei })
  }, [sendTransactionAsync, burnerAddress])

  return {
    burnerAddress,
    burnerBalance,
    isDerived,
    isAuthorized,
    fheReady,
    deriveSessionKey,
    authorizeBurner,
    encryptCoords,
    moveWithBurner,
    refetchAuth,
    fundBurner,
    refetchBalance,
  }
}
