import { useEffect, useRef } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { formatEther } from 'viem'
import { TREASURE_HUNT_ABI } from '../../lib/abi'
import { CONTRACT_ADDRESS, ENTRY_FEE } from '../../lib/contract'
import { useGameContract } from '../../hooks/useGameContract'
import type { GameStateHook } from '../../hooks/useGameState'
import s from './VictoryScreen.module.css'

type Props = { game: GameStateHook }

export function VictoryScreen({ game }: Props) {
  const { address } = useAccount()
  const { resetGame, txStatus, txError, txLog, reset } = useGameContract()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI, functionName: 'owner',
  })

  const { data: winnerMoveCount } = useReadContract({
    address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI,
    functionName: 'getMoveCount', args: [game.winner as `0x${string}`],
    query: { enabled: game.winner !== '0x0000000000000000000000000000000000000000' },
  })

  const isOwner = owner && address && (owner as string).toLowerCase() === address.toLowerCase()
  const isWinner = game.winner.toLowerCase() === (address?.toLowerCase() ?? '')
  const isPending = txStatus === 'pending' || txStatus === 'confirming'
  const prizePool = game.playerCount * ENTRY_FEE

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    type Star = { x: number; y: number; size: number; opacity: number; speed: number }
    let stars: Star[] = []

    function init() {
      canvas!.width = window.innerWidth
      canvas!.height = window.innerHeight
      stars = Array.from({ length: 150 }, () => ({
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        size: Math.random() * 2,
        opacity: Math.random(),
        speed: Math.random() * 0.5 + 0.1,
      }))
    }

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      for (const star of stars) {
        ctx!.fillStyle = `rgba(0, 242, 255, ${star.opacity})`
        ctx!.shadowBlur = 5
        ctx!.shadowColor = '#00f2ff'
        ctx!.beginPath()
        ctx!.arc(star.x, star.y, star.size, 0, Math.PI * 2)
        ctx!.fill()
        star.y -= star.speed
        if (star.y < 0) {
          star.y = canvas!.height
          star.x = Math.random() * canvas!.width
        }
      }
      animId = requestAnimationFrame(animate)
    }

    window.addEventListener('resize', init)
    init()
    animate()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', init) }
  }, [])

  async function handleReset() {
    reset()
    await resetGame()
    game.refetch()
    game.resetLocal()
  }

  return (
    <div className={s.root}>
      {/* Starfield canvas */}
      <canvas ref={canvasRef} className={s.canvas} />

      <main className={s.main}>
        <div className={s.card}>
          {/* Scanline overlay */}
          <div className={s.scanlineOverlay} />

          {/* Top status bar */}
          <div className={s.statusRow}>
            <div className={s.statusLine} />
            <span className={s.badge}>// GAME_ENDED //</span>
            <div className={s.statusLine} />
          </div>

          {/* Hero */}
          <div className={s.hero}>
            <h1 className={s.title}>WINNER</h1>
            <p className={s.subtitle}>The treasure has been found</p>
          </div>

          {/* You won alert */}
          {isWinner && (
            <div className={s.successBox}>
              <svg className={s.checkIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>You found the treasure and claimed the pot!</span>
            </div>
          )}

          {/* Winner address */}
          <div className={s.winnerSection}>
            <span className={s.winnerLabel}>Winner Address</span>
            <div className={s.winnerAddress}>{game.winner}</div>
          </div>

          {/* Stats grid */}
          <div className={s.stats}>
            <div className={`${s.stat} ${s.statPot}`}>
              <span className={s.statLabel}>Prize Pot</span>
              <span className={`${s.statValue} ${s.valuePot}`}>{formatEther(prizePool)} ETH</span>
            </div>
            <div className={`${s.stat} ${s.statMoves}`}>
              <span className={s.statLabel}>Moves</span>
              <span className={`${s.statValue} ${s.valueMoves}`}>{winnerMoveCount?.toString() ?? '—'}</span>
            </div>
            <div className={`${s.stat} ${s.statPlayers}`}>
              <span className={s.statLabel}>Players</span>
              <span className={`${s.statValue} ${s.valuePlayers}`}>{game.playerCount.toString()}</span>
            </div>
          </div>

          {/* Actions */}
          <div className={s.actions}>
            {isOwner && (
              <button className={s.btnReset} onClick={handleReset} disabled={isPending}>
                {isPending ? 'RESETTING...' : 'RESET GAME'}
              </button>
            )}
            {!isOwner && (
              <div className={s.waitingRow}>
                <div className={s.pingDot} />
                <span className={s.waitingText}>Waiting for owner to reset the game...</span>
                <div className={s.dashLine} />
              </div>
            )}
            {(txLog || txError) && (
              <div className={txError ? s.txError : s.txBar}>
                {txError ?? txLog}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
