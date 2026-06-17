import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useConnect, usePublicClient } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { injected } from 'wagmi/connectors'
import { useGameContract } from '../../hooks/useGameContract'
import { PING_COLOR, PING_PERCENT, GRID_SIZE, type PingLevel } from '../../types/game'
import type { GameStateHook } from '../../hooks/useGameState'
import { CONTRACT_ADDRESS } from '../../lib/contract'
import s from './GameBoard.module.css'

function feedStorageKey(addr: string) {
  return `fhe-hunt:${CONTRACT_ADDRESS}:${addr.toLowerCase()}:feed`
}

type Props = { game: GameStateHook }

type FeedEntry = { time: string; text: string; kind: 'cyan' | 'violet' | 'default' }

const PING_EMOJI: Record<PingLevel, string> = {
  FROZEN: '🧊', COLD: '❄️', WARM: '🌡️', HOT: '🔥',
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

export function GameBoard({ game }: Props) {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const publicClient = usePublicClient()
  const contract = useGameContract()

  const [feed, setFeed] = useState<FeedEntry[]>(() => {
    if (!address) return [{ time: timestamp(), text: 'Game active — start hunting', kind: 'cyan' as const }]
    try {
      const saved = localStorage.getItem(feedStorageKey(address))
      if (saved) return JSON.parse(saved) as FeedEntry[]
    } catch {}
    return [{ time: timestamp(), text: 'Game active — start hunting', kind: 'cyan' as const }]
  })
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [claimX, setClaimX] = useState(game.playerPos?.x ?? 0)
  const [claimY, setClaimY] = useState(game.playerPos?.y ?? 0)
  const [claimPhase, setClaimPhase] = useState<'idle' | 'tx1' | 'decrypt' | 'tx2' | 'wrong' | 'won'>('idle')
  const [isFunding, setIsFunding] = useState(false)
  const [isDeriving, setIsDeriving] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    type P = { x: number; y: number; size: number; speedX: number; speedY: number; color: string; baseOpacity: number; opacity: number; twinkleSpeed: number; twinkleDir: number }
    let particles: P[] = []

    function makeParticle(): P {
      const baseOpacity = Math.random() * 0.5 + 0.5
      return {
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        size: Math.random() * 2.5 + 0.8,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        color: Math.random() > 0.7 ? '#00dbe7' : '#ffffff',
        baseOpacity, opacity: baseOpacity,
        twinkleSpeed: Math.random() * 0.04 + 0.01,
        twinkleDir: Math.random() > 0.5 ? 1 : -1,
      }
    }

    function init() {
      canvas!.width = window.innerWidth
      canvas!.height = window.innerHeight
      particles = Array.from({ length: 250 }, makeParticle)
    }

    function animate() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      for (const p of particles) {
        p.x += p.speedX; p.y += p.speedY
        p.opacity += p.twinkleSpeed * p.twinkleDir
        if (p.opacity > p.baseOpacity + 0.2 || p.opacity < p.baseOpacity - 0.2) p.twinkleDir *= -1
        p.opacity = Math.max(0.05, Math.min(1, p.opacity))
        if (p.x < 0 || p.x > canvas!.width || p.y < 0 || p.y > canvas!.height) Object.assign(p, makeParticle())
        // glow halo
        ctx!.globalAlpha = p.opacity * 0.25
        ctx!.fillStyle = p.color
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2)
        ctx!.fill()
        // core dot
        ctx!.globalAlpha = p.opacity
        ctx!.fillStyle = p.color
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx!.fill()
      }
      animId = requestAnimationFrame(animate)
    }

    window.addEventListener('resize', init)
    init()
    animate()

    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', init) }
  }, [])

  // Persist feed to localStorage whenever it changes
  useEffect(() => {
    if (!address) return
    try { localStorage.setItem(feedStorageKey(address), JSON.stringify(feed)) } catch {}
  }, [feed, address])

  const pos = game.playerPos ?? { x: 7, y: 7 }
  const isPending = contract.txStatus === 'encrypting' || contract.txStatus === 'pending' || contract.txStatus === 'confirming' || contract.txStatus === 'decrypting'
  const burnerBal = Number(contract.burner.burnerBalance)
  // Single threshold: < 0.005 ETH → show warning + fund button
  // SESSION KEY panel shows button when !txError; inline shows button when txError — never both at once
  const burnerLow = contract.burner.isAuthorized && burnerBal < 5e15

  function addFeed(text: string, kind: FeedEntry['kind'] = 'default') {
    setFeed(prev => [...prev, { time: timestamp(), text, kind }].slice(-50))
  }

  useEffect(() => {
    if (contract.txLog) addFeed(contract.txLog, 'cyan')
  }, [contract.txLog])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [feed])

  async function handleMove(dx: number, dy: number) {
    if (isPending) return
    const oldPos = { ...pos }
    const nx = Math.max(0, Math.min(GRID_SIZE - 1, pos.x + dx))
    const ny = Math.max(0, Math.min(GRID_SIZE - 1, pos.y + dy))
    contract.reset()
    addFeed(`Encrypting move → (${nx}, ${ny})...`, 'cyan')
    const ok = await contract.move(nx, ny)
    if (ok) {
      // Update grid after MetaMask signed + TX submitted (don't wait for confirmation)
      game.recordMove(nx, ny)
      addFeed(`Moved to (${nx}, ${ny})`, 'cyan')
      // Refresh burner balance so FUND BURNER button appears if balance dropped
      contract.burner.refetchBalance()
    } else {
      // TX rejected or failed — stay at old position
      game.recordMove(oldPos.x, oldPos.y)
      addFeed(`Move failed — staying at (${oldPos.x}, ${oldPos.y})`, 'default')
      // Refetch burner balance — failure may mean out of gas → show FUND BURNER button
      contract.burner.refetchBalance()
    }
  }

  async function handleCheckPing() {
    if (isPending) return
    contract.reset()
    addFeed('Checking proximity...', 'cyan')
    const bucket = await contract.checkProximity()
    if (bucket !== null) {
      game.recordPing(bucket)
      const level = ['FROZEN', 'COLD', 'WARM', 'HOT'][bucket] as PingLevel
      addFeed(`Ping: ${PING_EMOJI[level]} ${level}`, level === 'HOT' ? 'violet' : 'cyan')
    }
  }

  async function handleFundBurner() {
    setIsFunding(true)
    try {
      addFeed('Funding burner wallet...', 'cyan')
      const hash = await contract.burner.fundBurner(parseEther('0.02'))
      await publicClient?.waitForTransactionReceipt({ hash })
      contract.burner.refetchBalance()
      contract.reset() // clear txError so FUND BURNER buttons disappear
      addFeed('Burner funded! Moves are now gasless.', 'cyan')
    } catch (e: any) {
      addFeed(`Fund failed: ${e.shortMessage ?? e.message}`, 'default')
    } finally {
      setIsFunding(false)
    }
  }

  async function handleClaim() {
    contract.reset()
    addFeed(`Claiming win at (${claimX}, ${claimY})...`, 'violet')
    const outcome = await contract.prepareAndFinalizeClaim(claimX, claimY, setClaimPhase)
    game.refetch()
    if (outcome === 'won') {
      setClaimPhase('won')
      addFeed('🏆 WIN CONFIRMED — pot transferred!', 'violet')
      setShowClaimModal(false)
    } else if (outcome === 'wrong') {
      setClaimPhase('wrong')
      addFeed('Treasure not found here — keep searching', 'default')
    } else {
      setClaimPhase('idle')
    }
  }

  const claimBusy = claimPhase === 'tx1' || claimPhase === 'decrypt' || claimPhase === 'tx2'
  const myPendingClaim = game.myHasPendingClaim
  const canClaim = !isPending && game.hasJoined && isConnected

  return (
    <div className={s.root}>
      {/* Background effects injected directly into body via portal — bypasses root stacking context */}
      {createPortal(
        <div className={s.bgLayer}>
          <canvas ref={canvasRef} className={s.bgCanvas} />
          <div className={s.pulsingGlow} />
        </div>,
        document.body
      )}

      {/* Header */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <span className={s.logo}>FHE_TERMINAL_V1.0</span>
          <div className={s.divider} />
          <span className={s.networkTag}>SEPOLIA TESTNET</span>
        </div>
        <div className={s.headerRight}>
          <div className={s.headerStat}>
            <span className={s.headerStatLabel}>State</span>
            <span className={s.headerStatValue}>[ACTIVE]</span>
          </div>
          <div className={s.headerStat}>
            <span className={s.headerStatLabel}>Pot</span>
            <span className={s.headerStatValue}>{formatEther(game.pot)} ETH</span>
          </div>
          <div className={s.headerStat}>
            <span className={s.headerStatLabel}>Players</span>
            <span className={s.headerStatValue}>{game.playerCount.toString()}</span>
          </div>
          {isConnected ? (
            <span className={s.walletAddress}>{address?.slice(0, 6)}...{address?.slice(-4)}</span>
          ) : (
            <button className={s.walletBtn} onClick={() => connect({ connector: injected() })}>
              CONNECT
            </button>
          )}
        </div>
      </header>

      {/* Left Sidebar — Activity Feed */}
      <aside className={s.sidebar}>
        <div className={s.sidebarTitle}>📡 LOBBY_FEED</div>
        <div className={s.feedList} ref={feedRef}>
          {feed.map((entry, i) => (
            <div key={i} className={s.feedItem}>
              <span className={s.feedTime}>[{entry.time}]</span>
              <div className={`${s.feedText} ${entry.kind !== 'default' ? s[entry.kind] : ''}`}>
                {entry.text}
              </div>
            </div>
          ))}
        </div>

        {game.pingHistory.length > 0 && (
          <>
            <div className={s.pingHistoryTitle}>PING HISTORY</div>
            <div className={s.pingBadges}>
              {game.pingHistory.map((ping, i) => (
                <span
                  key={i}
                  className={s.pingBadge}
                  style={{ background: PING_COLOR[ping] + '22', color: PING_COLOR[ping], border: `1px solid ${PING_COLOR[ping]}44` }}
                >
                  {ping}
                </span>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* Main — Grid */}
      <main className={s.main}>
        <div className={s.gridWrapper}>
          <div className={s.grid}>
            <div className={s.fogOverlay} />
            {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
              const cx = i % GRID_SIZE
              const cy = Math.floor(i / GRID_SIZE)
              const gameY = GRID_SIZE - 1 - cy  // display row 0 = game Y 15 (top), row 15 = game Y 0 (bottom)
              const isPlayer = cx === pos.x && gameY === pos.y
              const isVisited = game.visitedCells.some(c => c.x === cx && c.y === gameY)
              return (
                <div
                  key={i}
                  className={`${s.cell} ${isPlayer ? s.cellPlayer : isVisited ? s.cellVisited : ''}`}
                >
                  {isPlayer && <div className={s.radarRing} />}
                </div>
              )
            })}
          </div>
          <div className={s.axisY}><span>15</span><span>8</span><span>0</span></div>
          <div className={s.axisX}><span>0</span><span>8</span><span>15</span></div>
        </div>
      </main>

      {/* Right Sidebar — Controls */}
      <aside className={s.rightSidebar}>
        {/* Movement */}
        <div className={s.movementSection}>
          <div className={s.sectionTitle}>🧭 MOVEMENT_CONTROL</div>
          <div className={s.movePad}>
            <div />
            <button className={s.moveBtn} onClick={() => handleMove(0, 1)} disabled={isPending}>
              ↑<span className={s.moveBtnLabel}>N</span>
            </button>
            <div />
            <button className={s.moveBtn} onClick={() => handleMove(-1, 0)} disabled={isPending}>
              ←<span className={s.moveBtnLabel}>W</span>
            </button>
            <div className={s.moveCenter}>MOVE<br />(1 TX)</div>
            <button className={s.moveBtn} onClick={() => handleMove(1, 0)} disabled={isPending}>
              →<span className={s.moveBtnLabel}>E</span>
            </button>
            <div />
            <button className={s.moveBtn} onClick={() => handleMove(0, -1)} disabled={isPending}>
              ↓<span className={s.moveBtnLabel}>S</span>
            </button>
            <div />
          </div>
          <div className={s.posDisplay}>
            POS: X:{pos.x.toString().padStart(2, '0')} Y:{pos.y.toString().padStart(2, '0')} | MOVES: {game.moveCount}
          </div>
        </div>

        {/* Proximity */}
        <div>
          <div className={s.proximityPanel}>
            <div className={s.proximityStatus}>
              <div className={s.proximityLabel}>STATUS</div>
              <div
                className={s.proximityValue}
                style={{ color: game.lastPing ? PING_COLOR[game.lastPing] : 'var(--text-faint)' }}
              >
                {game.lastPing ? `${PING_EMOJI[game.lastPing]} ${game.lastPing}` : '— NO DATA —'}
              </div>
            </div>
            <div className={s.signalBar}>
              <div className={s.signalBarLabel}>
                <span>SIGNAL_STRENGTH</span>
                <span>{game.lastPing ? PING_PERCENT[game.lastPing] : 0}%</span>
              </div>
              <div className={s.signalTrack}>
                <div
                  className={s.signalFill}
                  style={{
                    width: `${game.lastPing ? PING_PERCENT[game.lastPing] : 0}%`,
                    background: game.lastPing ? PING_COLOR[game.lastPing] : 'transparent',
                    boxShadow: game.lastPing ? `0 0 8px ${PING_COLOR[game.lastPing]}` : 'none',
                  }}
                />
              </div>
            </div>
            <button
              className={s.pingBtn}
              onClick={handleCheckPing}
              disabled={isPending || !game.hasJoined || !isConnected || game.moveCount === 0}
            >
              {contract.txStatus === 'decrypting' ? 'DECRYPTING...' : isPending ? 'PENDING...' : 'SCAN AREA (1 TX)'}
            </button>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', marginTop: 4 }}>
              Each scan costs gas — proximity is computed on encrypted data on-chain.
              {game.moveCount === 0 && ' Move first before scanning.'}
            </div>
          </div>
        </div>

        {/* Claim */}
        <div>
          {myPendingClaim && (
            <div style={{ fontSize: 10, color: 'var(--secondary)', marginBottom: 8, padding: '6px 8px', border: '1px solid rgba(220,80,255,0.3)', background: 'rgba(220,80,255,0.05)' }}>
              Last claim was wrong. Move to a new position and retry.
            </div>
          )}
          <button
            className={s.claimBtn}
            onClick={() => { setClaimX(pos.x); setClaimY(pos.y); setClaimPhase('idle'); setShowClaimModal(true) }}
            disabled={!canClaim || isPending}
            style={game.lastPing === 'HOT' && canClaim && !myPendingClaim ? {
              boxShadow: '0 0 20px rgba(220,80,255,0.6)',
              borderColor: 'var(--secondary)',
              animation: 'glowPulse 1s infinite',
            } : undefined}
          >
            {myPendingClaim ? '🔄 RETRY CLAIM' : game.lastPing === 'HOT' ? '⚡ CLAIM WIN — YOU MAY BE ON TREASURE!' : 'CLAIM WIN'}
          </button>
          {game.moveCount > 0 && !game.lastPing && !myPendingClaim && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6, textAlign: 'center' }}>
              Scan area first to check proximity before claiming.
            </div>
          )}
        </div>

        {/* Session Key Panel */}
        {game.hasJoined && (
          <div style={{ border: '1px solid rgba(0,242,255,0.15)', background: 'rgba(0,242,255,0.03)', padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text-faint)', marginBottom: 8 }}>
              🔑 SESSION KEY
            </div>

            {/* State 3: Derived + authorized → active */}
            {contract.burner.isAuthorized ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff88', display: 'inline-block', boxShadow: '0 0 6px #00ff88' }} />
                  <span style={{ fontSize: 10, color: '#00ff88', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>SESSION ACTIVE</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-faint)', fontFamily: 'JetBrains Mono', marginTop: 2 }}>
                  <span>{contract.burner.burnerAddress.slice(0, 8)}...{contract.burner.burnerAddress.slice(-4)}</span>
                  <span style={{ color: 'var(--text-faint)', opacity: 0.4 }}>|</span>
                  <span>
                    Bal:{' '}
                    {burnerLow
                      ? <span style={{ color: '#ff6644' }}>LOW ({(burnerBal / 1e18).toFixed(4)} ETH)</span>
                      : `${(burnerBal / 1e18).toFixed(4)} ETH`}
                  </span>
                </div>
                {burnerLow && !contract.txError && (
                  <button
                    onClick={handleFundBurner}
                    disabled={isFunding}
                    style={{
                      width: '100%', marginTop: 8, padding: '7px', background: 'none',
                      border: '1px solid rgba(220,80,255,0.5)', color: 'var(--secondary)',
                      fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.15em', textTransform: 'uppercase',
                      cursor: isFunding ? 'not-allowed' : 'pointer',
                      opacity: isFunding ? 0.6 : 1,
                    }}
                  >
                    {isFunding ? 'FUNDING...' : 'FUND BURNER (0.02 ETH)'}
                  </button>
                )}
              </div>

            ) : contract.burner.isDerived ? (
              /* State 2: Derived but not yet registered on-chain → 1 TX to register */
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 6, lineHeight: 1.5 }}>
                  Session key ready. Register it on-chain once to enable gasless moves.
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'JetBrains Mono', marginBottom: 8 }}>
                  {contract.burner.burnerAddress.slice(0, 8)}...{contract.burner.burnerAddress.slice(-4)}
                </div>
                <button
                  onClick={async () => {
                    try {
                      await contract.burner.authorizeBurner()
                      contract.burner.refetchAuth()
                    } catch {}
                  }}
                  disabled={isPending}
                  style={{
                    width: '100%', padding: '8px', background: 'none',
                    border: '1px solid rgba(0,242,255,0.4)', color: 'var(--primary)',
                    fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >
                  REGISTER SESSION (1 TX)
                </button>
              </div>

            ) : (
              /* State 1: Not derived yet → free sign to generate session key */
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 8, lineHeight: 1.5 }}>
                  Sign a message to generate your session key.<br />
                  Free — no gas, no transaction.
                </div>
                <button
                  onClick={async () => {
                    if (isDeriving) return
                    setIsDeriving(true)
                    try {
                      await contract.burner.deriveSessionKey()
                    } catch (e: any) {
                      const msg = e?.shortMessage ?? e?.message ?? ''
                      if (!msg.toLowerCase().includes('reject') && !msg.toLowerCase().includes('denied')) {
                        addFeed(`Session key error: ${msg}`, 'default')
                      }
                    } finally {
                      setIsDeriving(false)
                    }
                  }}
                  disabled={isPending || isDeriving}
                  style={{
                    width: '100%', padding: '8px', background: 'none',
                    border: '1px solid rgba(0,242,255,0.4)', color: 'var(--primary)',
                    fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.15em', textTransform: 'uppercase',
                    cursor: isDeriving ? 'not-allowed' : 'pointer',
                    opacity: isDeriving ? 0.6 : 1,
                  }}
                >
                  {isDeriving ? 'WAITING FOR SIGNATURE...' : 'DERIVE SESSION KEY (FREE)'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* TX Status */}
        {(contract.txLog || contract.txError) && (
          <div className={contract.txError ? s.txError : s.txBar}>
            {contract.txError ?? contract.txLog}
          </div>
        )}
        {/* Inline FUND BURNER — only when txError + burnerLow (SESSION KEY panel handles the no-error case) */}
        {contract.txError && burnerLow && (
          <button
            onClick={handleFundBurner}
            disabled={isFunding}
            style={{
              width: '100%', marginTop: 6, padding: '10px',
              background: 'rgba(220,80,255,0.08)',
              border: '1px solid rgba(220,80,255,0.6)',
              color: 'var(--secondary)',
              fontFamily: 'Inter', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.15em', textTransform: 'uppercase',
              cursor: isFunding ? 'not-allowed' : 'pointer',
              opacity: isFunding ? 0.6 : 1,
            }}
          >
            {isFunding ? 'FUNDING...' : '⚡ FUND BURNER (0.02 ETH) — LOW BALANCE'}
          </button>
        )}

      </aside>

      {/* Footer */}
      <footer className={s.footer}>
        <div className={s.terminalLog}>
          <span className={s.terminalLabel}>TERMINAL_LOG</span>
          <div className={s.divider} style={{ height: 12 }} />
          <span className={s.terminalText}>
            {contract.txLog || '>> Standing by...'}
          </span>
        </div>
        <div className={s.footerRight}>
          <span className={s.footerStat}><span className={s.networkDot} />NETWORK: OK</span>
          <span className={s.footerStat}>SEPOLIA</span>
        </div>
      </footer>

      {/* Claim Modal */}
      {showClaimModal && (
        <div className={s.modalOverlay} onClick={e => { if (e.target === e.currentTarget) setShowClaimModal(false) }}>
          <div className={s.modal}>
            <div className={s.modalTitle}>⚡ CLAIM WIN — 2 TRANSACTIONS</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 12, lineHeight: 1.5 }}>
              Enter the coordinates you believe are the treasure.<br />
              The contract will verify encrypted — no coordinates are revealed on-chain.
            </div>
            <div className={s.modalCoords}>
              <div>
                <div className={s.inputLabel} style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>X (0–15)</div>
                <input
                  className={s.modalInput}
                  type="number" min={0} max={15} value={claimX}
                  onChange={e => setClaimX(Number(e.target.value))}
                  disabled={claimBusy}
                />
              </div>
              <div>
                <div className={s.inputLabel} style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 4 }}>Y (0–15)</div>
                <input
                  className={s.modalInput}
                  type="number" min={0} max={15} value={claimY}
                  onChange={e => setClaimY(Number(e.target.value))}
                  disabled={claimBusy}
                />
              </div>
            </div>

            {claimBusy && (
              <div className={s.modalProgress}>
                <div className={`${s.modalStep} ${claimPhase === 'tx1' ? s.active : s.done}`}>
                  {claimPhase === 'tx1' ? '⏳' : '✓'} TX 1/2 — prepareWinClaim
                </div>
                <div className={`${s.modalStep} ${claimPhase === 'decrypt' ? s.active : claimPhase === 'tx1' ? '' : s.done}`}>
                  {claimPhase === 'decrypt' ? '⏳' : claimPhase === 'tx1' ? '○' : '✓'} Decrypting proof off-chain
                </div>
                <div className={`${s.modalStep} ${claimPhase === 'tx2' ? s.active : ''}`}>
                  {claimPhase === 'tx2' ? '⏳' : '○'} TX 2/2 — finalizeWinClaim
                </div>
              </div>
            )}

            {claimPhase === 'wrong' && (
              <div className={s.txError} style={{ marginBottom: 12 }}>
                ✗ Wrong coordinates — keep hunting.
              </div>
            )}

            <div className={s.modalActions}>
              <button className={s.modalCancel} onClick={() => { setShowClaimModal(false); setClaimPhase('idle') }} disabled={claimBusy}>
                CANCEL
              </button>
              <button className={s.modalConfirm} onClick={handleClaim} disabled={claimBusy}>
                {claimBusy ? 'IN PROGRESS...' : 'SUBMIT CLAIM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
