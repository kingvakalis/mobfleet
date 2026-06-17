// Type declarations for the ESM ops inventory tool (prod-readiness-inventory.mjs), so
// the unit test (src/inventory-tls.test.ts) type-checks under `tsc --noEmit` without
// enabling allowJs. The .mjs file is the source of truth. Importing the module does NOT
// connect to any database (the runner is guarded by isMain()).

/** Redact any connection URL from an error/string — never leaks credentials. */
export function SAFE(e: unknown): string

/** Build the pg.Client config from a URL; TLS derived from sslmode (strict by default). */
export function pgClientConfig(url: string): Record<string, unknown> & { ssl?: unknown }

/** True only when TLS verification is explicitly relaxed (sslmode=no-verify). */
export function isRelaxedTls(url: string): boolean
