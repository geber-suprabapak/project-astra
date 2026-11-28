import { z } from 'zod'

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/

export const adminAuditLogsQuerySchema = z.object({
  entity_type: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  actor_id: z.string().trim().min(1).optional(),
  start_date: z.string().regex(isoDateRegex, 'start_date must be YYYY-MM-DD').optional(),
  end_date: z.string().regex(isoDateRegex, 'end_date must be YYYY-MM-DD').optional(),
})

export type AdminAuditLogsQuery = z.infer<typeof adminAuditLogsQuerySchema>
