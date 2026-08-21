import { PostgresDomainStore } from './postgres/domain-store.js'
import { S3ObjectStorage } from './storage/s3-storage.js'
import { OidcIdentityProvider } from './identity/oidc-identity.js'
import { robinClient } from '../clients/robin/client.js'
import type { AppProviders } from './types.js'

export * from './types.js'
export * from './postgres/domain-store.js'
export * from './postgres/migrate.js'
export * from './storage/s3-storage.js'
export * from './identity/oidc-identity.js'
export * from './memory/index.js'

export function createDefaultProviders(): AppProviders {
  return {
    domainStore: new PostgresDomainStore(),
    objectStorage: new S3ObjectStorage(),
    identityProvider: new OidcIdentityProvider(),
    robinClient,
  }
}

let cachedProviders: AppProviders | null = null

export function getDefaultProviders(): AppProviders {
  if (!cachedProviders) {
    cachedProviders = createDefaultProviders()
  }
  return cachedProviders
}

export const defaultProviders: AppProviders = {
  get domainStore() {
    return getDefaultProviders().domainStore
  },
  get objectStorage() {
    return getDefaultProviders().objectStorage
  },
  get identityProvider() {
    return getDefaultProviders().identityProvider
  },
  get robinClient() {
    return getDefaultProviders().robinClient
  },
}
