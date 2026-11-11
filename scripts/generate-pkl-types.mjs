import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { pklResources, pklReadFields } from '../src/modules/pkl/resources.ts'
import { registrationStatusSchema } from '../src/modules/pkl/schema.ts'
import { typeOfSchema } from './schema-types.mjs'

// Run with Bun: bun scripts/generate-pkl-types.mjs ../meraxes ../syrax
const registrationStatus = registrationStatusSchema.options
  .map((value) => JSON.stringify(value))
  .join(' | ')
const relations = new Map([
  [
    'internships',
    [
      ['student', 'students'],
      ['industry', 'industries'],
      ['supervisor', 'supervisors'],
      ['supervisor_guru', 'supervisors'],
      ['academic_year', 'academic_years'],
    ],
  ],
  [
    'registrations',
    [
      ['student', 'students'],
      ['industry', 'industries'],
      ['accepted_industry', 'industries'],
      ['academic_year', 'academic_years'],
    ],
  ],
  [
    'applications',
    [
      ['student', 'students'],
      ['industry', 'industries'],
      ['academic_year', 'academic_years'],
    ],
  ],
  ['daily_journals', [['internship', 'internships']]],
  [
    'assessment_scores',
    [
      ['internship', 'internships'],
      ['indicator', 'assessment_indicators'],
    ],
  ],
  ['certificates', [['internship', 'internships']]],
  [
    'attendance',
    [
      ['internship', 'internships'],
      ['student', 'students'],
    ],
  ],
  [
    'monitoring',
    [
      ['internship', 'internships'],
      ['supervisor', 'supervisors'],
    ],
  ],
  [
    'documents',
    [
      ['internship', 'internships'],
      ['student', 'students'],
    ],
  ],
])
const lines = [
  '// Generated from Astra PKL schemas; regenerate with scripts/generate-pkl-types.mjs.',
  'import type { ContentRows } from "./content-types";',
  `export type RegistrationStatus = ${registrationStatus};`,
  'export interface PklRows {',
]
for (const [resource, schema] of pklResources) {
  const specification = z.toJSONSchema(schema)
  const extras = ['id: string', 'created_at: string', 'updated_at: string']
  for (const field of pklReadFields(resource)) {
    if (specification.properties[field] || ['id', 'created_at', 'updated_at'].includes(field))
      continue
    let type = 'string | null'
    if (field === 'score') type = 'number | null'
    if (field === 'assessor_type') type = '"school" | "industry" | null'
    if (field === 'status')
      type =
        resource === 'registrations'
          ? 'RegistrationStatus'
          : '"pending" | "approved" | "rejected" | "withdrawn"'
    if (
      ['changed_at', 'changed_by', 'changed_by_role', 'commenter_id', 'commenter_role'].includes(
        field,
      )
    )
      type = 'string'
    if (field === 'to_status') type = 'RegistrationStatus'
    if (field === 'from_status') type = 'RegistrationStatus | null'
    extras.push(`${field}: ${type}`)
  }
  for (const [key, target] of relations.get(resource) ?? [])
    extras.push(`${key}: PklRows["${target}"] | null`)
  if (resource === 'supervisors') extras.push('guru_staff: ContentRows["guru_staff"] | null')
  if (resource === 'industries') extras.push('active_students_count: number')
  if (resource === 'internships')
    extras.push(
      'scores: (Omit<PklRows["assessment_scores"], "internship"> & { indicator: PklRows["assessment_indicators"] })[]',
    )
  lines.push(`  ${resource}: ${typeOfSchema(specification)} & { ${extras.join('; ')} };`)
}
lines.push('}', '')
if (!process.argv.slice(2).length) throw new Error('Pass the target frontend repository paths.')
for (const target of process.argv.slice(2))
  await writeFile(resolve(target, 'src/lib/astra/pkl-types.ts'), lines.join('\n'))
