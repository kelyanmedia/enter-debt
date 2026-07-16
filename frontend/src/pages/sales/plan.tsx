import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { EntityCarousel } from '@/components/EntityCarousel'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { canBrowseTeamManagers, hasCrmPipelineAccess, isSalesRop } from '@/lib/salesAccess'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type Currency = 'UZS' | 'USD'

type Category = {
  id: number
  name: string
  color: string
  avg_check: number | null
  sort_order: number
  is_archived: boolean
}

type MonthCell = { month: number; plan_amount: number; fact_amount: number }

type MatrixRow = {
  category: Category
  months: MonthCell[]
  plan_total: number
  fact_total: number
}

type SalesPlanData = {
  year: number
  manager_user_id: number | null
  read_only: boolean
  currency: {
    usd_to_uzs_rate: number
    rate_period_month: string
    rate_source: string
  }
  categories: Category[]
  matrix: MatrixRow[]
  totals: {
    by_month: MonthCell[]
    plan_total: number
    fact_total: number
  }
  kpis: {
    plan_year: number
    fact_to_date: number
    pct_complete: number
    forecast_year: number
    elapsed_months: number
  }
  has_any_plan: boolean
}

type SalesUser = { id: number; name: string; role: string }

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  mop: 'МОП',
  manager: 'Менеджер',
}

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: 22,
  boxShadow: '0 10px 30px rgba(15,23,42,.07)',
  border: '1px solid #edf0f5',
}

const KPI_STYLES = [
  { bg: 'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%)', accent: '#22c55e' },
  { bg: 'linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)', accent: '#3b82f6' },
  { bg: 'linear-gradient(135deg,#fff7ed 0%,#ffedd5 100%)', accent: '#f97316' },
  { bg: 'linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%)', accent: '#8b5cf6' },
]

function fmtGrouped(n: number) {
  return Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')
}

