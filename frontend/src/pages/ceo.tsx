import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Modal, BtnPrimary, BtnOutline, Input } from '@/components/ui'
import { CeoEditPencil, CeoMetricEditModal } from '@/components/CeoMetricEditor'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { fetchCeoLayout, saveCeoLayout } from '@/lib/ceoLayoutApi'
import type { PLReportForNet } from '@/lib/plNetProfitSeries'
import CeoDashboardBlocks, { type CeoLayoutBlock } from '@/components/CeoDashboardBlocks'

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

/** Совпадает с backend DEFAULT_CEO_BLOCKS — показ графиков, если API раскладки недоступен. */
const DEFAULT_CEO_LAYOUT_BLOCKS: CeoLayoutBlock[] = [
  { id: -1, kind: 'client_history', title: null, pl_row_id: null, sort_order: 0 },
  { id: -2, kind: 'turnover', title: null, pl_row_id: null, sort_order: 1 },
  { id: -3, kind: 'pl_row', title: null, pl_row_id: 'operating_profit', sort_order: 2 },
  { id: -4, kind: 'ltv', title: null, pl_row_id: null, sort_order: 3 },
]

function formatApiError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string }
  const st = err.response?.status
  if (st === 401) return 'Сессия истекла — войдите снова.'
  if (st === 403) return 'Недостаточно прав для раскладки CEO (нужны администратор, бухгалтерия или финансист).'
  if (st === 404) {
    const d = err.response?.data?.detail
    if (typeof d === 'string' && /not found/i.test(d)) {
      return 'Раскладка CEO на сервере не найдена (404). Перезапустите backend с актуальной версией (маршруты /api/dashboard/ceo/layout). После обновления очистите кэш: в папке frontend выполните npm run dev:clean'
    }
    if (typeof d === 'string') return d
  }
  if (st === 503) {
    const d = err.response?.data?.detail
    if (typeof d === 'string') return d
  }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((x: { msg?: string }) => x.msg || JSON.stringify(x)).filter(Boolean).join(', ')
  }
  if (d != null && typeof d === 'object') return JSON.stringify(d)
  return err.message || 'Ошибка запроса'
}

