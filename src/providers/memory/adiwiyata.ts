import { randomUUID } from 'node:crypto'
import type {
  AdiwiyataAdminReport,
  AdiwiyataEligibility,
  AdiwiyataReport,
  AdiwiyataSite,
  CreateAdiwiyataSiteParams,
  UpdateAdiwiyataSiteParams,
} from '../types.js'
import type { MemoryDomainState } from './domain-state.js'

export function getMemoryAdiwiyataEligibility(
  store: MemoryDomainState,
  userId: string,
): AdiwiyataEligibility | null {
  const eligibility = store.adiwiyataEligibility.get(userId)
  return eligibility ? { ...eligibility } : null
}

export function listMemoryAdiwiyataEligibility(store: MemoryDomainState): AdiwiyataEligibility[] {
  return Array.from(store.adiwiyataEligibility.values(), (eligibility) => ({ ...eligibility }))
}

export function upsertMemoryAdiwiyataEligibility(
  store: MemoryDomainState,
  userId: string,
  addedBy: string,
): AdiwiyataEligibility {
  const existing = store.adiwiyataEligibility.get(userId)
  const now = new Date().toISOString()
  const eligibility: AdiwiyataEligibility = existing
    ? { ...existing, is_active: true, updated_at: now }
    : {
        id: randomUUID(),
        user_id: userId,
        added_by: addedBy,
        is_active: true,
        created_at: now,
        updated_at: now,
      }
  store.adiwiyataEligibility.set(userId, eligibility)
  return { ...eligibility }
}

export function setMemoryAdiwiyataEligibilityActive(
  store: MemoryDomainState,
  id: string,
  isActive: boolean,
): AdiwiyataEligibility | null {
  for (const [userId, eligibility] of store.adiwiyataEligibility) {
    if (eligibility.id !== id) continue
    const updated = { ...eligibility, is_active: isActive, updated_at: new Date().toISOString() }
    store.adiwiyataEligibility.set(userId, updated)
    return { ...updated }
  }
  return null
}

export function listMemoryAdiwiyataSites(
  store: MemoryDomainState,
  filter?: { schoolId?: string; isActive?: boolean },
): AdiwiyataSite[] {
  return Array.from(store.adiwiyataSites.values())
    .filter((site) => filter?.schoolId === undefined || site.school_id === filter.schoolId)
    .filter((site) => filter?.isActive === undefined || site.is_active === filter.isActive)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((site) => ({ ...site }))
}

export function createMemoryAdiwiyataSite(
  store: MemoryDomainState,
  params: CreateAdiwiyataSiteParams,
): AdiwiyataSite {
  const now = new Date().toISOString()
  const site: AdiwiyataSite = {
    id: randomUUID(),
    school_id: params.schoolId,
    name: params.name,
    category: params.category,
    class_id: params.classId ?? null,
    is_active: true,
    sort_order: params.sortOrder ?? 0,
    created_by: params.createdBy,
    created_at: now,
    updated_at: now,
  }
  store.adiwiyataSites.set(site.id, site)
  return { ...site }
}

export function updateMemoryAdiwiyataSite(
  store: MemoryDomainState,
  id: string,
  schoolId: string,
  params: UpdateAdiwiyataSiteParams,
): AdiwiyataSite | null {
  const site = store.adiwiyataSites.get(id)
  if (!site || site.school_id !== schoolId) return null
  if (params.name !== undefined) site.name = params.name
  if (params.category !== undefined) site.category = params.category
  if (params.classId !== undefined) site.class_id = params.classId
  if (params.sortOrder !== undefined) site.sort_order = params.sortOrder
  if (params.isActive !== undefined) site.is_active = params.isActive
  site.updated_at = new Date().toISOString()
  return { ...site }
}

export function listMemoryAdiwiyataReports(
  store: MemoryDomainState,
  filter?: {
    classId?: string
    siteId?: string
    reportedBy?: string
    reportDate?: string
    siteIds?: string[]
  },
): AdiwiyataReport[] {
  return Array.from(store.adiwiyataReports.values())
    .filter((report) => filter?.classId === undefined || report.class_id === filter.classId)
    .filter((report) => filter?.siteId === undefined || report.site_id === filter.siteId)
    .filter(
      (report) => filter?.reportedBy === undefined || report.reported_by === filter.reportedBy,
    )
    .filter(
      (report) => filter?.reportDate === undefined || report.report_date === filter.reportDate,
    )
    .filter((report) => filter?.siteIds === undefined || filter.siteIds.includes(report.site_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((report) => ({ ...report }))
}

export function listMemoryAdiwiyataAdminReports(
  store: MemoryDomainState,
  filter: {
    schoolId: string
    reportDate: string
    classId?: string
    siteId?: string
  },
): AdiwiyataAdminReport[] {
  return Array.from(store.adiwiyataReports.values())
    .filter((report) => report.report_date === filter.reportDate)
    .filter((report) => filter.classId === undefined || report.class_id === filter.classId)
    .filter((report) => filter.siteId === undefined || report.site_id === filter.siteId)
    .flatMap((report) => {
      const site = store.adiwiyataSites.get(report.site_id)
      const classroom = store.classes.find((item) => item.id === report.class_id)
      const file = store.files.get(report.file_id)
      if (
        !site ||
        site.school_id !== filter.schoolId ||
        !classroom ||
        classroom.school_id !== filter.schoolId ||
        file?.purpose !== 'adiwiyata_report'
      )
        return []
      return [
        {
          ...report,
          site_name: site.name,
          category: site.category,
          class_name: classroom.name,
          uploader_name: store.profiles.get(report.reported_by)?.full_name ?? null,
          photo_file: { ...file },
        },
      ]
    })
    .sort(
      (a, b) =>
        a.site_name.localeCompare(b.site_name) ||
        a.class_name.localeCompare(b.class_name) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
}
