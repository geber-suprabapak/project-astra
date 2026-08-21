import { z } from 'zod'

const commaSeparated = z.string().transform((s) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
)

const positiveInt = z.coerce.number().int().positive()

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: positiveInt.default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SERVICE_NAME: z.string().min(1).default('skanida-bff'),

    TENANT_KEY: z.string().min(1),
    TENANT_NAME: z.string().min(1),
    BUSINESS_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),

    CORS_ALLOWED_ORIGINS: commaSeparated.default(''),

    DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/astra'),
    DATABASE_MAX_CONNECTIONS: positiveInt.default(10),
    DATABASE_IDLE_TIMEOUT_SECONDS: positiveInt.default(30),
    DATABASE_CONNECT_TIMEOUT_SECONDS: positiveInt.default(5),
    DB_QUERY_TIMEOUT_MS: positiveInt.default(5000),

    S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1).default('minioadmin'),
    S3_SECRET_ACCESS_KEY: z.string().min(1).default('minioadmin'),
    S3_BUCKET_AVATARS: z.string().min(1).default('avatars'),
    S3_BUCKET_PERMITS: z.string().min(1).default('perizinan'),
    S3_FORCE_PATH_STYLE: z
      .union([z.boolean(), z.string().transform((s) => s.toLowerCase() === 'true')])
      .default(true),
    S3_PUBLIC_URL: z.string().url().optional(),
    STORAGE_UPLOAD_TIMEOUT_MS: positiveInt.default(15000),

    OIDC_ISSUER: z.string().min(1).optional(),
    OIDC_JWKS_URL: z.string().url().optional(),
    OIDC_JWT_SECRET: z.string().min(1).optional(),
    OIDC_AUDIENCE: z.string().min(1).default('authenticated'),
    LOGTO_ENDPOINT: z.string().url().optional(),
    LOGTO_APP_ID: z.string().min(1).optional(),
    LOGTO_APP_SECRET: z.string().min(1).optional(),
    AUTH_USER_ID: z.string().min(1).optional(),
    AUTH_EMAIL: z.string().min(1).optional(),

    ROBIN_BASE_URL: z.string().url(),
    ROBIN_READY_TIMEOUT_MS: positiveInt.default(3000),
    ROBIN_IDENTIFY_TIMEOUT_MS: positiveInt.default(30000),
    ROBIN_ENROLL_TIMEOUT_MS: positiveInt.default(60000),
    ROBIN_ENROLL_STATUS_TIMEOUT_MS: positiveInt.default(5000),
    ROBIN_SERVICE_TOKEN: z.string().min(1).default('dev-robin-service-token'),

    REDIS_URL: z.string().url().optional(),
    REDIS_KEY_PREFIX: z.string().min(1).default('astra:ratelimit'),
  })
  .superRefine((data, ctx) => {
    if (!data.OIDC_JWT_SECRET && !data.OIDC_JWKS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either OIDC_JWT_SECRET or OIDC_JWKS_URL must be provided',
        path: ['OIDC_JWT_SECRET'],
      })
    }

    if (data.NODE_ENV === 'production') {
      if (data.CORS_ALLOWED_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ALLOWED_ORIGINS must be set in production',
          path: ['CORS_ALLOWED_ORIGINS'],
        })
      }

      if (data.CORS_ALLOWED_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ALLOWED_ORIGINS cannot contain wildcard "*" in production',
          path: ['CORS_ALLOWED_ORIGINS'],
        })
      }

      if (!data.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'REDIS_URL must be set in production',
          path: ['REDIS_URL'],
        })
      }
      if (!data.OIDC_ISSUER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'OIDC_ISSUER must be set in production',
          path: ['OIDC_ISSUER'],
        })
      }
    }
  })

export function parseEnv(input: Record<string, string | undefined>) {
  return envSchema.safeParse(input)
}

const parsed = parseEnv(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
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

  databaseUrl: raw.DATABASE_URL,
  databaseMaxConnections: raw.DATABASE_MAX_CONNECTIONS,
  databaseIdleTimeoutSeconds: raw.DATABASE_IDLE_TIMEOUT_SECONDS,
  databaseConnectTimeoutSeconds: raw.DATABASE_CONNECT_TIMEOUT_SECONDS,
  dbQueryTimeoutMs: raw.DB_QUERY_TIMEOUT_MS,

  s3Endpoint: raw.S3_ENDPOINT,
  s3Region: raw.S3_REGION,
  s3AccessKeyId: raw.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: raw.S3_SECRET_ACCESS_KEY,
  s3BucketAvatars: raw.S3_BUCKET_AVATARS,
  s3BucketPermits: raw.S3_BUCKET_PERMITS,
  s3ForcePathStyle: raw.S3_FORCE_PATH_STYLE,
  s3PublicUrl: raw.S3_PUBLIC_URL,
  storageUploadTimeoutMs: raw.STORAGE_UPLOAD_TIMEOUT_MS,

  oidcIssuer: raw.OIDC_ISSUER,
  oidcJwksUrl: raw.OIDC_JWKS_URL,
  oidcJwtSecret: raw.OIDC_JWT_SECRET,
  oidcAudience: raw.OIDC_AUDIENCE,
  logtoEndpoint: raw.LOGTO_ENDPOINT,
  logtoAppId: raw.LOGTO_APP_ID,
  logtoAppSecret: raw.LOGTO_APP_SECRET,
  authUserId: raw.AUTH_USER_ID,
  authEmail: raw.AUTH_EMAIL,

  robinBaseUrl: raw.ROBIN_BASE_URL,
  robinReadyTimeoutMs: raw.ROBIN_READY_TIMEOUT_MS,
  robinIdentifyTimeoutMs: raw.ROBIN_IDENTIFY_TIMEOUT_MS,
  robinEnrollTimeoutMs: raw.ROBIN_ENROLL_TIMEOUT_MS,
  robinEnrollStatusTimeoutMs: raw.ROBIN_ENROLL_STATUS_TIMEOUT_MS,
  robinServiceToken: raw.ROBIN_SERVICE_TOKEN,

  redisUrl: raw.REDIS_URL,
  redisKeyPrefix: raw.REDIS_KEY_PREFIX,
} as const
