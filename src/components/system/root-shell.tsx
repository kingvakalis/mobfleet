import { MotionConfig } from 'framer-motion'
import { AmbientBackground } from '@/components/background/ambient-background'
import { useSettings } from '@/state/settings-store'
import { ToastContainer } from '@/components/ui/toast'
import App from '@/App'

/** App root: motion policy + ambient layer + toasts around the view tree. */
export function RootShell() {
  const motion = useSettings((s) => s.motion)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const reduced = reduceMotion || motion === 'reduced' || motion === 'off'
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="relative w-full h-screen overflow-hidden bg-black">
        <AmbientBackground />
        <div className="relative z-10 w-full h-full">
          <App />
          <ToastContainer />
        </div>
      </div>
    </MotionConfig>
  )
}
