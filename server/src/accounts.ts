import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db'

/**
 * Account vault — the team-scoped account database (Instagram / TikTok records).
 *
 * SECURITY:
 * - Every query is anchored on a server-resolved teamId; per-id access is a
 *   findFirst({ where: { id, teamId } }) so one team can never read/mutate another's
 *   rows (a forged id in another team simply 404s).
 * - ACCOUNT PASSWORDS ARE NOT PERSISTED in this release. Plaintext credential
 *   storage is prohibited and this codebase has no reversible-encryption helper, so
 *   the `password` column/field was REMOVED for the production cutover (the Account
 *   table is new — no data to migrate). Re-introduce it later only as authenticated-
 *   encrypted storage with a dedicated server-side key. The vault stores ONLY
 *   non-secret account metadata (handle, platform, username, email, status, tags, …).
 *
 * The Prisma `Account` model does NOT exist yet (see SCHEMA-PROPOSAL / PROPOSALS.md).
 * Until the lead adds it + regenerates the client, this module compiles against a
 * thin injectable DB PORT (`AccountsDb`); `prismaAccountsDb()` adapts the live client
 * via `prisma as unknown as AccountsDb`, so `tsc --noEmit` passes WITHOUT the new
 * delegate, and the integration tests SKIP (gated on the model + TEST_DATABASE_URL).
 */

// ── Domain ──────────────────────────────────────────────────────────────────────

