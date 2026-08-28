# Skanida Platform

The school-attendance platform records student activity and school administration while delegating identity and API authorization to Logto.

## Authorization

**Platform Role**:
A domain classification stored with an Astra profile for school workflows and audit context. It is not an API authorization grant.
_Avoid_: Token role, permission

**Permission Scope**:
An API capability issued in a Logto access token through a Logto global role. Astra uses it to authorize privileged or cross-user actions.
_Avoid_: Astra role, custom JWT role
