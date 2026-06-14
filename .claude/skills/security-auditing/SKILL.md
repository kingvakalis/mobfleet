---
name: security-auditing
description: Use when building or reviewing anything touching auth, permissions/RBAC, sensitive data, inputs, exports, or external surfaces — and for dedicated security passes. Apply to access control, credential handling, scope/tenant isolation, audit logging, injection/XSS, and data exposure. Enforce on the server boundary, not just the UI.
---

# Security Auditing

Find and close real exposures; verify access is enforced, not merely hidden.

## Core stance
- **Enforce at the boundary that can't be bypassed.** Hiding a button is UX, not
  security. The server/data layer must reject an unauthorized action even if the
  client calls it directly. Client guards mirror — never replace — that.
- **Least privilege + deny by default.** New capabilities start with no access;
  grant explicitly. Explicit deny wins over allow.
- **Don't trust the client.** Validate/authorize every request server-side;
  re-derive identity and scope from the session, not from request params.

## RBAC / access control checklist
- Every action checks a specific permission; every route/view is guarded.
- Anti-escalation: a user can't grant a permission they lack, or assign a role
  ≥ their own authority; no self-escalation.
- Resource scope is filtered in the query (workspace/group/owner), so out-of-
  scope rows never reach the browser — not filtered after fetch in the client.
- Ownership invariants hold (e.g. last owner protected); destructive actions are
  gated + confirmed + reversible-or-audited.

## Sensitive data
- Secrets (passwords, recovery info, tokens) are masked by default; reveal/
  export require a distinct permission and are **audit-logged** per access.
- Never put credential values in analytics, logs, list payloads, or exports —
  use presence/absence only where a signal is needed.
- No secrets in source, client bundles, error messages, or URLs.

## Common web vulns
- Output is escaped (XSS); never `dangerouslySetInnerHTML` with untrusted data.
- Inputs validated/normalized server-side (injection, path traversal, type).
- AuthN/session: secure cookies, expiry, revocation, brute-force throttling.
- CSRF protection on state-changing requests; CORS locked to known origins.
- Exports/downloads authorized server-side and scope-enforced.

## Audit & honesty
- Security-relevant events (permission/role/scope changes, reveals, exports,
  ownership) are recorded append-only with actor, target, result, timestamp.
- If a control only runs client-side today, say so explicitly and document the
  server enforcement point — don't imply protection that isn't there.

## Process
1. Map the trust boundaries and the sensitive assets/actions.
2. For each: who can do it, where is it enforced, what's logged?
3. Adversarially probe: can a lower role reach it via API/scope gaps/exports?
4. Verify masking, audit entries, and deny-by-default for new capabilities.

## Definition of done
Access enforced at the real boundary (or the gap is documented); least-privilege
defaults; secrets masked + audited + never in payloads; inputs validated;
adversarial checks pass.