export const ACCOUNT_PLATFORMS = ['Instagram', 'TikTok'] as const
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export const ACCOUNT_STATUSES = ['active', 'flagged', 'banned', 'warming'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/** The persisted row shape (mirrors the proposed Prisma Account model). */
export interface AccountRow {
  id: string
  teamId: string
  handle: string
  platform: string
  username: string
  email: string
  phone: string | null
  assignedPhone: string | null
  group: string
  owner: string
  twoFA: boolean
  status: string
  tags: unknown // string[] (Json)
  followers: number
  notes: string
  createdAt: number
  updatedAt: number
}

/** The safe, password-free shape returned by list/read routes. */
export interface SafeAccount {
  id: string
  handle: string
  platform: string
  username: string
  email: string
  phone: string | null
  assignedPhone: string | null
  group: string
  owner: string
  twoFA: boolean
  status: string
  tags: string[]
  followers: number
  notes: string
  createdAt: number
  updatedAt: number
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Map a row to the safe shape. No secret fields exist on Account (password removed). */
export function toSafeAccount(row: AccountRow): SafeAccount {
  return {
    id: row.id,
    handle: row.handle,
    platform: row.platform,
    username: row.username,
    email: row.email,
    phone: row.phone ?? null,
    assignedPhone: row.assignedPhone ?? null,
    group: row.group,
    owner: row.owner,
    twoFA: row.twoFA,
    status: row.status,
    tags: asStringArray(row.tags),
    followers: row.followers,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ── Validation (Zod v4) ───────────────────────────────────────────────────────

export const createAccountBody = z.object({
  handle: z.string().trim().min(1).max(200),
  platform: z.enum(ACCOUNT_PLATFORMS),
  username: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(64).optional(),
  assignedPhone: z.string().trim().max(200).optional(),
  group: z.string().trim().max(120).optional(),
  owner: z.string().trim().max(200).optional(),
  twoFA: z.boolean().optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  followers: z.number().int().min(0).max(1_000_000_000).optional(),
  notes: z.string().max(5000).optional(),
})
export type CreateAccountBody = z.infer<typeof createAccountBody>

/** Update: every field optional (partial patch). username keeps its dedupe constraint. */
export const updateAccountBody = createAccountBody.partial()
export type UpdateAccountBody = z.infer<typeof updateAccountBody>

/** A single import row (same validation as create) — the bulk-import unit. */
export const importAccountsBody = z.object({
  accounts: z.array(createAccountBody).min(1).max(1000),
})
export type ImportAccountsBody = z.infer<typeof importAccountsBody>

// ── DB port (so tsc passes without the not-yet-generated delegate) ───────────────

export interface AccountsDb {
  account: {
    findMany(args: unknown): Promise<AccountRow[]>
    findFirst(args: unknown): Promise<AccountRow | null>
    create(args: unknown): Promise<AccountRow>
    update(args: unknown): Promise<AccountRow>
    delete(args: unknown): Promise<AccountRow>
  }
}

/** Adapt the live Prisma client to the port. After the lead adds the Account model +
 *  `prisma generate`, this cast becomes a structural match (no code change needed). */
export function prismaAccountsDb(): AccountsDb {
  return prisma as unknown as AccountsDb
}

const id = () => `acct_${randomUUID()}`

// ── Data access (team-scoped) ────────────────────────────────────────────────────

/** List a team's accounts, newest-updated first. Metadata-only (no secret fields). */
export async function listAccounts(teamId: string, db: AccountsDb = prismaAccountsDb()): Promise<AccountRow[]> {
  return db.account.findMany({ where: { teamId }, orderBy: { updatedAt: 'desc' } })
}

/** Read ONE account, team-scoped (findFirst on {id,teamId} → cross-tenant id 404s). */
export async function getAccount(teamId: string, accountId: string, db: AccountsDb = prismaAccountsDb()): Promise<AccountRow | null> {
  return db.account.findFirst({ where: { id: accountId, teamId } })
}

/** Build the create payload from a validated body (applies defaults; team-scoped). Pure. */
export function buildAccountCreateData(teamId: string, body: CreateAccountBody, now: number) {
  return {
    id: id(),
    teamId,
    handle: body.handle,
    platform: body.platform,
    username: body.username,
    email: body.email,
    phone: body.phone ?? null,
    assignedPhone: body.assignedPhone ?? null,
    group: body.group ?? 'Unassigned',
    owner: body.owner ?? 'Unassigned',
    twoFA: body.twoFA ?? false,
    status: body.status ?? 'warming',
    tags: body.tags ?? [],
    followers: body.followers ?? 0,
    notes: body.notes ?? '',
    createdAt: now,
    updatedAt: now,
  }
}

export async function createAccount(teamId: string, body: CreateAccountBody, now: number, db: AccountsDb = prismaAccountsDb()): Promise<AccountRow> {
  return db.account.create({ data: buildAccountCreateData(teamId, body, now) })
}

/** Build the update payload — only the keys present in the patch are written. Pure. */
export function buildAccountUpdateData(body: UpdateAccountBody, now: number): Record<string, unknown> {
  const data: Record<string, unknown> = { updatedAt: now }
  if (body.handle !== undefined) data.handle = body.handle
  if (body.platform !== undefined) data.platform = body.platform
  if (body.username !== undefined) data.username = body.username
  if (body.email !== undefined) data.email = body.email
  if (body.phone !== undefined) data.phone = body.phone
  if (body.assignedPhone !== undefined) data.assignedPhone = body.assignedPhone
  if (body.group !== undefined) data.group = body.group
  if (body.owner !== undefined) data.owner = body.owner
  if (body.twoFA !== undefined) data.twoFA = body.twoFA
  if (body.status !== undefined) data.status = body.status
  if (body.tags !== undefined) data.tags = body.tags
  if (body.followers !== undefined) data.followers = body.followers
  if (body.notes !== undefined) data.notes = body.notes
  return data
}

/** Update ONE account, team-scoped. Returns null when the id is not in this team
 *  (so the route 404s) — the team gate is the findFirst, not the update WHERE. */
export async function updateAccount(teamId: string, accountId: string, body: UpdateAccountBody, now: number, db: AccountsDb = prismaAccountsDb()): Promise<AccountRow | null> {
  const existing = await db.account.findFirst({ where: { id: accountId, teamId } })
  if (!existing) return null
  return db.account.update({ where: { id: accountId }, data: buildAccountUpdateData(body, now) })
}

/** Delete ONE account, team-scoped. IDEMPOTENT: deleting an already-absent id is OK
 *  (returns false), so a double-delete never errors. */
export async function deleteAccount(teamId: string, accountId: string, db: AccountsDb = prismaAccountsDb()): Promise<boolean> {
  const existing = await db.account.findFirst({ where: { id: accountId, teamId } })
  if (!existing) return false
  await db.account.delete({ where: { id: accountId } })
  return true
}

// ── Import (idempotent dedupe by (teamId, username)) ─────────────────────────────

export interface ImportResult {
  created: number
  updated: number
  total: number
}

/**
 * Bulk-import accounts, IDEMPOTENT on (teamId, username): a username already in the
 * team is UPDATED in place (re-running an import does not create duplicates — backed
 * by the @@unique([teamId, username]) constraint); a new username is CREATED. Within
 * a single payload, later rows for the same username win (last-write). All writes are
 * team-scoped. Returns the created/updated tallies.
 */
export async function importAccounts(teamId: string, body: ImportAccountsBody, now: number, db: AccountsDb = prismaAccountsDb()): Promise<ImportResult> {
  // Collapse intra-payload duplicates (last wins) so the per-username write is unambiguous.
  const byUsername = new Map<string, CreateAccountBody>()
  for (const a of body.accounts) byUsername.set(a.username, a)

  let created = 0
  let updated = 0
  for (const row of byUsername.values()) {
    const existing = await db.account.findFirst({ where: { teamId, username: row.username } })
    if (existing) {
      await db.account.update({ where: { id: existing.id }, data: buildAccountUpdateData(row, now) })
      updated++
    } else {
      await db.account.create({ data: buildAccountCreateData(teamId, row, now) })
      created++
    }
  }
  return { created, updated, total: created + updated }
}
