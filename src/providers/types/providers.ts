import type { RobinClient } from '../../clients/robin/client.js'
import type { IdentityRole, UserMetadata } from './common.js'
import type { FilePurpose } from './files-notifications.js'
import type { CreateStudentIdentityParams, IdentityUser } from './rbac-users.js'
import type { DomainStore } from './store.js'

export interface IdentityProvider {
  createCmsIdentity?(params: {
    email: string
    fullName: string
    password: string
  }): Promise<{ userId: string }>
  verifyToken(token: string): Promise<IdentityUser>
  verifyLegacyToken?(token: string): Promise<IdentityUser>
  verifyPassword(email: string, password: string): Promise<void>
  updatePassword(userId: string, newPassword: string): Promise<void>
  updateUserMetadata(userId: string, metadata: UserMetadata): Promise<void>
  createStudentIdentity?(params: CreateStudentIdentityParams): Promise<{ userId: string }>
  setUserSuspended?(userId: string, suspended: boolean): Promise<void>
  assignUserRole?(userId: string, role: IdentityRole): Promise<void>
  revokeUserRole?(userId: string, role: IdentityRole): Promise<void>
  revokeUserSessions?(userId: string): Promise<void>
  updateUserEmail?(userId: string, email: string): Promise<void>
  deleteUser?(userId: string): Promise<void>
  checkHealth(): Promise<boolean>
  createStaffIdentity?(params: {
    email: string
    fullName: string
    role: string
    password?: string
  }): Promise<{ userId: string; email: string }>
  requestPasswordResetEmail?(email: string): Promise<void>
  assignRoles?(userId: string, roles: string[]): Promise<void>
}

export interface ObjectStorage {
  uploadAvatar(userId: string, file: Buffer, contentType: string): Promise<string>
  deleteAvatar(userId: string): Promise<void>
  getSignedAvatarUrl(path: string): Promise<string | null>
  uploadPermitAttachment(userId: string, file: Buffer, contentType: string): Promise<string>
  getSignedPermitUrl(path: string): Promise<string | null>
  deletePermitAttachment?(path: string): Promise<void>
  uploadFaceEnrollmentImage(
    userId: string,
    imageIndex: number,
    file: Buffer,
    contentType: string,
  ): Promise<string>
  uploadAdiwiyataReport(path: string, file: Buffer): Promise<void>
  getSignedAdiwiyataReportUrl(path: string, expiresInSeconds?: number): Promise<string | null>
  deleteFaceEnrollmentImages(userId: string): Promise<void>
  /** Delete one object belonging to an Astra file record. */
  deleteObject(purpose: FilePurpose, path: string): Promise<void>
  getSignedFaceEnrollmentUrl(path: string): Promise<string | null>
  uploadPublicFile?(path: string, file: Buffer, contentType: string): Promise<string>
  getPublicUrl?(path: string): string
  getPresignedUploadUrl?(params: {
    bucket?: string
    key: string
    contentType: string
    expiresInSeconds?: number
  }): Promise<string>
  /**
   * Returns stored metadata for one Astra file object, or null when the object does not exist.
   * Optional: providers without it cannot verify uploads, and upload confirmation fails closed
   * (the File stays pending_upload and no download URL is issued).
   */
  statObject?(
    purpose: FilePurpose,
    path: string,
  ): Promise<{ sizeBytes: number; contentType: string } | null>
  checkHealth(): Promise<boolean>
}

export interface AppProviders {
  domainStore: DomainStore
  objectStorage: ObjectStorage
  identityProvider: IdentityProvider
  robinClient: RobinClient
}
