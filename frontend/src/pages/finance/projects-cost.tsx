import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, Empty, formatMoneyNumber, BtnOutline, BtnPrimary, MoneyInput, Input, Field, Modal } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { isFinanceTeamRole } from '@/lib/roles'

interface ScheduleMonth {
  month: string
  amount: string
  status: string
  due_date?: string | null
  paid_at?: string | null
  description?: string | null
}

type CostFieldApi = 'cost_design_uzs' | 'cost_dev_uzs' | 'cost_other_uzs' | 'cost_seo_uzs'

interface ProjectsCostFieldUiRow {
  field_key: CostFieldApi
  label: string
}

interface ProjectsCostUi {
  fields: ProjectsCostFieldUiRow[]
}

interface ProjectCostRow {
  payment_id: number
  partner_id: number
  partner_name: string
  project_name: string
  project_category?: string | null
  payment_type: string
  is_recurring_billing: boolean
  amount_basis: string
  contract_total?: string | null
  billing_unit_amount: string
  sum_paid_actual: string
  paid_percent?: string | null
  pm_name?: string | null
  project_start: string
  schedule_months: ScheduleMonth[]
  /** Итого: ручной ввод + из задач «Команда» */
  cost_design_uzs: string
  cost_dev_uzs: string
  cost_other_uzs: string
  cost_seo_uzs: string
  cost_design_manual_uzs?: string
  cost_dev_manual_uzs?: string
  cost_other_manual_uzs?: string
  cost_seo_manual_uzs?: string
  tasks_cost_design_uzs?: string
  tasks_cost_dev_uzs?: string
  tasks_cost_other_uzs?: string
  tasks_cost_seo_uzs?: string
  internal_cost_sum: string
  profit_actual: string
  /** % менеджера из «Комиссия», если строка привязана к этому payment_id */
  manager_commission_percent?: string | null
  manager_commission_reserved_uzs?: string | null
  profit_after_manager_uzs: string
}

const COST_MANUAL_FIELD: Record<CostFieldApi, keyof ProjectCostRow> = {
  cost_design_uzs: 'cost_design_manual_uzs',
  cost_dev_uzs: 'cost_dev_manual_uzs',
  cost_other_uzs: 'cost_other_manual_uzs',
  cost_seo_uzs: 'cost_seo_manual_uzs',
}

const COST_TASKS_FIELD: Record<CostFieldApi, keyof ProjectCostRow> = {
  cost_design_uzs: 'tasks_cost_design_uzs',
  cost_dev_uzs: 'tasks_cost_dev_uzs',
  cost_other_uzs: 'tasks_cost_other_uzs',
  cost_seo_uzs: 'tasks_cost_seo_uzs',
}

const DEFAULT_COST_FIELD_LABELS: Record<CostFieldApi, string> = {
  cost_design_uzs: 'Дизайн',
  cost_dev_uzs: 'Разраб.',
  cost_other_uzs: 'Прочее',
  cost_seo_uzs: 'SEO',
}

const COL_COUNT = 17

const MONTHS_RU = [
  'Янв.', 'Февр.', 'Март', 'Апр.', 'Май', 'Июнь',
  'Июль', 'Авг.', 'Сент.', 'Окт.', 'Нояб.', 'Дек.',
]

