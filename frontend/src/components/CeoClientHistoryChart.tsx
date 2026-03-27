import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface ClientHistoryPoint {
  month: string
  label: string
  count: number
}

function ClientTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: ClientHistoryPoint }>
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const v = payload[0].value ?? 0
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e8e9ef',
        borderRadius: 12,
        padding: '12px 14px',
        fontSize: 13,
        boxShadow: '0 8px 28px rgba(0,0,0,.12)',
        minWidth: 160,
      }}
    >
      <div style={{ fontWeight: 700, color: '#1a1d23', marginBottom: 6 }}>{row?.label}</div>
      <div style={{ color: '#6b7280' }}>
        Новых компаний:{' '}
        <span style={{ fontWeight: 800, color: '#2563eb', fontSize: 20 }}>{v}</span>
      </div>
    </div>
  )
}

export default function CeoClientHistoryChart({
  data,
  year,
}: {
  data: ClientHistoryPoint[]
  year: number
}) {
  const chartData = data.map(d => ({ ...d, count: Number(d.count) }))
  const maxC = Math.max(...chartData.map(d => d.count), 1)
  const yMax = Math.max(5, Math.ceil(maxC * 1.15))

  if (!chartData.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>Нет данных за {year}</div>
    )
  }

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="clientAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="0" stroke="#eceef2" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#8a8fa8' }}
            tickLine={false}
            axisLine={{ stroke: '#e8e9ef' }}
            interval={0}
            tickMargin={8}
          />
          <YAxis
            domain={[0, yMax]}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#8a8fa8' }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={v => String(Math.round(v))}
          />
          <Tooltip content={<ClientTooltip />} cursor={{ stroke: '#bfdbfe', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="count"
            name="Клиентов"
            stroke="#2563eb"
            strokeWidth={2.5}
            fill="url(#clientAreaFill)"
            activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff', fill: '#2563eb' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
