export function isMfaVerified(
  explicit: boolean | undefined,
  authenticationMethods: readonly string[] | undefined,
): boolean {
  if (explicit !== undefined) return explicit

  return (
    authenticationMethods?.includes('pwd') === true &&
    authenticationMethods.some((method) => ['mfa', 'otp', 'totp', 'webauthn'].includes(method))
  )
}
