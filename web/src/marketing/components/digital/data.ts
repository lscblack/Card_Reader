/* Illustrative digital-card templates and people for the landing page and docs (Part 4 §2 layouts). */

export type CardLayout = 'centered' | 'left' | 'split' | 'hero_photo' | 'banner' | 'compact'

export interface CardDesign {
  primary: string
  background: string
  text: string
  accent: string
  background_style: 'solid' | 'gradient' | 'glass' | 'pattern'
  font: 'sans' | 'serif' | 'mono' | 'display'
  corner_radius: number
}

export interface CardPerson {
  name: string
  initials: string
  title: string
  company: string
}

export interface CardTemplate {
  id: string
  name: string
  layout: CardLayout
  design: CardDesign
  person: CardPerson
}

export const samplePeople: CardPerson[] = [
  { name: 'Amara Okafor', initials: 'AO', title: 'Product Designer', company: 'Studio North' },
  { name: 'Lucas Martin', initials: 'LM', title: 'Account Executive', company: 'Brightwave' },
  { name: 'Mei Tanaka', initials: 'MT', title: 'Photographer', company: 'Freelance' },
  { name: 'Diego Ruiz', initials: 'DR', title: 'Founder', company: 'Ruiz & Co.' },
]

export const templates: CardTemplate[] = [
  { id: 'modern', name: 'Modern', layout: 'centered', person: samplePeople[0], design: { primary: '#b91c1c', background: '#ffffff', text: '#1c1717', accent: '#b91c1c', background_style: 'solid', font: 'sans', corner_radius: 20 } },
  { id: 'gradient', name: 'Gradient', layout: 'centered', person: samplePeople[1], design: { primary: '#f97316', background: '#7c2d12', text: '#ffffff', accent: '#fdba74', background_style: 'gradient', font: 'display', corner_radius: 24 } },
  { id: 'split', name: 'Split', layout: 'split', person: samplePeople[3], design: { primary: '#0f766e', background: '#f0fdfa', text: '#134e4a', accent: '#0f766e', background_style: 'solid', font: 'sans', corner_radius: 16 } },
  { id: 'photo_hero', name: 'Photo hero', layout: 'hero_photo', person: samplePeople[2], design: { primary: '#1f2937', background: '#111827', text: '#f9fafb', accent: '#fbbf24', background_style: 'solid', font: 'serif', corner_radius: 20 } },
  { id: 'glass', name: 'Glass', layout: 'banner', person: samplePeople[0], design: { primary: '#2563eb', background: '#0b1220', text: '#e5edff', accent: '#60a5fa', background_style: 'glass', font: 'sans', corner_radius: 28 } },
  { id: 'minimal', name: 'Minimal', layout: 'left', person: samplePeople[1], design: { primary: '#111111', background: '#fafaf9', text: '#1c1917', accent: '#57534e', background_style: 'solid', font: 'sans', corner_radius: 8 } },
  { id: 'bold', name: 'Bold', layout: 'banner', person: samplePeople[3], design: { primary: '#dc2626', background: '#1c0a0a', text: '#fff1f1', accent: '#f87171', background_style: 'pattern', font: 'display', corner_radius: 18 } },
  { id: 'classic', name: 'Classic', layout: 'compact', person: samplePeople[2], design: { primary: '#854d0e', background: '#fffbeb', text: '#422006', accent: '#a16207', background_style: 'solid', font: 'serif', corner_radius: 10 } },
]
