import { AppError } from '../../lib/errors/app-error.js'
import type {
  AdiwiyataSite,
  AdiwiyataSiteCategory,
  AppProviders,
  IdentityRole,
} from '../../providers/types.js'
import { getActiveSitePeriod, requireAdiwiyataAdmin, validateSiteClass } from './service-shared.js'

export interface AdiwiyataAdminSites {
  academic_period: { id: string; name: string; school_id: string }
  sites: AdiwiyataSite[]
}

export async function listAdiwiyataAdminSites(params: {
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataAdminSites> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const sites = await params.providers.domainStore.listAdiwiyataSites({
    schoolId: period.school_id,
  })
  return {
    academic_period: { id: period.id, name: period.name, school_id: period.school_id },
    sites: sites.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }
}

export async function createAdiwiyataAdminSite(params: {
  name: string
  category: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder: number
  actorId: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  await validateSiteClass(params.providers, period, params.classId)
  return params.providers.domainStore.createAdiwiyataSite({
    schoolId: period.school_id,
    name: params.name,
    category: params.category,
    classId: params.classId,
    sortOrder: params.sortOrder,
    createdBy: params.actorId,
  })
}

export async function updateAdiwiyataAdminSite(params: {
  id: string
  name?: string
  category?: AdiwiyataSiteCategory
  classId?: string | null
  sortOrder?: number
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  await validateSiteClass(params.providers, period, params.classId)
  const site = await params.providers.domainStore.updateAdiwiyataSite(params.id, period.school_id, {
    name: params.name,
    category: params.category,
    classId: params.classId,
    sortOrder: params.sortOrder,
  })
  if (!site) throw AppError.notFound('Adiwiyata Site')
  return site
}

export async function deactivateAdiwiyataAdminSite(params: {
  id: string
  actorRole: IdentityRole | null
  providers: AppProviders
}): Promise<AdiwiyataSite> {
  requireAdiwiyataAdmin(params.actorRole)
  const period = await getActiveSitePeriod(params.providers)
  const site = await params.providers.domainStore.updateAdiwiyataSite(params.id, period.school_id, {
    isActive: false,
  })
  if (!site) throw AppError.notFound('Adiwiyata Site')
  return site
}
