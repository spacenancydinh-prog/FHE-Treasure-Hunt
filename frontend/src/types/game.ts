export type PingLevel = 'FROZEN' | 'COLD' | 'WARM' | 'HOT'

export type GamePhase = 'lobby' | 'hunting' | 'victory'

export type GameState = {
  phase: GamePhase
  playerPos: { x: number; y: number } | null
  visitedCells: Array<{ x: number; y: number }>
  moveCount: number
  lastPing: PingLevel | null
  pingHistory: PingLevel[]
  pot: bigint
  playerCount: bigint
  isWinner: boolean
  winner: string
  treasureSet: boolean
  hasJoined: boolean
  pendingClaimer: string
}

export const BUCKET_TO_PING: Record<number, PingLevel> = {
  0: 'FROZEN',
  1: 'COLD',
  2: 'WARM',
  3: 'HOT',
}

export const PING_COLOR: Record<PingLevel, string> = {
  FROZEN: 'var(--frozen)',
  COLD:   'var(--cold)',
  WARM:   'var(--warm)',
  HOT:    'var(--hot)',
}

export const PING_PERCENT: Record<PingLevel, number> = {
  FROZEN: 10,
  COLD:   35,
  WARM:   68,
  HOT:    95,
}

export const GRID_SIZE = 16
export const ENTRY_FEE = 10000000000000000n  // 0.01 ETH in wei
