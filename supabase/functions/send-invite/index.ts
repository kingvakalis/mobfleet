// ════════════════════════════════════════════════════════════════════════════
// send-invite — email a team invitation link via Resend (Supabase Edge Function)
// ════════════════════════════════════════════════════════════════════════════
// The browser can't send email (no service-role key, and we don't want a mail
// secret in client code). The Team UI inserts the invite row directly (admin-only
// RLS) and then calls THIS function to deliver the link. If the function isn't
// deployed or fails, the UI still shows a copy-to-clipboard link, so invites work
// either way.
//
// AUTHORIZATION: we create a Supabase client with the CALLER's JWT and look up the
// invite by id. RLS (team_invites_select = is_team_admin) returns the row only if
// the caller administers that team — so a non-admin can't trigger invite emails.
//
// Required function secrets (supabase secrets set ...):
//   RESEND_API_KEY     — Resend API key
//   INVITE_FROM_EMAIL  — verified sender, e.g. "MobFleet <invites@mobfleet.com>"
//   APP_URL            — app origin for the accept link, e.g. https://app.mobfleet.com
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Restrict to the configured app origin when set (APP_URL), else fall back to '*'.
// Authorization is enforced by RLS via the caller JWT regardless; this just trims
// the browser-invocation surface.
const ALLOWED_ORIGIN = (Deno.env.get('APP_URL') ?? '*').replace(/\/$/, '')
const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'missing authorization' }, 401)

  let inviteId: string | undefined
  try {
    inviteId = (await req.json())?.inviteId
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  if (!inviteId) return json({ error: 'inviteId is required' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  // Caller-scoped client → RLS authorises the lookup (admins only).
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: invite, error } = await supabase
    .from('team_invites')
    .select('id, email, role, token, status, team_id, teams(name)')
    .eq('id', inviteId)
    .single()

  if (error || !invite) return json({ error: 'invite not found or not permitted' }, 403)
  if (invite.status !== 'pending') return json({ error: 'invite is no longer pending' }, 409)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('INVITE_FROM_EMAIL')
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  if (!resendKey || !from || !appUrl) {
    return json({ error: 'email delivery is not configured (RESEND_API_KEY / INVITE_FROM_EMAIL / APP_URL)' }, 501)
  }

  const teamName = (invite as { teams?: { name?: string } }).teams?.name ?? 'a workspace'
  const acceptUrl = `${appUrl}/invite?token=${encodeURIComponent(invite.token)}`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: invite.email,
      subject: `You're invited to ${teamName} on MobFleet`,
      html: `
        <div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#000;color:#e2e8f0;padding:32px;border-radius:12px;max-width:520px;margin:auto">
          <h1 style="font-size:20px;color:#fff;margin:0 0 12px">You've been invited to ${teamName}</h1>
          <p style="font-size:14px;line-height:1.6;color:#94a3b8;margin:0 0 24px">
            You've been invited to join <strong style="color:#fff">${teamName}</strong> as
            <strong style="color:#2dd4bf">${invite.role}</strong> on MobFleet. Accept the invitation to get started.
          </p>
          <a href="${acceptUrl}" style="display:inline-block;background:rgba(45,212,191,0.12);border:1px solid rgba(45,212,191,0.35);color:#7ce8da;text-decoration:none;font-size:13px;padding:12px 22px;border-radius:6px;letter-spacing:.08em;text-transform:uppercase">Accept invitation</a>
          <p style="font-size:12px;color:#64748b;margin:24px 0 0">Or paste this link into your browser:<br/><span style="color:#94a3b8">${acceptUrl}</span></p>
          <p style="font-size:11px;color:#475569;margin:16px 0 0">This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.</p>
        </div>`,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return json({ error: `email provider rejected the send (${res.status})`, detail }, 502)
  }
  return json({ ok: true })
})
