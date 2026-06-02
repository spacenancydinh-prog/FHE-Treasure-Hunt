import { useGameState } from './hooks/useGameState'
import { LobbyScreen } from './components/screens/LobbyScreen'
import { GameBoard } from './components/screens/GameBoard'
import { VictoryScreen } from './components/screens/VictoryScreen'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { useState, useEffect } from 'react'

const SEPOLIA_ID = sepolia.id

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  gap: 16,
  color: 'var(--primary)',
  fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.15em',
}

const dotStyle: React.CSSProperties = {
  width: 8, height: 8,
  borderRadius: '50%',
  background: 'var(--primary)',
  animation: 'glowPulse 1.5s infinite',
}

function WrongNetworkBanner() {
  const { switchChain } = useSwitchChain()
  const [switching, setSwitching] = useState(false)
  const [switchErr, setSwitchErr] = useState<string | null>(null)

  async function handleSwitch() {
    setSwitching(true)
    setSwitchErr(null)
    try {
      await switchChain({ chainId: SEPOLIA_ID })
    } catch (e: any) {
      setSwitchErr(e.shortMessage ?? e.message ?? 'Switch failed')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'rgba(220, 80, 255, 0.12)',
      borderBottom: '1px solid rgba(220, 80, 255, 0.5)',
      backdropFilter: 'blur(20px)',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
      gap: 16,
    }}>
      <span style={{ color: 'var(--secondary)', letterSpacing: '0.1em' }}>
        ⚠ WRONG NETWORK — This game runs on Ethereum Sepolia testnet
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {switchErr && (
          <span style={{ color: '#ff6b6b', fontSize: 11 }}>{switchErr}</span>
        )}
        <button
          onClick={handleSwitch}
          disabled={switching}
          style={{
            background: 'transparent',
            border: '1px solid rgba(220, 80, 255, 0.6)',
            color: 'var(--secondary)',
            padding: '5px 14px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            letterSpacing: '0.1em',
            cursor: switching ? 'not-allowed' : 'pointer',
            opacity: switching ? 0.6 : 1,
          }}
        >
          {switching ? 'SWITCHING...' : 'SWITCH TO SEPOLIA'}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const game = useGameState()

  // Auto-switch to Sepolia as soon as wallet connects on wrong network
  useEffect(() => {
    if (isConnected && chainId !== SEPOLIA_ID) {
      switchChain({ chainId: SEPOLIA_ID })
    }
  }, [isConnected, chainId])

  const wrongNetwork = isConnected && chainId !== SEPOLIA_ID

  if (game.isLoading) {
    return (
      <>
        {wrongNetwork && <WrongNetworkBanner />}
        <div style={{ ...loadingStyle, paddingTop: wrongNetwork ? 52 : 0 }}>
          <div style={dotStyle} />
          <span style={{ fontSize: 12 }}>CONNECTING TO CHAIN...</span>
        </div>
      </>
    )
  }

  return (
    <>
      {wrongNetwork && <WrongNetworkBanner />}
      <div style={{ paddingTop: wrongNetwork ? 44 : 0 }}>
        {game.phase === 'hunting' ? <GameBoard game={game} />
        : game.phase === 'victory' ? <VictoryScreen game={game} />
        : <LobbyScreen game={game} />}
      </div>
    </>
  )
}
