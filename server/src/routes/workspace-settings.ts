import type { FastifyInstance } from 'fastify'
import { ctx, requirePermission } from '../auth/context'
import { logAudit } from '../auth/db'
import { HttpError } from '../http-error'
import {
  workspaceSettingsPatch,
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  applyWorkspaceSettingsPatch,
} from '../workspace-settings'

/**
 * Team-scoped workspace settings API (the server-authoritative home for the SPA's
 * WorkspaceSettings contract).
 *
 * AUTH:
 *  - GET requires `settings.view`.
 *  - POST requires `settings.edit_workspace` (the workspace-identity/operator-defaults
 *    edit permission). Appearance-only fields ride the same edit endpoint; the finer
 *    `settings.edit_appearance` key exists for UI gating but the persistence write is a
 *    single blob, so edit_workspace governs the save. No NEW permission keys are added.
 *
 * The acting team is the AUTHENTICATED team (ctx().teamId); a client never passes a
 * teamId, so cross-team read/write is impossible. The settings blob is never a secret.
 *
 *   GET  /v1/settings/workspace -> { settings: WorkspaceSettings }   (settings.view)
 *   POST /v1/settings/workspace -> { settings: WorkspaceSettings }   (settings.edit_workspace)
 */
export function registerWorkspaceSettingsRoutes(app: FastifyInstance) {
  app.get('/v1/settings/workspace', async (req) => {
    requirePermission(req, 'settings.view')
    const c = ctx(req)
    let settings
    try {
      settings = await loadWorkspaceSettings(c.teamId)
    } catch {
      throw new HttpError(500, 'could not load workspace settings')
    }
    return { settings }
  })

  app.post('/v1/settings/workspace', async (req) => {
    requirePermission(req, 'settings.edit_workspace')
    const c = ctx(req)
    const patch = workspaceSettingsPatch.parse(req.body)
    let settings
    try {
      const current = await loadWorkspaceSettings(c.teamId)
      const next = applyWorkspaceSettingsPatch(current, patch)
      settings = await saveWorkspaceSettings(c.teamId, next, Date.now())
    } catch {
      throw new HttpError(500, 'could not save workspace settings')
    }
    await logAudit({
      teamId: c.teamId,
      actorId: c.userId,
      action: 'settings.workspace.update',
      result: 'allowed',
      detail: Object.keys(patch).join(','),
    })
    return { settings }
  })
}
