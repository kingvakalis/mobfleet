# Supabase Auth email templates

MobFleet **password reset is sent by Supabase Auth**, not the MobFleet server
mailer. (`AuthContext.forgotPassword` → `supabase.auth.resetPasswordForEmail`.)
So the branded reset email must be configured in the Supabase Dashboard — it
cannot be delivered or proven by the server's tests.

## `reset-password.html`

Branded MobFleet "Reset Password" email, matching the in-app templates
(background `#0a0a0a`, accent `#2dd4bf`, MobFleet wordmark, teal CTA).

**Generated** from the single source of truth
[`src/shared/email-templates.ts`](../../src/shared/email-templates.ts) →
`buildSupabaseResetEmail()`. Do not hand-edit; if the design changes, regenerate
it from that builder so it stays in sync with the invite/welcome templates.

It uses Supabase's recovery-link variable verbatim:

```
{{ .ConfirmationURL }}
```

### Install (manual, one-time)

1. Supabase Dashboard → **Authentication → Email Templates → Reset Password**.
2. Paste the full contents of `reset-password.html` into the message body.
3. Set the subject to: `Reset your MOBFLEET password`.
4. Save.

### Required redirect URLs

Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs** must
allow-list the reset landing page, or the link falls back to the Site URL and the
user lands on "Access Restricted" instead of the reset form:

```
http://localhost:5173/reset-password
http://mobfleet.co/reset-password
https://mobfleet.co/reset-password
```

Also confirm **Site URL** points at the app (e.g. `https://mobfleet.co`).

> The MobFleet server mailer also exposes `sendResetEmail()` /
> `buildResetEmail()` for an optional custom Resend-delivered reset, but that path
> is **not currently wired** — Supabase Auth is the active reset sender.
