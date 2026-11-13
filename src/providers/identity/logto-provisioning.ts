import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type { CreateStudentIdentityParams, IdentityRole } from '../types.js'
import type { LogtoManagementClient } from './logto-client.js'

type LogtoCreateUserPayload = {
  username?: string
  primaryEmail: string
  password?: string
  name?: string
  isSuspended: boolean
  customData: { nis?: string }
}

export async function createCmsIdentity(
  client: LogtoManagementClient,
  params: { email: string; fullName: string; password: string },
): Promise<{ userId: string }> {
  const roleName = client.cmsAccessRoleName
  if (!client.isConfigured() || !roleName) {
    throw AppError.dependencyUnavailable('CMS identity provisioning')
  }
  const baseUrl = client.requireBaseUrl()
  const token = await client.getManagementToken()
  const roleIds = await client.getRoleIds([roleName], token)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const response = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    body: JSON.stringify({
      primaryEmail: params.email,
      name: params.fullName,
      password: params.password,
      isSuspended: true,
    }),
  })
  if ([409, 422].includes(response.status)) {
    throw AppError.conflict(
      'Identity could not be created; verify the email and password policy. Existing identities are never claimed automatically.',
    )
  }
  if (!response.ok) throw AppError.dependencyUnavailable('CMS identity provisioning')
  const { id } = z.object({ id: z.string().min(1) }).parse(await response.json())
  const assigned = await fetch(`${baseUrl}/api/users/${encodeURIComponent(id)}/roles`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    body: JSON.stringify({ roleIds }),
  })
  if (!assigned.ok) {
    logger.error(
      { userId: id, status: assigned.status },
      'CMS identity remains suspended after role assignment failure',
    )
    throw AppError.dependencyUnavailable('CMS identity provisioning')
  }
  return { userId: id }
}

export async function createStaffIdentity(
  client: LogtoManagementClient,
  params: { email: string; fullName: string; role: string; password?: string },
): Promise<{ userId: string; email: string }> {
  if (!client.isConfigured()) {
    return {
      userId: `logto-staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email: params.email,
    }
  }

  try {
    const baseUrl = client.requireBaseUrl()
    const token = await client.getManagementToken()
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        primaryEmail: params.email,
        name: params.fullName,
        password: params.password,
        customData: { role: params.role },
      }),
    })
    if (!response.ok) {
      logger.error({ status: response.status, email: params.email }, 'Logto create user failed')
      if (response.status === 409 || response.status === 422) {
        throw AppError.conflict(`Identity already exists for email "${params.email}".`)
      }
      throw AppError.internal('Failed to create user in identity provider.')
    }
    // SAFETY: response JSON contains id from Logto user creation
    const data = (await response.json()) as { id: string }
    return { userId: data.id, email: params.email }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, email: params.email }, 'Logto create user error')
    throw AppError.internal('Failed to create user in identity provider.')
  }
}

export async function assignRoles(
  client: LogtoManagementClient,
  userId: string,
  roles: readonly string[],
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const roleIds = await client.getRoleIds(roles, token)
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roleIds }),
    })
    if (!response.ok) throw AppError.internal('Failed to assign roles in identity provider.')
  } catch (err) {
    logger.warn({ err, userId, roles }, 'Logto role assignment error')
    throw AppError.internal('Failed to assign roles in identity provider.')
  }
}

export async function createStudentIdentity(
  client: LogtoManagementClient,
  params: CreateStudentIdentityParams,
): Promise<{ userId: string }> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const userPayload: LogtoCreateUserPayload = {
      primaryEmail: params.email,
      password: params.password,
      name: params.name,
      isSuspended: params.suspended ?? true,
      customData: params.username ? { nis: params.username } : {},
    }

    if (params.username && !/^\d+$/.test(params.username)) {
      userPayload.username = params.username
    }

    let userId: string | null = null
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(userPayload),
    })

    if (response.ok) {
      // SAFETY: Logto user creation response contains an id field.
      const data = (await response.json()) as { id: string }
      userId = data.id
    } else if (response.status === 409 || response.status === 422) {
      const searchRes = await fetch(
        `${baseUrl}/api/users?search.primaryEmail=${encodeURIComponent(params.email)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ).catch(() => null)
      if (searchRes?.ok) {
        // SAFETY: Logto Management API /api/users search returns a JSON array of user records
        const candidates = (await searchRes.json()) as Array<{
          id: string
          primaryEmail?: string | null
          isSuspended?: boolean
          customData?: { nis?: string }
        }>
        const match = candidates.find(
          (u) =>
            u.primaryEmail === params.email &&
            (!params.username || u.customData?.nis === params.username),
        )
        if (match) {
          userId = match.id
        }
      }
    }

    if (!userId) {
      throw AppError.internal('Failed to create student identity in identity provider.')
    }

    await assignRoles(client, userId, params.roles ?? ['student'])
    return { userId }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, username: params.username }, 'Logto create student identity error')
    throw AppError.internal('Failed to create student identity in identity provider.')
  }
}

export async function assignUserRole(
  client: LogtoManagementClient,
  userId: string,
  role: IdentityRole,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const roleIds = await client.getRoleIds([role], token)
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}/roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roleIds }),
    })
    if (!response.ok) {
      throw AppError.internal('Failed to assign role in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId, role }, 'Logto assign user role error')
    throw AppError.internal('Failed to assign role in identity provider.')
  }
}

export async function revokeUserRole(
  client: LogtoManagementClient,
  userId: string,
  role: IdentityRole,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const [roleId] = await client.getRoleIds([role], token)
    const response = await fetch(
      `${baseUrl}/api/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    )
    if (!response.ok && response.status !== 404) {
      throw AppError.internal('Failed to revoke role in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId, role }, 'Logto revoke user role error')
    throw AppError.internal('Failed to revoke role in identity provider.')
  }
}
