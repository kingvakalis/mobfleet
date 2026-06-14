/**
 * Resource scopes. Permissions answer "may this action happen at all"; scopes
 * answer "on which resources". A Manager may have phones.view but only for
 * their selected groups.
 *
 * The backend (or, in this SPA, the data hooks) must filter queries by the
 * resolved scope — never fetch the whole workspace and hide rows client-side
 * for security. In the SPA we filter at the selector boundary and document
 * that the same predicate belongs in the server query.
 */

export type ScopeType =
  | 'workspace'        // entire workspace
  | 'assigned_groups'  // groups assigned to the membership
  | 'assigned_phones'  // phones assigned to the membership
  | 'self'             // only the member's own records

export interface AccessScope {
  type: ScopeType
  /** Group names in scope (for assigned_groups). */
  groups: string[]
  /** Phone names/ids in scope (for assigned_phones). */
  phones: string[]
}

export const SCOPE_LABELS: Record<ScopeType, string> = {
  workspace: 'Entire workspace',
  assigned_groups: 'Assigned groups',
  assigned_phones: 'Assigned phones',
  self: 'Own data only',
}

/** Does a phone (by group + name) fall within the scope? */
export function phoneInScope(scope: AccessScope, phone: { group?: string; name?: string; id?: string }): boolean {
  switch (scope.type) {
    case 'workspace':
      return true
    case 'assigned_groups':
      return phone.group ? scope.groups.includes(phone.group) : false
    case 'assigned_phones':
      return Boolean(
        (phone.name && scope.phones.includes(phone.name)) ||
        (phone.id && scope.phones.includes(phone.id)),
      )
    case 'self':
      return false
  }
}

export function groupInScope(scope: AccessScope, group: string): boolean {
  switch (scope.type) {
    case 'workspace':       return true
    case 'assigned_groups': return scope.groups.includes(group)
    case 'assigned_phones': return false
    case 'self':            return false
  }
}
