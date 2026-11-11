import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/errors/app-error.js'
import type { AppProviders } from '../../providers/types.js'
import type { CmsSession } from './schema.js'
import { cmsJurusanAliases, validateCmsContentQuery } from './content.js'
import {
  assertCmsAccountManager,
  validateCmsAccountChange,
  type CmsAccountCreate,
} from './accounts.js'

export async function createCmsAccount(
  providers: AppProviders,
  access: CmsSession,
  input: CmsAccountCreate,
) {
  validateCmsAccountChange(access, null, input)
  const identity = providers.identityProvider
  if (!identity.createCmsIdentity || !identity.setUserSuspended)
    throw AppError.dependencyUnavailable('CMS identity provisioning')
  // Validate current authority before creating an external identity; the insert rechecks it under lock.
  await providers.domainStore.listCmsAccounts({ access, limit: 1, offset: 0 })
  if (input.role === 'admin_jurusan') {
    const departments = await providers.domainStore.listCmsContent({
      resource: 'jurusan',
      access,
      query: validateCmsContentQuery('jurusan', { id: input.jurusan_id!, limit: 1 }),
    })
    if (
      !departments[0] ||
      !cmsJurusanAliases(input.jurusan_slug!).includes(String(departments[0].slug).toLowerCase())
    )
      throw AppError.validationError('Department binding does not match an existing department.')
  }
  const created = await identity.createCmsIdentity({
    email: input.email,
    fullName: input.full_name,
    password: input.password,
  })
  const { password: _password, ...profile } = input
  const account = await providers.domainStore.insertCmsAccount({
    access,
    id: randomUUID(),
    subject: created.userId,
    data: profile,
  })
  await identity.setUserSuspended(created.userId, false)
  return providers.domainStore.mutateCmsAccount({
    access,
    id: account.id,
    data: { access_enabled: true },
  })
}
export async function resetCmsAccountPassword(
  providers: AppProviders,
  access: CmsSession,
  id: string,
  password: string,
) {
  const [target] = await providers.domainStore.listCmsAccounts({ access, id, limit: 1, offset: 0 })
  if (!target) throw AppError.notFound('CMS account')
  assertCmsAccountManager(access, target.role)
  // Revoke before changing the password, so a partial provider failure cannot leave old Astra tokens valid.
  await providers.domainStore.mutateCmsAccount({
    access,
    id: target.id,
    data: {},
    invalidate_sessions: true,
  })
  await providers.domainStore.revokeUserSessions(target.logto_subject)
  await providers.identityProvider.updatePassword(target.logto_subject, password)
  await providers.identityProvider.revokeUserSessions?.(target.logto_subject)
  return { id: target.id, success: true }
}
