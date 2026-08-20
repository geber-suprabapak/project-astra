import { SignJWT } from 'jose'

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    if (!current.startsWith('--')) continue

    const key = current.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args.set(key, true)
      continue
    }

    args.set(key, next)
    i += 1
  }
  return args
}

function asString(value: string | boolean | undefined): string | null {
  if (value === true || value === false || value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const args = parseArgs(process.argv.slice(2))
const userId = asString(args.get('user-id')) ?? Bun.env.AUTH_USER_ID?.trim() ?? 'test-student-1'
const email = asString(args.get('email')) ?? Bun.env.AUTH_EMAIL?.trim() ?? 'student@sekolah.sch.id'
const role = asString(args.get('role')) ?? 'student'
const secretKey =
  asString(args.get('secret')) ??
  Bun.env.OIDC_JWT_SECRET?.trim() ??
  'test-jwt-secret-that-is-long-enough-32-chars'
const audience = asString(args.get('audience')) ?? Bun.env.OIDC_AUDIENCE?.trim() ?? 'authenticated'
const issuer = asString(args.get('issuer')) ?? Bun.env.OIDC_ISSUER?.trim() ?? 'https://auth.school.test'

const secret = new TextEncoder().encode(secretKey)

const token = await new SignJWT({
  email,
  role,
  name: 'Test Student',
})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(userId)
  .setAudience(audience)
  .setIssuer(issuer)
  .setIssuedAt()
  .setExpirationTime('24h')
  .sign(secret)

if (args.get('json') === true) {
  console.log(
    JSON.stringify(
      {
        access_token: token,
        token_type: 'Bearer',
        expires_in: 86400,
        user_id: userId,
        email,
        role,
      },
      null,
      2,
    ),
  )
} else {
  console.log(token)
}
