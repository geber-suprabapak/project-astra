import { z } from 'zod'

export const certificateCodeSchema = z.uuid()
export const certificateVerificationSchema = z.object({
  id: z.uuid(),
  certificate_number: z.string(),
  issue_date: z.iso.date(),
  final_score: z.number().nullable(),
  grade: z.string().nullable(),
  internship: z.object({
    start_date: z.iso.date().nullable(),
    end_date: z.iso.date().nullable(),
    student: z.object({ name: z.string(), nis: z.string(), jurusan: z.string() }),
    industry: z.object({ name: z.string(), city: z.string().nullable() }),
  }),
})
export type CertificateVerification = z.infer<typeof certificateVerificationSchema>
