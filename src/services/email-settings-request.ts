/**
 * Pure request-builder for the email-settings POST. Kept import-free so it is
 * unit-testable in the Playwright `engine` project (no `@/` alias resolution).
 */
export interface UpdateTeamEmailSettingsRequest {
  senderEmail: string
  senderName: string
  resendApiKey?: string
}

/**
 * Build the POST body. Includes resendApiKey ONLY when the user typed a new,
 * non-masked key — never the masked display value (`••••…`) and never an empty
 * string (a blank key tells the server to PRESERVE the stored one).
 */
export function buildEmailSettingsUpdate(form: {
  senderName: string
  senderEmail: string
  newApiKey: string
}): UpdateTeamEmailSettingsRequest {
  const req: UpdateTeamEmailSettingsRequest = {
    senderName: form.senderName.trim(),
    senderEmail: form.senderEmail.trim(),
  }
  const key = form.newApiKey.trim()
  if (key.length > 0 && !key.includes('•')) req.resendApiKey = key
  return req
}