export default function CeoDashboardPage() {
  const { user, loading, companySlug } = useAuth()
  const router = useRouter()
  const isAdmin = user?.role === 'admin'
  /** Те же роли, что GET /ceo/layout — могут сохранять раскладку и восстанавливать блоки */
  const canConfigureCeoLayout =
    user?.role === 'admin' || user?.role === 'accountant' || user?.role === 'financier'
  const ceoLayoutAutoRestoreDone = useRef(false)

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

  const [netProfitYear, setNetProfitYear] = useState(() => new Date().getFullYear())
  const [plCurrent, setPlCurrent] = useState<PLReportForNet | null>(null)
  const [plPrev, setPlPrev] = useState<PLReportForNet | null>(null)
  const [netProfitLoading, setNetProfitLoading] = useState(false)
  const [netProfitError, setNetProfitError] = useState<string | null>(null)

  const [layoutBlocks, setLayoutBlocks] = useState<CeoLayoutBlock[]>([])
  const [layoutLoading, setLayoutLoading] = useState(true)
  const [layoutSaving, setLayoutSaving] = useState(false)
  const [layoutEdit, setLayoutEdit] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState<'client_history' | 'turnover' | 'pl_row' | 'ltv'>('pl_row')
  const [addPlRowId, setAddPlRowId] = useState('operating_profit')
  const [addTitle, setAddTitle] = useState('')
  const [layoutError, setLayoutError] = useState('')
  const [addModalError, setAddModalError] = useState('')
  /** GET /ceo/layout успешен; при false — ещё не было ответа. */
  const [layoutReady, setLayoutReady] = useState(false)
  /** Раскладка только локально (API GET/PUT недоступны) — кнопки настройки отключены. */
  const [layoutSyncBroken, setLayoutSyncBroken] = useState(false)

  const [editMetric, setEditMetric] = useState<null | 'client_history' | 'turnover' | 'ltv'>(null)
  const [dataTick, setDataTick] = useState(0)
  const bumpData = useCallback(() => setDataTick(t => t + 1), [])

  const projectCards = useMemo(
    () =>
      [
        {
          title: 'SMM',
          value: stats?.web_projects ?? 0,
          href: '/payments?category=smm',
          hint: 'Соцсети и SMM',
        },
        {
          title: 'Таргет',
          value: stats?.seo_projects ?? 0,
          href: '/payments?category=target',
          hint: 'Таргетированная реклама',
        },
        {
          title: 'Личный бренд',
          value: stats?.ppc_projects ?? 0,
          href: '/payments?category=personal_brand',
          hint: 'Личный бренд',
        },
        {
          title: 'Контент',
          value: stats?.mobile_app_projects ?? 0,
          href: '/payments?category=content',
          hint: 'Контент',
        },
      ].filter((card) => card.value > 0),
    [stats],
  )

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

  useEffect(() => {
    let cancelled = false
    const y = netProfitYear
    setNetProfitLoading(true)
    setNetProfitError(null)
    const run = async () => {
      try {
        const cur = await api.get<PLReportForNet>(`finance/pl?year=${y}`)
        if (cancelled) return
        let prevReport: PLReportForNet | null = null
        if (y > 2000) {
          try {
            const pr = await api.get<PLReportForNet>(`finance/pl?year=${y - 1}`)
            if (!cancelled) prevReport = pr.data
          } catch {
            /* нет доступа или сеть — пунктир год назад будет нулевым */
          }
        }
        if (cancelled) return
        setPlCurrent(cur.data)
        setPlPrev(prevReport)
      } catch {
        if (!cancelled) {
          setPlCurrent(null)
          setPlPrev(null)
          setNetProfitError('Не удалось загрузить P&L. Раздел «P&L» в меню Финансы.')
        }
      } finally {
        if (!cancelled) setNetProfitLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [netProfitYear])

  useEffect(() => {
    ceoLayoutAutoRestoreDone.current = false
  }, [companySlug])

  useEffect(() => {
    setLayoutLoading(true)
    setLayoutReady(false)
    setLayoutError('')
    fetchCeoLayout()
      .then((data) => {
        setLayoutBlocks(data.blocks || [])
        setLayoutSyncBroken(false)
        setLayoutReady(true)
      })
      .catch((e) => {
        setLayoutBlocks(DEFAULT_CEO_LAYOUT_BLOCKS)
        setLayoutSyncBroken(true)
        setLayoutError(formatApiError(e))
        setLayoutReady(true)
      })
      .finally(() => setLayoutLoading(false))
  }, [companySlug])

  const persistLayout = useCallback(
    async (next: CeoLayoutBlock[], opts?: { skipLayoutBanner?: boolean }) => {
      if (next.length === 0) return
      setLayoutSaving(true)
      if (!opts?.skipLayoutBanner) setLayoutError('')
      try {
        const data = await saveCeoLayout({
          blocks: next.map((b) => {
            const pid =
              b.kind === 'pl_row' ? (b.pl_row_id && String(b.pl_row_id).trim()) || 'operating_profit' : null
            return {
              kind: b.kind,
              title: b.title || null,
              pl_row_id: pid,
            }
          }),
        })
        setLayoutBlocks(data.blocks || [])
        setLayoutSyncBroken(false)
      } catch (e) {
        const msg = formatApiError(e)
        if (!opts?.skipLayoutBanner) setLayoutError(msg)
        throw new Error(msg)
      } finally {
        setLayoutSaving(false)
      }
    },
    [],
  )

  /** Тот же набор, что в backend `DEFAULT_CEO_BLOCKS` — если раскладка пуста или сброшена. */
  const restoreDefaultLayout = useCallback(async () => {
    try {
      await persistLayout(DEFAULT_CEO_LAYOUT_BLOCKS)
      setLayoutSyncBroken(false)
    } catch {
      setLayoutBlocks(DEFAULT_CEO_LAYOUT_BLOCKS)
      setLayoutSyncBroken(true)
    }
  }, [persistLayout])

  /** Один раз за сессию компании: если блоков нет — подставляем стандартный набор (тот же, что «Восстановить…»). */
  useEffect(() => {
    if (layoutLoading || !layoutReady || layoutSyncBroken || !canConfigureCeoLayout || layoutBlocks.length > 0) return
    if (ceoLayoutAutoRestoreDone.current) return
    ceoLayoutAutoRestoreDone.current = true
    void restoreDefaultLayout()
  }, [
    layoutLoading,
    layoutReady,
    layoutSyncBroken,
    canConfigureCeoLayout,
    layoutBlocks.length,
    restoreDefaultLayout,
  ])

  const moveBlock = useCallback(
    (index: number, delta: number) => {
      const j = index + delta
      if (j < 0 || j >= layoutBlocks.length) return
      const next = [...layoutBlocks]
      const t = next[index]!
      next[index] = next[j]!
      next[j] = t
      void persistLayout(next).catch(() => {})
    },
    [layoutBlocks, persistLayout],
  )

  const removeBlock = useCallback(
    (index: number) => {
      if (layoutBlocks.length <= 1) return
      const next = layoutBlocks.filter((_, i) => i !== index)
      void persistLayout(next).catch(() => {})
    },
    [layoutBlocks, persistLayout],
  )

  const addBlock = useCallback(async () => {
    const title = addTitle.trim() || null
    const row = addKind === 'pl_row' ? addPlRowId.trim() || 'operating_profit' : null
    const next: CeoLayoutBlock[] = [
      ...layoutBlocks,
      {
        id: -Date.now(),
        kind: addKind,
        title,
        pl_row_id: row,
        sort_order: layoutBlocks.length,
      },
    ]
    setAddModalError('')
    try {
      await persistLayout(next, { skipLayoutBanner: true })
      setLayoutError('')
      setAddOpen(false)
      setAddTitle('')
      setAddKind('pl_row')
      setAddPlRowId('operating_profit')
    } catch (e) {
      setAddModalError(e instanceof Error ? e.message : formatApiError(e))
    }
  }, [layoutBlocks, addKind, addPlRowId, addTitle, persistLayout])

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
        subtitle="Карточки по линиям; ниже — блоки графиков. Администратор: «Настроить блоки» — порядок, удаление; «+ Добавить блок»; карандаш на графике — ручной ввод метрик; P&L — ссылка на отчёт. Если блоков нет — «Восстановить стандартные блоки»."
      />
      {layoutError ? (
        <div
          style={{
            margin: '0 24px',
            padding: '10px 14px',
            borderRadius: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {layoutError}
            {layoutSyncBroken ? (
              <span style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#7f1d1d', lineHeight: 1.45 }}>
                Ниже — стандартные графики; сохранение раскладки на сервер может не работать, пока API{' '}
                <code style={{ fontSize: 11 }}>/api/dashboard/ceo/layout</code> недоступен (часто помогает перезапуск
                backend с актуальной версией или правка nginx). Кнопки «Настроить блоки» и «+ Добавить блок» доступны —
                при ошибке сохранения проверьте ответ сервера.
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => setLayoutError('')}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#991b1b',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            Закрыть
          </button>
        </div>
      ) : null}
      <div
        style={{
          padding: '22px 24px',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
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
            hint="Активные проекты по выбранным рабочим линиям (без техподдержки и хостинга/доменов)"
          />
          {projectCards.map((card) => (
            <CeoCard
              key={card.href}
              title={card.title}
              value={card.value}
              href={card.href}
              hint={card.hint}
            />
          ))}
        </div>

        <CeoDashboardBlocks
          layoutBlocks={layoutBlocks}
          layoutLoading={layoutLoading}
          layoutEdit={layoutEdit}
          setLayoutEdit={setLayoutEdit}
          layoutSaving={layoutSaving}
          isAdmin={isAdmin}
          canConfigureLayout={canConfigureCeoLayout}
          onRestoreDefaults={canConfigureCeoLayout ? restoreDefaultLayout : undefined}
          moveBlock={moveBlock}
          removeBlock={removeBlock}
          setAddOpen={setAddOpen}
          clientYear={clientYear}
          setClientYear={setClientYear}
          clientPoints={clientPoints}
          turnoverYear={turnoverYear}
          setTurnoverYear={setTurnoverYear}
          turnover={turnover}
          netProfitYear={netProfitYear}
          setNetProfitYear={setNetProfitYear}
          plCurrent={plCurrent}
          plPrev={plPrev}
          netProfitLoading={netProfitLoading}
          netProfitError={netProfitError}
          ltvYear={ltvYear}
          setLtvYear={setLtvYear}
          ltvBuckets={ltvBuckets}
          setEditMetric={setEditMetric}
        />

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

      {canConfigureCeoLayout && (
        <Modal
          open={addOpen}
          onClose={() => {
            setAddOpen(false)
            setAddModalError('')
          }}
          title="Новый блок"
          width={520}
          footer={
            <>
              <BtnOutline
                type="button"
                onClick={() => {
                  setAddOpen(false)
                  setAddModalError('')
                }}
              >
                Отмена
              </BtnOutline>
              <BtnPrimary type="button" disabled={layoutSaving} onClick={() => void addBlock()}>
                {layoutSaving ? 'Сохранение…' : 'Добавить'}
              </BtnPrimary>
            </>
          }
        >
          <div style={{ marginBottom: 14, fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>
            Порядок блоков свой для каждой компании. Для графика P&L выберите строку из текущего отчёта (год для P&L —
            переключатель на графике после добавления).
          </div>
          {addModalError ? (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: 13,
              }}
            >
              {addModalError}
            </div>
          ) : null}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Тип блока</div>
            <select
              value={addKind}
              onChange={e => setAddKind(e.target.value as typeof addKind)}
              style={{
                width: '100%',
                borderRadius: 9,
                border: '1px solid #e8e9ef',
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              <option value="client_history">Активные партнёры</option>
              <option value="turnover">Динамика оборота</option>
              <option value="pl_row">График по строке P&L</option>
              <option value="ltv">LTV · срок сотрудничества</option>
            </select>
          </div>
          {addKind === 'pl_row' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Строка P&L (row_id)</div>
              {plCurrent?.rows?.length ? (
                <select
                  value={addPlRowId}
                  onChange={e => setAddPlRowId(e.target.value)}
                  style={{
                    width: '100%',
                    borderRadius: 9,
                    border: '1px solid #e8e9ef',
                    padding: '8px 12px',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                >
                  {plCurrent.rows.map(r => (
                    <option key={r.row_id} value={r.row_id}>
                      {r.label || r.row_id}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={addPlRowId}
                  onChange={e => setAddPlRowId(e.target.value)}
                  placeholder="например operating_profit или rev_web"
                />
              )}
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Свой заголовок (по желанию)</div>
            <Input value={addTitle} onChange={e => setAddTitle(e.target.value)} placeholder="Пусто — подпись по умолчанию" />
          </div>
        </Modal>
      )}

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
