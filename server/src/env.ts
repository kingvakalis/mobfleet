import 'dotenv/config'

function str(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}

export const env = {
  port: Number(str('PORT', '8787')),
  databaseUrl: str('DATABASE_URL', 'file:./dev.db'),
  allowedOrigin: str('ALLOWED_ORIGIN', '*'),
  provider: str('PROVIDER', 'simulated') as 'simulated' | 'corellium' | 'geelark',
}
