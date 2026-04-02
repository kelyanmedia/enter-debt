import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card } from '@/components/ui'
import { CeoEditPencil, CeoMetricEditModal } from '@/components/CeoMetricEditor'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'

const CeoTurnoverChart = dynamic(() => import('@/components/CeoTurnoverChart'), { ssr: false })
const CeoLtvChart = dynamic(() => import('@/components/CeoLtvChart'), { ssr: false })
const CeoClientHistoryChart = dynamic(() => import('@/components/CeoClientHistoryChart'), { ssr: false })

interface CeoStats {
  total_projects: number
  web_projects: number
  seo_projects: number
  ppc_projects: number
  mobile_app_projects: number
  tech_support_projects: number
  hosting_domain_projects: number
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

function buildMonthRecord(
  points: { count?: number; amount?: number | string }[],
  kind: 'count' | 'amount',
): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 1; i <= 12; i++) {
    const k = String(i)
    const p = points[i - 1]
    if (!p) {
      out[k] = '0'
      continue
    }
    if (kind === 'count') out[k] = String(p.count ?? 0)
    else out[k] = String(p.amount ?? 0)
  }
  return out
}

function ltvRecordFromBuckets(buckets: LtvBucket[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const b of buckets) out[b.key] = String(b.count ?? 0)
  return out
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

/** Одна высота/ширина ячейки сетки: длинные подписи переносятся внутри */
const CEO_CARD_ROW_PX = 188

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
    <Link
      href={href}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        height: '100%',
        minHeight: CEO_CARD_ROW_PX,
      }}
    >
      <div
        style={{
          borderRadius: 14,
          padding: '16px 18px',
          height: '100%',
          minHeight: CEO_CARD_ROW_PX,
          maxHeight: CEO_CARD_ROW_PX,
          boxSizing: 'border-box',
          border: featured ? 'none' : '1px solid #e8e9ef',
          background: featured
            ? 'linear-gradient(145deg, #1a6b3c 0%, #145a32 100%)'
            : '#fff',
          boxShadow: featured ? '0 8px 24px rgba(26,107,60,.25)' : '0 1px 3px rgba(0,0,0,.04)',
          transition: 'transform .12s, box-shadow .12s',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 8,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.3,
              color: featured ? 'rgba(255,255,255,.85)' : '#6b7280',
              flex: 1,
              minWidth: 0,
              wordBreak: 'break-word',
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
                flexShrink: 0,
              }}
            >
              ↗
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: featured ? '#fff' : '#1a1d23',
            lineHeight: 1.1,
            flexShrink: 0,
          }}
        >
          {value}
        </div>
        {hint ? (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              lineHeight: 1.35,
              color: featured ? 'rgba(255,255,255,.75)' : '#8a8fa8',
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              wordBreak: 'break-word',
            }}
          >
            {hint}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </div>
    </Link>
  )
}

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i)

