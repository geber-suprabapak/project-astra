import { z } from 'zod'
import { AppError } from '../../lib/errors/app-error.js'
import type { CmsContentImport, CmsContentRow } from '../../modules/cms/content.js'
import { listMemoryCmsContent, mutateMemoryCmsContent } from './cms-content.js'
import type { MemoryDomainState } from './domain-state.js'

export function importMemoryCmsContent(
  store: MemoryDomainState,
  params: CmsContentImport,
): CmsContentRow[] {
  if (params.upsert_by_slug && params.resource !== 'berita')
    throw AppError.validationError('Slug upsert is only supported for news imports.')
  const before = store.cmsContent.has(params.resource)
    ? structuredClone(store.cmsContent.get(params.resource)!)
    : null
  const auditLength = store.cmsContentAudit.length
  try {
    return params.data.map((data) => {
      let id: string | undefined
      if (params.upsert_by_slug) {
        const slug = z.string().min(1).safeParse(data.slug)
        if (!slug.success) throw AppError.validationError('News slug is required.')
        id = listMemoryCmsContent(store, {
          resource: 'berita',
          access: params.access,
          query: { slug: slug.data, limit: 1, offset: 0, sort: 'id', direction: 'asc' },
        })[0]?.id
      }
      return mutateMemoryCmsContent(store, {
        ...params,
        data,
        id,
        action: id ? 'update' : 'create',
      })
    })
  } catch (error) {
    if (before) store.cmsContent.set(params.resource, before)
    else store.cmsContent.delete(params.resource)
    store.cmsContentAudit.length = auditLength
    throw error
  }
}
