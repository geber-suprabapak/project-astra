import { z } from 'zod'
import type { CmsSession } from '../cms/schema.js'

export const pklCheckInSchema = z
  .object({
    internship_id: z.uuid(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    photo_url: z.string().max(2000).optional(),
  })
  .strict()
export const pklCheckOutSchema = pklCheckInSchema.omit({ internship_id: true, photo_url: true })
export interface PklCheckIn extends z.infer<typeof pklCheckInSchema> {
  access: CmsSession
}
export interface PklCheckOut extends z.infer<typeof pklCheckOutSchema> {
  id: string
  access: CmsSession
}
export function pklSchoolDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
