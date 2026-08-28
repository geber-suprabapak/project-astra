/**
 * Permission scopes issued by the Skanida API resource in Logto.
 *
 * Astra authorizes bearer tokens with these scopes. Global Logto roles grant
 * scopes; the role name itself is not an authorization input to this service.
 */
export const logtoScopes = {
  mobileAccess: 'mobile:access',
  adminRead: 'admin:read',
  filesReadAny: 'files:read:any',
  filesDeleteAny: 'files:delete:any',
} as const

export function hasScope(scopes: readonly string[] | undefined, required: string): boolean {
  return scopes?.includes(required) === true
}
