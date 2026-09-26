import type { RenderableCard } from '../api/types'

/** Realistic sample details for template previews when the user hasn't filled theirs in yet. */
export const SAMPLE_FIELDS: RenderableCard['fields'] = {
  full_name: 'Alex Morgan',
  headline: 'Design with purpose',
  job_title: 'Design Lead',
  company: 'Northwind',
  department: 'Product',
  phones: [{ label: 'Mobile', value: '+1 415 555 0123' }],
  emails: [{ label: 'Work', value: 'alex@northwind.example' }],
  websites: [{ label: 'Website', url: 'https://northwind.example' }],
  address: '42 Market St, San Francisco',
  socials: [
    { platform: 'linkedin', url: 'https://linkedin.com/in/alex' },
    { platform: 'instagram', url: 'https://instagram.com/alex' },
  ],
  custom_links: [],
  id_number: 'NW-20481',
  valid_from: '2026-01-01',
  valid_until: '2027-12-31',
  barcode_value: 'NW20481',
}
