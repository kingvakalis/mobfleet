import type { FastifyInstance } from 'fastify'
import { ctx, requirePermission } from '../auth/context'
import { logAudit } from '../auth/db'
import { HttpError, notFound } from '../http-error'
import {
  createAccountBody,
  updateAccountBody,
  importAccountsBody,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  importAccounts,
  toSafeAccount,
} from '../accounts'

/**
 * Team-scoped Account database API.
 *
 * AUTH: every route requires the matching `accounts.*` permission. The acting team is
 * the AUTHENTICATED team (ctx().teamId) — a client never passes a teamId, so cross-team
 * read/write is impossible. Per-id reads/writes are team-scoped via findFirst({id,teamId})
 * so a foreign id 404s (conceals cross-tenant existence). The account PASSWORD is never
 * returned by these routes (toSafeAccount reduces it to a boolean); reveal is a separate,
 * audited endpoint gated by accounts.reveal_password (not implemented here).
 *
 *   GET    /v1/accounts            -> { accounts: SafeAccount[] }              (accounts.view)
 *   GET    /v1/accounts/:id        -> { account: SafeAccount }                (accounts.view)
 *   POST   /v1/accounts            -> { account: SafeAccount }                (accounts.create)
 *   PATCH  /v1/accounts/:id        -> { account: SafeAccount }                (accounts.edit)
 *   DELETE /v1/accounts/:id        -> { ok: true }                           (accounts.delete)
 *   POST   /v1/accounts/import     -> { created, updated, total }            (accounts.import)
 */
export function registerAccountsRoutes(app: FastifyInstance) {
  app.get('/v1/accounts', async (req) => {
    requirePermission(req, 'accounts.view')
    const c = ctx(req)
    const rows = await listAccounts(c.teamId)
    return { accounts: rows.map(toSafeAccount) }
  })

  app.get('/v1/accounts/:id', async (req) => {
    requirePermission(req, 'accounts.view')
    const c = ctx(req)
    const row = await getAccount(c.teamId, (req.params as { id: string }).id)
    if (!row) throw notFound('account not found')
    return { account: toSafeAccount(row) }
  })

  app.post('/v1/accounts', async (req) => {
    requirePermission(req, 'accounts.create')
    const c = ctx(req)
    const body = createAccountBody.parse(req.body)
    let row
    try {
      row = await createAccount(c.teamId, body, Date.now())
    } catch (e) {
      // (teamId, username) is unique within a team — a duplicate is a 409, not a 500.
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
        throw new HttpError(409, 'an account with that username already exists in this workspace')
      }
      throw new HttpError(500, 'could not create account')
    }
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'accounts.create', target: row.id, result: 'allowed', detail: `${row.platform}:${row.username}` })
    return { account: toSafeAccount(row) }
  })

  app.patch('/v1/accounts/:id', async (req) => {
    requirePermission(req, 'accounts.edit')
    const c = ctx(req)
    const accountId = (req.params as { id: string }).id
    const body = updateAccountBody.parse(req.body)
    let row
    try {
      row = await updateAccount(c.teamId, accountId, body, Date.now())
    } catch (e) {
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
        throw new HttpError(409, 'an account with that username already exists in this workspace')
      }
      throw new HttpError(500, 'could not update account')
    }
    if (!row) throw notFound('account not found')
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'accounts.edit', target: accountId, result: 'allowed' })
    return { account: toSafeAccount(row) }
  })

  app.delete('/v1/accounts/:id', async (req) => {
    requirePermission(req, 'accounts.delete')
    const c = ctx(req)
    const accountId = (req.params as { id: string }).id
    // IDEMPOTENT: deleting an already-absent (or never-existed-in-this-team) id is OK.
    const removed = await deleteAccount(c.teamId, accountId)
    if (removed) {
      await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'accounts.delete', target: accountId, result: 'allowed' })
    }
    return { ok: true }
  })

  app.post('/v1/accounts/import', async (req) => {
    requirePermission(req, 'accounts.import')
    const c = ctx(req)
    const body = importAccountsBody.parse(req.body)
    let result
    try {
      result = await importAccounts(c.teamId, body, Date.now())
    } catch {
      throw new HttpError(500, 'could not import accounts')
    }
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'accounts.import', result: 'allowed', detail: `created=${result.created} updated=${result.updated}` })
    return result
  })
}
