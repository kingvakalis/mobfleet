import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { SourceSnapshot, SrcAuthUser, SrcInvite, SrcMember, SrcTeam } from './types'

/**
 * Loads + STRICTLY validates an offline Supabase source snapshot (exported by
 * ops/export-supabase-inventory-snapshot.sql). Fail-closed: any structural problem -- unsupported
 * version, missing/!typed fields, duplicate ids, malformed timestamps, malformed JSON values --
 * throws and the inventory aborts. Computes a deterministic SHA-256 of the file bytes. No DB
 * connection is ever made here (pure file read), so snapshot mode cannot touch Supabase.
 */
export const SUPPORTED_SNAPSHOT_VERSION = 1

const fail = (m: string): never => {
  throw new Error(`snapshot: ${m}`)
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const rec = (v: unknown, ctx: string): Record<string, unknown> => (isObj(v) ? v : fail(`${ctx} must be a JSON object`))
const arr = (v: unknown, ctx: string): unknown[] => (Array.isArray(v) ? v : fail(`${ctx} must be a JSON array`))
const str = (v: unknown, ctx: string): string => (typeof v === 'string' && v.length > 0 ? v : fail(`${ctx} must be a non-empty string`))
const strN = (v: unknown, ctx: string): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : fail(`${ctx} must be a string or null`))
const tsN = (v: unknown, ctx: string): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return fail(`${ctx} must be a timestamp string or null`)
  if (Number.isNaN(Date.parse(v))) return fail(`${ctx} is a malformed timestamp: ${JSON.stringify(v)}`)
  return v
}
const arrN = (v: unknown, ctx: string): unknown => (v === null || v === undefined ? null : Array.isArray(v) ? v : fail(`${ctx} must be a JSON array or null`))
const objN = (v: unknown, ctx: string): unknown => (v === null || v === undefined ? null : isObj(v) ? v : fail(`${ctx} must be a JSON object or null`))

function dedupe(ids: string[], ctx: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) fail(`duplicate ${ctx} id: ${id}`)
    seen.add(id)
  }
}

export function loadSourceSnapshot(path: string): SourceSnapshot {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch {
    return fail(`cannot read snapshot file at ${path}`)
  }
  const sha256 = createHash('sha256').update(buf).digest('hex')

  let parsed: unknown
  try {
    parsed = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    return fail(`invalid JSON (${e instanceof Error ? e.message : 'parse error'})`)
  }
  const o = rec(parsed, 'root')
  if (o.snapshotVersion !== SUPPORTED_SNAPSHOT_VERSION) {
    return fail(`unsupported snapshotVersion ${JSON.stringify(o.snapshotVersion)} (supported: ${SUPPORTED_SNAPSHOT_VERSION})`)
  }
  const generatedAt = tsN(o.generatedAt, 'generatedAt') ?? fail('generatedAt is required')

  const authUsers: SrcAuthUser[] = arr(o.authUsers, 'authUsers').map((v, i) => {
    const r = rec(v, `authUsers[${i}]`)
    return {
      id: str(r.id, `authUsers[${i}].id`),
      email: strN(r.email, `authUsers[${i}].email`),
      emailConfirmedAt: tsN(r.emailConfirmedAt, `authUsers[${i}].emailConfirmedAt`),
      fullName: strN(r.fullName, `authUsers[${i}].fullName`),
      createdAt: tsN(r.createdAt, `authUsers[${i}].createdAt`),
    }
  })
  const teams: SrcTeam[] = arr(o.teams, 'teams').map((v, i) => {
    const r = rec(v, `teams[${i}]`)
    return {
      id: str(r.id, `teams[${i}].id`),
      name: str(r.name, `teams[${i}].name`),
      ownerUserId: strN(r.ownerUserId, `teams[${i}].ownerUserId`),
      createdAt: tsN(r.createdAt, `teams[${i}].createdAt`),
    }
  })
  const members: SrcMember[] = arr(o.members, 'members').map((v, i) => {
    const r = rec(v, `members[${i}]`)
    return {
      id: str(r.id, `members[${i}].id`),
      teamId: str(r.teamId, `members[${i}].teamId`),
      userId: str(r.userId, `members[${i}].userId`),
      role: str(r.role, `members[${i}].role`),
      status: str(r.status, `members[${i}].status`),
      email: strN(r.email, `members[${i}].email`),
      name: strN(r.name, `members[${i}].name`),
      invitedBy: strN(r.invitedBy, `members[${i}].invitedBy`),
      scopeType: str(r.scopeType, `members[${i}].scopeType`),
      scopeGroups: arrN(r.scopeGroups, `members[${i}].scopeGroups`),
      scopePhones: arrN(r.scopePhones, `members[${i}].scopePhones`),
      overrides: objN(r.overrides, `members[${i}].overrides`),
      joinedAt: tsN(r.joinedAt, `members[${i}].joinedAt`),
    }
  })
  const invites: SrcInvite[] = arr(o.invites, 'invites').map((v, i) => {
    const r = rec(v, `invites[${i}]`)
    return {
      id: str(r.id, `invites[${i}].id`),
      teamId: str(r.teamId, `invites[${i}].teamId`),
      email: str(r.email, `invites[${i}].email`),
      role: str(r.role, `invites[${i}].role`),
      token: str(r.token, `invites[${i}].token`),
      status: str(r.status, `invites[${i}].status`),
      invitedBy: strN(r.invitedBy, `invites[${i}].invitedBy`),
      createdAt: tsN(r.createdAt, `invites[${i}].createdAt`),
      expiresAt: tsN(r.expiresAt, `invites[${i}].expiresAt`),
      acceptedAt: tsN(r.acceptedAt, `invites[${i}].acceptedAt`),
    }
  })

  dedupe(authUsers.map((u) => u.id), 'authUsers')
  dedupe(teams.map((t) => t.id), 'teams')
  dedupe(members.map((m) => m.id), 'members')
  dedupe(invites.map((x) => x.id), 'invites')

  return {
    authUsers,
    teams,
    members,
    invites,
    mode: 'offline_snapshot',
    proof: null,
    roleProof: null,
    snapshotMeta: { version: SUPPORTED_SNAPSHOT_VERSION, generatedAt, sha256 },
  }
}
