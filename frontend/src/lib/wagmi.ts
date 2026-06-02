import { createConfig, http, fallback } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

const PRIMARY_RPC = import.meta.env.VITE_SEPOLIA_RPC

const endpoints = [
  http('https://sepolia.drpc.org',                          { retryCount: 2, retryDelay: 400 }),
  http('https://api.zan.top/eth-sepolia',                   { retryCount: 2, retryDelay: 400 }),
  http('https://ethereum-sepolia-rpc.publicnode.com',       { retryCount: 2, retryDelay: 400 }),
  http('https://ethereum-sepolia.gateway.tatum.io',         { retryCount: 2, retryDelay: 400 }),
  http('https://1rpc.io/sepolia',                           { retryCount: 2, retryDelay: 400 }),
  ...(PRIMARY_RPC ? [http(PRIMARY_RPC,                      { retryCount: 2, retryDelay: 400 })] : []),
]

// rank: true → viem benchmarks all RPCs every 60s and routes to the fastest one
const rpcTransport = fallback(endpoints, {
  rank: { interval: 60_000, sampleCount: 5 },
})

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [metaMask(), injected()],
  transports: { [sepolia.id]: rpcTransport },
})
