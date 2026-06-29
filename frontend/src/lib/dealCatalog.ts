export type DealService = {
  key: string
  label: string
  color: string
}

export const DEAL_SERVICES: DealService[] = [
  { key: 'seo', label: 'SEO', color: '#059669' },
  { key: 'smm', label: 'SMM', color: '#7c3aed' },
  { key: 'web', label: 'Сайт / веб', color: '#2563eb' },
  { key: 'ppc', label: 'PPC / таргет', color: '#ea580c' },
  { key: 'branding', label: 'Брендинг', color: '#db2777' },
  { key: 'video', label: 'Видео / продакшн', color: '#0891b2' },
  { key: 'mobile', label: 'Мобильное приложение', color: '#4f46e5' },
  { key: 'support', label: 'Техподдержка', color: '#64748b' },
]

export const DEAL_TAG_PRESETS = [
  'SEO',
  'SMM',
  'Лендинг',
  'Контекст',
  'Таргет',
  'Брендинг',
  'Дизайн',
  'Разработка',
  'Контент',
  'CRM',
  'Аналитика',
  'Retainer',
  'Абонент',
  'Разовый проект',
] as const

const serviceMap = new Map(DEAL_SERVICES.map(s => [s.key, s]))

export function dealServiceLabel(key?: string | null): string {
  if (!key) return '—'
  return serviceMap.get(key)?.label ?? key
}

export function dealServiceMeta(key?: string | null): DealService | undefined {
  if (!key) return undefined
  return serviceMap.get(key)
}
