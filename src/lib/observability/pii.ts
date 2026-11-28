import { z } from 'zod'
import type { AuditLogDetails } from '../../providers/types.js'

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

const AUDIT_STRIP_PATTERN =
  /^(authorization|cookie|set_?cookie|x_?service_?token|x_?api_?key|password|new_?password|old_?password|current_?password|token|access_?token|refresh_?token|id_?token|jwt|secret|reset_?code|otp|code|latitude|longitude|image|image_?base64|images|embedding|embeddings|vector)$/i
const AUDIT_EMAIL_PATTERN = /^(email|previous_?email|new_?email)$/i
const AUDIT_LAST4_PATTERN = /^(phone|phone_?number|nik|nisn)$/i
const AUDIT_ADDRESS_PATTERN = /^(address|alamat)$/i

export type SanitizedAuditValue =
  | string
  | number
  | boolean
  | null
  | SanitizedAuditValue[]
  | { [key: string]: SanitizedAuditValue }

export type SanitizedAuditDetails = Record<string, SanitizedAuditValue>

const rawAuditValueSchema: z.ZodType<SanitizedAuditValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(rawAuditValueSchema),
    z.record(z.string(), rawAuditValueSchema),
  ]),
)
const rawAuditObjectSchema = z.record(z.string(), rawAuditValueSchema)

function maskEmailValue(value: string): string {
  const trimmed = value.trim()
  const atIndex = trimmed.indexOf('@')
  if (atIndex <= 0) return '[MASKED_EMAIL]'
  const local = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  return `${local.slice(0, 1)}***@${domain}`
}

function maskLast4Value(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '***'
  return `***${trimmed.slice(-4)}`
}

function parseAuditDetailsObject(
  raw: SanitizedAuditValue | undefined,
): SanitizedAuditDetails | null {
  if (raw == null) return null
  let current: SanitizedAuditValue = raw
  for (let pass = 0; pass < 2; pass++) {
    const strParsed = z.string().safeParse(current)
    if (!strParsed.success) break
    const trimmed = strParsed.data.trim()
    if (!trimmed) return null
    try {
      const jsonParsed = rawAuditValueSchema.safeParse(JSON.parse(trimmed))
      if (!jsonParsed.success) return { raw: sanitizeLogString(trimmed) }
      current = jsonParsed.data
    } catch {
      return { raw: sanitizeLogString(trimmed) }
    }
  }
  const objParsed = rawAuditObjectSchema.safeParse(current)
  if (objParsed.success) {
    return objParsed.data
  }
  const finalStr = z.string().safeParse(current)
  return { value: finalStr.success ? sanitizeLogString(finalStr.data) : current }
}

function sanitizeAuditValue(key: string, value: SanitizedAuditValue): SanitizedAuditValue {
  const normalizedKey = key.replace(/-/g, '_')
  if (AUDIT_STRIP_PATTERN.test(normalizedKey)) {
    return '[REDACTED]'
  }
  if (value === null) return null
  const strParsed = z.string().safeParse(value)
  if (strParsed.success) {
    if (AUDIT_EMAIL_PATTERN.test(normalizedKey)) return maskEmailValue(strParsed.data)
    if (AUDIT_LAST4_PATTERN.test(normalizedKey)) return maskLast4Value(strParsed.data)
    if (AUDIT_ADDRESS_PATTERN.test(normalizedKey)) return '[MASKED_ADDRESS]'
    return sanitizeLogString(strParsed.data)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(key, item))
  }
  const objParsed = rawAuditObjectSchema.safeParse(value)
  if (objParsed.success) {
    const nested: SanitizedAuditDetails = {}
    for (const [childKey, childVal] of Object.entries(objParsed.data)) {
      nested[childKey] = sanitizeAuditValue(childKey, childVal)
    }
    return nested
  }
  return value
}

export function sanitizeAuditLogDetails(
  details: AuditLogDetails | SanitizedAuditValue | undefined,
): SanitizedAuditDetails | null {
  const normalizedInput = rawAuditValueSchema.safeParse(details)
  const parsed = normalizedInput.success ? parseAuditDetailsObject(normalizedInput.data) : null
  if (!parsed) return null
  const sanitized: SanitizedAuditDetails = {}
  for (const [key, value] of Object.entries(parsed)) {
    sanitized[key] = sanitizeAuditValue(key, value)
  }
  return sanitized
}
