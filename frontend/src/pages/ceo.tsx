import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { PageHeader, Card } from '@/components/ui'
import api from '@/lib/api'

const CeoTurnoverChart = dynamic(() => import('@/components/CeoTurnoverChart'), { ssr: false })
const CeoLtvChart = dynamic(() => import('@/components/CeoLtvChart'), { ssr: false })
const CeoClientHistoryChart = dynamic(() => import('@/components/CeoClientHistoryChart'), { ssr: false })

interface CeoStats {
  total_projects: number
  web_projects: number
  seo_projects: number
  ppc_projects: number
}

interface TurnoverPoint {
  month: string
  label: string
  amount: string | number
  previous_year_amount: string | number
}

interface LtvBucket {
  key: string
  label: string
  count: number
}

interface ClientHistoryPoint {
  month: string
  label: string
  count: number
}

function ArrowIcon() {
  return (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'rgba(255,255,255,.95)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        color: '#1a1d23',
        flexShrink: 0,
        boxShadow: '0 1px 4px rgba(0,0,0,.08)',
      }}
    >
      ↗
    </span>
  )
}

function CeoCard({
  title,
  value,
  featured,
  href,
  hint,
}: {
  title: string
  value: number
  featured?: boolean
  href: string
  hint?: string
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div
        style={{
          borderRadius: 14,
          padding: '18px 20px',
          minHeight: 130,
          border: featured ? 'none' : '1px solid #e8e9ef',
          background: featured
            ? 'linear-gradient(145deg, #1a6b3c 0%, #145a32 100%)'
            : '#fff',
          boxShadow: featured ? '0 8px 24px rgba(26,107,60,.25)' : '0 1px 3px rgba(0,0,0,.04)',
          transition: 'transform .12s, box-shadow .12s',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: featured ? 'rgba(255,255,255,.85)' : '#6b7280',
            }}
          >
            {title}
          </span>
          {featured ? (
            <ArrowIcon />
          ) : (
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#f5f6fa',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: '#1a1d23',
              }}
            >
              ↗
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: featured ? '#fff' : '#1a1d23',
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: featured ? 'rgba(255,255,255,.75)' : '#8a8fa8',
            }}
          >
            {hint}
          </div>
        )}
      </div>
    </Link>
  )
}

export default function CeoDashboardPage() {
  const [stats, setStats] = useState<CeoStats | null>(null)
  const [turnover, setTurnover] = useState<TurnoverPoint[]>([])
  const [ltvBuckets, setLtvBuckets] = useState<LtvBucket[]>([])
  const [clientYear, setClientYear] = useState(() => new Date().getFullYear())
  const [clientPoints, setClientPoints] = useState<ClientHistoryPoint[]>([])

  useEffect(() => {
    api.get<CeoStats>('dashboard/ceo').then(r => setStats(r.data)).catch(() => setStats(null))
    api.get<{ points: TurnoverPoint[] }>('dashboard/ceo/turnover')
      .then(r => setTurnover(r.data.points || []))
      .catch(() => setTurnover([]))
    api.get<{ buckets: LtvBucket[] }>('dashboard/ceo/partner-ltv')
      .then(r => setLtvBuckets(r.data.buckets || []))
      .catch(() => setLtvBuckets([]))
  }, [])

  useEffect(() => {
    api.get<{ points: ClientHistoryPoint[] }>(`dashboard/ceo/client-history?year=${clientYear}`)
      .then(r => setClientPoints(r.data.points || []))
      .catch(() => setClientPoints([]))
  }, [clientYear])

  return (
    <Layout>
      <PageHeader
        title="CEO Dashboard"
        subtitle="Проекты по линиям, новые компании по месяцам, оборот и LTV."
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          <CeoCard
            featured
            title="Всего проектов"
            value={stats?.total_projects ?? 0}
            href="/payments"
            hint="Все неархивные проекты в вашей зоне доступа"
          />
          <CeoCard
            title="Web проекты"
            value={stats?.web_projects ?? 0}
            href="/payments?category=web"
            hint="Сайты и веб-услуги"
          />
          <CeoCard
            title="SEO проекты"
            value={stats?.seo_projects ?? 0}
            href="/payments?category=seo"
            hint="Поисковая оптимизация"
          />
          <CeoCard
            title="PPC проекты"
            value={stats?.ppc_projects ?? 0}
            href="/payments?category=ppc"
            hint="Контекстная реклама"
          />
        </div>

        <Card style={{ marginBottom: 20, padding: '4px 4px 8px' }}>
          <div
            style={{
              padding: '16px 18px 8px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>
                Количество клиентов · {clientYear}
              </div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                Новые компании по месяцам — по дате добавления в систему (история в базе). Наведите на график для
                числа за месяц.
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}>
              <span style={{ fontWeight: 600 }}>Год</span>
              <select
                value={clientYear}
                onChange={e => setClientYear(Number(e.target.value))}
                style={{
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  color: '#1a1d23',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CeoClientHistoryChart data={clientPoints} year={clientYear} />
        </Card>

        <Card style={{ marginBottom: 20, padding: '4px 4px 8px' }}>
          <div style={{ padding: '16px 18px 8px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>Динамика оборота</div>
            <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4 }}>
              Сумма оплаченных проектов по месяцу оплаты (последние 12 месяцев). Синяя зона — текущий период, пунктир — тот же месяц год назад.
              Наведите курсор на график для точных сумм.
            </div>
          </div>
          <CeoTurnoverChart
            data={turnover.map(p => ({
              month: p.month,
              label: p.label,
              amount: Number(p.amount),
              previous_year_amount: Number(p.previous_year_amount),
            }))}
          />
        </Card>

        <Card style={{ marginBottom: 20, padding: '4px 4px 12px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px 4px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>LTV · срок сотрудничества</div>
            <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
              Сколько месяцев компания с вами с момента добавления в систему. Учитываются только{' '}
              <strong style={{ color: '#5b6478' }}>активные</strong> партнёры. Наведите на столбец — точное число компаний.
            </div>
          </div>
          <CeoLtvChart data={ltvBuckets} />
        </Card>

        <div
          style={{
            fontSize: 13,
            color: '#8a8fa8',
            maxWidth: 560,
            lineHeight: 1.5,
            padding: '14px 16px',
            background: '#f8f9fc',
            borderRadius: 10,
            border: '1px solid #e8e9ef',
          }}
        >
          Укажите линию проекта при создании или редактировании в поле «Линия (Web / SEO / PPC)». Без линии проект
          учитывается только в «Всего проектов».
        </div>
      </div>
    </Layout>
  )
}
