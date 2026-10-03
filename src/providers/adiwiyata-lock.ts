/** Shared advisory-lock name for report submission and later verify/unverify. */
export function adiwiyataReportLockName(classId: string, siteId: string, reportDate: string) {
  return `adiwiyata-report:${classId}:${siteId}:${reportDate}`
}
