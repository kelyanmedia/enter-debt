import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, Empty, formatMoneyNumber, BtnOutline, MoneyInput, Input, Field } from '@/components/ui'
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
  cost_design_uzs: string
  cost_dev_uzs: string
  cost_other_uzs: string
  cost_seo_uzs: string
  internal_cost_sum: string
  profit_actual: string
}

const COL_COUNT = 16

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

function formatStart(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const CAT_BG: Record<string, string> = {
  web: '#fff4e6',
  ppc: '#e8f4fc',
  seo: '#f3e8ff',
  mobile_app: '#ecfdf5',
  tech_support: '#f1f5f9',
  hosting_domain: '#fef3c7',
}

function categoryLabel(cat?: string | null) {
  if (!cat) return '—'
  const m: Record<string, string> = {
    web: 'WEB',
    ppc: 'PPC',
    seo: 'SEO',
    mobile_app: 'App',
    tech_support: 'Поддержка',
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
    load()
  }, [load])

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
    const v = moneyCellString(row[field])
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
          cost_design_uzs: field === 'cost_design_uzs' ? v : moneyCellString(row.cost_design_uzs),
          cost_dev_uzs: field === 'cost_dev_uzs' ? v : moneyCellString(row.cost_dev_uzs),
          cost_other_uzs: field === 'cost_other_uzs' ? v : moneyCellString(row.cost_other_uzs),
          cost_seo_uzs: field === 'cost_seo_uzs' ? v : moneyCellString(row.cost_seo_uzs),
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
    const n = Number(row[field]) || 0
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
        title="Нажмите, чтобы ввести сумму"
        style={{
          ...breakdownBtnStyle,
          cursor: costSaving ? 'wait' : 'pointer',
          opacity: n > 0 ? 1 : 0.75,
        }}
      >
        {n > 0 ? formatMoneyNumber(n) : '—'}
      </button>
    )
  }

  const totals = useMemo(() => {
    let cost = 0
    let internal = 0
    let profit = 0
    let paid = 0
    let design = 0
    let dev = 0
    let other = 0
    let seo = 0
    for (const r of rows) {
      cost += Number(r.billing_unit_amount) || 0
      internal += Number(r.internal_cost_sum) || 0
      profit += Number(r.profit_actual) || 0
      paid += Number(r.sum_paid_actual) || 0
      design += Number(r.cost_design_uzs) || 0
      dev += Number(r.cost_dev_uzs) || 0
      other += Number(r.cost_other_uzs) || 0
      seo += Number(r.cost_seo_uzs) || 0
    }
    return { cost, internal, profit, paid, design, dev, other, seo }
  }, [rows])

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  return (
    <Layout>
      <PageHeader
        title="Projects Cost"
        subtitle="Проекты из «Проекты» и график оплат. В списке за месяц — проекты, у которых интервал работы пересекает этот календарный месяц: от даты начала (создание и первый месяц графика) до дедлайна проекта или, если его нет, до последней даты в графике (срок строки или конец последнего месяца услуги). Без графика — по месяцу создания или оплаты. Клик по «Дизайн», «Разраб.», «Прочее», «SEO» — ввод сумм; «Себест.» = их сумма, прибыль = оплата факт − себестоимость."
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <Link href="/payments" style={{ fontSize: 13, fontWeight: 600, color: '#1a6b3c' }}>
            Открыть проекты →
          </Link>
          <BtnOutline type="button" onClick={() => void load()} style={{ fontSize: 12, padding: '6px 12px' }}>
            Обновить
          </BtnOutline>
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
                    <Th>Прибыль</Th>
                    <Th>Оплата факт</Th>
                    <Th>Оплата %</Th>
                    <Th>Дизайн</Th>
                    <Th>Разраб.</Th>
                    <Th>Прочее</Th>
                    <Th>SEO</Th>
                    <Th>Начало</Th>
                    <Th style={{ minWidth: 120 }}>График</Th>
                    <Th>ПМ</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
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
                          <Td style={{ fontWeight: 700, color: '#1e3a5f' }}>
                            {formatMoneyNumber(Number(r.profit_actual))}
                          </Td>
                          <Td style={{ fontWeight: 700, color: '#166534' }}>
                            {formatMoneyNumber(Number(r.sum_paid_actual))}
                          </Td>
                          <Td style={{ fontSize: 13 }}>{isRec ? <span style={{ color: '#94a3b8' }}>n/a</span> : pct}</Td>
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
                {rows.length > 0 && (
                  <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
                    <tr style={{ background: '#e2e8f0', fontWeight: 700, boxShadow: '0 -1px 0 #cbd5e1' }}>
                      <Td colSpan={4} style={{ borderTop: '2px solid #94a3b8', color: '#334155' }}>
                        Итого
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', whiteSpace: 'nowrap' }}>
                        {formatMoneyNumber(totals.cost)}
                      </Td>
                      <Td style={{ borderTop: '2px solid #94a3b8' }}>{formatMoneyNumber(totals.internal)}</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#1e3a5f' }}>{formatMoneyNumber(totals.profit)}</Td>
                      <Td style={{ borderTop: '2px solid #94a3b8', color: '#166534' }}>{formatMoneyNumber(totals.paid)}</Td>
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
          Себестоимость по проекту = сумма четырёх колонок. Раньше введённая одна сумма «Себест.» при обновлении переносится в
          «Прочее». В «Итого» по стоимости суммируются ставки за период и разовые суммы в одной шкале (для отчётности).
        </div>
      </div>
    </Layout>
  )
}
