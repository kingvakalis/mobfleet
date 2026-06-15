import { ackCommand } from './agent-commands'
import { broadcastCommandLog } from './command-log-hub'
import { formatCommandLog, commandTypeForAction } from '../../src/shared/control-command'
import type { AgentCommandAction, CommandResultBody } from '../../src/shared/schemas'

/**
 * Stage 2 of the command-log lifecycle: COMPLETION. The queue-acceptance log
 * (stage 1, in routes.ts) is unchanged; this adds the follow-up "✓ / ✗" log when
 * the agent reports a result, shared by the WS + HTTP ack paths so the text and
 * broadcast stay identical.
 */

/** Max length of the failure suffix appended to a completion log line. */
const MAX_ERROR_LEN = 200

/** Replace ASCII control chars (incl. CR/LF/tab + DEL) with a space, so a failure
 *  message can't inject newlines/control bytes into the broadcast log line. */
function stripControlChars(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    out += c < 0x20 || c === 0x7f ? ' ' : ch
  }
  return out
}

/**
 * Build a short, SAFE failure message from a validated CommandResultBody: prefer
 * error.message, then error.code, else a generic fallback. Strips control chars,
 * collapses whitespace, and length-limits. Never exposes stack traces, secrets,
 * or command payloads (those are not part of result.error).
 */
export function formatCommandResultError(result: CommandResultBody): string {
  const raw = result.error?.message ?? result.error?.code ?? ''
  const cleaned = stripControlChars(String(raw)).replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'Command failed'
  return cleaned.length > MAX_ERROR_LEN ? `${cleaned.slice(0, MAX_ERROR_LEN - 1)}…` : cleaned
}

/** The completion log line: the SAME base text as the queue-acceptance log,
 *  suffixed with " ✓" on success or " ✗ <safe error>" on failure. */
export function completionLogText(baseText: string, result: CommandResultBody): string {
  return result.success ? `${baseText} ✓` : `${baseText} ✗ ${formatCommandResultError(result)}`
}

/**
 * Persist the agent's command result (via ackCommand) and — ONLY when this ack
 * caused a new terminal transition ('updated') — broadcast a team-scoped
 * completion command_log. Idempotent: a duplicate/retried ack ('noop') never
 * re-broadcasts. The DB row is authoritative for teamId/deviceId/command, so an
 * agent-supplied team/device id cannot redirect the broadcast. A broadcast
 * failure never rolls back the (already-committed) acknowledgement.
 */
export async function acknowledgeCommandResult(input: {
  teamId: string
  deviceId: string
  commandId: string
  result: CommandResultBody
  now: number
}): Promise<{ outcome: 'updated' | 'noop' | 'missing' }> {
  // One authoritative mapping: success → acked, failure → failed. The agent's
  // `success` boolean decides the status; never a separate status string.
  const status: 'acked' | 'failed' = input.result.success ? 'acked' : 'failed'
  const { outcome, command } = await ackCommand(
    input.teamId,
    input.deviceId,
    input.commandId,
    status,
    input.result.error?.message,
    input.now,
    input.result,
  )
  if (outcome === 'updated' && command) {
    try {
      const action = command.action as AgentCommandAction
      const base = formatCommandLog(action, (command.payload ?? undefined) as Record<string, unknown> | undefined)
      broadcastCommandLog(command.teamId, {
        type: 'command_log',
        deviceId: command.deviceId,
        entry: {
          ts: input.now,
          text: completionLogText(base, input.result),
          commandType: commandTypeForAction(action),
          success: input.result.success,
        },
      })
      console.log(JSON.stringify({
        event: 'command.completed',
        teamId: command.teamId,
        deviceId: command.deviceId,
        commandId: input.commandId,
        action: command.action,
        status,
        success: input.result.success,
        durationMs: input.result.durationMs ?? null,
      }))
    } catch (err) {
      // Persistence already committed — a broadcast failure must not undo it.
      console.error(JSON.stringify({
        event: 'command.completed.broadcast_error',
        teamId: command.teamId,
        commandId: input.commandId,
        error: err instanceof Error ? err.message : 'error',
      }))
    }
  }
  return { outcome }
}