function ymLabel(ym: string) {
  const [y, m] = ym.split('-')
  const mi = parseInt(m, 10) - 1
  if (mi < 0 || mi > 11) return ym
  return `${MONTHS_RU[mi]} ${y}`
}

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftYM(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1 + delta, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

type PeriodPreset = 'this' | 'last' | 'all' | 'custom'

/** Раздел таблицы: услуги = всё, кроме хостинга/домена; хостинг отдельно. */
type ProjectsCostSegment = 'services' | 'hosting'

function formatStart(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const CAT_BG: Record<string, string> = {
  smm: '#f3e8ff',
  target: '#fff7ed',
  personal_brand: '#ccfbf1',
  content: '#ffedd5',
  web: '#fff4e6',
  ppc: '#e8f4fc',
  seo: '#f3e8ff',
  mobile_app: '#ecfdf5',
  tech_support: '#f1f5f9',
  events: '#fce7f3',
  hosting_domain: '#fef3c7',
}

function categoryLabel(cat?: string | null) {
  if (!cat) return '—'
  const m: Record<string, string> = {
    smm: 'SMM',
    target: 'Таргет',
    personal_brand: 'Личный бренд',
    content: 'Контент',
    web: 'WEB',
    ppc: 'PPC',
    seo: 'SEO',
    mobile_app: 'App',
    tech_support: 'Поддержка',
    events: 'Ивенты',
    hosting_domain: 'Хостинг / домен',
  }
  return m[cat] || cat.toUpperCase()
}

function paymentTypeRu(t: string) {
  const m: Record<string, string> = {
    recurring: 'Рекуррент',
    regular: 'Рекуррент',
    one_time: 'Разовый',
    service_expiry: 'Сервис',
  }
  return m[t] || t
}

/** Только сумма; для рекуррента — «N / период» без слова «договор» */
function costDisplay(isRec: boolean, billingUnit: string) {
  const n = formatMoneyNumber(Number(billingUnit))
  if (isRec) return `${n} / период`
  return n
}

function moneyCellString(v: string | undefined) {
  return String(Number(v) || 0)
}

const breakdownBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '2px 0',
  margin: 0,
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  color: '#334155',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
  maxWidth: 120,
  textAlign: 'left',
}

export default function FinanceProjectsCostPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<ProjectCostRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('this')
  const [customFrom, setCustomFrom] = useState(currentYM)
  const [customTo, setCustomTo] = useState(currentYM)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [costEdit, setCostEdit] = useState<{ paymentId: number; field: CostFieldApi } | null>(null)
  const [costDraft, setCostDraft] = useState('')
  const [costSaving, setCostSaving] = useState(false)
  const costDraftRef = useRef('')
  const [segmentTab, setSegmentTab] = useState<ProjectsCostSegment>('services')
  const [tableSearch, setTableSearch] = useState('')
  const [costFieldLabels, setCostFieldLabels] = useState<Record<CostFieldApi, string>>(DEFAULT_COST_FIELD_LABELS)
  const [labelEditField, setLabelEditField] = useState<CostFieldApi | null>(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [labelSaving, setLabelSaving] = useState(false)

  const canEditCostLabels =
    user?.role === 'admin' || user?.role === 'accountant' || user?.role === 'financier'

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [loading, user, router])

  const monthRange = useMemo(() => {
    if (periodPreset === 'all') return null
    const cur = currentYM()
    if (periodPreset === 'this') return { from: cur, to: cur }
    if (periodPreset === 'last') {
      const p = shiftYM(cur, -1)
      return { from: p, to: p }
    }
    const f = (customFrom || '').trim() || cur
    const t = (customTo || '').trim() || f
    return f <= t ? { from: f, to: t } : { from: t, to: f }
  }, [periodPreset, customFrom, customTo])

  const periodHint = useMemo(() => {
    if (periodPreset === 'all') return 'Весь период — все активные проекты.'
    if (periodPreset === 'this') return `Период: ${ymLabel(currentYM())} (текущий месяц).`
    if (periodPreset === 'last') return `Период: ${ymLabel(shiftYM(currentYM(), -1))} (прошлый месяц).`
    return `Период: ${ymLabel(monthRange!.from)} — ${ymLabel(monthRange!.to)}.`
  }, [periodPreset, monthRange])

  const load = useCallback(async () => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setFetching(true)
    try {
      const params = new URLSearchParams()
      if (monthRange) {
        params.set('month_from', monthRange.from)
        params.set('month_to', monthRange.to)
      }
      const qs = params.toString()
      const url = qs ? `finance/projects-cost?${qs}` : 'finance/projects-cost'
      const r = await api.get<ProjectCostRow[]>(url)
      setRows(r.data || [])
    } catch {
      setRows([])
    } finally {
      setFetching(false)
    }
  }, [user, monthRange])

  useEffect(() => {
    void load()
  }, [load])

  const loadCostFieldUi = useCallback(async () => {
    try {
      const r = await api.get<ProjectsCostUi>('company-ui/projects-cost')
      const next = { ...DEFAULT_COST_FIELD_LABELS }
      for (const row of r.data.fields || []) {
        next[row.field_key] = row.label || DEFAULT_COST_FIELD_LABELS[row.field_key]
      }
      setCostFieldLabels(next)
    } catch {
      setCostFieldLabels(DEFAULT_COST_FIELD_LABELS)
    }
  }, [])

  useEffect(() => {
    if (!loading && user && isFinanceTeamRole(user.role)) {
      void loadCostFieldUi()
    }
  }, [loadCostFieldUi, loading, user])

  const segmentRows = useMemo(() => {
    if (segmentTab === 'hosting') {
      return rows.filter((r) => r.project_category === 'hosting_domain')
    }
    return rows.filter((r) => r.project_category !== 'hosting_domain')
  }, [rows, segmentTab])

  const tableRows = useMemo(() => {
    const raw = tableSearch.trim().toLowerCase()
    if (!raw) return segmentRows
    const tokens = raw.split(/\s+/).filter(Boolean)
    return segmentRows.filter((r) => {
      const cat = categoryLabel(r.project_category)
      const hay = [
        r.partner_name,
        r.project_name,
        r.pm_name,
        r.project_category,
        cat,
        String(r.payment_id),
        String(r.partner_id),
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return tokens.every((t) => hay.includes(t))
    })
  }, [segmentRows, tableSearch])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const cancelCostEdit = useCallback(() => {
    setCostEdit(null)
    setCostDraft('')
    costDraftRef.current = ''
  }, [])

  const startCostEdit = useCallback((row: ProjectCostRow, field: CostFieldApi) => {
    const manKey = COST_MANUAL_FIELD[field]
    const manualRaw = row[manKey]
    const v = moneyCellString(
      manualRaw !== undefined && manualRaw !== null ? String(manualRaw) : String(row[field] ?? '0'),
    )
    setCostEdit({ paymentId: row.payment_id, field })
    setCostDraft(v)
    costDraftRef.current = v
  }, [])

  const commitCostEdit = useCallback(
    async (row: ProjectCostRow, field: CostFieldApi) => {
      if (costSaving) return
      setCostSaving(true)
      try {
        const v = costDraftRef.current.trim() || '0'
        const body = {
          cost_design_uzs:
            field === 'cost_design_uzs'
              ? v
              : moneyCellString(
                  row.cost_design_manual_uzs !== undefined && row.cost_design_manual_uzs !== null
                    ? String(row.cost_design_manual_uzs)
                    : '0',
                ),
          cost_dev_uzs:
            field === 'cost_dev_uzs'
              ? v
              : moneyCellString(
                  row.cost_dev_manual_uzs !== undefined && row.cost_dev_manual_uzs !== null
                    ? String(row.cost_dev_manual_uzs)
                    : '0',
                ),
          cost_other_uzs:
            field === 'cost_other_uzs'
              ? v
              : moneyCellString(
                  row.cost_other_manual_uzs !== undefined && row.cost_other_manual_uzs !== null
                    ? String(row.cost_other_manual_uzs)
                    : '0',
                ),
          cost_seo_uzs:
            field === 'cost_seo_uzs'
              ? v
              : moneyCellString(
                  row.cost_seo_manual_uzs !== undefined && row.cost_seo_manual_uzs !== null
                    ? String(row.cost_seo_manual_uzs)
                    : '0',
                ),
        }
        const res = await api.put<ProjectCostRow>(
          `finance/projects-cost/${row.payment_id}/cost-breakdown`,
          body,
        )
        setRows((prev) => prev.map((x) => (x.payment_id === row.payment_id ? res.data : x)))
        cancelCostEdit()
      } catch {
        /* остаёмся в режиме редактирования */
      } finally {
        setCostSaving(false)
      }
    },
    [costSaving, cancelCostEdit],
  )

  const renderBreakdownCell = (row: ProjectCostRow, field: CostFieldApi) => {
    const open = costEdit?.paymentId === row.payment_id && costEdit.field === field
    const total = Number(row[field]) || 0
    const manual = Number(row[COST_MANUAL_FIELD[field]] ?? 0) || 0
    const fromTasks = Number(row[COST_TASKS_FIELD[field]] ?? 0) || 0
    const titleParts = [
      `Итого: ${formatMoneyNumber(total)}`,
      `в т.ч. ручной ввод: ${formatMoneyNumber(manual)}`,
    ]
    if (fromTasks > 0) titleParts.push(`из задач «Команда»: ${formatMoneyNumber(fromTasks)}`)
    const title = titleParts.join(' · ')
    if (open) {
      return (
        <MoneyInput
          value={costDraft}
          onChange={(v) => {
            setCostDraft(v)
            costDraftRef.current = v
          }}
          autoFocus
          disabled={costSaving}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commitCostEdit(row, field)
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelCostEdit()
            }
          }}
          onBlur={() => void commitCostEdit(row, field)}
          style={{ minWidth: 88, fontSize: 12, padding: '4px 6px' }}
        />
      )
    }
    return (
      <button
        type="button"
        disabled={costSaving}
        onClick={() => startCostEdit(row, field)}
        title={`${title}. Нажмите, чтобы изменить только ручную часть (без задач).`}
        style={{
          ...breakdownBtnStyle,
          cursor: costSaving ? 'wait' : 'pointer',
          opacity: total > 0 ? 1 : 0.75,
        }}
      >
        {total > 0 ? formatMoneyNumber(total) : '—'}
      </button>
    )
  }

  const openLabelEdit = useCallback((field: CostFieldApi) => {
    setLabelEditField(field)
    setLabelDraft(costFieldLabels[field] || DEFAULT_COST_FIELD_LABELS[field])
  }, [costFieldLabels])

  const saveLabelEdit = useCallback(async () => {
    if (!labelEditField || labelSaving) return
    setLabelSaving(true)
    try {
      const nextLabel = labelDraft.trim() || DEFAULT_COST_FIELD_LABELS[labelEditField]
      const body: ProjectsCostUi = {
        fields: (Object.keys(DEFAULT_COST_FIELD_LABELS) as CostFieldApi[]).map((field_key) => ({
          field_key,
          label: field_key === labelEditField ? nextLabel : costFieldLabels[field_key] || DEFAULT_COST_FIELD_LABELS[field_key],
        })),
      }
      const r = await api.put<ProjectsCostUi>('company-ui/projects-cost', body)
      const next = { ...DEFAULT_COST_FIELD_LABELS }
      for (const row of r.data.fields || []) next[row.field_key] = row.label || DEFAULT_COST_FIELD_LABELS[row.field_key]
      setCostFieldLabels(next)
      setLabelEditField(null)
      setLabelDraft('')
    } finally {
      setLabelSaving(false)
    }
  }, [costFieldLabels, labelDraft, labelEditField, labelSaving])

  const renderCostHeader = useCallback((field: CostFieldApi) => {
    const label = costFieldLabels[field] || DEFAULT_COST_FIELD_LABELS[field]
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span>{label}</span>
        {canEditCostLabels ? (
          <button
            type="button"
            onClick={() => openLabelEdit(field)}
            title="Изменить подпись колонки для текущей компании"
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              color: '#64748b',
              fontSize: 12,
              lineHeight: 1,
              fontFamily: 'inherit',
            }}
          >
            ✎
          </button>
        ) : null}
      </div>
    )
  }, [canEditCostLabels, costFieldLabels, openLabelEdit])

  const totals = useMemo(() => {
    let cost = 0
    let internal = 0
    let profit = 0
    let paid = 0
    let design = 0
    let dev = 0
    let other = 0
    let seo = 0
    for (const r of tableRows) {
      cost += Number(r.billing_unit_amount) || 0
      internal += Number(r.internal_cost_sum) || 0
      profit += Number(r.profit_after_manager_uzs ?? r.profit_actual) || 0
      paid += Number(r.sum_paid_actual) || 0
      design += Number(r.cost_design_uzs) || 0
      dev += Number(r.cost_dev_uzs) || 0
      other += Number(r.cost_other_uzs) || 0
      seo += Number(r.cost_seo_uzs) || 0
    }
    return { cost, internal, profit, paid, design, dev, other, seo }
  }, [tableRows])

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  return (
    <Layout>
      <PageHeader
        title="Projects Cost"
        subtitle="Проекты из «Проекты» и график оплат. Раздел «Услуги» — все категории кроме «Хостинг/домен»; хостинг и домен вынесены в отдельный раздел и не смешиваются с итогами услуг. «Прибыль» — маржа после резерва под % менеджера из привязанной строки «Комиссия». Период — пересечение интервала работы с выбранными месяцами."
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <Link href="/payments" style={{ fontSize: 13, fontWeight: 600, color: '#1a6b3c' }}>
            Открыть проекты →
          </Link>
          <BtnOutline type="button" onClick={() => void load()} style={{ fontSize: 12, padding: '6px 12px' }}>
            Обновить
          </BtnOutline>
          <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} aria-hidden />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginRight: 2 }}>РАЗДЕЛ</span>
          {(['services', 'hosting'] as const).map((key) => {
            const labels: Record<typeof key, string> = {
              services: 'Услуги',
              hosting: 'Хостинг / домен',
            }
            const active = segmentTab === key
            return (
              <BtnOutline
                key={key}
                type="button"
                onClick={() => {
                  setSegmentTab(key)
                  setTableSearch('')
                }}
                style={{
                  fontSize: 12,
                  padding: '6px 12px',
                  ...(active
                    ? { background: '#1a6b3c', color: '#fff', borderColor: '#1a6b3c' }
                    : {}),
                }}
              >
                {labels[key]}
              </BtnOutline>
            )
          })}
          {fetching && <span style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка…</span>}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: '#f8fafc',
            borderRadius: 10,
            border: '1px solid #e8e9ef',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginRight: 4 }}>ПЕРИОД</span>
          {(['this', 'last', 'all', 'custom'] as const).map((key) => {
            const labels: Record<typeof key, string> = {
              this: 'Этот месяц',
              last: 'Прошлый месяц',
              all: 'Весь период',
              custom: 'Настройка дат',
            }
            const active = periodPreset === key
            return (
              <BtnOutline
                key={key}
                type="button"
                onClick={() => {
                  setPeriodPreset(key)
                  if (key === 'custom') {
                    const c = currentYM()
                    setCustomFrom((f) => f || c)
                    setCustomTo((t) => t || c)
                  }
                }}
                style={{
                  fontSize: 12,
                  padding: '6px 12px',
                  ...(active
                    ? { background: '#1a6b3c', color: '#fff', borderColor: '#1a6b3c' }
                    : {}),
                }}
              >
                {labels[key]}
              </BtnOutline>
            )
          })}
          {periodPreset === 'custom' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, width: '100%', marginTop: 4 }}>
              <Field label="С месяца">
                <Input type="month" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ maxWidth: 160 }} />
              </Field>
              <Field label="По месяц">
                <Input type="month" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ maxWidth: 160 }} />
              </Field>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{periodHint}</div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: '#f8fafc',
            borderRadius: 10,
            border: '1px solid #e8e9ef',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ПОИСК</span>
          <Input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Партнёр, проект, категория, ПМ, id…"
            autoComplete="off"
            style={{ flex: '1 1 220px', maxWidth: 400, minWidth: 160 }}
          />
          {tableSearch.trim() !== '' && (
            <button
              type="button"
              onClick={() => setTableSearch('')}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Сбросить
            </button>
          )}
        </div>

        <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {rows.length === 0 && !fetching ? (
            <div style={{ padding: 40 }}>
              <Empty
                text={
                  periodPreset === 'all'
                    ? 'Нет активных проектов. Добавьте их в разделе «Проекты».'
                    : 'В выбранном периоде нет проектов, у которых работа пересекает эти месяцы (см. дедлайн и график). Выберите другой период или «Весь период».'
                }
              />
            </div>
          ) : rows.length > 0 && !fetching && segmentRows.length === 0 ? (
            <div style={{ padding: 40 }}>
              <Empty
                text={
                  segmentTab === 'services'
                    ? 'В разделе «Услуги» нет строк: все проекты в периоде относятся к «Хостинг/домен». Переключитесь на соответствующий раздел.'
                    : 'В разделе «Хостинг/домен» нет проектов за выбранный период. Переключитесь на «Услуги» или смените период.'
                }
              />
            </div>
          ) : rows.length > 0 && !fetching && tableRows.length === 0 ? (
            <div style={{ padding: 40 }}>
              <Empty text="Ничего не найдено по поиску. Измените запрос или нажмите «Сбросить»." />
            </div>
          ) : (
            <div
              role="region"
              aria-label="Таблица Projects Cost"
              tabIndex={0}
              onWheel={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                const el = e.currentTarget
                const step = 48
                if (e.key === 'ArrowDown' || e.key === 'PageDown') {
                  el.scrollTop += e.key === 'PageDown' ? el.clientHeight * 0.9 : step
                  e.preventDefault()
                }
                if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                  el.scrollTop -= e.key === 'PageUp' ? el.clientHeight * 0.9 : step
                  e.preventDefault()
                }
              }}
              style={{
                maxHeight: 'min(72vh, calc(100vh - 200px))',
                overflow: 'auto',
                overflowX: 'auto',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                outline: 'none',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 3, boxShadow: '0 1px 0 #e2e8f0' }}>
                  <tr style={{ background: '#f8fafc' }}>
                    <Th style={{ width: 36 }}>№</Th>
                    <Th>Проект</Th>
                    <Th>Партнёр</Th>
                    <Th>Категория</Th>
                    <Th>Стоимость</Th>
                    <Th>Себест.</Th>
                    <Th title="Маржа минус резерв комиссии PM (% из «Комиссия»)">Прибыль</Th>
                    <Th>Оплата факт</Th>
                    <Th>Оплата %</Th>
                    <Th title="% менеджера из учёта комиссий (при привязке к проекту)">% комиссии</Th>
                    <Th title="Итого по статье: ручной ввод в таблице + суммы из задач «Команда», привязанных к проекту">
                      {renderCostHeader('cost_design_uzs')}
                    </Th>
                    <Th title="Итого по статье: ручной ввод в таблице + суммы из задач «Команда», привязанных к проекту">
                      {renderCostHeader('cost_dev_uzs')}
                    </Th>
                    <Th title="Итого по статье: ручной ввод в таблице + суммы из задач «Команда», привязанных к проекту">
                      {renderCostHeader('cost_other_uzs')}
                    </Th>
                    <Th title="Итого по статье: ручной ввод в таблице + суммы из задач «Команда», привязанных к проекту">
                      {renderCostHeader('cost_seo_uzs')}
                    </Th>
                    <Th>Начало</Th>
                    <Th style={{ minWidth: 120 }}>График</Th>
                    <Th>ПМ</Th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, idx) => {
                    const cat = r.project_category || ''
                    const bg = CAT_BG[cat] || '#fff'
                    const isRec = r.is_recurring_billing
                    const pct =
                      r.paid_percent != null && r.paid_percent !== ''
                        ? `${formatMoneyNumber(Number(r.paid_percent))} %`
                        : '—'
                    const open = expanded.has(r.payment_id)
                    return (
                      <Fragment key={r.payment_id}>
                        <tr
                          style={{
                            borderBottom: '1px solid #eef2f7',
                            background: bg,
                          }}
                        >
                          <Td style={{ fontWeight: 600 }}>{idx + 1}</Td>
                          <Td style={{ fontWeight: 600, maxWidth: 200 }}>
                            <Link href="/payments" style={{ color: '#1a1d23', textDecoration: 'none' }} title="Редактировать в «Проекты»">
                              {r.project_name || '—'}
                            </Link>
                          </Td>
                          <Td style={{ color: '#475569', fontSize: 13 }}>{r.partner_name}</Td>
                          <Td>
                            <span style={{ fontWeight: 700, fontSize: 12 }}>{categoryLabel(cat)}</span>
                            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{paymentTypeRu(r.payment_type)}</div>
                          </Td>
                          <Td style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{costDisplay(isRec, r.billing_unit_amount)}</Td>
                          <Td style={{ fontSize: 13, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                            {formatMoneyNumber(Number(r.internal_cost_sum))}
                          </Td>
                          <Td style={{ fontWeight: 700, color: '#1e3a5f', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
                            <div
                              title={
                                Number(r.manager_commission_reserved_uzs) > 0
                                  ? `Маржа: ${formatMoneyNumber(Number(r.profit_actual))}, резерв под комиссию: ${formatMoneyNumber(Number(r.manager_commission_reserved_uzs))}`
                                  : undefined
                              }
                            >
                              <div>{formatMoneyNumber(Number(r.profit_after_manager_uzs ?? r.profit_actual))}</div>
                              {Number(r.manager_commission_reserved_uzs) > 0 && (
                                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
                                  маржа {formatMoneyNumber(Number(r.profit_actual))}
                                </div>
                              )}
                            </div>
                          </Td>
                          <Td style={{ fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>
                            {formatMoneyNumber(Number(r.sum_paid_actual))}
                          </Td>
                          <Td style={{ fontSize: 13 }}>{isRec ? <span style={{ color: '#94a3b8' }}>n/a</span> : pct}</Td>
                          <Td style={{ fontSize: 13, textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700, color: '#2563eb' }}>
                            {r.manager_commission_percent != null && r.manager_commission_percent !== ''
                              ? `${formatMoneyNumber(Number(r.manager_commission_percent))} %`
                              : '—'}
                          </Td>
                          <Td style={{ fontSize: 12, verticalAlign: 'middle' }}>{renderBreakdownCell(r, 'cost_design_uzs')}</Td>
                          <Td style={{ fontSize: 12, verticalAlign: 'middle' }}>{renderBreakdownCell(r, 'cost_dev_uzs')}</Td>
                          <Td style={{ fontSize: 12, verticalAlign: 'middle' }}>{renderBreakdownCell(r, 'cost_other_uzs')}</Td>
                          <Td style={{ fontSize: 12, verticalAlign: 'middle' }}>{renderBreakdownCell(r, 'cost_seo_uzs')}</Td>
                          <Td style={{ fontSize: 13 }}>{formatStart(r.project_start)}</Td>
                          <Td>
                            <button
                              type="button"
                              onClick={() => toggle(r.payment_id)}
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#1a6b3c',
                                background: '#fff',
                                border: '1px solid #c3e6d0',
                                borderRadius: 6,
                                padding: '4px 8px',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              {open ? 'Скрыть' : 'Показать'} ({r.schedule_months.length})
                            </button>
                          </Td>
                          <Td style={{ fontSize: 13 }}>{r.pm_name?.trim() || '—'}</Td>
                        </tr>
                        {open && r.schedule_months.length > 0 && (
                          <tr style={{ background: '#fafbfc' }}>
                            <Td colSpan={COL_COUNT} style={{ padding: '10px 16px 14px', verticalAlign: 'top' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
                                Порядок оплат по месяцам (как в графике проекта)
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {r.schedule_months.map((m) => (
                                  <div
                                    key={m.month}
                                    style={{
                                      padding: '6px 10px',
                                      borderRadius: 8,
                                      fontSize: 12,
                                      border: '1px solid #e2e8f0',
                                      background: m.status === 'paid' ? '#ecfdf5' : '#fff',
                                      color: m.status === 'paid' ? '#166534' : '#64748b',
                                    }}
                                    title={m.description?.trim() || undefined}
                                  >
                                    <strong>{ymLabel(m.month)}</strong>
                                    {' · '}
                                    {formatMoneyNumber(Number(m.amount))}
                                    {m.status === 'paid' ? ' ✓' : ' · ожидается'}
                                  </div>
                                ))}
                              </div>
                            </Td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                {tableRows.length > 0 && (
                  <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
                    <tr style={{ background: '#e2e8f0', fontWeight: 700, boxShadow: '0 -1px 0 #cbd5e1' }}>
                      <Td colSpan={4} style={{ borderTop: '2px solid #94a3b8', color: '#334155' }}>
                        Итого{tableSearch.trim() ? ' (по фильтру)' : ''}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.cost)}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8' }}>{formatMoneyNumber(totals.internal)}</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#1e3a5f' }}>{formatMoneyNumber(totals.profit)}</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#166534' }}>{formatMoneyNumber(totals.paid)}</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#64748b' }}>—</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#64748b' }}>—</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.design)}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.dev)}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.other)}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.seo)}
                      </Td>
                      <Td colSpan={3} style={{ borderTop: '2px solid #94a3b8' }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </Card>

        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, maxWidth: 900 }}>
          Себестоимость по проекту = сумма четырёх колонок (каждая показывает итог: ваш ручной ввод в ячейке плюс распределение
          из задач «Команда», где строка привязана к этому проекту и статье). Редактирование ячейки меняет только ручную часть.
          Для USD-задач в сводку попадают суммы по курсу месяца даты задачи из «Доступные средства». Строка «Итого» относится
          только к текущему разделу («Услуги» или «Хостинг/домен»); при поиске суммируются видимые строки.
        </div>
      </div>
      <Modal
        open={labelEditField !== null}
        onClose={() => {
          if (labelSaving) return
          setLabelEditField(null)
          setLabelDraft('')
        }}
        title="Подпись колонки себестоимости"
        width={460}
        footer={
          <>
            <BtnOutline
              type="button"
              onClick={() => {
                setLabelEditField(null)
                setLabelDraft('')
              }}
              disabled={labelSaving}
            >
              Отмена
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void saveLabelEdit()} disabled={labelSaving}>
              {labelSaving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.45, marginBottom: 12 }}>
          Подпись меняется только для текущей компании. Сами поля себестоимости и расчёты остаются теми же.
        </div>
        <Field label="Название колонки">
          <Input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="Например: Дизайн / Продакшн / PM / Маркетинг"
            autoFocus
          />
        </Field>
      </Modal>
    </Layout>
  )
}
