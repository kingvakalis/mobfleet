# Production Release Smoke Checklist

Release validation, Subagent 5. Run these **post-deploy** against the live (or a
production-equivalent preview) deployment to confirm the SaaS core is healthy. Each
check lists the request, the expected result, and the failure signal.

> **Do NOT run the destructive/mutating checks against production with a real user's
> data.** Use a dedicated smoke-test account/workspace. Read-only checks (`/healthz`,
> `GET /v1/me`, `GET /v1/activity`) are safe against prod. Mutating checks (invite
> accept, onboarding, email prefs) belong on a **staging/preview** deploy or a
> disposable smoke workspace.

Conventions:
- `API` = backend base URL (Railway). `WEB` = web app base URL (Vercel).
- `$TOKEN` = a real Supabase access token for the smoke account
  (`supabase.auth.getSession()` → `access_token`). **Never paste a service_role key.**
- `$TEAM` = the smoke account's active team id (from `GET /v1/me`).

---

## 0. Pre-flight

- [ ] Correct bundle deployed (verify the built JS hash matches the intended commit
      on BOTH `phone-farm-app.vercel.app` and `pfa-upped.vercel.app`).
- [ ] `MAIL_TRANSPORT` is intentional for the environment. For smoke runs that
      should not email real users, set the smoke workspace to **console** transport
      (no team Resend config) so invites log a link instead of sending.
- [ ] No `service_role` / live secret reachable from the browser bundle
      (run `node scripts/secret-scan.mjs` on the build output as a belt-and-braces check).

## 1. Health — `GET $API/healthz`

```sh
curl -fsS "$API/healthz"
```
- [ ] HTTP 200, body indicates OK.
- **FAIL:** non-200, timeout, or DB-unreachable error → backend down / migrations not applied.

## 2. Authoritative identity — `GET $API/v1/me`

```sh
curl -fsS "$API/v1/me" -H "Authorization: Bearer $TOKEN"
```
- [ ] HTTP 200. Response carries the user, the team membership(s), the active team,
      role, and `state` (`ready` | `onboarding` | `suspended`).
- [ ] Unauthenticated (`GET /v1/me` with no token) → **401**, never 200.
- **FAIL:** 200 with no membership for a provisioned user, or a 5xx → onboarding/me path broken.

## 3. Onboarding idempotency — `POST $API/v1/onboarding/team`

Provision-or-return: calling twice must NOT create a second team.
```sh
curl -fsS "$API/v1/onboarding/team" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Smoke Workspace"}'
# call again with the SAME token + body:
curl -fsS "$API/v1/onboarding/team" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Smoke Workspace"}'
```
- [ ] Both calls return the SAME team id (idempotent — the second is a no-op return).
- [ ] `GET /v1/me` afterwards shows exactly ONE owner membership for that team.
- **FAIL:** two distinct team ids, or a duplicate-membership error → idempotency regressed.

## 4. Invite accept via Prisma — `POST $API/v1/invites/inspect` + `/accept`

The accept flow is Prisma-authoritative (NOT Supabase-native).
```sh
# As owner: create an invite (captures the token server-side; email logs a link in console transport)
curl -fsS "$API/v1/team/invites" -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "x-team-id: $TEAM" -H 'Content-Type: application/json' \
  -d '{"email":"smoke-invitee@example.test","role":"viewer"}'

# As the invitee: inspect, then accept using the invite token
curl -fsS "$API/v1/invites/inspect" -H 'Content-Type: application/json' -d '{"token":"<TOKEN>"}'
curl -fsS "$API/v1/invites/accept"  -H "Authorization: Bearer $INVITEE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"token":"<TOKEN>"}'
```
- [ ] `inspect` returns the workspace + role for a valid token; a revoked/expired token
      returns the corresponding status (not a generic 500).
- [ ] `accept` makes the invitee a member with the invited role; `GET /v1/me` for the
      invitee now lists that team.
- [ ] Re-accepting the same token is **idempotent** → `already_member` (no error, no dup).
- **FAIL:** accept 500s, creates a duplicate membership, or escalates the role.

## 5. Role enforcement & 403 — least-privilege checks

```sh
# A viewer attempts an owner/admin-only mutation (e.g. create an invite):
curl -s -o /dev/null -w '%{http_code}' "$API/v1/team/invites" \
  -H "Authorization: Bearer $VIEWER_TOKEN" -H "x-team-id: $TEAM" \
  -H 'Content-Type: application/json' -d '{"email":"x@y.test","role":"viewer"}'
```
- [ ] Returns **403** (not 200, not 401) — the server enforces RBAC, not just the UI.
- [ ] Cross-tenant access: a member of team A sending `x-team-id: <team B>` → **403/404**,
      never another team's data (tenant isolation).
- **FAIL:** 200 for a forbidden action, or any cross-tenant data leak.

## 6. Activity feed — `GET $API/v1/activity`

```sh
curl -fsS "$API/v1/activity" -H "Authorization: Bearer $TOKEN" -H "x-team-id: $TEAM"
```
- [ ] HTTP 200, returns recent audit/activity entries scoped to `$TEAM` only.
- [ ] The onboarding + invite-accept from steps 3–4 appear as entries.
- **FAIL:** entries from another team appear, or 5xx.

## 7. Email preferences — `GET/POST $API/v1/settings/email/preferences`

```sh
curl -fsS "$API/v1/settings/email" -H "Authorization: Bearer $TOKEN" -H "x-team-id: $TEAM"
curl -fsS "$API/v1/settings/email/preferences" -H "Authorization: Bearer $TOKEN" \
  -H "x-team-id: $TEAM" -H 'Content-Type: application/json' \
  -d '{"teamInvitesEnabled":false,"passwordResetEnabled":true,"welcomeEmailEnabled":true}'
```
- [ ] `GET /v1/settings/email` NEVER returns the full Resend key — only `last4`/masked.
- [ ] Preferences POST persists and a subsequent GET reflects the change.
- [ ] Toggling `teamInvitesEnabled=false` suppresses the invite email on the next invite.
- **FAIL:** the full API key appears in any response, or preferences don't persist.

## 8. UI smoke — `WEB`

- [ ] `/login` renders; signing in with the smoke account lands on the dashboard (not `/login`).
- [ ] The permission-aware shell (Primary navigation) renders for the role.
- [ ] A persisted Supabase session token exists (`localStorage` `sb-*`) — proves real auth.
- [ ] Team switcher (if multi-team) switches the active workspace; data re-scopes.
- **FAIL:** redirect loop to `/login`, blank shell, or a section visible that the role forbids.

---

### Sign-off

| Check | Result | Notes |
| --- | --- | --- |
| 1 Health | ☐ pass / ☐ fail | |
| 2 /v1/me + 401 | ☐ pass / ☐ fail | |
| 3 Onboarding idempotency | ☐ pass / ☐ fail | |
| 4 Invite accept (Prisma) | ☐ pass / ☐ fail | |
| 5 403 / tenant isolation | ☐ pass / ☐ fail | |
| 6 Activity | ☐ pass / ☐ fail | |
| 7 Email prefs (no key leak) | ☐ pass / ☐ fail | |
| 8 UI shell + session | ☐ pass / ☐ fail | |

Release approved by: ____________________  Date: __________  Commit: __________
