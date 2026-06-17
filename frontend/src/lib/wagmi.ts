import { createConfig, http, webSocket, fallback } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

const endpoints = [
  http('https://eth-sepolia.g.alchemy.com/v2/rjATHv5NutxS6nUQp2ra1', { retryCount: 2, retryDelay: 400 }),
  http('https://ethereum-sepolia-public.nodies.app',                   { retryCount: 2, retryDelay: 400 }),
  http('https://0xrpc.io/sep',                                         { retryCount: 2, retryDelay: 400 }),
  http('https://sepolia.rpc.sentio.xyz',                               { retryCount: 2, retryDelay: 400 }),
  http('https://eth-sepolia.api.onfinality.io/public',                 { retryCount: 2, retryDelay: 400 }),
  http('https://api.zan.top/eth-sepolia',                              { retryCount: 2, retryDelay: 400 }),
  http('https://ethereum-sepolia-rpc.publicnode.com',                  { retryCount: 2, retryDelay: 400 }),
  webSocket('wss://sepolia.drpc.org',                                  { retryCount: 2, retryDelay: 400 }),
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
