import { z } from 'zod'

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-service-token|x-api-key|password|new_?password|old_?password|current_?password|token|access_?token|refresh_?token|id_?token|jwt|secret|reset_?code|otp|code|email|phone|phone_?number|nik|nisn|address|alamat|full_?name|student_?name|image|image_?base64|images|embedding|embeddings|vector)$/i

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const DATA_URI_IMAGE_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{128,}={0,2}\b/g
const UUID_SEGMENT_PATTERN =
  /\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/g
const NUMERIC_ID_SEGMENT_PATTERN = /\/\d{4,}(?=\/|$)/g

const BASE_SENSITIVE_FIELDS = [
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'x-service-token',
  'password',
  'newPassword',
  'oldPassword',
  'currentPassword',
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'id_token',
  'idToken',
  'jwt',
  'secret',
  'resetCode',
  'otp',
  'email',
  'phone',
  'phoneNumber',
  'phone_number',
  'nik',
  'nisn',
  'address',
  'alamat',
  'fullName',
  'full_name',
  'studentName',
  'student_name',
  'image',
  'image_base64',
  'imageBase64',
  'images',
  'embedding',
  'embeddings',
  'vector',
] as const

export const PINO_REDACT_PATHS: string[] = [
  ...BASE_SENSITIVE_FIELDS,
  ...BASE_SENSITIVE_FIELDS.map((field) => `*.${field}`),
  ...BASE_SENSITIVE_FIELDS.map((field) => `*.*.${field}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.Authorization',
  'headers.cookie',
  'headers.Cookie',
  'headers["set-cookie"]',
  'headers["Set-Cookie"]',
  'params.code',
  'payload.code',
]

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function sanitizeLogString(value: string): string {
  return value
    .replace(DATA_URI_IMAGE_PATTERN, '[REDACTED_IMAGE]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(LONG_BASE64_PATTERN, '[REDACTED_BASE64]')
}

export function sanitizePathWithoutQuery(rawPath: string): string {
  const withoutQuery = rawPath.split('?')[0] ?? '/'
  return withoutQuery
    .replace(UUID_SEGMENT_PATTERN, '/:id')
    .replace(NUMERIC_ID_SEGMENT_PATTERN, '/:id')
}

export function sanitizeRouteLabel(route: string | undefined): string {
  if (!route) return 'unmatched'
  const withoutQuery = route.split('?')[0]?.trim() ?? ''
  if (!withoutQuery || withoutQuery === '*') return 'unmatched'
  return withoutQuery
    .replace(UUID_SEGMENT_PATTERN, '/:id')
    .replace(NUMERIC_ID_SEGMENT_PATTERN, '/:id')
}

export type SafeSpanAttributeValue = string | number | boolean
export interface SafeSpanAttributes {
  [key: string]: SafeSpanAttributeValue
}

export function filterSafeSpanAttributes(attributes: SafeSpanAttributes): SafeSpanAttributes {
  const safe: SafeSpanAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveKey(key)) continue
    const parsedString = z.string().safeParse(value)
    safe[key] = parsedString.success ? sanitizeLogString(parsedString.data) : value
  }
  return safe
}
