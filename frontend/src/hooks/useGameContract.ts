import { useState, useCallback } from 'react'
import { useWriteContract, usePublicClient, useAccount, useChainId, useSwitchChain } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { parseGwei } from 'viem'
import { TREASURE_HUNT_ABI } from '../lib/abi'
import { CONTRACT_ADDRESS, ENTRY_FEE } from '../lib/contract'
import { useFHEEncrypt } from './useFHEEncrypt'
import { useBurnerWallet } from './useBurnerWallet'
import { useToast } from '../context/ToastContext'
import { GRID_SIZE } from '../types/game'

export type TxStatus = 'idle' | 'encrypting' | 'pending' | 'confirming' | 'decrypting' | 'done' | 'error'

export function useGameContract() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { encryptCoords, decryptBucket, decryptForTx } = useFHEEncrypt()
  const burner = useBurnerWallet(address)
  const toast = useToast()

  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const isWrongNetwork = chainId !== sepolia.id

  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txError, setTxError] = useState<string | null>(null)
  const [txLog, setTxLog] = useState<string>('')

  function log(msg: string) { setTxLog(msg) }
  function err(msg: string) { setTxStatus('error'); setTxError(msg); toast.error(msg) }
  function reset() { setTxStatus('idle'); setTxError(null); setTxLog('') }

  // Auto-switch to Sepolia before any write TX
  async function ensureSepolia() {
    if (chainId !== sepolia.id) {
      log('Switching to Sepolia...')
      await switchChainAsync({ chainId: sepolia.id })
    }
  }

  const waitReceipt = useCallback(async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error('No public client')
    log(`Confirming TX ${hash.slice(0, 10)}...`)
    setTxStatus('confirming')
    return publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
  }, [publicClient])

  const joinGame = useCallback(async () => {
    try {
      await ensureSepolia()
      setTxStatus('pending'); log('Joining game...')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'joinGame', value: ENTRY_FEE,
      })
      await waitReceipt(hash)
      setTxStatus('done'); log('Joined game!')
    } catch (e: any) {
      err(e.shortMessage ?? e.message)
    }
  }, [writeContractAsync, waitReceipt])

  const setTreasure = useCallback(async (x: number, y: number) => {
    try {
      await ensureSepolia()
      setTxStatus('encrypting'); log(`Encrypting treasure (${x}, ${y})...`)
      const { encX, encY } = await encryptCoords(x, y)
      setTxStatus('pending'); log('Submitting setTreasure...')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'setTreasure', args: [encX as any, encY as any],
      })
      await waitReceipt(hash)
      setTxStatus('done'); log('Treasure placed!')
    } catch (e: any) {
      err(e.shortMessage ?? e.message)
    }
  }, [encryptCoords, writeContractAsync, waitReceipt])

  const move = useCallback(async (x: number, y: number): Promise<boolean> => {
    const cx = Math.max(0, Math.min(GRID_SIZE - 1, x))
    const cy = Math.max(0, Math.min(GRID_SIZE - 1, y))
    try {
      await ensureSepolia()
      setTxStatus('encrypting'); log(`Encrypting move (${cx}, ${cy})...`)

      let hash: `0x${string}`
      if (burner.isAuthorized) {
        // Burner path: encrypt with burner's FHE client, submit without MetaMask
        const { encX, encY } = await burner.encryptCoords(cx, cy)
        setTxStatus('pending'); log('Submitting move (session key)...')
        hash = await burner.moveWithBurner(encX, encY)
      } else {
        // Fallback: player's wallet (MetaMask)
        const { encX, encY } = await encryptCoords(cx, cy)
        setTxStatus('pending'); log('Submitting move...')
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
          functionName: 'move', args: [encX as any, encY as any],
          maxPriorityFeePerGas: parseGwei('1'), // hint MetaMask to use minimal tip
        })
      }

      setTxStatus('done'); log(`Moved to (${cx}, ${cy}) ✓`)
      publicClient?.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => {})
      return true
    } catch (e: any) {
      err(e.shortMessage ?? e.message)
      return false
    }
  }, [burner, encryptCoords, writeContractAsync, publicClient])

  const checkProximity = useCallback(async (): Promise<number | null> => {
    if (!address || !publicClient) return null
    try {
      await ensureSepolia()
      setTxStatus('pending'); log('Checking proximity...')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'checkProximity',
      })
      await waitReceipt(hash)
      setTxStatus('decrypting'); log('Decrypting ping...')
      const ctHashBytes32 = await publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'getLastBucket',
        account: address,
      }) as `0x${string}`
      const bucket = await decryptBucket(ctHashBytes32)
      setTxStatus('done'); log(`Proximity: ${['FROZEN','COLD','WARM','HOT'][bucket] ?? '?'}`)
      return bucket
    } catch (e: any) {
      err(e.shortMessage ?? e.message)
      return null
    }
  }, [address, publicClient, writeContractAsync, waitReceipt, decryptBucket])

  const prepareAndFinalizeClaim = useCallback(async (
    x: number,
    y: number,
    onStep?: (step: 'tx1' | 'decrypt' | 'tx2') => void,
  ): Promise<'won' | 'wrong' | 'error'> => {
    try {
      await ensureSepolia()
      // TX 1
      onStep?.('tx1')
      setTxStatus('encrypting'); log(`Encrypting claim (${x}, ${y})...`)
      const { encX, encY } = await encryptCoords(x, y)
      setTxStatus('pending'); log('TX 1/2 — prepareWinClaim...')
      const hash1 = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'prepareWinClaim', args: [encX as any, encY as any],
      })
      const receipt1 = await waitReceipt(hash1)
      if (receipt1.status !== 'success') throw new Error('Treasure not found here — keep searching')

      // Off-chain decrypt (read handle from storage)
      onStep?.('decrypt')
      setTxStatus('decrypting'); log('Decrypting proof off-chain...')
      if (!address || !publicClient) throw new Error('No wallet')
      const { keccak256, encodeAbiParameters } = await import('viem')
      const slot = keccak256(encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [address, 13n],
      ))
      const ctHashBytes32 = await publicClient.getStorageAt({ address: CONTRACT_ADDRESS, slot }) as `0x${string}`
      const { result, signature } = await decryptForTx(ctHashBytes32)

      // TX 2 — always finalize regardless of result (false clears pendingClaimer on-chain)
      onStep?.('tx2')
      setTxStatus('pending'); log(`TX 2/2 — finalizeWinClaim (${result ? 'WIN' : 'miss'})...`)
      const hash2 = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'finalizeWinClaim', args: [result, signature],
      })
      await waitReceipt(hash2)
      if (!result) {
        setTxStatus('done'); log('Treasure not found here — keep searching')
        return 'wrong'
      }
      setTxStatus('done'); log('🏆 Winner! Pot transferred.')
      return 'won'
    } catch (e: any) {
      const msg: string = e.shortMessage ?? e.message ?? ''
      const isRevert = msg.toLowerCase().includes('revert') || msg.toLowerCase().includes('preparewin')
      err(isRevert ? 'Treasure not found here — keep searching' : msg)
      return 'error'
    }
  }, [address, publicClient, encryptCoords, writeContractAsync, waitReceipt, decryptForTx])

  const resetGame = useCallback(async () => {
    try {
      await ensureSepolia()
      setTxStatus('pending'); log('Resetting game...')
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
        functionName: 'resetGame',
      })
      await waitReceipt(hash)
      setTxStatus('done'); log('Game reset.')
    } catch (e: any) {
      err(e.shortMessage ?? e.message)
    }
  }, [writeContractAsync, waitReceipt])

  return {
    txStatus, txError, txLog, reset,
    joinGame, setTreasure, move, checkProximity,
    prepareAndFinalizeClaim, resetGame,
    burner,
    isWrongNetwork,
  }
}
