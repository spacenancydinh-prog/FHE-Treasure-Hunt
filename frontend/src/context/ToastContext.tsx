import { createContext, useCallback, useContext, useState } from 'react'

export type ToastType = 'error' | 'info'

export type Toast = {
  id: number
  message: string
  type: ToastType
}

type ToastContextValue = {
  toasts: Toast[]
  error: (msg: string) => void
  info: (msg: string) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const add = useCallback((message: string, type: ToastType) => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, type }].slice(-3)) // max 3
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{
      toasts,
      error: (msg) => add(msg, 'error'),
      info:  (msg) => add(msg, 'info'),
      dismiss,
    }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}
