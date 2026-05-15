import { z } from 'zod'

const commaSeparated = z
  .string()
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))

const positiveInt = z.coerce.number().int().positive()

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: positiveInt.default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SERVICE_NAME: z.string().min(1).default('skanida-bff'),

    TENANT_KEY: z.string().min(1),
    TENANT_NAME: z.string().min(1),
    BUSINESS_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),

    CORS_ALLOWED_ORIGINS: commaSeparated.default(''),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_JWT_SECRET: z.string().min(1).optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_ISSUER: z.string().min(1),
    SUPABASE_JWT_AUDIENCE: z.string().min(1).default('authenticated'),
    SUPABASE_STORAGE_BUCKET_AVATARS: z.string().min(1).default('avatars'),
    SUPABASE_STORAGE_BUCKET_PERMITS: z.string().min(1).default('perizinan'),

    ROBIN_BASE_URL: z.string().url(),
    ROBIN_READY_TIMEOUT_MS: positiveInt.default(3000),
    ROBIN_IDENTIFY_TIMEOUT_MS: positiveInt.default(30000),
    ROBIN_ENROLL_TIMEOUT_MS: positiveInt.default(60000),
    ROBIN_ENROLL_STATUS_TIMEOUT_MS: positiveInt.default(5000),
    SUPABASE_QUERY_TIMEOUT_MS: positiveInt.default(5000),
    SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS: positiveInt.default(15000),
  })
  .superRefine((data, ctx) => {
    if (!data.SUPABASE_JWT_SECRET && !data.SUPABASE_JWKS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL must be provided',
        path: ['SUPABASE_JWT_SECRET'],
      })
    }
  })

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  console.error(`[config] Invalid environment variables:\n${issues}`)
  process.exit(1)
}

const raw = parsed.data

export const env = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  serviceName: raw.SERVICE_NAME,
  tenantKey: raw.TENANT_KEY,
  tenantName: raw.TENANT_NAME,
  businessTimezone: raw.BUSINESS_TIMEZONE,
  corsAllowedOrigins: raw.CORS_ALLOWED_ORIGINS,
  supabaseUrl: raw.SUPABASE_URL,
  supabaseAnonKey: raw.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
  supabaseJwtSecret: raw.SUPABASE_JWT_SECRET,
  supabaseJwksUrl: raw.SUPABASE_JWKS_URL,
  supabaseJwtIssuer: raw.SUPABASE_JWT_ISSUER,
  supabaseJwtAudience: raw.SUPABASE_JWT_AUDIENCE,
  supabaseBucketAvatars: raw.SUPABASE_STORAGE_BUCKET_AVATARS,
  supabaseBucketPermits: raw.SUPABASE_STORAGE_BUCKET_PERMITS,
  robinBaseUrl: raw.ROBIN_BASE_URL,
  robinReadyTimeoutMs: raw.ROBIN_READY_TIMEOUT_MS,
  robinIdentifyTimeoutMs: raw.ROBIN_IDENTIFY_TIMEOUT_MS,
  robinEnrollTimeoutMs: raw.ROBIN_ENROLL_TIMEOUT_MS,
  robinEnrollStatusTimeoutMs: raw.ROBIN_ENROLL_STATUS_TIMEOUT_MS,
  supabaseQueryTimeoutMs: raw.SUPABASE_QUERY_TIMEOUT_MS,
  supabaseStorageUploadTimeoutMs: raw.SUPABASE_STORAGE_UPLOAD_TIMEOUT_MS,
} as const
