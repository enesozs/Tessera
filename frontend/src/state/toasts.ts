import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'alert'
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let next = 1

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (text, tone = 'info') => {
    const id = next++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }))
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      tone === 'alert' ? 15_000 : 4_000,
    )
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
