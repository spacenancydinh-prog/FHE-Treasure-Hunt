import { useToast } from '../context/ToastContext'
import s from './Toast.module.css'

export function ToastContainer() {
  const { toasts, dismiss } = useToast()
  if (toasts.length === 0) return null

  return (
    <div className={s.container}>
      {toasts.map(t => (
        <div key={t.id} className={`${s.toast} ${s[t.type]}`}>
          <span className={s.message}>{t.message}</span>
          <button className={s.close} onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
