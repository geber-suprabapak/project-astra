import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'

function normalizeManifestPath(path: string) {
  return path.replaceAll(/\{[^}]+\}/g, ':_')
}

function normalizeImplementedPath(path: string) {
  return path.replaceAll(/:[^/]+/g, ':_')
}

describe('integration: published Astra contract manifest', () => {
  it('maps every published route to an implemented Hono route', async () => {
    // SAFETY: This repository-owned contract fixture is validated below by iterating every declared route.
    const contract = JSON.parse(
      await readFile(new URL('../../contracts/astra-v1.json', import.meta.url), 'utf8'),
    ) as {
      mobile_routes: string[]
      admin_routes: string[]
      identity_routes: string[]
    }
    const publishedRoutes = [
      ...contract.mobile_routes,
      ...contract.admin_routes,
      ...contract.identity_routes,
    ]
    const implementedRoutes = new Set(
      createApp().routes.map((route) => `${route.method} ${normalizeImplementedPath(route.path)}`),
    )

    for (const publishedRoute of publishedRoutes) {
      const [method, path] = publishedRoute.split(' ', 2)
      expect(
        implementedRoutes.has(`${method} ${normalizeManifestPath(path!)}`),
        `Missing implementation for published route: ${publishedRoute}`,
      ).toBe(true)
    }
  })
})
