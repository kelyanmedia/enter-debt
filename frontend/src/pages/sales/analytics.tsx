import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { ClientsGeoMap } from '@/components/ClientsGeoMap'
import { DateRangePicker, previousMonthRange, thisMonthRange, toYMD } from '@/components/DateRangePicker'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { hasCrmPipelineAccess } from '@/lib/salesAccess'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type AnalyticsData = {
  currency: {
    display_currency: 'UZS' | 'USD'
    default_currency: 'UZS'
    rate_source: string
    usd_to_uzs_rate: number
    rate_period_month: string
  }
  kpis: {
    total_revenue: number
    total_revenue_change_pct: number
    total_leads: number
    total_leads_change_pct: number
    new_customers: number
    new_customers_change_pct: number
    conversion_rate: number
    conversion_rate_change_pct: number
    active_deals: number
    active_deals_change_pct: number
    total_deals: number
    customer_retention: number
    customer_retention_count: number
  }
  revenue_performance: {
    period?: string
    labels: string[]
    revenue: number[]
    expenses: number[]
    profit: number[]
  }
  funnel: { name: string; count: number; color: string }[]
  lead_sources: { name: string; count: number; pct: number; color: string }[]
  team_activities: { name: string; count: number; color: string }[]
  deal_status: { name: string; pct: number; color: string }[]
  locations: { code: string; name: string; pct: number; count: number; lat: number; lng: number }[]
  retention_monthly: { month: string; month_full: string; pct: number; active_count: number; total_count: number }[]
  top_sales_reps: { name: string; deals_closed: number; revenue: number }[]
  upcoming_tasks: { title: string; subtitle: string; time: string; icon: string }[]
  recent_activities: { title: string; ago: string; icon: string }[]
}

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
  { bg: 'linear-gradient(135deg,#ecfeff 0%,#cffafe 100%)', accent: '#06b6d4' },
  { bg: 'linear-gradient(135deg,#fdf2f8 0%,#fce7f3 100%)', accent: '#ec4899' },
]

