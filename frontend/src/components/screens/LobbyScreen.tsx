import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain } from 'wagmi'
import { formatEther } from 'viem'
import { injected } from 'wagmi/connectors'
import { sepolia } from 'wagmi/chains'
import { TREASURE_HUNT_ABI } from '../../lib/abi'
import { CONTRACT_ADDRESS } from '../../lib/contract'
import { useGameContract } from '../../hooks/useGameContract'
import type { GameStateHook } from '../../hooks/useGameState'
import s from './LobbyScreen.module.css'

type Props = { game: GameStateHook }

export function LobbyScreen({ game }: Props) {
  const { address, isConnected, chainId } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const { joinGame, setTreasure, txStatus, txError, txLog, reset, isWrongNetwork } = useGameContract()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  useEffect(() => {
    if (chainId && chainId !== sepolia.id) {
      switchChain?.({ chainId: sepolia.id })
    }
  }, [chainId, switchChain])

  const [showOwner, setShowOwner] = useState(false)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS, abi: TREASURE_HUNT_ABI, functionName: 'owner',
  })

  const isOwner = owner && address && (owner as string).toLowerCase() === address.toLowerCase()
  const alreadyJoined = game.hasJoined
  const canJoin = isConnected && !alreadyJoined && txStatus === 'idle'
  const isPending = txStatus === 'encrypting' || txStatus === 'pending' || txStatus === 'confirming'

  async function handleJoin() {
    reset()
    await joinGame()
    game.refetch()
  }

  async function handleSetTreasure() {
    reset()
    await setTreasure(tx, ty)
    game.refetch()
    const retryId = setInterval(() => game.refetch(), 1_000)
    setTimeout(() => clearInterval(retryId), 8_000)
  }

  const joinBtnLabel = isPending ? 'JOINING...' : alreadyJoined ? '✓ JOINED' : 'JOIN GAME WITH 0.01 ETH'

  return (
    <div className={s.page}>
      {/* Background */}
      <div className={s.bgLayer}>
        <div className={s.bgBase} />

        {/* Star field — white stars */}
        <div className={s.starField}>
          <div className={s.star} style={{ width: 1, height: 1, left: '10%', top: '100%', animationDuration: '40s' }} />
          <div className={s.star} style={{ width: 2, height: 2, left: '25%', top: '100%', animationDuration: '60s', opacity: 0.3 }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '45%', top: '100%', animationDuration: '50s' }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '70%', top: '100%', animationDuration: '45s' }} />
          <div className={s.star} style={{ width: 2, height: 2, left: '85%', top: '100%', animationDuration: '55s', opacity: 0.4 }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '5%', top: '80%', animationDuration: '38s' }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '35%', top: '60%', animationDuration: '42s' }} />
          <div className={s.star} style={{ width: 2, height: 2, left: '52%', top: '40%', animationDuration: '58s', opacity: 0.35 }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '78%', top: '70%', animationDuration: '47s' }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '92%', top: '20%', animationDuration: '53s' }} />
          <div className={s.star} style={{ width: 1, height: 1, left: '18%', top: '30%', animationDuration: '44s' }} />
          <div className={s.star} style={{ width: 2, height: 2, left: '62%', top: '90%', animationDuration: '65s', opacity: 0.25 }} />
          {/* Cyan stars */}
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 2, height: 2, left: '15%', top: '100%', animationDuration: '30s' }} />
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 3, height: 3, left: '55%', top: '100%', animationDuration: '70s', opacity: 0.2 }} />
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 2, height: 2, left: '90%', top: '100%', animationDuration: '40s' }} />
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 2, height: 2, left: '38%', top: '50%', animationDuration: '35s' }} />
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 1, height: 1, left: '72%', top: '25%', animationDuration: '48s', opacity: 0.4 }} />
          <div className={`${s.star} ${s.starCyan}`} style={{ width: 2, height: 2, left: '20%', top: '65%', animationDuration: '32s', opacity: 0.3 }} />
        </div>

        <div className={s.bgGradient} />
        <div className={s.scanlineEffect} />
        <div className={s.noiseOverlay} />
      </div>

      {/* Fixed Header */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.headerLogoWrap}>
            <img src="/FHE_LOGO.jpg" alt="Fhenix" className={s.headerLogoImg} />
          </div>
          <span className={s.headerLogo}>TREASURE HUNT</span>
        </div>
        <div className={s.headerRight}>
          <div className={s.networkPill}>
            <span className={s.networkDot} />
            <span className={s.networkLabel}>NETWORK: SEPOLIA</span>
          </div>
          {isConnected ? (
            <div className={s.walletInfo}>
              <span className={s.walletAddress}>
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <button className={s.disconnectBtn} onClick={() => disconnect()} title="Disconnect wallet">
                ×
              </button>
            </div>
          ) : (
            <button className={s.walletBtn} onClick={() => connect({ connector: injected() })}>
              CONNECT
            </button>
          )}
        </div>
      </header>

      {/* Main — centered, no sidebar */}
      <main className={s.main}>
        <div className={s.card}>
          {/* Corner brackets */}
          <div className={s.bracketTL} />
          <div className={s.bracketTR} />
          <div className={s.bracketBL} />
          <div className={s.bracketBR} />

          <div className={s.cardInner}>
            {/* <p className={s.cardSubtitle}>FHE_TERMINAL // SEPOLIA</p> */}
            <h1 className={s.cardTitle}>FHE TREASURE HUNT</h1>
            {/* Radar */}
            <div className={s.radar}>
              <div className={s.radarRing1} />
              <div className={s.radarRing2} />
              <div className={s.radarRing3} />
              <div className={s.radarRing4} />
              <div className={s.radarPulse1} />
              <div className={s.radarPulse2} />
              <div className={s.radarOuterRing} />
              <div className={s.radarLine} />
              <div className={s.radarCenter} />
            </div>

            {/* Stats grid */}
            <div className={s.statsGrid}>
              <div className={s.statCard}>
                <div className={s.statCardLabel}>TOTAL BOUNTY</div>
                <div>
                  <span className={s.statCardValue}>{formatEther(game.pot)}</span>
                  <span className={s.statCardUnit}>ETH</span>
                </div>
              </div>
              <div className={s.statCard}>
                <div className={s.statCardLabel}>DECRYPTORS READY</div>
                <div>
                  <span className={s.statCardValue}>{game.playerCount.toString()}</span>
                  <span className={s.statCardUnit}>JOINED</span>
                </div>
                <div className={s.statCardSub}>min 2 to start</div>
              </div>
              <div className={s.statCard}>
                <div className={s.statCardLabel}>SYSTEM FREQ</div>
                <div className={s.statCardText}>Sepolia_Testnet</div>
              </div>
            </div>

            {/* Actions */}
            <div className={s.actions}>
              {/* Status badges */}
              {!alreadyJoined && game.playerCount < 2n && isConnected && (
                <div className={`${s.statusBadge} ${s.statusBadgeStep}`}>
                  ⏳ Step 1: Join the lobby ({game.playerCount.toString()}/2 operatives needed)
                </div>
              )}
              {!alreadyJoined && game.playerCount >= 2n && !game.treasureSet && isConnected && (
                <div className={s.statusBadge}>
                  ✅ {game.playerCount.toString()} operatives ready. Waiting for command to set target...
                </div>
              )}
              {alreadyJoined && !game.treasureSet && (
                <div className={s.statusBadge}>
                  ✅ You are registered ({game.playerCount.toString()}/2 min).
                  {game.playerCount < 2n
                    ? ' Awaiting 1 more operative...'
                    : ' Waiting for owner to set treasure...'}
                </div>
              )}

              {/* Main CTA */}
              {!isConnected ? (
                <button className={s.btnPrimary} onClick={() => connect({ connector: injected() })}>
                  CONNECT WALLET
                </button>
              ) : isWrongNetwork ? (
                <button
                  className={s.btnSwitchNetwork}
                  onClick={() => switchChain({ chainId: sepolia.id })}
                  disabled={isSwitching}
                >
                  {isSwitching ? 'SWITCHING...' : '⚠ SWITCH TO SEPOLIA'}
                </button>
              ) : (
                <button
                  className={s.btnPrimary}
                  onClick={handleJoin}
                  disabled={!canJoin || isPending || alreadyJoined}
                >
                  {joinBtnLabel}
                </button>
              )}

