import { useToastStore } from '@/state/toast-store'

/**
 * Fire-and-forget guard for provider mutations.
 *
 * UI handlers frequently dispatch a provider call without awaiting it
 * (`void client.start(id)`). If that promise rejects there is no catch, so it
 * becomes an unhandled rejection: a console error and — worse — zero feedback
 * to the operator, who is left believing the action succeeded.
 *
 * `safe()` wraps such a call: it swallows the rejection, logs it for
 * diagnostics, and surfaces a toast so the failure is visible. Use it anywhere
 * a `void client.X()` previously stood.
 */
export function safe<T>(p: Promise<T>, message = 'Action failed — please try again'): void {
  void p.catch((err) => {
    console.error('[provider]', message, err)
    useToastStore.getState().addToast(message, 'error')
  })
}