function fmtMoney(n: number, currency: 'UZS' | 'USD' = 'UZS') {
  if (currency === 'UZS') {
    return `${Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} UZS`
  }
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** Короткий формат для KPI: миллионы + тысячи (3 цифры), мелочь (<1 тыс) не показываем */
function fmtMoneyCompact(n: number, currency: 'UZS' | 'USD' = 'UZS') {
  if (currency === 'UZS') {
    const abs = Math.abs(n)
    const sign = n < 0 ? '−' : ''
    const grouped = (v: number) => v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ')
    if (abs >= 1_000_000) {
      const millions = Math.floor(abs / 1_000_000)
      const thousands = Math.floor((abs % 1_000_000) / 1_000)
      if (millions >= 100_000 || thousands === 0) {
        return `${sign}${grouped(millions)} млн UZS`
      }
      return `${sign}${grouped(millions)} ${String(thousands).padStart(3, '0')} млн UZS`
    }
    if (abs >= 10_000) {
      return `${sign}${grouped(Math.floor(abs / 1_000))} тыс UZS`
    }
    return `${sign}${grouped(Math.round(abs))} UZS`
  }
  return fmtMoney(n, currency)
}

function kpiValueFontSize(value: string) {
  const len = value.length
  if (len > 24) return 12
  if (len > 20) return 13
  if (len > 16) return 15
  if (len > 12) return 18
  if (len > 10) return 22
  return 30
}

function fmtAxisMoney(n: number, currency: 'UZS' | 'USD') {
  if (currency === 'UZS') {
    if (n >= 1_000_000_000) return `${Math.round(n / 1_000_000_000)} млрд`
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} млн`
    if (n >= 1_000) return `${Math.round(n / 1_000)} тыс`
    return `${Math.round(n)}`
  }
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US')
}

function splitBarLabel(name: string): string[] {
  if (name.includes(' / ')) return name.split(' / ')
  if (name.length <= 11) return [name]
  const mid = Math.ceil(name.length / 2)
  const space = name.lastIndexOf(' ', mid)
  if (space > 0) return [name.slice(0, space), name.slice(space + 1)]
  return [name]
}

function BarAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  const lines = splitBarLabel(String(payload?.value || ''))
  return (
    <g transform={`translate(${x ?? 0},${(y ?? 0) + 8})`}>
      {lines.map((line, i) => (
        <text
          key={`${line}-${i}`}
          x={0}
          y={i * 13}
          textAnchor="middle"
          fill="#64748b"
          fontSize={11}
          fontWeight={700}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'absolute',
  zIndex: 5,
  padding: '8px 12px',
  borderRadius: 10,
  background: '#fff',
  border: '1px solid #e2e8f0',
  boxShadow: '0 10px 26px rgba(15,23,42,.12)',
  fontSize: 12,
  fontWeight: 800,
  color: '#111827',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
}

function MiniSparkline({
  color,
  data,
  labels,
  formatValue = fmtNum,
}: {
  color: string
  data: number[]
  labels?: string[]
  formatValue?: (v: number) => string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const pts = data.length ? data : [3, 5, 4, 7, 6, 8, 9]
  const max = Math.max(...pts, 1)
  const w = 100
  const h = 46
  const coordinates = pts.map((v, i) => ({
    x: (i / (pts.length - 1 || 1)) * w,
    y: h - (v / max) * (h - 4) - 2,
    v,
    label: labels?.[i] || `Точка ${i + 1}`,
  }))
  const path = coordinates
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`)
    .join(' ')
  const area = `${path} L${w},${h} L0,${h} Z`

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * w
    let nearest = 0
    let minDist = Infinity
    coordinates.forEach((c, i) => {
      const d = Math.abs(c.x - x)
      if (d < minDist) {
        minDist = d
        nearest = i
      }
    })
    setHoverIdx(nearest)
  }

  const active = hoverIdx != null ? coordinates[hoverIdx] : null

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', marginTop: 8, cursor: 'crosshair' }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={area} fill={color} fillOpacity={0.2} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
        {active && (
          <>
            <line x1={active.x} y1={0} x2={active.x} y2={h} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
            <circle cx={active.x} cy={active.y} r={3.5} fill="#fff" stroke={color} strokeWidth={2} />
          </>
        )}
      </svg>
      {active && (
        <div style={{
          ...TOOLTIP_STYLE,
          left: `${(active.x / w) * 100}%`,
          bottom: h + 8,
          transform: 'translateX(-50%)',
        }}>
          {active.label}: {formatValue(active.v)}
        </div>
      )}
    </div>
  )
}

function BarValueBadge(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  value?: number
}) {
  const { x = 0, y = 0, width = 0, height = 0, value } = props
  if (value == null || width <= 0 || height <= 0) return null
  const text = fmtNum(value)
  const pillH = 24
  const pillW = Math.min(Math.max(width - 10, 48), text.length * 7 + 22)
  const cx = x + width / 2
  const cy = height >= pillH + 14
    ? y + height - pillH / 2 - 10
    : y + Math.max(height / 2, pillH / 2 + 2)
  return (
    <g>
      <rect
        x={cx - pillW / 2}
        y={cy - pillH / 2}
        width={pillW}
        height={pillH}
        rx={pillH / 2}
        fill="#fff"
        opacity={0.96}
      />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#111827"
        fontSize={11}
        fontWeight={800}
      >
        {text}
      </text>
    </g>
  )
}

