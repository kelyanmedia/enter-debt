import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatMoneyNumber } from '@/components/ui'

export interface TurnoverPoint {
  month: string
  label: string
  amount: number
  previous_year_amount: number
}

function fmtAxis(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`
  return String(Math.round(v))
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e8e9ef',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 13,
        boxShadow: '0 8px 28px rgba(0,0,0,.12)',
        minWidth: 180,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8, color: '#1a1d23' }}>{label}</div>
      {payload.map(p => (
        <div key={String(p.dataKey)} style={{ marginTop: 4, color: p.color || '#333' }}>
          <span style={{ opacity: 0.85 }}>{p.name || p.dataKey}:</span>{' '}
          <span style={{ fontWeight: 600 }}>{formatMoneyNumber(p.value ?? 0)} Uzs</span>
        </div>
      ))}
    </div>
  )
}

export default function CeoTurnoverChart({ data }: { data: TurnoverPoint[] }) {
  const chartData = data.map(p => ({
    label: p.label,
    amount: Number(p.amount),
    prev: Number(p.previous_year_amount),
  }))

  if (chartData.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>
        Нет данных об оплатах за выбранный период
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="ceoTurnoverFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="0" stroke="#e8e9ef" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#8a8fa8' }}
            tickLine={false}
            axisLine={{ stroke: '#e8e9ef' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={fmtAxis}
            tick={{ fontSize: 11, fill: '#8a8fa8' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="amount"
            name="Оборот"
            stroke="#2563eb"
            strokeWidth={2.5}
            fill="url(#ceoTurnoverFill)"
            activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff', fill: '#2563eb' }}
          />
          <Line
            type="monotone"
            dataKey="prev"
            name="Год назад"
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="6 6"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
