import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@/components/system/error-boundary'
import { RootShell } from '@/components/system/root-shell'
import { applyAppearance } from '@/lib/themes'
import { useSettings } from '@/state/settings-store'

import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/jetbrains-mono/400.css'

import './index.css'

// Apply the persisted theme BEFORE the first render so there is no flash of
// the default theme, and keep the document in sync with every settings change.
applyAppearance(useSettings.getState())
useSettings.subscribe((s) => applyAppearance(s))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootShell />
    </ErrorBoundary>
  </StrictMode>,
)
