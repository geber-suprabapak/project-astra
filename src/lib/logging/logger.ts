import pino from 'pino'

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: {
    service: process.env['SERVICE_NAME'] ?? 'skanida-bff',
    tenantKey: process.env['TENANT_KEY'] ?? 'unknown',
  },
  redact: {
    paths: ['*.password', '*.token', '*.access_token', '*.image_base64'],
    censor: '[REDACTED]',
  },
})

export type Logger = typeof logger
