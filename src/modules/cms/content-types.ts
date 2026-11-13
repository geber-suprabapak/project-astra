import { z } from 'zod'
import type { CmsSession } from './schema.js'

export const cmsContentInputSchema = z.record(z.string(), z.json())
export type CmsContentInput = z.infer<typeof cmsContentInputSchema>
export type CmsContentRow = CmsContentInput & { id: string }

export interface ResourceDefinition {
  schema: z.ZodObject
  roles: string[]
  readRoles?: string[]
  scope: 'id' | 'jurusan' | null
  singleton: boolean
}

export const cmsContentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    sort: z
      .string()
      .regex(/^[a-z_]+$/)
      .default('created_at'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    id: z.uuid().optional(),
    slug: z.string().min(1).max(200).optional(),
    search: z.string().trim().min(2).max(100).optional(),
    jurusan: z.string().min(1).max(100).optional(),
    category: z.string().max(200).optional(),
    page: z.string().max(100).optional(),
    year_label: z.string().max(100).optional(),
    is_published: z.enum(['true', 'false']).optional(),
  })
  .strict()

export type CmsContentQueryInput = z.input<typeof cmsContentQuerySchema>
export type CmsContentQuery = z.infer<typeof cmsContentQuerySchema>

export interface CmsContentList {
  resource: string
  query: CmsContentQuery
  access: CmsSession | null
}

export interface CmsContentMutation {
  resource: string
  action: 'create' | 'update' | 'delete'
  id?: string
  data: CmsContentInput
  access: CmsSession
}

export interface CmsContentImport {
  upsert_by_slug?: boolean
  resource: string
  data: CmsContentInput[]
  access: CmsSession
}
