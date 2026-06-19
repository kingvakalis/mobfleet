import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/system/error-boundary'
import { RootShell } from '@/components/system/root-shell'
import { AuthProvider } from '@/contexts/AuthContext'
import { AuthzProvider } from '@/contexts/AuthzContext'
import { TeamProvider } from '@/contexts/TeamContext'
import { ProtectedRoute } from '@/auth/protected-route'
import { OnboardingGate } from '@/auth/onboarding-gate'
import { RedirectIfAuthed } from '@/auth/redirect-if-authed'
import { LoginPage } from '@/pages/login'
import { SignupPage } from '@/pages/signup'
import { ForgotPasswordPage } from '@/pages/forgot-password'
import { ResetPasswordPage } from '@/pages/reset-password'
import { InvitePage } from '@/pages/invite'
import { OnboardingPage } from '@/pages/onboarding'
import { ForbiddenPage } from '@/pages/forbidden'
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
          <AuthzProvider>
            <TeamProvider>
              <Routes>
                <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
                <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
                {/* Public password recovery: reached pre-auth. /reset-password is the
                    landing target for the Supabase recovery email (see auth-redirect). */}
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                {/* Public: invitees may arrive unauthenticated; the page routes
                    them to signup (carrying the token) and redeems it once signed in. */}
                <Route path="/invite" element={<InvitePage />} />
                <Route path="/forbidden" element={<ProtectedRoute><ForbiddenPage /></ProtectedRoute>} />
                <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
                {/* The whole app lives behind the auth gate. With Supabase
                    unconfigured the gate is a passthrough, so the standalone
                    mock/demo build is unaffected. The OnboardingGate routes
                    first-run owners to /onboarding and redeems pending invites. */}
                <Route path="/" element={<ProtectedRoute><OnboardingGate><RootShell /></OnboardingGate></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </TeamProvider>
          </AuthzProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
