import type { AppProviders, UserProfile } from '../../providers/types.js'

/** Read canonical student fields while retaining account-owned security metadata. */
export async function getCanonicalProfile(
  userId: string,
  providers: AppProviders,
): Promise<UserProfile> {
  const profile = await providers.domainStore.getUserProfile(userId)
  if (profile.role !== 'student' || !profile.nis) return profile
  const roster = await providers.domainStore.getRosterStudentByNis(profile.nis)
  if (!roster?.student_id || roster.user_id !== userId) return profile
  return {
    ...profile,
    full_name: roster.full_name,
    class_name: roster.class_name || null,
    absence_number: roster.absence_number ?? null,
    gender: roster.gender ?? null,
  }
}
