import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { ErrorBoundary } from '@/components/system/error-boundary'
import { AmbientBackground } from '@/components/background/ambient-background'

import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/jetbrains-mono/400.css'

import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div className="relative w-full h-screen overflow-hidden bg-[#07070f]">
          <AmbientBackground />
          <div className="relative z-10 w-full h-full">
            <App />
          </div>
        </div>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
