import { useReadContracts, useAccount, useWatchContractEvent } from 'wagmi'
import { useCallback, useState, useEffect, useRef } from 'react'
import { TREASURE_HUNT_ABI } from '../lib/abi'
import { CONTRACT_ADDRESS, ZERO_ADDRESS } from '../lib/contract'
import type { GamePhase, PingLevel } from '../types/game'
import { BUCKET_TO_PING } from '../types/game'

export type GameStateHook = ReturnType<typeof useGameState>

type PersistedState = {
  playerPos: { x: number; y: number } | null
  visitedCells: Array<{ x: number; y: number }>
  moveCount: number
  lastPing: PingLevel | null
  pingHistory: PingLevel[]
}

function storageKey(addr: string) {
  return `fhe-hunt:${CONTRACT_ADDRESS}:${addr.toLowerCase()}`
}

function loadPersistedState(addr: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(addr))
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch {
    return null
  }
}

function savePersistedState(addr: string, state: PersistedState) {
  try {
    localStorage.setItem(storageKey(addr), JSON.stringify(state))
  } catch {}
}

function clearPersistedState(addr: string) {
  try {
    localStorage.removeItem(storageKey(addr))
  } catch {}
}

const ON_CHAIN_CACHE_KEY = `fhe-hunt:onchain:${CONTRACT_ADDRESS}`

function clearOnChainCache() {
  try { localStorage.removeItem(ON_CHAIN_CACHE_KEY) } catch {}
}

export function useGameState() {
  const { address } = useAccount()
  const [lastPing, setLastPing] = useState<PingLevel | null>(null)
  const [pingHistory, setPingHistory] = useState<PingLevel[]>([])
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number } | null>(null)
  const [visitedCells, setVisitedCells] = useState<Array<{ x: number; y: number }>>([])
  const [moveCount, setMoveCount] = useState(0)
  // Stable phase: never downgrade from a known phase on RPC errors
  const lastKnownRawState = useRef<number | null>(null)
  // Track whether we've loaded from localStorage for the current address
  const restoredForAddr = useRef<string | null>(null)

  const contract = { address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI } as const
  const playerAddr = address ?? ZERO_ADDRESS as `0x${string}`

  // Single multicall — all reads batched into 1 RPC round-trip via Multicall3
  const { data, refetch: refetchAll } = useReadContracts({
    contracts: [
      { ...contract, functionName: 'getGameState'   },
      { ...contract, functionName: 'getPot'         },
      { ...contract, functionName: 'getPlayerCount' },
      { ...contract, functionName: 'treasureSet'    },
      { ...contract, functionName: 'winner'            },
      { ...contract, functionName: 'hasPendingClaim', args: [playerAddr] },
      { ...contract, functionName: 'hasJoined',       args: [playerAddr] },
      { ...contract, functionName: 'getMoveCount', args: [playerAddr] },
    ] as const,
    query: {
      refetchInterval: 2_000,
      staleTime: 0,
    },
  })

  const rawStateOnChain = data?.[0]?.result as number | undefined
  // Persist last known good state so RPC hiccups don't kick players to lobby
  useEffect(() => {
    if (rawStateOnChain !== undefined) lastKnownRawState.current = rawStateOnChain
  }, [rawStateOnChain])

  const rawState       = rawStateOnChain ?? lastKnownRawState.current ?? 0

  const pot            = (data?.[1]?.result as bigint  | undefined) ?? 0n
  const playerCount    = (data?.[2]?.result as bigint  | undefined) ?? 0n
  const treasureSet    = (data?.[3]?.result as boolean | undefined) ?? false
  const winner            = (data?.[4]?.result as string  | undefined) ?? ZERO_ADDRESS
  const myHasPendingClaim = (data?.[5]?.result as boolean | undefined) ?? false
  const hasJoined         = (data?.[6]?.result as boolean | undefined) ?? false
  const chainMoves        = (data?.[7]?.result as bigint  | undefined) ?? 0n

  // Restore from localStorage when wallet connects (once per address)
  // Guard: if player is not joined on-chain, discard any stale saved state
  useEffect(() => {
    if (!address || restoredForAddr.current === address) return
    if (data === undefined) return  // wait for first on-chain fetch before deciding
    restoredForAddr.current = address
    const saved = loadPersistedState(address)
    if (!saved) return
    if (!hasJoined) {
      // Not in the current game — stale state from a previous game, discard it
      clearPersistedState(address)
      return
    }
    if (saved.playerPos)    setPlayerPos(saved.playerPos)
    if (saved.visitedCells) setVisitedCells(saved.visitedCells)
    if (saved.moveCount)    setMoveCount(saved.moveCount)
    if (saved.lastPing)     setLastPing(saved.lastPing)
    if (saved.pingHistory)  setPingHistory(saved.pingHistory)
  }, [address, data, hasJoined])

  // Persist to localStorage whenever client-side game state changes
  useEffect(() => {
    if (!address) return
    savePersistedState(address, { playerPos, visitedCells, moveCount, lastPing, pingHistory })
  }, [address, playerPos, visitedCells, moveCount, lastPing, pingHistory])

  // Loading: true until first successful fetch
  const isLoading = data === undefined

  const phase: GamePhase =
    rawState === 2 ? 'victory'
    : rawState === 1 ? 'hunting'
    : 'lobby'

  const isWinner = winner.toLowerCase() === (address?.toLowerCase() ?? '')

  function refetch() { refetchAll() }

  // 2s polling so HTTP-transport event detection is fast enough for lobby→game transitions
  const watchOpts = { ...contract, pollingInterval: 2_000 } as const
  useWatchContractEvent({ ...watchOpts, eventName: 'PlayerJoined', onLogs: refetch })
  useWatchContractEvent({ ...watchOpts, eventName: 'GameCreated',  onLogs: refetch })
  useWatchContractEvent({ ...watchOpts, eventName: 'GameWon',      onLogs: refetch })
  useWatchContractEvent({ ...watchOpts, eventName: 'GameReset',    onLogs: () => { resetLocal(); refetch() } })

  function resetLocal() {
    if (address) clearPersistedState(address)
    clearOnChainCache()
    lastKnownRawState.current = null
    restoredForAddr.current = null
    setLastPing(null)
    setPingHistory([])
    setPlayerPos(null)
    setVisitedCells([])
    setMoveCount(0)
  }

  const recordMove = useCallback((x: number, y: number) => {
    setPlayerPos({ x, y })
    setVisitedCells(prev => {
      const already = prev.some(c => c.x === x && c.y === y)
      return already ? prev : [...prev, { x, y }]
    })
    setMoveCount(prev => prev + 1)
  }, [])

  const recordPing = useCallback((bucket: number) => {
    const ping = BUCKET_TO_PING[bucket] ?? 'FROZEN'
    setLastPing(ping)
    setPingHistory(prev => [ping, ...prev].slice(0, 20))
  }, [])

  return {
    phase,
    isLoading,
    pot,
    playerCount,
    treasureSet,
    winner,
    myHasPendingClaim,
    hasJoined,
    isWinner,
    lastPing,
    pingHistory,
    playerPos,
    visitedCells,
    moveCount: Math.max(moveCount, Number(chainMoves)),
    refetch,
    recordMove,
    recordPing,
    resetLocal,
  }
}
