import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'

export interface LogtoManagementConfig {
  logtoEndpoint?: string
  logtoAppId?: string
  logtoAppSecret?: string
  logtoCmsAccessRoleName?: string
}

export class LogtoManagementClient {
  private m2mToken: string | null = null
  private m2mTokenExpiresAt = 0

  constructor(private readonly config: LogtoManagementConfig) {}

  get cmsAccessRoleName(): string | undefined {
    return this.config.logtoCmsAccessRoleName
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.logtoEndpoint && this.config.logtoAppId && this.config.logtoAppSecret,
    )
  }

  requireBaseUrl(): string {
    if (!this.config.logtoEndpoint || !this.config.logtoAppId || !this.config.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }
    return this.config.logtoEndpoint.replace(/\/$/, '')
  }

  async getManagementToken(): Promise<string> {
    if (!this.config.logtoEndpoint || !this.config.logtoAppId || !this.config.logtoAppSecret) {
      throw AppError.internal('Identity provider management API is not configured.')
    }

    if (this.m2mToken && Date.now() < this.m2mTokenExpiresAt - 60000) {
      return this.m2mToken
    }

    const credentials = Buffer.from(
      `${this.config.logtoAppId}:${this.config.logtoAppSecret}`,
    ).toString('base64')
    const response = await fetch(`${this.config.logtoEndpoint.replace(/\/$/, '')}/oidc/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&resource=https://default.logto.app/api&scope=all',
    })

    if (!response.ok) {
      logger.error({ status: response.status }, 'Failed to fetch Logto management token')
      throw AppError.internal('Failed to authenticate with identity provider management API.')
    }

    // SAFETY: Successful Logto token responses contain a string access_token and optional expires_in.
    const data = (await response.json()) as { access_token: string; expires_in?: number }
    this.m2mToken = data.access_token
    this.m2mTokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000
    return this.m2mToken
  }

  async getRoleIds(names: readonly string[], token: string): Promise<string[]> {
    const baseUrl = this.config.logtoEndpoint?.replace(/\/$/, '')
    const ids = new Map<string, string>()
    for (let page = 1; names.some((name) => !ids.has(name)); page++) {
      const response = await fetch(`${baseUrl}/api/roles?type=User&page_size=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      })
      if (!response.ok) throw AppError.internal('Failed to retrieve identity provider roles.')
      const roles = z
        .array(z.object({ id: z.string(), name: z.string() }))
        .parse(await response.json())
      for (const role of roles) ids.set(role.name, role.id)
      if (roles.length < 100) break
    }
    return names.map((name) => {
      const id = ids.get(name)
      if (!id) throw AppError.internal(`Identity provider role is not configured: ${name}`)
      return id
    })
  }
}
