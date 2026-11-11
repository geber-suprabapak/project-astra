import { z } from 'zod'
import { getCmsContentResource, type CmsContentInput } from '../../src/modules/cms/content.js'

export function cmsContentFixture(resource: string): CmsContentInput {
  const specification = z.toJSONSchema(getCmsContentResource(resource).schema)
  const data: CmsContentInput = {}
  for (const field of specification.required ?? []) {
    const property = specification.properties?.[field]
    if (!property || property === true)
      throw new Error(`Missing fixture definition: ${resource}.${field}`)
    if (property.enum) data[field] = z.json().parse(property.enum[0])
    else if (property.default !== undefined) data[field] = z.json().parse(property.default)
    else if (property.type === 'boolean') data[field] = false
    else if (property.type === 'number' || property.type === 'integer') data[field] = 1
    else if (property.type === 'array') data[field] = []
    else data[field] = `synthetic-${field}`
  }
  if (resource === 'visi_misi') data.visi = 'Synthetic vision'
  if (resource === 'poin_pelanggaran') data.title = 'Synthetic violation'
  if (resource === 'mou_kerjasama') data.partner = 'Synthetic partner'
  if (resource === 'tracer_alumni')
    Object.assign(data, {
      year: '2026',
      employed_percent: '60',
      college_percent: '30',
      entrepreneur_percent: '10',
    })
  return data
}

export const cmsAlternateFormFixtures: { resource: string; data: CmsContentInput }[] = [
  { resource: 'beasiswa', data: { name: 'Scholarship', amount: '1000000', deadline: '2026-12-01', link: 'https://example.test/apply' } },
  { resource: 'bkk_lowongan', data: { title: 'Developer', company: 'Partner', type: 'Full Time', requirements: 'Graduate', salary: 'Negotiable', link: 'https://example.test/job', image: '' } },
  { resource: 'download_dokumen', data: { title: 'Student handbook', file_type: 'PDF', file_name: 'handbook.pdf', file_url: 'https://example.test/handbook.pdf' } },
  { resource: 'guru_tamu', data: { name: 'Guest', company: 'Partner', position: 'Engineer', field: 'Software', event_date: '2026-12-01', description: 'Guest lesson', image: '' } },
  { resource: 'mou_kerjasama', data: { partner_name: 'Industry partner', category: 'Software', mou_number: 'SYNTHETIC-1', signed_date: '2026-01-01', expired_date: '2027-01-01', description: 'Training', image: '' } },
  { resource: 'mou_kerjasama', data: { partner_name: 'Industry partner', type: 'Training', mou_date: '2026-01-01', valid_until: '2027-01-01', description: 'Training', sort_order: 1 } },
  { resource: 'spmb_biaya', data: { item: 'Uniform', amount: '100000', category: 'Optional' } },
  { resource: 'tata_tertib', data: { title: 'Attendance', content: 'Arrive on time', category: 'Akademik' } },
  { resource: 'testimoni_dudi', data: { name: 'Partner', company: '', content: 'Good work', image: '', rating: 4 } },
  { resource: 'poin_pelanggaran', data: { violation: 'Late arrival', category: 'Ringan', points: 10 } },
  { resource: 'tracer_alumni', data: { name: 'Synthetic graduate', graduation_year: 2026, jurusan: 'pplg', status: 'Bekerja', company_or_campus: 'Partner', position: 'Engineer', salary_range: 'Private' } },
].map(fixture => ({ ...fixture, data: { ...fixture.data, is_published: false } }))
