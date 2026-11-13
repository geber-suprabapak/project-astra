import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import { logger } from '../../lib/logging/logger.js'
import type { UserMetadata } from '../types.js'
import type { LogtoManagementClient } from './logto-client.js'

export async function verifyPassword(
  client: LogtoManagementClient,
  email: string,
  password: string,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const response = await fetch(`${baseUrl}/api/interaction/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      throw AppError.authInvalid('Current password is incorrect.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, email }, 'Logto password verification failed with error')
    throw AppError.authInvalid('Current password is incorrect.')
  }
}

export async function updatePassword(
  client: LogtoManagementClient,
  userId: string,
  newPassword: string,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}/password`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: newPassword }),
    })
    if (!response.ok) {
      logger.error(
        { userId, status: response.status },
        'Logto update password returned error status',
      )
      throw AppError.internal('Failed to update password in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId }, 'Logto update password error')
    throw AppError.internal('Failed to update password in identity provider.')
  }
}

export async function updateUserMetadata(
  client: LogtoManagementClient,
  userId: string,
  metadata: UserMetadata,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}/custom-data`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ customData: metadata }),
    })
    if (!response.ok) {
      logger.error(
        { userId, status: response.status },
        'Logto update user metadata returned error status',
      )
      throw AppError.internal('Failed to update user metadata in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId }, 'Logto update user metadata error')
    throw AppError.internal('Failed to update user metadata in identity provider.')
  }
}

export async function requestPasswordResetEmail(
  client: LogtoManagementClient,
  email: string,
): Promise<void> {
  if (!client.isConfigured()) {
    return
  }

  try {
    const baseUrl = client.requireBaseUrl()
    const response = await fetch(`${baseUrl}/api/interaction/verification/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) {
      logger.warn({ status: response.status, email }, 'Logto password reset email request failed')
    }
  } catch (err) {
    logger.warn({ err, email }, 'Logto password reset email error')
  }
}

export async function revokeUserSessions(
  client: LogtoManagementClient,
  userId: string,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const url = `${baseUrl}/api/users/${encodeURIComponent(userId)}/sessions`
    const headers = { Authorization: `Bearer ${token}` }
    const response = await fetch(url, { headers })
    if (!response.ok) throw AppError.internal('Failed to list identity provider sessions.')
    const { sessions } = z
      .object({
        sessions: z.array(z.object({ payload: z.object({ uid: z.string().min(1) }) })),
      })
      .parse(await response.json())
    for (const session of sessions) {
      const revoked = await fetch(
        `${url}/${encodeURIComponent(session.payload.uid)}?revokeGrantsTarget=all`,
        { method: 'DELETE', headers },
      )
      if (!revoked.ok && revoked.status !== 404) {
        throw AppError.internal('Failed to revoke identity provider session.')
      }
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Logto sign-out error during session revocation')
    throw AppError.internal('Failed to revoke identity provider sessions.')
  }
}

export async function setUserSuspended(
  client: LogtoManagementClient,
  userId: string,
  suspended: boolean,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const response = await fetch(
      `${baseUrl}/api/users/${encodeURIComponent(userId)}/is-suspended`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isSuspended: suspended }),
      },
    )
    if (!response.ok) {
      throw AppError.internal('Failed to update user status in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId, suspended }, 'Logto set user suspended error')
    throw AppError.internal('Failed to update user status in identity provider.')
  }
}

export async function updateUserEmail(
  client: LogtoManagementClient,
  userId: string,
  email: string,
): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primaryEmail: email }),
    })
    if (!response.ok) {
      throw AppError.internal('Failed to update email in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId }, 'Logto update user email error')
    throw AppError.internal('Failed to update email in identity provider.')
  }
}

export async function deleteUser(client: LogtoManagementClient, userId: string): Promise<void> {
  const baseUrl = client.requireBaseUrl()
  try {
    const token = await client.getManagementToken()
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!response.ok && response.status !== 404) {
      throw AppError.internal('Failed to delete user in identity provider.')
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, userId }, 'Logto delete user error')
    throw AppError.internal('Failed to delete user in identity provider.')
  }
}
