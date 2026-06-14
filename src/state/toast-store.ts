import { create } from 'zustand'

export type ToastLevel = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  level: ToastLevel
  duration: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, level?: ToastLevel, duration?: number) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, level = 'info', duration = 4000) => {
    const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    set(s => ({ toasts: [...s.toasts, { id, message, level, duration }] }))
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, duration)
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
