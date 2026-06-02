import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './lib/wagmi'
import { ToastProvider } from './context/ToastContext'
import { ToastContainer } from './components/Toast'
import './styles/design-tokens.css'
import './styles/globals.css'
import App from './App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      gcTime: 10 * 60_000,
      retry: 1,
      retryDelay: 500,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
          <ToastContainer />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
