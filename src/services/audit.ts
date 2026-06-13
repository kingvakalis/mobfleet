import { create } from 'zustand'

/**
 * Security audit log. Records authorization-relevant events (role/permission/
 * scope changes, suspensions, sensitive reveals, ownership, settings).
 *
 * Session-scoped + capped in the SPA. BACKEND INTEGRATION POINT: these events
 * are the contract for an append-only, immutable server audit table — normal
 * employees must not be able to delete history once the backend exists.
 */

export type AuditAction =
  | 'role.changed' | 'permission.granted' | 'permission.denied' | 'permission.inherited'
  | 'scope.changed' | 'employee.suspended' | 'employee.reinstated' | 'employee.removed'
  | 'employee.invited' | 'account.password_revealed' | 'account.recovery_revealed'
  | 'account.created' | 'account.updated' | 'account.deleted' | 'accounts.imported'
  | 'accounts.exported' | 'phone.command' | 'phone.rebooted' | 'phone.retired'
  | 'automation.run' | 'automation.edited' | 'automation.deleted' | 'job.cancelled' | 'job.retried'
  | 'settings.changed' | 'ownership.transferred' | 'acting.switched'

export interface AuditEvent {
  id: string
  ts: number
  actor: string
  action: AuditAction
  target?: string
  detail?: string
  result: 'success' | 'denied'
}

interface AuditState {
  events: AuditEvent[]
  log: (e: Omit<AuditEvent, 'id' | 'ts'>) => void
}

let seq = 0

export const useAudit = create<AuditState>((set) => ({
  events: [],
  log: (e) =>
    set((s) => ({
      events: [{ ...e, id: `audit-${seq++}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now() }, ...s.events].slice(0, 300),
    })),
}))

/** Imperative logger for non-React call sites. */
export function logAudit(e: Omit<AuditEvent, 'id' | 'ts'>) {
  useAudit.getState().log(e)
}

export const AUDIT_LABEL: Record<AuditAction, string> = {
  'role.changed': 'Role changed',
  'permission.granted': 'Permission granted',
  'permission.denied': 'Permission denied',
  'permission.inherited': 'Permission reset to inherit',
  'scope.changed': 'Resource scope changed',
  'employee.suspended': 'Employee suspended',
  'employee.reinstated': 'Employee reinstated',
  'employee.removed': 'Employee removed',
  'employee.invited': 'Employee invited',
  'account.password_revealed': 'Password revealed',
  'account.recovery_revealed': 'Recovery data revealed',
  'account.created': 'Account created',
  'account.updated': 'Account updated',
  'account.deleted': 'Account deleted',
  'accounts.imported': 'Accounts imported',
  'accounts.exported': 'Accounts exported',
  'phone.command': 'Phone command',
  'phone.rebooted': 'Phone rebooted',
  'phone.retired': 'Phone retired',
  'automation.run': 'Automation run',
  'automation.edited': 'Automation edited',
  'automation.deleted': 'Automation deleted',
  'job.cancelled': 'Job cancelled',
  'job.retried': 'Job retried',
  'settings.changed': 'Settings changed',
  'ownership.transferred': 'Ownership transferred',
  'acting.switched': 'Acting user switched',
}
