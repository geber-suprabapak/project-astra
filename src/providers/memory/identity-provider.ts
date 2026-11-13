import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { isMfaVerified } from '../identity/claims.js'
import {
  identityRoleSchema,
  type CreateStudentIdentityParams,
  type IdentityProvider,
  type IdentityRole,
  type IdentityUser,
  type UserMetadata,
} from '../types.js'

const identityTokenPayloadSchema = z
  .object({
    sub: z.string().min(1),
    iat: z.number().int().nonnegative().optional(),
    email: z.string().nullable().optional(),
    roles: z.array(identityRoleSchema).optional(),
    scope: z.string().min(1).optional(),
    amr: z.array(z.string().min(1)).optional(),
    mfa_verified: z.boolean().optional(),
    must_change_password: z.boolean().optional(),
  })
  .passthrough()

export class MemoryIdentityProvider implements IdentityProvider {
  public users = new Map<string, IdentityUser>()
  public passwords = new Map<string, string>()
  public revokedUsers = new Set<string>()
  public suspendedUsers = new Set<string>()
  public revokedSessions = new Set<string>()
  public isHealthy = true

  async createStudentIdentity(params: CreateStudentIdentityParams): Promise<{ userId: string }> {
    for (const [existingUserId, existingUser] of this.users.entries()) {
      if (existingUser.email === params.email && this.suspendedUsers.has(existingUserId)) {
        this.users.set(existingUserId, {
          ...existingUser,
          roles: [...(params.roles ?? ['student'])],
        })
        if (params.password) {
          this.passwords.set(params.email, params.password)
        }
        return { userId: existingUserId }
      }
    }

    const userId = `student-identity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    this.users.set(userId, {
      userId,
      email: params.email,
      roles: [...(params.roles ?? ['student'])],
      scopes: ['openid', 'profile'],
      mfaVerified: false,
      mustChangePassword: false,
    })
    if (params.password) {
      this.passwords.set(params.email, params.password)
    }
    if (params.suspended !== false) {
      this.suspendedUsers.add(userId)
    }
    return { userId }
  }

  async setUserSuspended(userId: string, suspended: boolean): Promise<void> {
    if (suspended) {
      this.suspendedUsers.add(userId)
    } else {
      this.suspendedUsers.delete(userId)
    }
  }

  async assignUserRole(userId: string, role: IdentityRole): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.roles = [...new Set([...(user.roles ?? []), role])]
      this.users.set(userId, user)
    }
  }

  async revokeUserRole(userId: string, role: IdentityRole): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.roles = (user.roles ?? []).filter((assignedRole) => assignedRole !== role)
      this.users.set(userId, user)
    }
  }

  async updateUserEmail(userId: string, email: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.email = email
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const user = this.users.get(userId)
    if (user?.email) {
      this.passwords.delete(user.email)
    }
    this.passwords.delete(userId)
    this.users.delete(userId)
    this.suspendedUsers.add(userId)
    this.revokedUsers.add(userId)
    this.revokedSessions.add(userId)
  }

  async verifyToken(token: string): Promise<IdentityUser> {
    if (!token || token === 'invalid' || token === 'invalid.jwt.token') {
      throw AppError.authInvalid()
    }

    if (token.startsWith('user-')) {
      return {
        userId: token,
        roles: ['student'],
        scopes: ['openid', 'profile'],
        mfaVerified: false,
        mustChangePassword: false,
      }
    }

    try {
      if (token.includes('.')) {
        const parts = token.split('.')
        const rawPayload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        const parsedPayload = identityTokenPayloadSchema.safeParse(rawPayload)
        if (parsedPayload.success) {
          const { data } = parsedPayload
          return {
            userId: data.sub,
            issuedAt: data.iat,
            email: data.email,
            roles: data.roles ?? [],
            scopes: data.scope?.split(' ').filter(Boolean) ?? [],
            mfaVerified: isMfaVerified(data.mfa_verified, data.amr),
            mustChangePassword: data.must_change_password,
          }
        }
      }
    } catch {
      // Fall through to the plain mock token path.
    }

    return {
      userId: token,
      roles: ['student'],
      scopes: ['openid', 'profile'],
      mfaVerified: false,
      mustChangePassword: false,
    }
  }

  async verifyPassword(email: string, password: string): Promise<void> {
    const stored = this.passwords.get(email)
    if (stored && stored !== password) {
      throw AppError.authInvalid('Current password is incorrect.')
    }
    if (!password || password.length < 6) {
      throw AppError.authInvalid('Current password is incorrect.')
    }
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    this.passwords.set(userId, newPassword)
    const user = this.users.get(userId)
    if (user?.email) {
      this.passwords.set(user.email, newPassword)
    }
  }

  async updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void> {
    const existing = this.users.get(userId)
    if (existing) {
      this.users.set(userId, { ...existing, ...metadata })
    }
  }

  async createCmsIdentity(params: {
    email: string
    fullName: string
    password: string
  }): Promise<{ userId: string }> {
    if ([...this.users.values()].some((user) => user.email === params.email))
      throw AppError.conflict('Identity already exists.')
    const userId = randomUUID()
    this.users.set(userId, {
      userId,
      email: params.email,
      authSource: 'logto',
      scopes: ['cms:access'],
    })
    this.passwords.set(params.email, params.password)
    await this.setUserSuspended(userId, true)
    return { userId }
  }

  async createStaffIdentity(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }> {
    const userId = `staff-identity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // SAFETY: role string cast to IdentityRole array
    const role = params.role as NonNullable<IdentityUser['roles']>[number]
    this.users.set(userId, {
      userId,
      email: params.email,
      roles: [role],
      scopes: ['openid', 'profile', 'admin:read'],
      mfaVerified: true,
      mustChangePassword: false,
    })
    if (params.password) {
      this.passwords.set(params.email, params.password)
    }
    return { userId, email: params.email }
  }

  async requestPasswordResetEmail(email: string): Promise<void> {
    let found = false
    for (const u of this.users.values()) {
      if (u.email === email) {
        found = true
        break
      }
    }
    if (!found) {
      // Simulate silent success
    }
  }

  async revokeUserSessions(userId: string): Promise<void> {
    this.revokedUsers.add(userId)
    this.revokedSessions.add(userId)
  }

  async assignRoles(userId: string, roles: string[]): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      // SAFETY: string roles cast to IdentityRole array
      user.roles = roles as IdentityUser['roles']
      this.users.set(userId, user)
    }
  }

  async checkHealth(): Promise<boolean> {
    return this.isHealthy
  }
}
