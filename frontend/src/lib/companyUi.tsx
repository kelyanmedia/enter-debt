import type { ReactNode } from 'react'

export type PaymentsSegmentKey = 'all' | 'services' | 'hosting'

export interface CompanyPaymentsUiSegment {
  segment_key: string
  label: string
  sort_order: number
  is_visible: boolean
}

export interface CompanyPaymentsUiLine {
  category_slug: string
  label: string
  sort_order: number
  is_visible: boolean
}

export interface CompanyPaymentsUi {
  segments: CompanyPaymentsUiSegment[]
  lines: CompanyPaymentsUiLine[]
}

/** Совпадает с бэкендом CANONICAL_CATEGORY_SLUGS / PAYMENTS_CATEGORY_QUERY_VALUES */
export const CANONICAL_CATEGORY_SLUGS: readonly string[] = [
  'smm',
  'target',
  'personal_brand',
  'content',
  'web',
  'seo',
  'ppc',
  'mobile_app',
  'tech_support',
  'events',
  'hosting_domain',
] as const

const DEFAULT_LINE_LABELS: Record<string, string> = {
  smm: 'SMM',
  target: 'Таргет',
  personal_brand: 'Личный бренд',
  content: 'Контент',
  web: 'Web',
  seo: 'SEO',
  ppc: 'PPC',
  mobile_app: 'Моб. приложение',
  tech_support: 'Тех. сопр.',
  events: 'Ивенты',
  hosting_domain: 'Хостинг/домен',
}

const DEFAULT_SEGMENT_LABELS: Record<PaymentsSegmentKey, string> = {
  all: 'Все',
  services: 'Услуги',
  hosting: 'Домены/хостинг',
}

export function defaultCompanyPaymentsUi(): CompanyPaymentsUi {
  return {
    segments: (['all', 'services', 'hosting'] as const).map((key, i) => ({
      segment_key: key,
      label: DEFAULT_SEGMENT_LABELS[key],
      sort_order: i,
      is_visible: true,
    })),
    lines: CANONICAL_CATEGORY_SLUGS.map((slug, i) => ({
      category_slug: slug,
      label: DEFAULT_LINE_LABELS[slug] ?? slug,
      sort_order: i,
      is_visible: true,
    })),
  }
}

export function effectiveCompanyUi(ui: CompanyPaymentsUi | null | undefined): CompanyPaymentsUi {
  if (ui?.segments?.length && ui?.lines?.length) return ui
  return defaultCompanyPaymentsUi()
}

export function segmentLabelMap(ui: CompanyPaymentsUi): Record<string, string> {
  return Object.fromEntries(ui.segments.map((s) => [s.segment_key, s.label]))
}

export function lineLabelMap(ui: CompanyPaymentsUi): Record<string, string> {
  return Object.fromEntries(ui.lines.map((l) => [l.category_slug, l.label]))
}

export function visibleSegmentsSorted(ui: CompanyPaymentsUi): CompanyPaymentsUiSegment[] {
  return [...ui.segments].filter((s) => s.is_visible).sort((a, b) => a.sort_order - b.sort_order || a.segment_key.localeCompare(b.segment_key))
}

export function visibleLinesSorted(ui: CompanyPaymentsUi): CompanyPaymentsUiLine[] {
  return [...ui.lines].filter((l) => l.is_visible).sort((a, b) => a.sort_order - b.sort_order || a.category_slug.localeCompare(b.category_slug))
}

export function allLinesSorted(ui: CompanyPaymentsUi): CompanyPaymentsUiLine[] {
  return [...ui.lines].sort((a, b) => a.sort_order - b.sort_order || a.category_slug.localeCompare(b.category_slug))
}

/** Бейдж линии: цвета по slug (как в legacy payments/debitor). */
export function ProjectLineBadge({
  cat,
  labels,
}: {
  cat?: string | null
  labels: Record<string, string>
}): ReactNode {
  const text = cat ? labels[cat] ?? cat : null
  if (!cat || !text)
    return <span style={{ color: '#c5c8d4', fontSize: 12 }}>—</span>
  const base = { fontSize: 11, fontWeight: 700 as const, padding: '3px 8px', borderRadius: 6 }
  if (cat === 'smm') return <span style={{ ...base, color: '#7c3aed', background: '#f3e8ff' }}>{text}</span>
  if (cat === 'target') return <span style={{ ...base, color: '#c2410c', background: '#fff7ed' }}>{text}</span>
  if (cat === 'personal_brand') return <span style={{ ...base, color: '#0d9488', background: '#ccfbf1' }}>{text}</span>
  if (cat === 'content') return <span style={{ ...base, color: '#7c2d12', background: '#ffedd5' }}>{text}</span>
  if (cat === 'web') return <span style={{ ...base, color: '#2563eb', background: '#eff4ff' }}>{text}</span>
  if (cat === 'seo') return <span style={{ ...base, color: '#b45309', background: '#fff8ee' }}>{text}</span>
  if (cat === 'ppc') return <span style={{ ...base, color: '#6b7280', background: '#f3f4f6' }}>{text}</span>
  if (cat === 'mobile_app') return <span style={{ ...base, color: '#7c3aed', background: '#f3e8ff' }}>{text}</span>
  if (cat === 'tech_support') return <span style={{ ...base, color: '#0d9488', background: '#ccfbf1' }}>{text}</span>
  if (cat === 'events') return <span style={{ ...base, color: '#be185d', background: '#fce7f3' }}>{text}</span>
  if (cat === 'hosting_domain') return <span style={{ ...base, color: '#4338ca', background: '#eef2ff' }}>{text}</span>
  return <span style={{ ...base, color: '#64748b', background: '#f1f5f9' }}>{text}</span>
}
