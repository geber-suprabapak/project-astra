import {
  getPermitHistory,
  insertPermit,
  type Permit,
} from '../../clients/supabase/admin.js'
import {
  getSignedPermitUrl,
  uploadPermitAttachment,
} from '../../clients/supabase/storage.js'
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
    // NOTE: link_foto (raw storage path) is never returned to mobile
    attachment_url: attachmentUrl,
    created_at: permit.created_at,
    rejection_reason: permit.rejection_reason,
    rejected_at: permit.rejected_at,
  }
}

export async function listPermits(userId: string): Promise<PermitResponse[]> {
  const permits = await getPermitHistory(userId)

  return Promise.all(
    permits.map(async (p) => {
      const url = p.link_foto ? await getSignedPermitUrl(p.link_foto) : null
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
}): Promise<PermitResponse> {
  let storagePath: string | null = null

  if (params.attachment) {
    storagePath = await uploadPermitAttachment(
      params.userId,
      params.attachment.buffer,
      params.attachment.contentType,
    )
  }

  const permit = await insertPermit({
    user_id: params.userId,
    kategori_izin: params.category,
    deskripsi: params.description,
    status: false,
    link_foto: storagePath,
    tanggal: `${params.date}T00:00:00+07:00`,
  })

  const attachmentUrl = storagePath ? await getSignedPermitUrl(storagePath) : null
  return toPermitResponse(permit, attachmentUrl)
}
