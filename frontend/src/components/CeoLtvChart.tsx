import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface LtvBucket {
  key: string
  label: string
  count: number
}

function LtvTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: LtvBucket }>
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
        boxShadow: '0 10px 40px rgba(0,0,0,.12)',
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 700, color: '#1a1d23', marginBottom: 6, lineHeight: 1.35 }}>{row?.label}</div>
      <div style={{ color: '#6b7280' }}>
        Компаний:{' '}
        <span style={{ fontWeight: 800, color: '#1a6b3c', fontSize: 18 }}>{v}</span>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, lineHeight: 1.4 }}>
        По дате добавления в систему. Только активные компании.
      </div>
    </div>
  )
}

export default function CeoLtvChart({ data }: { data: LtvBucket[] }) {
  const chartData = [...data]

  if (!chartData.length) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>Нет данных</div>
    )
  }

  const maxC = Math.max(...chartData.map(d => d.count), 1)
  const yMax = Math.max(5, Math.ceil(maxC / 5) * 5)

  return (
    <div style={{ width: '100%', height: 360 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 16, right: 12, left: 2, bottom: 4 }}
          barCategoryGap="18%"
        >
          <defs>
            <linearGradient id="ltvBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#eceef2" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
            interval={0}
            height={72}
            tickMargin={4}
            angle={-22}
            textAnchor="end"
          />
          <YAxis
            domain={[0, yMax]}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: '#8a8fa8' }}
            tickLine={false}
            axisLine={false}
            width={36}
            label={{
              value: 'Компаний',
              angle: -90,
              position: 'insideLeft',
              style: { fill: '#9ca3af', fontSize: 11, fontWeight: 600 },
            }}
          />
          <Tooltip content={<LtvTooltip />} cursor={{ fill: 'rgba(59, 130, 246, .07)' }} />
          <Bar
            dataKey="count"
            name="Компаний"
            radius={[14, 14, 6, 6]}
            maxBarSize={56}
            fill="url(#ltvBarGrad)"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