export default function CeoDashboardPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (!loading && user && (user.role === 'manager' || user.role === 'administration')) router.replace('/debitor')
  }, [user, loading, router])

  const [stats, setStats] = useState<CeoStats | null>(null)
  const [turnover, setTurnover] = useState<TurnoverPoint[]>([])
  const [turnoverYear, setTurnoverYear] = useState<number | null>(() => new Date().getFullYear())
  const [ltvBuckets, setLtvBuckets] = useState<LtvBucket[]>([])
  const [ltvYear, setLtvYear] = useState<number | null>(() => new Date().getFullYear())
  const [clientYear, setClientYear] = useState(() => new Date().getFullYear())
  const [clientPoints, setClientPoints] = useState<ClientHistoryPoint[]>([])

  const [editMetric, setEditMetric] = useState<null | 'client_history' | 'turnover' | 'ltv'>(null)
  const [dataTick, setDataTick] = useState(0)
  const bumpData = useCallback(() => setDataTick(t => t + 1), [])

  useEffect(() => {
    api.get<CeoStats>('dashboard/ceo').then(r => setStats(r.data)).catch(() => setStats(null))
  }, [dataTick])

  useEffect(() => {
    const url =
      turnoverYear === null ? 'dashboard/ceo/turnover' : `dashboard/ceo/turnover?year=${turnoverYear}`
    api.get<{ points: TurnoverPoint[] }>(url)
      .then(r => setTurnover(r.data.points || []))
      .catch(() => setTurnover([]))
  }, [turnoverYear, dataTick])

  useEffect(() => {
    const url = ltvYear === null ? 'dashboard/ceo/partner-ltv' : `dashboard/ceo/partner-ltv?year=${ltvYear}`
    api.get<{ buckets: LtvBucket[] }>(url)
      .then(r => setLtvBuckets(r.data.buckets || []))
      .catch(() => setLtvBuckets([]))
  }, [ltvYear, dataTick])

  useEffect(() => {
    api.get<{ points: ClientHistoryPoint[] }>(`dashboard/ceo/client-history?year=${clientYear}`)
      .then(r => setClientPoints(r.data.points || []))
      .catch(() => setClientPoints([]))
  }, [clientYear, dataTick])

  const editInitialMonths = useMemo(() => {
    if (editMetric === 'client_history') return buildMonthRecord(clientPoints, 'count')
    if (editMetric === 'turnover') return buildMonthRecord(turnover, 'amount')
    return {}
  }, [editMetric, clientPoints, turnover])

  const editInitialLtv = useMemo(() => {
    if (editMetric !== 'ltv') return {}
    return ltvRecordFromBuckets(ltvBuckets)
  }, [editMetric, ltvBuckets])

  const editYear =
    editMetric === 'client_history'
      ? clientYear
      : editMetric === 'turnover'
        ? turnoverYear ?? new Date().getFullYear()
        : ltvYear ?? new Date().getFullYear()

  const redirectingToDebitor =
    !loading && user && (user.role === 'manager' || user.role === 'administration')

  return (
    <Layout>
      {redirectingToDebitor && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 240,
            color: '#8a8fa8',
            fontSize: 14,
          }}
        >
          Переход в дебиторку…
        </div>
      )}
      {!loading && user && user.role !== 'manager' && user.role !== 'administration' && <>
      <PageHeader
        title="CEO Dashboard"
        subtitle="Проекты по линиям, активные партнёры по месяцам, оборот и LTV."
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gridAutoRows: `${CEO_CARD_ROW_PX}px`,
            gap: 14,
            marginBottom: 24,
            alignItems: 'stretch',
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
          <CeoCard
            title="Мобильные приложения"
            value={stats?.mobile_app_projects ?? 0}
            href="/payments?category=mobile_app"
            hint="Разработка и сопровождение приложений"
          />
          <CeoCard
            title="Тех сопровождение"
            value={stats?.tech_support_projects ?? 0}
            href="/payments?category=tech_support"
            hint="Техническая поддержка и сопровождение"
          />
          <CeoCard
            title="Хостинг и домены"
            value={stats?.hosting_domain_projects ?? 0}
            href="/payments?category=hosting_domain"
            hint="Хостинг, домены, инфраструктура"
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
                Активные партнёры · {clientYear}
              </div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                Новые партнёры по месяцу добавления в систему, у которых есть неархивный проект в линиях веб, SEO,
                PPC, мобильные приложения или техподдержка (как на карточках выше; хостинг и домены не учитываются).
                Наведите на график — число за месяц.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
                  {YEAR_OPTIONS.map(y => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              {isAdmin && (
                <CeoEditPencil
                  onClick={() => setEditMetric('client_history')}
                  title="Ручной ввод: активные партнёры по месяцам"
                />
              )}
            </div>
          </div>
          <CeoClientHistoryChart data={clientPoints} year={clientYear} />
        </Card>

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
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>Динамика оборота</div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                {turnoverYear === null
                  ? 'Сумма оплаченных по месяцу оплаты — скользящие 12 месяцев. Пунктир — тот же месяц год назад.'
                  : `Календарный год ${turnoverYear}: суммы по месяцам. Пунктир — ${turnoverYear - 1}. Ручной ввод доступен для выбранного года.`}{' '}
                Наведите курсор на график для сумм.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}>
                <span style={{ fontWeight: 600 }}>Период</span>
                <select
                  value={turnoverYear === null ? '' : turnoverYear}
                  onChange={e => {
                    const v = e.target.value
                    setTurnoverYear(v === '' ? null : Number(v))
                  }}
                  style={{
                    border: '1px solid #e8e9ef',
                    borderRadius: 9,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    color: '#1a1d23',
                    background: '#fff',
                    cursor: 'pointer',
                    minWidth: 160,
                  }}
                >
                  <option value="">Последние 12 месяцев</option>
                  {YEAR_OPTIONS.map(y => (
                    <option key={y} value={y}>
                      Календарный {y}
                    </option>
                  ))}
                </select>
              </label>
              {isAdmin && turnoverYear !== null && (
                <CeoEditPencil
                  onClick={() => setEditMetric('turnover')}
                  title="Ручной ввод оборота по месяцам за год"
                />
              )}
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
          <div
            style={{
              padding: '16px 18px 4px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>LTV · срок сотрудничества</div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                {ltvYear === null
                  ? 'Распределение активных компаний по длительности сотрудничества — расчёт из базы сейчас.'
                  : ltvYear === new Date().getFullYear()
                    ? 'Текущий год: те же данные, что и «из базы», плюс можно задать ручной срез.'
                    : `Год ${ltvYear}: показываются только ручные значения, если вы их задали; иначе нули.`}{' '}
                Наведите на столбец — число компаний.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}>
                <span style={{ fontWeight: 600 }}>Год</span>
                <select
                  value={ltvYear === null ? '' : ltvYear}
                  onChange={e => {
                    const v = e.target.value
                    setLtvYear(v === '' ? null : Number(v))
                  }}
                  style={{
                    border: '1px solid #e8e9ef',
                    borderRadius: 9,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    color: '#1a1d23',
                    background: '#fff',
                    cursor: 'pointer',
                    minWidth: 140,
                  }}
                >
                  <option value="">Сейчас (из базы)</option>
                  {YEAR_OPTIONS.map(y => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              {isAdmin && ltvYear !== null && (
                <CeoEditPencil onClick={() => setEditMetric('ltv')} title="Ручной ввод LTV по корзинам" />
              )}
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
          Укажите линию проекта при создании или редактировании в поле «Линия (CEO)». Без линии проект учитывается
          только в «Всего проектов».
        </div>
      </div>

      {editMetric && (
        <CeoMetricEditModal
          open
          onClose={() => setEditMetric(null)}
          metric={editMetric}
          year={editYear}
          initialMonths={editInitialMonths}
          initialLtv={editInitialLtv}
          onSaved={bumpData}
        />
      )}
      </>}
    </Layout>
  )
}
