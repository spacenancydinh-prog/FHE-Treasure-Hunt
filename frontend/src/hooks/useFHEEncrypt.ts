import { useState, useCallback, useRef } from 'react'
import { usePublicClient, useWalletClient } from 'wagmi'
import { Encryptable, FheTypes } from '@cofhe/sdk'
import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web'
import { sepolia as cofheSepolia } from '@cofhe/sdk/chains'

type FheClient = Awaited<ReturnType<typeof createCofheClient>>

export function useFHEEncrypt() {
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const [fheReady, setFheReady] = useState(false)
  const [fheLoading, setFheLoading] = useState(false)
  const fheRef = useRef<FheClient | null>(null)

  const initFHE = useCallback(async () => {
    if (fheRef.current && fheReady) return fheRef.current
    if (!publicClient || !walletClient) throw new Error('Wallet not connected')
    setFheLoading(true)
    try {
      const config = createCofheConfig({ supportedChains: [cofheSepolia] })
      const client = createCofheClient(config)
      await client.connect(publicClient as any, walletClient as any)
      await client.permits.getOrCreateSelfPermit()
      fheRef.current = client
      setFheReady(true)
      return client
    } finally {
      setFheLoading(false)
    }
  }, [publicClient, walletClient, fheReady])

  const encryptCoords = useCallback(async (x: number, y: number) => {
    const fhe = await initFHE()
    const [encX, encY] = await fhe.encryptInputs([
      Encryptable.uint8(BigInt(x)),
      Encryptable.uint8(BigInt(y)),
    ]).execute()
    return { encX, encY }
  }, [initFHE])

  const decryptBucket = useCallback(async (ctHashBytes32: `0x${string}`): Promise<number> => {
    const fhe = fheRef.current ?? await initFHE()
    const ctHash = BigInt(ctHashBytes32)
    const result = await fhe.decryptForView(ctHash, FheTypes.Uint8).withPermit().execute()
    return Number(result)
  }, [initFHE])

  const decryptForTx = useCallback(async (ctHashBytes32: `0x${string}`): Promise<{ result: boolean; signature: `0x${string}` }> => {
    const fhe = fheRef.current ?? await initFHE()
    const ctHash = BigInt(ctHashBytes32)
    const res = await fhe.decryptForTx(ctHash).withPermit().execute()
    return {
      result: res.decryptedValue !== 0n,
      signature: res.signature as `0x${string}`,
    }
  }, [initFHE])

  return { fheReady, fheLoading, initFHE, encryptCoords, decryptBucket, decryptForTx }
}