{/* TX feedback */}
              {(txError || (txLog && !alreadyJoined)) && (
                <div className={txError ? s.error : s.txStatus}>
                  {txError ?? txLog}
                </div>
              )}
            </div>

          </div>

          {/* Owner Panel */}
          {isOwner && (
            <div className={s.ownerSection}>
              <button className={s.ownerToggle} onClick={() => setShowOwner(v => !v)}>
                🔒 COMMAND_PANEL {showOwner ? '▲' : '▼'}
              </button>
              {showOwner && (
                <div className={s.ownerPanel}>
                  <div className={s.coordInputs}>
                    <div className={s.inputGroup}>
                      <label className={s.inputLabel}>Target X (0–15)</label>
                      <input
                        className={s.input}
                        type="number" min={0} max={15} value={tx}
                        onChange={e => setTx(Number(e.target.value))}
                      />
                    </div>
                    <div className={s.inputGroup}>
                      <label className={s.inputLabel}>Target Y (0–15)</label>
                      <input
                        className={s.input}
                        type="number" min={0} max={15} value={ty}
                        onChange={e => setTy(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <button
                    className={s.btnOwnerAction}
                    onClick={handleSetTreasure}
                    disabled={game.treasureSet || isPending || game.playerCount < 2n}
                  >
                    {game.treasureSet
                      ? '✓ TARGET COORDINATES LOCKED'
                      : isPending
                      ? 'ENCRYPTING TARGET...'
                      : game.playerCount < 2n
                      ? `NEED ${2 - Number(game.playerCount)} MORE OPERATIVE(S)`
                      : 'ENCRYPT & DEPLOY TARGET'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Fixed Footer */}
      <footer className={s.footer}>
        <div className={s.footerLeft}>
          SYS_VER: 2.0.4 // NETWORK: SEPOLIA_TESTNET
        </div>
        <div className={s.footerRight}>
          <span>LATENCY: —</span>
          <span className={s.footerCyan}>
            🔒 ENCRYPTION: FHE_ACTIVE
          </span>
          <span>SUPPORT_TERMINAL</span>
        </div>
      </footer>
    </div>
  )
}
