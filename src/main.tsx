import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/system/error-boundary'
import { RootShell } from '@/components/system/root-shell'
import { AuthProvider } from '@/auth/auth-context'
import { ProtectedRoute } from '@/auth/protected-route'
import { LoginPage } from '@/pages/login'
import { SignupPage } from '@/pages/signup'
import { InvitePage } from '@/pages/invite'
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
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/invite" element={<ProtectedRoute><InvitePage /></ProtectedRoute>} />
            {/* The whole app lives behind the auth gate. With Supabase
                unconfigured the gate is a passthrough, so the standalone
                mock/demo build is unaffected. */}
            <Route path="/" element={<ProtectedRoute><RootShell /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
