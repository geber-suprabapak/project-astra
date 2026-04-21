import type { AttendanceStatus } from '../dashboard/service.js'

export { computeAttendanceStatus } from '../dashboard/service.js'

/** Determine action type from attendance status */
export function computeActionType(
  status: AttendanceStatus,
): 'check_in' | 'check_out' | 'done' {
  if (status.hasCheckedIn && status.hasCheckedOut) return 'done'
  if (status.hasCheckedIn) return 'check_out'
  return 'check_in'
}

/** Compute what status label to insert in `absences` table */
export function computeInsertStatus(
  actionType: 'check_in' | 'check_out',
  isLate: boolean,
): 'Hadir' | 'Terlambat' | 'Pulang' {
  if (actionType === 'check_out') return 'Pulang'
  return isLate ? 'Terlambat' : 'Hadir'
}

/** Decode base64 byte size */
export function base64ByteSize(b64: string): number {
  const padding = b64.match(/=+$/)
  const p = padding ? padding[0].length : 0
  return Math.floor((b64.length * 3) / 4) - p
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB

export function validateImageBase64(b64: string): void {
  const size = base64ByteSize(b64)
  if (size > MAX_IMAGE_BYTES) {
    const mb = (size / 1024 / 1024).toFixed(1)
    throw Object.assign(new Error(`Image too large: ${mb}MB. Maximum is 5MB.`), { code: 'VALIDATION_ERROR' })
  }
}