function fmtMoney(n: number, currency: Currency, rate: number) {
  if (currency === 'USD') {
    const usd = rate > 0 ? n / rate : 0
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
    if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`
    return `$${Math.round(usd).toLocaleString('en-US')}`
  }
  return `${fmtGrouped(n)} сум`
}

function fmtCompact(n: number, currency: Currency, rate: number) {
  if (currency === 'USD') return fmtMoney(n, currency, rate)
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${fmtGrouped(Math.round(abs / 1_000_000_000))} млрд`
  if (abs >= 1_000_000) return `${fmtGrouped(Math.round(abs / 1_000_000))} млн`
  if (abs >= 1_000) return `${fmtGrouped(Math.round(abs / 1_000))} тыс`
  return fmtGrouped(abs)
}

function fmtAxis(n: number, currency: Currency, rate: number) {
  const v = currency === 'USD' && rate > 0 ? n / rate : n
  if (v >= 1_000_000_000) return `${Math.round(v / 1_000_000_000)} млрд`
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} млн`
  if (v >= 1_000) return `${Math.round(v / 1_000)} тыс`
  return `${Math.round(v)}`
}

/** 250м / 1.5млрд / 250000000 */
function parseMoneyInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s/g, '').replace(',', '.')
  if (!s) return 0
  const m = s.match(/^(\d+(?:\.\d+)?)(млрд|млн|м|k|к)?$/)
  if (!m) {
    const n = Number(s.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? Math.round(n) : null
  }
  const num = Number(m[1])
  if (!Number.isFinite(num)) return null
  const suf = m[2]
  if (suf === 'млрд') return Math.round(num * 1_000_000_000)
  if (suf === 'млн' || suf === 'м') return Math.round(num * 1_000_000)
  if (suf === 'k' || suf === 'к') return Math.round(num * 1_000)
  return Math.round(num)
}

function progressColor(pct: number) {
  if (pct >= 100) return '#22c55e'
  if (pct >= 70) return '#eab308'
  return '#ef4444'
}

function EmptyPlan({ year, onCreate }: { year: number; onCreate: () => void }) {
  return (
    <div style={{ ...CARD, padding: '56px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 12 }}>📋</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
        План продаж на {year} ещё не заполнен
      </div>
      <div style={{ fontSize: 14, color: '#64748b', marginBottom: 22, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
        Задайте план по направлениям — диаграммы и KPI появятся автоматически. Можно распределить годовую сумму по месяцам.
      </div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          background: 'linear-gradient(135deg,#22c55e,#16a34a)',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          padding: '12px 22px',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Создать план на {year}
      </button>
    </div>
  )
}

export default function SalesPlanPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const canAccess = hasCrmPipelineAccess(user)
  const showManagerPicker = canBrowseTeamManagers(user)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [data, setData] = useState<SalesPlanData | null>(null)
  const [fetching, setFetching] = useState(false)
  const [currency, setCurrency] = useState<Currency>('UZS')
  const [mode, setMode] = useState<'plan' | 'fact' | 'both'>('both')
  const [donutMode, setDonutMode] = useState<'plan' | 'fact'>('plan')
  const [progressScope, setProgressScope] = useState<'year' | number>('year')
  const [visibleCatIds, setVisibleCatIds] = useState<number[] | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [editing, setEditing] = useState<{ catId: number; month: number; field: 'plan' | 'fact' } | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [catModal, setCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState('#3b82f6')
  const [distModal, setDistModal] = useState<{ catId: number; name: string } | null>(null)
  const [distAmount, setDistAmount] = useState('')
  const [showEmptyHint, setShowEmptyHint] = useState(true)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const managersReady = !showManagerPicker || salesUsers.length > 0

  useEffect(() => {
    if (!loading && user && !canAccess) void router.replace('/')
  }, [loading, user, canAccess, router])

  useEffect(() => {
    if (!user || !canAccess || !showManagerPicker) return
    void (async () => {
      try {
        const r = await api.get<SalesUser[]>('sales/users-list')
        setSalesUsers(r.data)
      } catch {
        setSalesUsers([])
      }
    })()
  }, [user, canAccess, showManagerPicker])

  const managerItems = useMemo(() => {
    if (!showManagerPicker || !user) return []
    const mops = salesUsers
      .filter((u) => u.role === 'mop')
      .map((u) => ({ id: u.id as number | null, name: u.name, subtitle: ROLE_LABELS[u.role] || u.role }))
    const managers = salesUsers
      .filter((u) => u.role === 'manager')
      .map((u) => ({ id: u.id as number | null, name: u.name, subtitle: ROLE_LABELS[u.role] || u.role }))
    if (user.role === 'admin') {
      return [
        { id: null, name: 'Все менеджеры', subtitle: 'Сводка по команде' },
        { id: user.id, name: user.name || 'Админ', subtitle: 'Мой план' },
        ...mops,
        ...managers,
      ]
    }
    if (isSalesRop(user)) {
      return [
        { id: user.id, name: user.name || 'Мой план', subtitle: 'Мой план' },
        ...mops.filter((u) => u.id !== user.id),
      ]
    }
    return []
  }, [showManagerPicker, user, salesUsers])

  useEffect(() => {
    if (!showManagerPicker || managerItems.length === 0) return
    setSelectedManagerId((prev) =>
      managerItems.some((i) => i.id === prev) ? prev : managerItems[0].id,
    )
  }, [showManagerPicker, managerItems])

  const managerParams = useMemo(() => {
    if (!showManagerPicker) return {}
    if (selectedManagerId == null) return {}
    return { manager_user_id: selectedManagerId }
  }, [showManagerPicker, selectedManagerId])

  const load = useCallback(async () => {
    if (!user || !canAccess) return
    if (showManagerPicker && !managersReady) return
    setFetching(true)
    try {
      const r = await api.get<SalesPlanData>('sales/plan', {
        params: { year, ...managerParams },
      })
      setData(r.data)
      if (visibleCatIds === null && r.data.matrix.length) {
        setVisibleCatIds(r.data.matrix.map((m) => m.category.id))
      }
    } catch {
      setData(null)
    } finally {
      setFetching(false)
    }
  }, [user, canAccess, year, visibleCatIds, showManagerPicker, managersReady, managerParams])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, user, canAccess, selectedManagerId, managersReady])

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editing])

  const rate = data?.currency.usd_to_uzs_rate || 0

  const filteredMatrix = useMemo(() => {
    if (!data) return []
    const ids = visibleCatIds
    if (!ids) return data.matrix
    return data.matrix.filter((r) => ids.includes(r.category.id))
  }, [data, visibleCatIds])

  const filteredTotals = useMemo(() => {
    const by_month = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      plan_amount: 0,
      fact_amount: 0,
    }))
    let plan_total = 0
    let fact_total = 0
    for (const row of filteredMatrix) {
      plan_total += row.plan_total
      fact_total += row.fact_total
      row.months.forEach((m, i) => {
        by_month[i].plan_amount += m.plan_amount
        by_month[i].fact_amount += m.fact_amount
      })
    }
    return { by_month, plan_total, fact_total }
  }, [filteredMatrix])

  const barData = useMemo(
    () =>
      filteredTotals.by_month.map((m, i) => ({
        name: MONTHS[i],
        plan: m.plan_amount,
        fact: m.fact_amount,
        pct: m.plan_amount > 0 ? Math.round((m.fact_amount / m.plan_amount) * 100) : 0,
      })),
    [filteredTotals],
  )

  const cumulativeData = useMemo(() => {
    let cp = 0
    let cf = 0
    return filteredTotals.by_month.map((m, i) => {
      cp += m.plan_amount
      cf += m.fact_amount
      return { name: MONTHS[i], plan: cp, fact: cf }
    })
  }, [filteredTotals])

  const donutData = useMemo(() => {
    return filteredMatrix
      .map((r) => ({
        name: r.category.name,
        value: donutMode === 'plan' ? r.plan_total : r.fact_total,
        color: r.category.color,
      }))
      .filter((d) => d.value > 0)
  }, [filteredMatrix, donutMode])

  const progressRows = useMemo(() => {
    return filteredMatrix.map((r) => {
      let plan = r.plan_total
      let fact = r.fact_total
      if (progressScope !== 'year') {
        const cell = r.months.find((m) => m.month === progressScope)
        plan = cell?.plan_amount || 0
        fact = cell?.fact_amount || 0
      }
      const pct = plan > 0 ? Math.round((fact / plan) * 100) : fact > 0 ? 100 : 0
      return { id: r.category.id, name: r.category.name, color: r.category.color, plan, fact, pct }
    })
  }, [filteredMatrix, progressScope])

  const kpis = useMemo(() => {
    if (!data) return null
    const elapsed = data.kpis.elapsed_months
    const factToDate = filteredTotals.by_month.slice(0, elapsed).reduce((s, m) => s + m.fact_amount, 0)
    const planToDate = filteredTotals.by_month.slice(0, elapsed).reduce((s, m) => s + m.plan_amount, 0)
    const pct = planToDate > 0 ? Math.round((factToDate / planToDate) * 1000) / 10 : 0
    const forecast = elapsed > 0 ? Math.round((factToDate / elapsed) * 12) : 0
    return {
      plan_year: filteredTotals.plan_total,
      fact_to_date: factToDate,
      pct_complete: pct,
      forecast_year: forecast,
    }
  }, [data, filteredTotals])

  const markSaved = () => {
    setSaveState('saved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setSaveState('idle'), 1800)
  }

  const saveCell = async (catId: number, month: number, field: 'plan' | 'fact', value: number) => {
    if (data?.read_only) return
    setSaveState('saving')
    try {
      await api.put('sales/plan/entries', {
        category_id: catId,
        year,
        month,
        [field === 'plan' ? 'plan_amount' : 'fact_amount']: value,
        ...managerParams,
      })
      setData((prev) => {
        if (!prev) return prev
        const matrix = prev.matrix.map((row) => {
          if (row.category.id !== catId) return row
          const months = row.months.map((m) =>
            m.month === month ? { ...m, [field === 'plan' ? 'plan_amount' : 'fact_amount']: value } : m,
          )
          const plan_total = months.reduce((s, m) => s + m.plan_amount, 0)
          const fact_total = months.reduce((s, m) => s + m.fact_amount, 0)
          return { ...row, months, plan_total, fact_total }
        })
        const by_month = Array.from({ length: 12 }, (_, i) => {
          let plan_amount = 0
          let fact_amount = 0
          for (const r of matrix) {
            plan_amount += r.months[i].plan_amount
            fact_amount += r.months[i].fact_amount
          }
          return { month: i + 1, plan_amount, fact_amount }
        })
        return {
          ...prev,
          matrix,
          totals: {
            by_month,
            plan_total: by_month.reduce((s, m) => s + m.plan_amount, 0),
            fact_total: by_month.reduce((s, m) => s + m.fact_amount, 0),
          },
          has_any_plan: true,
        }
      })
      setShowEmptyHint(false)
      markSaved()
    } catch {
      setSaveState('error')
    }
  }

  const commitEdit = async () => {
    if (!editing) return
    const parsed = parseMoneyInput(editDraft)
    setEditing(null)
    if (parsed === null) return
    await saveCell(editing.catId, editing.month, editing.field, parsed)
  }

  const startEdit = (catId: number, month: number, field: 'plan' | 'fact', current: number) => {
    if (data?.read_only) return
    setEditing({ catId, month, field })
    setEditDraft(current ? String(current) : '')
  }

  const createCategory = async () => {
    const name = newCatName.trim()
    if (!name) return
    try {
      await api.post('sales/plan/categories', { name, color: newCatColor })
      setCatModal(false)
      setNewCatName('')
      setVisibleCatIds(null)
      await load()
    } catch (e) {
      alert('Не удалось добавить направление')
    }
  }

  const archiveCategory = async (id: number) => {
    if (!window.confirm('Архивировать направление? Данные сохранятся, но строка исчезнет из таблицы.')) return
    await api.patch(`sales/plan/categories/${id}`, { is_archived: true })
    setVisibleCatIds(null)
    await load()
  }

  const distribute = async () => {
    if (!distModal || data?.read_only) return
    const amount = parseMoneyInput(distAmount)
    if (amount === null || amount < 0) {
      alert('Укажите сумму')
      return
    }
    setSaveState('saving')
    try {
      const r = await api.post<SalesPlanData>('sales/plan/distribute', {
        category_id: distModal.catId,
        year,
        annual_plan: amount,
        field: 'plan',
        ...managerParams,
      })
      setData(r.data)
      setDistModal(null)
      setDistAmount('')
      setShowEmptyHint(false)
      markSaved()
    } catch {
      setSaveState('error')
    }
  }

  const copyPrevYear = async () => {
    if (data?.read_only) return
    if (!window.confirm(`Скопировать план из ${year - 1} в ${year}?`)) return
    setSaveState('saving')
    try {
      const r = await api.post<SalesPlanData>('sales/plan/copy', {
        year,
        mode: 'prev_year',
        field: 'plan',
        ...managerParams,
      })
      setData(r.data)
      setShowEmptyHint(false)
      markSaved()
    } catch {
      setSaveState('error')
    }
  }

  const exportCsv = () => {
    void (async () => {
      try {
        const qs = new URLSearchParams({ year: String(year) })
        if (managerParams.manager_user_id != null) {
          qs.set('manager_user_id', String(managerParams.manager_user_id))
        }
        const r = await api.get(`sales/plan/export?${qs.toString()}`, { responseType: 'blob' })
        const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `sales-plan-${year}.csv`
        a.click()
        URL.revokeObjectURL(a.href)
      } catch {
        alert('Не удалось экспортировать')
      }
    })()
  }

  if (loading || !user || !canAccess) return null

  const showEmpty = Boolean(data && !data.has_any_plan && showEmptyHint)
  const readOnly = Boolean(data?.read_only)
  const currentManager = managerItems.find((m) => m.id === selectedManagerId)

  return (
    <Layout>
      <div style={{ padding: '22px 24px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14, justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              План продаж
              {showManagerPicker && currentManager && selectedManagerId != null ? (
                <span style={{ fontWeight: 600, color: '#64748b', fontSize: 18 }}> · {currentManager.name}</span>
              ) : null}
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b', maxWidth: 520 }}>
              Планирование по направлениям и месяцам. План и факт сохраняются по каждому месяцу
              {showManagerPicker ? ' и по каждому менеджеру' : ''}.
            </p>
            {showManagerPicker && managerItems.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <EntityCarousel
                  items={managerItems}
                  value={selectedManagerId}
                  onChange={setSelectedManagerId}
                  ariaLabel="Менеджер"
                />
              </div>
            )}
            {readOnly ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                Сводка по всем менеджерам — только просмотр. Выберите менеджера, чтобы редактировать.
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 12, border: '1px solid #e8e9ef', padding: '4px 6px' }}>
              <button type="button" onClick={() => setYear((y) => y - 1)} style={navBtn}>‹</button>
              <span style={{ fontWeight: 800, fontSize: 15, minWidth: 56, textAlign: 'center' }}>{year}</span>
              <button type="button" onClick={() => setYear((y) => y + 1)} style={navBtn}>›</button>
            </div>
            <div style={{ display: 'flex', background: '#fff', borderRadius: 12, border: '1px solid #e8e9ef', overflow: 'hidden' }}>
              {(['UZS', 'USD'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  style={{
                    ...toggleBtn,
                    background: currency === c ? '#0f172a' : 'transparent',
                    color: currency === c ? '#fff' : '#64748b',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <button type="button" onClick={exportCsv} style={outlineBtn}>
              ↗ Экспорт отчёта
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: saveState === 'error' ? '#ef4444' : '#64748b', minWidth: 90 }}>
              {saveState === 'saving' ? 'Сохранение…' : saveState === 'saved' ? '✓ Сохранено' : saveState === 'error' ? 'Ошибка' : ''}
            </span>
          </div>
        </div>

        {data?.currency.usd_to_uzs_rate ? (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Курс ДДС: 1 USD = {fmtGrouped(data.currency.usd_to_uzs_rate)} UZS
            {data.currency.rate_period_month ? ` (${data.currency.rate_period_month})` : ''}
          </div>
        ) : null}

        {fetching && !data ? (
          <div style={{ ...CARD, padding: 40, textAlign: 'center', color: '#64748b' }}>Загрузка…</div>
        ) : showEmpty ? (
          <EmptyPlan
            year={year}
            onCreate={() => {
              setShowEmptyHint(false)
              if (data?.matrix[0]) {
                setDistModal({ catId: data.matrix[0].category.id, name: data.matrix[0].category.name })
              }
            }}
          />
        ) : (
          <>
            {/* KPI */}
            {kpis && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                {[
                  { label: 'План на год', value: fmtMoney(kpis.plan_year, currency, rate), hint: 'Сумма плана по всем направлениям' },
                  { label: 'Факт на текущую дату', value: fmtMoney(kpis.fact_to_date, currency, rate), hint: 'Факт за прошедшие месяцы года' },
                  { label: '% выполнения', value: `${kpis.pct_complete} %`, hint: 'Факт / план за прошедшие месяцы' },
                  { label: 'Прогноз до конца года', value: fmtMoney(kpis.forecast_year, currency, rate), hint: 'Факт ÷ прошедшие месяцы × 12' },
                ].map((k, i) => (
                  <div
                    key={k.label}
                    style={{
                      ...CARD,
                      padding: '18px 20px',
                      background: KPI_STYLES[i].bg,
                      borderColor: 'transparent',
                    }}
                    title={k.hint}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {k.label}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                      {k.value}
                    </div>
                    <div style={{ marginTop: 8, height: 4, borderRadius: 4, background: `${KPI_STYLES[i].accent}33` }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: 4,
                          width: i === 2 ? `${Math.min(100, kpis.pct_complete)}%` : '70%',
                          background: KPI_STYLES[i].accent,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14 }}>
              <div style={{ ...CARD, padding: '18px 18px 8px' }}>
                <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>План vs Факт по месяцам</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Две колонки на месяц</div>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => fmtAxis(Number(v), currency, rate)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          fmtMoney(Number(value), currency, rate),
                          name === 'plan' ? 'План' : 'Факт',
                        ]}
                        labelFormatter={(label, payload) => {
                          const pct = payload?.[0]?.payload?.pct
                          return `${label}${pct != null ? ` · ${pct}%` : ''}`
                        }}
                        contentStyle={{ borderRadius: 12, border: '1px solid #e8e9ef', fontSize: 12 }}
                      />
                      <Legend formatter={(v) => (v === 'plan' ? 'План' : 'Факт')} />
                      <Bar dataKey="plan" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="fact" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ ...CARD, padding: '18px 18px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>Структура по направлениям</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Donut</div>
                  </div>
                  <div style={{ display: 'flex', background: '#f8fafc', borderRadius: 10, overflow: 'hidden', border: '1px solid #e8e9ef' }}>
                    {(['plan', 'fact'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDonutMode(m)}
                        style={{
                          ...toggleBtn,
                          padding: '6px 10px',
                          background: donutMode === m ? '#fff' : 'transparent',
                          color: donutMode === m ? '#0f172a' : '#94a3b8',
                          boxShadow: donutMode === m ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
                        }}
                      >
                        {m === 'plan' ? 'План' : 'Факт'}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ width: '100%', height: 260, display: 'flex', alignItems: 'center' }}>
                  {donutData.length === 0 ? (
                    <div style={{ width: '100%', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Нет данных</div>
                  ) : (
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2}>
                          {donutData.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmtMoney(Number(v), currency, rate)} contentStyle={{ borderRadius: 12, border: '1px solid #e8e9ef', fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            {/* Cumulative */}
            <div style={{ ...CARD, padding: '18px 18px 8px' }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Накопительный план и факт</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Кумулятив с начала года — видно отставание или опережение</div>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <AreaChart data={cumulativeData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="planGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="factGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => fmtAxis(Number(v), currency, rate)} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={52} />
                    <Tooltip formatter={(v: number, name: string) => [fmtMoney(Number(v), currency, rate), name === 'plan' ? 'План' : 'Факт']} contentStyle={{ borderRadius: 12, border: '1px solid #e8e9ef', fontSize: 12 }} />
                    <Area type="monotone" dataKey="plan" stroke="#94a3b8" fill="url(#planGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="fact" stroke="#3b82f6" fill="url(#factGrad)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Progress bars */}
            <div style={{ ...CARD, padding: 18 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Выполнение по направлениям</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>&lt;70% красный · 70–99% жёлтый · ≥100% зелёный</div>
                </div>
                <select
                  value={progressScope === 'year' ? 'year' : String(progressScope)}
                  onChange={(e) => setProgressScope(e.target.value === 'year' ? 'year' : Number(e.target.value))}
                  style={selectStyle}
                >
                  <option value="year">Весь год</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {progressRows.map((r) => (
                  <div key={r.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5, fontSize: 13 }}>
                      <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 99, background: r.color, display: 'inline-block' }} />
                        {r.name}
                      </span>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>
                        {fmtCompact(r.fact, currency, rate)} / {fmtCompact(r.plan, currency, rate)} ·{' '}
                        <span style={{ color: progressColor(r.pct) }}>{r.pct}%</span>
                      </span>
                    </div>
                    <div style={{ height: 10, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, r.pct)}%`,
                          background: progressColor(r.pct),
                          borderRadius: 99,
                          transition: 'width .3s',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Toolbar for matrix */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', background: '#fff', borderRadius: 12, border: '1px solid #e8e9ef', overflow: 'hidden' }}>
                {([
                  ['both', 'План + Факт'],
                  ['plan', 'Только план'],
                  ['fact', 'Только факт'],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMode(k)}
                    style={{
                      ...toggleBtn,
                      background: mode === k ? '#0f172a' : 'transparent',
                      color: mode === k ? '#fff' : '#64748b',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setCatModal(true)} style={outlineBtn} disabled={readOnly}>+ Направление</button>
              <button type="button" onClick={() => void copyPrevYear()} style={outlineBtn} disabled={readOnly}>Скопировать план прошлого года</button>
              <button type="button" onClick={() => void load()} style={outlineBtn} disabled={fetching}>
                {fetching ? '…' : 'Обновить'}
              </button>
            </div>

            {/* Matrix */}
            <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th
                        style={{
                          ...thSticky,
                          textAlign: 'left',
                          minWidth: 180,
                        }}
                      >
                        Направление
                      </th>
                      {MONTHS.map((m) => (
                        <th key={m} style={{ ...thCell, minWidth: mode === 'both' ? 108 : 88 }}>{m}</th>
                      ))}
                      <th style={{ ...thCell, minWidth: 110 }}>Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatrix.map((row) => (
                      <tr key={row.category.id} style={{ borderBottom: '1px solid #eef2f7' }}>
                        <td style={{ ...tdSticky, fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 99, background: row.category.color, flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.category.name}</div>
                              {row.category.avg_check ? (
                                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                                  ср. чек {fmtCompact(row.category.avg_check, currency, rate)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            {!readOnly && (
                              <button
                                type="button"
                                style={miniLink}
                                onClick={() => setDistModal({ catId: row.category.id, name: row.category.name })}
                              >
                                ÷ на 12
                              </button>
                            )}
                            {!readOnly && (
                              <button type="button" style={{ ...miniLink, color: '#94a3b8' }} onClick={() => void archiveCategory(row.category.id)}>
                                архив
                              </button>
                            )}
                          </div>
                        </td>
                        {row.months.map((cell) => (
                          <td key={cell.month} style={{ ...tdCell, verticalAlign: 'top' }}>
                            {(mode === 'plan' || mode === 'both') && (
                              <EditableCell
                                label={mode === 'both' ? 'П' : undefined}
                                value={cell.plan_amount}
                                currency={currency}
                                rate={rate}
                                editing={
                                  editing?.catId === row.category.id &&
                                  editing.month === cell.month &&
                                  editing.field === 'plan'
                                }
                                draft={editDraft}
                                inputRef={editInputRef}
                                onStart={() => startEdit(row.category.id, cell.month, 'plan', cell.plan_amount)}
                                onDraft={setEditDraft}
                                onCommit={() => void commitEdit()}
                                onCancel={() => setEditing(null)}
                                tone="#64748b"
                              />
                            )}
                            {(mode === 'fact' || mode === 'both') && (
                              <EditableCell
                                label={mode === 'both' ? 'Ф' : undefined}
                                value={cell.fact_amount}
                                currency={currency}
                                rate={rate}
                                editing={
                                  editing?.catId === row.category.id &&
                                  editing.month === cell.month &&
                                  editing.field === 'fact'
                                }
                                draft={editDraft}
                                inputRef={editInputRef}
                                onStart={() => startEdit(row.category.id, cell.month, 'fact', cell.fact_amount)}
                                onDraft={setEditDraft}
                                onCommit={() => void commitEdit()}
                                onCancel={() => setEditing(null)}
                                tone="#166534"
                              />
                            )}
                          </td>
                        ))}
                        <td style={{ ...tdCell, fontWeight: 800, verticalAlign: 'top' }}>
                          {(mode === 'plan' || mode === 'both') && (
                            <div style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{fmtCompact(row.plan_total, currency, rate)}</div>
                          )}
                          {(mode === 'fact' || mode === 'both') && (
                            <div style={{ color: '#166534', whiteSpace: 'nowrap', marginTop: mode === 'both' ? 4 : 0 }}>
                              {fmtCompact(row.fact_total, currency, rate)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#e2e8f0', fontWeight: 800 }}>
                      <td style={{ ...tdSticky, background: '#e2e8f0' }}>Итого</td>
                      {filteredTotals.by_month.map((m) => (
                        <td key={m.month} style={{ ...tdCell, verticalAlign: 'top' }}>
                          {(mode === 'plan' || mode === 'both') && (
                            <div style={{ color: '#334155', whiteSpace: 'nowrap' }}>{fmtCompact(m.plan_amount, currency, rate)}</div>
                          )}
                          {(mode === 'fact' || mode === 'both') && (
                            <div style={{ color: '#166534', whiteSpace: 'nowrap', marginTop: mode === 'both' ? 4 : 0 }}>
                              {fmtCompact(m.fact_amount, currency, rate)}
                            </div>
                          )}
                        </td>
                      ))}
                      <td style={{ ...tdCell, verticalAlign: 'top' }}>
                        {(mode === 'plan' || mode === 'both') && (
                          <div style={{ color: '#334155', whiteSpace: 'nowrap' }}>{fmtCompact(filteredTotals.plan_total, currency, rate)}</div>
                        )}
                        {(mode === 'fact' || mode === 'both') && (
                          <div style={{ color: '#166534', whiteSpace: 'nowrap', marginTop: mode === 'both' ? 4 : 0 }}>
                            {fmtCompact(filteredTotals.fact_total, currency, rate)}
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '10px 16px', fontSize: 11, color: '#94a3b8', borderTop: '1px solid #eef2f7' }}>
                Клик по ячейке — ввод. Поддерживаются сокращения: <code>250м</code> = 250 млн, <code>1.5млрд</code> = 1.5 млрд. Автосохранение при уходе с ячейки.
              </div>
            </div>
          </>
        )}
      </div>

      {/* Category modal */}
      {catModal && (
        <ModalShell title="Новое направление" onClose={() => setCatModal(false)}>
          <label style={labelStyle}>Название</label>
          <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} style={inputStyle} placeholder="Например: Консалтинг" autoFocus />
          <label style={{ ...labelStyle, marginTop: 12 }}>Цвет</label>
          <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} style={{ width: 48, height: 36, border: 'none', background: 'transparent', cursor: 'pointer' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" style={outlineBtn} onClick={() => setCatModal(false)}>Отмена</button>
            <button type="button" style={primaryBtn} onClick={() => void createCategory()}>Добавить</button>
          </div>
        </ModalShell>
      )}

      {/* Distribute modal */}
      {distModal && (
        <ModalShell title={`Распределить на год · ${distModal.name}`} onClose={() => setDistModal(null)}>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
            Введите годовую сумму плана — она разделится поровну на 12 месяцев (остаток добавится к первым месяцам).
          </p>
          <label style={labelStyle}>Сумма плана на год (сум)</label>
          <input
            value={distAmount}
            onChange={(e) => setDistAmount(e.target.value)}
            style={inputStyle}
            placeholder="250м или 250000000"
            autoFocus
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" style={outlineBtn} onClick={() => setDistModal(null)}>Отмена</button>
            <button type="button" style={primaryBtn} onClick={() => void distribute()}>Распределить</button>
          </div>
        </ModalShell>
      )}
    </Layout>
  )
}

function EditableCell({
  label,
  value,
  currency,
  rate,
  editing,
  draft,
  inputRef,
  onStart,
  onDraft,
  onCommit,
  onCancel,
  tone,
}: {
  label?: string
  value: number
  currency: Currency
  rate: number
  editing: boolean
  draft: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onStart: () => void
  onDraft: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  tone: string
}) {
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit()
          if (e.key === 'Escape') onCancel()
        }}
        style={{
          width: '100%',
          border: '1px solid #3b82f6',
          borderRadius: 6,
          padding: '3px 5px',
          fontSize: 11,
          fontFamily: 'inherit',
          fontWeight: 700,
        }}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={onStart}
      title="Клик для редактирования"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'right',
        background: 'transparent',
        border: 'none',
        padding: '2px 0',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        color: tone,
        whiteSpace: 'nowrap',
      }}
    >
      {label ? <span style={{ opacity: 0.45, marginRight: 4 }}>{label}</span> : null}
      {value ? fmtCompact(value, currency, rate) : '—'}
    </button>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,.35)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD, width: '100%', maxWidth: 420, padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  border: 'none',
  background: '#f1f5f9',
  borderRadius: 8,
  width: 28,
  height: 28,
  cursor: 'pointer',
  fontWeight: 800,
  fontFamily: 'inherit',
}

const toggleBtn: React.CSSProperties = {
  border: 'none',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const outlineBtn: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  borderRadius: 10,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#334155',
}

const primaryBtn: React.CSSProperties = {
  border: 'none',
  background: '#16a34a',
  color: '#fff',
  borderRadius: 10,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  background: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: '#64748b',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const thSticky: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: '#f8fafc',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  borderBottom: '1px solid #e2e8f0',
  boxShadow: '2px 0 6px rgba(15,23,42,.04)',
}

const thCell: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  borderBottom: '1px solid #e2e8f0',
  textAlign: 'right',
}

const tdSticky: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: '#fff',
  padding: '10px 12px',
  borderBottom: '1px solid #eef2f7',
  boxShadow: '2px 0 6px rgba(15,23,42,.04)',
  maxWidth: 200,
}

const tdCell: React.CSSProperties = {
  padding: '8px 8px',
  borderBottom: '1px solid #eef2f7',
  textAlign: 'right',
}

const miniLink: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#3b82f6',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
}