function TeamActivitiesChart({ data }: { data: { name: string; count: number; color: string }[] }) {
  const maxVal = Math.max(...data.map((d) => d.count), 1)
  const yMax = Math.max(Math.ceil(maxVal / 9) * 9, 9)
  return (
    <div style={{ height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 6, left: -6, bottom: 4 }} barCategoryGap="14%">
          <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false} />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            interval={0}
            height={52}
            tick={(props) => <BarAxisTick {...props} />}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            width={34}
            tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : String(v))}
          />
          <Tooltip
            formatter={(v: number) => [fmtNum(v), 'Количество']}
            labelStyle={{ fontWeight: 800, color: '#111827' }}
            contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 10px 26px rgba(15,23,42,.12)' }}
            cursor={{ fill: 'rgba(15,23,42,.04)', radius: 14 }}
          />
          <Bar dataKey="count" radius={[18, 18, 0, 0]} maxBarSize={78}>
            {data.map((e, i) => (
              <Cell key={i} fill={e.color} />
            ))}
            <LabelList
              dataKey="count"
              content={(raw) => {
                const p = raw as { x?: number; y?: number; width?: number; height?: number; value?: number }
                return <BarValueBadge x={p.x} y={p.y} width={p.width} height={p.height} value={p.value} />
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function DonutChart({
  total,
  label,
  slices,
}: {
  total: number
  label: string
  slices: { name: string; pct: number; color: string; count?: number }[]
}) {
  const data = slices.map((s) => ({ ...s, value: s.pct || 1 }))
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1.15fr)',
      alignItems: 'center',
      gap: 20,
      minHeight: 300,
      height: '100%',
    }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 340, aspectRatio: '1', justifySelf: 'center' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              innerRadius="76%"
              outerRadius="92%"
              paddingAngle={5}
              cornerRadius={8}
              dataKey="value"
              stroke="#fff"
              strokeWidth={3}
            >
              {data.map((e, i) => (
                <Cell key={i} fill={e.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _name, p: any) => [`${v}%`, p?.payload?.name || '']}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 10px 26px rgba(15,23,42,.12)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          maxWidth: '54%',
          margin: '0 auto',
          left: 0,
          right: 0,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 22, fontWeight: 950, color: '#111827', letterSpacing: '-.03em', lineHeight: 1.05 }}>{fmtNum(total)}</div>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, marginTop: 4, lineHeight: 1.25 }}>{label}</div>
        </div>
      </div>
      <div style={{ minWidth: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: '4px 0' }}>
        {slices.map((s) => (
          <div key={s.name} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <span style={{
                fontSize: 13,
                color: '#475569',
                fontWeight: 800,
                lineHeight: 1.35,
                flex: 1,
                minWidth: 0,
              }}>{s.name}</span>
              <span style={{ fontSize: 16, fontWeight: 950, color: '#111827', flexShrink: 0, letterSpacing: '-.02em', lineHeight: 1.35 }}>{s.pct}%</span>
            </div>
            <div style={{ width: '100%', height: 4, borderRadius: 999, background: s.color, marginTop: 7 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SalesFunnel({ stages }: { stages: { name: string; count: number; color: string }[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = stages.slice(0, 5)
  const count = Math.max(shown.length, 1)
  const palette = ['#86dff2', '#b9a9f5', '#fed28c', '#9fc3f6', '#b9e878']

  const stageStats = shown.map((s, i) => {
    const prev = i === 0 ? s.count : shown[i - 1]?.count || 0
    const conversion = i === 0 ? (s.count > 0 ? 100 : 0) : prev > 0 ? Math.round((s.count / prev) * 100) : 0
    return { ...s, conversion, color: palette[i % palette.length] }
  })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(320px, 1.25fr) minmax(240px, .75fr)',
      gap: 38,
      alignItems: 'center',
      minHeight: 440,
      position: 'relative',
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '26px 0 18px',
      }}>
        {stageStats.map((s, i) => {
          const w = 26 + ((i + 1) / count) * 70
          const active = hovered === null || hovered === i
          return (
            <div
              key={s.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              title={`${s.name}: ${fmtNum(s.count)} сделок, ${s.conversion}%`}
              style={{
                width: `${w}%`,
                height: 78,
                background: s.color,
                borderRadius: 20,
                clipPath: 'polygon(12% 0, 88% 0, 100% 100%, 0 100%)',
                opacity: active ? 0.98 : 0.38,
                boxShadow: hovered === i ? '0 14px 28px rgba(15,23,42,.14)' : '0 10px 20px rgba(15,23,42,.06)',
                transform: hovered === i ? 'scale(1.02)' : 'scale(1)',
                transition: 'all .15s ease',
                cursor: 'pointer',
              }}
            />
          )
        })}
      </div>
      <div style={{ minWidth: 0 }}>
        {stageStats.map((s, i) => {
          const active = hovered === null || hovered === i
          return (
            <div
              key={s.name}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{
                marginBottom: i === shown.length - 1 ? 0 : 28,
                opacity: active ? 1 : 0.45,
                transition: 'opacity .15s ease',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
                <div style={{
                  fontSize: 18,
                  color: hovered === i ? '#111827' : '#4b5563',
                  fontWeight: 850,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'color .15s ease',
                }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 24, fontWeight: 950, color: '#111827', letterSpacing: '-.03em', flexShrink: 0 }}>
                  {s.conversion}%
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4, fontSize: 12, color: '#9ca3af', fontWeight: 750 }}>
                <span>{i === 0 ? 'Старт этапа' : 'Конверсия с прошлого этапа'}</span>
                <span>{fmtNum(s.count)} сделок</span>
              </div>
              <div style={{ width: '100%', height: 4, borderRadius: 999, background: s.color, marginTop: 12 }} />
              {hovered === i && (
                <div style={{
                  ...TOOLTIP_STYLE,
                  top: -6,
                  right: 0,
                  transform: 'translateY(-100%)',
                }}>
                  {s.name} · {fmtNum(s.count)} сделок · {s.conversion}%
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActivityIcon({ kind }: { kind: string }) {
  const icons: Record<string, string> = {
    lead: '▦',
    stage: '↻',
    note: '💬',
    phone: '📞',
    doc: '📄',
    video: '📹',
  }
  return (
    <div style={{
      width: 52, height: 52, borderRadius: 14, background: '#f1f5f9',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
    }}>
      {icons[kind] || '•'}
    </div>
  )
}

const quickHeaderBtn: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  boxShadow: '0 6px 16px rgba(15,23,42,.04)',
}

export default function SalesAnalyticsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [fetching, setFetching] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return toYMD(d)
  })
  const [dateTo, setDateTo] = useState(() => toYMD(new Date()))
  const [displayCurrency, setDisplayCurrency] = useState<'UZS' | 'USD'>('UZS')
  const [retentionMonths, setRetentionMonths] = useState(12)
  const [revenuePeriod, setRevenuePeriod] = useState<'7d' | '30d' | '3m' | '12m'>('30d')

  const canAccess = hasCrmPipelineAccess(user)

  function setThisMonthRange() {
    const r = thisMonthRange()
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  function setPreviousMonthRange() {
    const r = previousMonthRange()
    setDateFrom(r.from)
    setDateTo(r.to)
  }

  const load = useCallback(async () => {
    setFetching(true)
    try {
      const res = await api.get<AnalyticsData>('sales/analytics', {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          display_currency: displayCurrency,
          months: retentionMonths,
          revenue_period: revenuePeriod,
        },
      })
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setFetching(false)
    }
  }, [dateFrom, dateTo, displayCurrency, retentionMonths, revenuePeriod])

  useEffect(() => {
    if (!loading && user && !canAccess) void router.replace('/')
  }, [loading, user, canAccess, router])

  useEffect(() => {
    if (canAccess) void load()
  }, [canAccess, load])

  const revenueChart = useMemo(() => {
    if (!data) return []
    const { labels, revenue, expenses, profit } = data.revenue_performance
    return labels.map((label, i) => ({
      label,
      revenue: revenue[i] ?? 0,
      expenses: expenses[i] ?? 0,
      profit: profit[i] ?? 0,
    }))
  }, [data])

  const kpiCards = useMemo(() => {
    if (!data) return []
    const k = data.kpis
    return [
      { title: 'Выручка', value: fmtMoneyCompact(k.total_revenue, displayCurrency), change: k.total_revenue_change_pct, suffix: 'к прошлому месяцу' },
      { title: 'Всего лидов', value: fmtNum(k.total_leads), change: k.total_leads_change_pct, suffix: '' },
      { title: 'Новые клиенты', value: fmtNum(k.new_customers), change: k.new_customers_change_pct, suffix: '' },
      { title: 'Конверсия', value: `${k.conversion_rate}%`, change: k.conversion_rate_change_pct, suffix: '' },
      { title: 'Активные сделки', value: fmtNum(k.active_deals), change: k.active_deals_change_pct, suffix: '' },
      { title: 'Удержание', value: `${k.customer_retention}%`, change: 0, suffix: fmtNum(k.customer_retention_count) },
    ]
  }, [data, displayCurrency])

  const funnelStages = useMemo(() => {
    const rows = data?.funnel.length ? data.funnel : [{ name: 'Нет данных', count: 0, color: '#e2e8f0' }]
    return rows.slice(0, 5)
  }, [data])

  const revenueTickInterval = revenuePeriod === '30d' ? 4 : revenuePeriod === '3m' ? 1 : 0

  if (loading || !user || !canAccess) return null

  return (
    <Layout>
      <div style={{ minHeight: '100%', background: '#f4f5f7', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e9ef' }}>
          <div style={{ padding: '28px 36px 18px' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#111827', letterSpacing: '-.04em', lineHeight: 1.05 }}>
              Аналитика продаж
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск или команда…"
              style={{
                marginTop: 16, width: '100%', maxWidth: 420, padding: '14px 18px',
                borderRadius: 15, border: '1px solid #e2e8f0', background: '#f8fafc',
                fontSize: 15, fontFamily: 'inherit', outline: 'none',
                boxShadow: 'inset 0 1px 2px rgba(15,23,42,.03)',
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            padding: '12px 36px 18px',
            borderTop: '1px solid #f1f5f9',
          }}>
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              align="left"
              onApply={({ from, to }) => {
                setDateFrom(from)
                setDateTo(to)
              }}
            />
            <button type="button" onClick={setThisMonthRange} style={quickHeaderBtn}>
              Этот месяц
            </button>
            <button type="button" onClick={setPreviousMonthRange} style={quickHeaderBtn}>
              Прошлый месяц
            </button>
            <div style={{
              display: 'inline-flex',
              padding: 4,
              borderRadius: 16,
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              gap: 4,
              marginLeft: 'auto',
            }}>
              {(['UZS', 'USD'] as const).map(cur => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setDisplayCurrency(cur)}
                  title={cur === 'UZS' ? 'Суммы в UZS (курс из ДДС)' : 'Суммы в USD (курс из ДДС)'}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: 'none',
                    background: displayCurrency === cur ? '#111827' : 'transparent',
                    color: displayCurrency === cur ? '#fff' : '#475569',
                    fontSize: 14,
                    fontWeight: 900,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: displayCurrency === cur ? '0 8px 18px rgba(15,23,42,.18)' : 'none',
                  }}
                >
                  {cur}
                </button>
              ))}
            </div>
            {data?.currency?.usd_to_uzs_rate ? (
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800, whiteSpace: 'nowrap' }}>
                Курс ДДС: {Math.round(data.currency.usd_to_uzs_rate).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')}
              </div>
            ) : null}
            <button type="button" onClick={() => window.print()} style={{
              padding: '14px 22px', borderRadius: 15, border: 'none',
              background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff',
              fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 10px 24px rgba(34,197,94,.32)',
            }}>
              ↗ Экспорт отчёта
            </button>
          </div>
        </div>

        <div style={{ padding: '34px 40px 56px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {fetching && !data && (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Загрузка аналитики…</div>
          )}

          {data && (
            <>
              {/* KPI row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 22,
              }}>
                {kpiCards.map((card, i) => {
                  const style = KPI_STYLES[i % KPI_STYLES.length]
                  const sparkSlice = revenueChart.slice(i, i + 7)
                  const sparkData = sparkSlice.map((r) => r.revenue)
                  const sparkLabels = sparkSlice.map((r) => r.label)
                  const sparkFormat = i === 0
                    ? (v: number) => fmtMoneyCompact(v, displayCurrency)
                    : fmtNum
                  return (
                    <div key={card.title} style={{
                      ...CARD,
                      background: style.bg,
                      border: 'none',
                      padding: '22px 24px 14px',
                      minHeight: 134,
                      transform: 'translateZ(0)',
                    }}>
                      <div style={{ fontSize: 14, color: '#475569', fontWeight: 800 }}>{card.title}</div>
                      <div style={{
                        fontSize: kpiValueFontSize(card.value),
                        fontWeight: 950,
                        color: '#111827',
                        marginTop: 8,
                        letterSpacing: '-.03em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.15,
                      }}>{card.value}</div>
                      <div style={{ fontSize: 13, color: style.accent, fontWeight: 800, marginTop: 4 }}>
                        {card.change >= 0 ? '+' : ''}{card.change}%
                        {card.suffix ? ` · ${card.suffix}` : ' к прошлому месяцу'}
                      </div>
                      <MiniSparkline
                        color={style.accent}
                        data={sparkData}
                        labels={sparkLabels}
                        formatValue={sparkFormat}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Revenue + Funnel */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 26 }}>
                <div style={{ ...CARD, padding: 28, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#111827' }}>Динамика выручки</div>
                    <select
                      value={revenuePeriod}
                      onChange={(e) => setRevenuePeriod(e.target.value as '7d' | '30d' | '3m' | '12m')}
                      style={{
                        padding: '10px 14px', borderRadius: 12, border: '1px solid #e2e8f0',
                        fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: '#fff', color: '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="7d">7 дней</option>
                      <option value="30d">30 дней</option>
                      <option value="3m">3 месяца</option>
                      <option value="12m">12 месяцев</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 18, fontSize: 14, color: '#475569', fontWeight: 700 }}>
                    {[
                      { c: '#22c55e', l: 'Выручка' },
                      { c: '#f97316', l: 'Расходы' },
                      { c: '#3b82f6', l: 'Прибыль' },
                    ].map((x) => (
                      <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 46, height: 4, borderRadius: 2, background: x.c }} />
                        {x.l}
                      </span>
                    ))}
                  </div>
                  <div style={{ height: 390 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueChart} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
                        <defs>
                          <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="expG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f97316" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="profG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 700 }}
                          axisLine={false}
                          tickLine={false}
                          interval={revenueTickInterval}
                        />
                        <YAxis tick={{ fontSize: 13, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAxisMoney(Number(v), displayCurrency)} />
                        <Tooltip
                          formatter={(v: number, name: string) => [fmtMoney(v, displayCurrency), name === 'revenue' ? 'Выручка' : name === 'expenses' ? 'Расходы' : 'Прибыль']}
                          labelStyle={{ fontWeight: 800, color: '#111827' }}
                          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 10px 26px rgba(15,23,42,.12)' }}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#22c55e" fill="url(#revG)" strokeWidth={3} />
                        <Area type="monotone" dataKey="expenses" stroke="#f97316" fill="url(#expG)" strokeWidth={3} />
                        <Area type="monotone" dataKey="profit" stroke="#3b82f6" fill="url(#profG)" strokeWidth={3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div style={{ ...CARD, padding: 34, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 950, color: '#111827', letterSpacing: '-.03em' }}>Воронка продаж</div>
                      <div style={{ fontSize: 15, color: '#9ca3af', fontWeight: 800, marginTop: 8 }}>
                        Конверсия по ключевым этапам
                      </div>
                    </div>
                  </div>
                  <SalesFunnel stages={funnelStages} />
                </div>
              </div>

              {/* Donuts + bars */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 26 }}>
                <div style={{ ...CARD, padding: 32, minHeight: 410 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 20 }}>Источники лидов</div>
                  <DonutChart
                    total={data.kpis.total_leads}
                    label="Всего лидов"
                    slices={data.lead_sources.length ? data.lead_sources : [{ name: 'Нет данных', pct: 100, color: '#e2e8f0' }]}
                  />
                </div>
                <div style={{ ...CARD, padding: 32, minHeight: 410 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 20 }}>Активность команды</div>
                  <TeamActivitiesChart data={data.team_activities} />
                </div>
                <div style={{ ...CARD, padding: 32, minHeight: 410 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 20 }}>Статусы сделок</div>
                  <DonutChart
                    total={data.kpis.total_deals}
                    label="Всего сделок"
                    slices={data.deal_status}
                  />
                </div>
              </div>

              {/* Map + retention */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 26 }}>
                <div style={{ ...CARD, padding: 28 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 22 }}>GEO клиентов</div>
                  <ClientsGeoMap locations={data.locations} />
                </div>
                <div style={{ ...CARD, padding: 28 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#111827' }}>Удержание клиентов</div>
                    <select
                      value={retentionMonths}
                      onChange={(e) => setRetentionMonths(Number(e.target.value))}
                      style={{
                        padding: '10px 14px', borderRadius: 12, border: '1px solid #e2e8f0',
                        fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <option value={6}>Последние 6 мес.</option>
                      <option value={12}>Последние 12 мес.</option>
                      <option value={24}>Последние 24 мес.</option>
                    </select>
                  </div>
                  <div style={{ height: 310 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.retention_monthly} margin={{ top: 10, right: 10, left: -4, bottom: 0 }}>
                        <defs>
                          <linearGradient id="retG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 700 }}
                          axisLine={false}
                          tickLine={false}
                          interval={retentionMonths > 12 ? 1 : 0}
                        />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 13, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const row = payload[0].payload as AnalyticsData['retention_monthly'][number]
                            return (
                              <div style={{
                                borderRadius: 12,
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 10px 26px rgba(15,23,42,.12)',
                                background: '#fff',
                                padding: '10px 12px',
                                fontSize: 13,
                              }}>
                                <div style={{ fontWeight: 800, color: '#111827', marginBottom: 4 }}>{row.month_full}</div>
                                <div style={{ fontWeight: 700, color: '#3b82f6' }}>{row.pct}% удержание</div>
                                <div style={{ color: '#64748b', fontWeight: 600, marginTop: 2 }}>
                                  {row.active_count} из {row.total_count} клиентов
                                </div>
                              </div>
                            )
                          }}
                        />
                        <Area type="monotone" dataKey="pct" stroke="#3b82f6" fill="url(#retG)" strokeWidth={3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Bottom row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 26 }}>
                <div style={{ ...CARD, padding: 28 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 18 }}>Топ менеджеров</div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8,
                    background: '#c4b5fd', borderRadius: '16px 16px 0 0', padding: '15px 18px',
                    fontSize: 14, fontWeight: 900, color: '#312e81',
                  }}>
                    <span>Менеджер</span>
                    <span style={{ textAlign: 'center' }}>Сделки</span>
                    <span style={{ textAlign: 'right' }}>Выручка</span>
                  </div>
                  {(data.top_sales_reps.length ? data.top_sales_reps : [{ name: '—', deals_closed: 0, revenue: 0 }]).map((r) => (
                    <div key={r.name} style={{
                      display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8,
                      padding: '17px 18px', borderBottom: '1px solid #edf0f5', fontSize: 15,
                      background: '#fff',
                    }}>
                      <span style={{ fontWeight: 800, color: '#111827' }}>{r.name}</span>
                      <span style={{ textAlign: 'center', color: '#475569', fontWeight: 700 }}>{r.deals_closed}</span>
                      <span style={{ textAlign: 'right', fontWeight: 900, color: '#111827', whiteSpace: 'nowrap', fontSize: 13 }}>{fmtMoneyCompact(r.revenue, displayCurrency)}</span>
                    </div>
                  ))}
                </div>

                <div style={{ ...CARD, padding: 28 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#111827' }}>Ближайшие задачи</div>
                    <span style={{ fontSize: 14, color: '#94a3b8', cursor: 'pointer', fontWeight: 800 }}>Все →</span>
                  </div>
                  {(data.upcoming_tasks.length ? data.upcoming_tasks : [{ title: 'Нет задач', subtitle: '', time: '', icon: 'doc' }]).map((t, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '15px 0',
                      borderBottom: i < 2 ? '1px solid #edf0f5' : 'none',
                    }}>
                      <div style={{
                        width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg,#dbeafe,#c7d2fe)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, flexShrink: 0,
                      }}>
                        {t.title.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, fontWeight: 600 }}>{t.time || t.subtitle}</div>
                      </div>
                      <button type="button" style={{
                        width: 40, height: 40, borderRadius: '50%', border: '1px solid #e2e8f0',
                        background: '#f8fafc', cursor: 'pointer', fontSize: 16,
                      }}>
                        {t.icon === 'phone' ? '📞' : t.icon === 'video' ? '📹' : '📄'}
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ ...CARD, padding: 28 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#111827' }}>Недавняя активность</div>
                    <span style={{ fontSize: 14, color: '#94a3b8', cursor: 'pointer', fontWeight: 800 }}>Все →</span>
                  </div>
                  {(data.recent_activities.length ? data.recent_activities.slice(0, 3) : [{ title: 'Нет активности', ago: '', icon: 'note' }]).map((a, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 14, padding: '15px 0',
                      borderBottom: i < 2 ? '1px solid #edf0f5' : 'none',
                    }}>
                      <ActivityIcon kind={a.icon} />
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#111827' }}>{a.title}</div>
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 5, fontWeight: 600 }}>{a.ago}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}
