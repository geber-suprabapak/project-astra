# Logto RBAC is the API authority

Logto global roles grant the Skanida API-resource scopes and are the authority for API authorization. Astra validates the access token audience and required scopes, while its PostgreSQL profile remains the authority for lifecycle and school-domain context; Astra must not authorize from custom `roles`, `mfa_verified`, or `must_change_password` token claims. This avoids duplicating RBAC in two systems and keeps MFA and password policy in Logto.

## Consequences

`mobile:access`, `admin:read`, `files:read:any`, and `files:delete:any` are Logto permission scopes. The Logto tenant must provision them and assign them through global roles before access is enabled.
