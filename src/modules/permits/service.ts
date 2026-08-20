import { defaultProviders } from '../../providers/index.js'
import type { AppProviders, Permit } from '../../providers/types.js'
import type { PermitCategory } from './schema.js'

export interface PermitResponse {
  id: string
  category: string
  description: string
  date: string
  approval_status: string
  attachment_url: string | null
  created_at: string | undefined
  rejection_reason: string | null | undefined
  rejected_at: string | null | undefined
}

function toPermitResponse(permit: Permit, attachmentUrl: string | null): PermitResponse {
  return {
    id: permit.id,
    category: permit.kategori_izin,
    description: permit.deskripsi,
    date: permit.tanggal,
    approval_status: permit.approval_status,
    attachment_url: attachmentUrl,
    created_at: permit.created_at,
    rejection_reason: permit.rejection_reason,
    rejected_at: permit.rejected_at,
  }
}

export async function listPermits(
  userId: string,
  providers: AppProviders = defaultProviders,
): Promise<PermitResponse[]> {
  const permits = await providers.domainStore.getPermitHistory(userId)

  return Promise.all(
    permits.map(async (p) => {
      const url = p.link_foto
        ? await providers.objectStorage.getSignedPermitUrl(p.link_foto)
        : null
      return toPermitResponse(p, url)
    }),
  )
}

export async function createPermit(params: {
  userId: string
  category: PermitCategory
  description: string
  date: string
  attachment?: { buffer: Buffer; contentType: string } | null
  providers?: AppProviders
}): Promise<PermitResponse> {
  const providers = params.providers ?? defaultProviders
  let storagePath: string | null = null

  if (params.attachment) {
    storagePath = await providers.objectStorage.uploadPermitAttachment(
      params.userId,
      params.attachment.buffer,
      params.attachment.contentType,
    )
  }

  const permit = await providers.domainStore.insertPermit({
    user_id: params.userId,
    kategori_izin: params.category,
    deskripsi: params.description,
    status: false,
    link_foto: storagePath,
    tanggal: `${params.date}T00:00:00+07:00`,
  })

  const attachmentUrl = storagePath
    ? await providers.objectStorage.getSignedPermitUrl(storagePath)
    : null
  return toPermitResponse(permit, attachmentUrl)
}
