import { typeOfSchema } from './schema-types.mjs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { cmsContentResources } from '../src/modules/cms/content.ts'

// Run with Bun: bun scripts/generate-cms-types.mjs ../meraxes ../syrax

const lines = [
  '// Generated from Astra CMS resource schemas; regenerate with scripts/generate-cms-types.mjs.',
  'export interface ContentRows {',
]
for (const [name, resource] of cmsContentResources) {
  const schema = z.toJSONSchema(resource.schema)
  for (const key of ['id', 'created_at', 'updated_at']) {
    schema.properties[key] = { type: 'string' }
    schema.required ??= []
    schema.required.push(key)
  }
  lines.push(`  ${name}: ${typeOfSchema(schema)};`)
}
lines.push('}', '')
if (!process.argv.slice(2).length) throw new Error('Pass the target frontend repository paths.')
for (const target of process.argv.slice(2))
  await writeFile(resolve(target, 'src/lib/astra/content-types.ts'), lines.join('\n'))
