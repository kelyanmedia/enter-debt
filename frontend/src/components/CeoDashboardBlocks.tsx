import type { CSSProperties } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Card, BtnOutline, BtnPrimary } from '@/components/ui'
import { CeoEditPencil } from '@/components/CeoMetricEditor'
import { buildPlRowSeriesFromPl, plRowLabel, type PLReportForNet } from '@/lib/plNetProfitSeries'

const CeoTurnoverChart = dynamic(() => import('@/components/CeoTurnoverChart'), { ssr: false })
const CeoNetProfitChart = dynamic(() => import('@/components/CeoNetProfitChart'), { ssr: false })
const CeoLtvChart = dynamic(() => import('@/components/CeoLtvChart'), { ssr: false })
const CeoClientHistoryChart = dynamic(() => import('@/components/CeoClientHistoryChart'), { ssr: false })

export type CeoLayoutBlock = {
  id: number
  kind: 'client_history' | 'turnover' | 'pl_row' | 'ltv'
  title: string | null
  pl_row_id: string | null
  sort_order: number
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

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i)

const selectStyle: CSSProperties = {
  border: '1px solid #e8e9ef',
  borderRadius: 9,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: '#1a1d23',
  background: '#fff',
  cursor: 'pointer',
}

const miniBtn: CSSProperties = {
  border: '1px solid #e8e9ef',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
  background: '#fff',
  fontFamily: 'inherit',
}

type Props = {
  layoutBlocks: CeoLayoutBlock[]
  layoutLoading: boolean
  layoutEdit: boolean
  setLayoutEdit: (v: boolean | ((p: boolean) => boolean)) => void
  layoutSaving: boolean
  isAdmin: boolean
  /** Порядок блоков / восстановление — админ, бухгалтерия, финансист (как GET layout) */
  canConfigureLayout?: boolean
  onRestoreDefaults?: () => void
  moveBlock: (index: number, delta: number) => void
  removeBlock: (index: number) => void
  setAddOpen: (v: boolean) => void
  clientYear: number
  setClientYear: (y: number) => void
  clientPoints: ClientHistoryPoint[]
  turnoverYear: number | null
  setTurnoverYear: (y: number | null) => void
  turnover: TurnoverPoint[]
  netProfitYear: number
  setNetProfitYear: (y: number) => void
  plCurrent: PLReportForNet | null
  plPrev: PLReportForNet | null
  netProfitLoading: boolean
  netProfitError: string | null
  ltvYear: number | null
  setLtvYear: (y: number | null) => void
  ltvBuckets: LtvBucket[]
  setEditMetric: (m: 'client_history' | 'turnover' | 'ltv' | null) => void
}

export default function CeoDashboardBlocks(p: Props) {
  const {
    layoutBlocks,
    layoutLoading,
    layoutEdit,
    setLayoutEdit,
    layoutSaving,
    isAdmin,
    canConfigureLayout,
    onRestoreDefaults,
    moveBlock,
    removeBlock,
    setAddOpen,
    clientYear,
    setClientYear,
    clientPoints,
    turnoverYear,
    setTurnoverYear,
    turnover,
    netProfitYear,
    setNetProfitYear,
    plCurrent,
    plPrev,
    netProfitLoading,
    netProfitError,
    ltvYear,
    setLtvYear,
    ltvBuckets,
    setEditMetric,
  } = p

  const canLayout = canConfigureLayout ?? isAdmin

  if (layoutLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>
        Загрузка блоков…
      </div>
    )
  }

  const adminToolbar = canLayout && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <BtnOutline type="button" onClick={() => setLayoutEdit(!layoutEdit)}>
        {layoutEdit ? 'Закончить настройку' : 'Настроить блоки'}
      </BtnOutline>
      {(layoutEdit || layoutBlocks.length === 0) && (
        <BtnOutline type="button" onClick={() => setAddOpen(true)}>
          + Добавить блок
        </BtnOutline>
      )}
      {layoutBlocks.length === 0 && onRestoreDefaults && (
        <BtnPrimary type="button" onClick={() => onRestoreDefaults()} disabled={layoutSaving}>
          Восстановить стандартные блоки
        </BtnPrimary>
      )}
      {layoutSaving && <span style={{ fontSize: 12, color: '#94a3b8' }}>Сохраняем…</span>}
    </div>
  )

  if (layoutBlocks.length === 0) {
    return (
      <>
        {adminToolbar}
        <div
          style={{
            padding: '28px 20px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
            lineHeight: 1.55,
            maxWidth: 520,
            margin: '0 auto',
            background: '#f8fafc',
            borderRadius: 12,
            border: '1px solid #e8e9ef',
          }}
        >
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 8 }}>Блоки графиков не загружены</div>
          <p style={{ margin: '0 0 12px' }}>
            Обычно здесь четыре блока: активные партнёры, оборот, строка P&L и LTV. Если список пуст — восстановите
            стандартный набор (кнопка выше для администратора) или добавьте блоки вручную.
          </p>
          {!canLayout && (
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
              Редактирование раскладки — у администратора, бухгалтерии или финансиста.
            </p>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {adminToolbar}

      {layoutBlocks.map((block, idx) => (
        <Card
          key={`${block.id}-${idx}`}
          style={{ marginBottom: 20, padding: '4px 4px 8px', position: 'relative', overflow: 'hidden' }}
        >
          {layoutEdit && canLayout && (
            <div
              style={{
                position: 'absolute',
                right: 10,
                top: 10,
                zIndex: 5,
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                maxWidth: 200,
              }}
            >
              <button type="button" style={miniBtn} disabled={idx === 0} onClick={() => moveBlock(idx, -1)} title="Выше">
                ↑
              </button>
              <button
                type="button"
                style={miniBtn}
                disabled={idx >= layoutBlocks.length - 1}
                onClick={() => moveBlock(idx, 1)}
                title="Ниже"
              >
                ↓
              </button>
              <button
                type="button"
                style={{ ...miniBtn, color: '#b91c1c', borderColor: '#fecaca' }}
                disabled={layoutBlocks.length <= 1}
                onClick={() => removeBlock(idx)}
                title="Удалить блок"
              >
                ✕
              </button>
            </div>
          )}

          {block.kind === 'client_history' && (
            <>
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
                    {block.title?.trim() || `Активные партнёры · ${clientYear}`}
                  </div>
                  <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                    Новые партнёры по месяцу добавления, у которых есть неархивный проект в линиях SMM, Таргет, личный
                    бренд, контент или старых линиях (как на карточках выше; хостинг и домены не учитываются). Наведите
                    на график — число за месяц.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}>
                    <span style={{ fontWeight: 600 }}>Год</span>
                    <select value={clientYear} onChange={e => setClientYear(Number(e.target.value))} style={selectStyle}>
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
            </>
          )}

          {block.kind === 'turnover' && (
            <>
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
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>
                    {block.title?.trim() || 'Динамика оборота'}
                  </div>
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
                      style={{ ...selectStyle, minWidth: 160 }}
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
                data={turnover.map(pt => ({
                  month: pt.month,
                  label: pt.label,
                  amount: Number(pt.amount),
                  previous_year_amount: Number(pt.previous_year_amount),
                }))}
              />
            </>
          )}

          {block.kind === 'pl_row' && block.pl_row_id && (
            <>
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
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>
                    {block.title?.trim() ||
                      plRowLabel(plCurrent, block.pl_row_id) ||
                      `P&L · ${block.pl_row_id}`}
                  </div>
                  <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4, lineHeight: 1.5 }}>
                    Данные из отчёта P&L по выбранной строке (суммы в сумах по месяцам). Пунктир — тот же месяц{' '}
                    {netProfitYear - 1} года.
                    {isAdmin && (
                      <>
                        {' '}
                        <Link href="/finance/pl" style={{ color: '#1a6b3c', fontWeight: 600 }}>
                          Открыть P&L →
                        </Link>
                      </>
                    )}
                  </div>
                  {netProfitError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{netProfitError}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6b7280' }}>
                    <span style={{ fontWeight: 600 }}>Год</span>
                    <select value={netProfitYear} onChange={e => setNetProfitYear(Number(e.target.value))} style={{ ...selectStyle, minWidth: 120 }}>
                      {YEAR_OPTIONS.map(y => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                  {netProfitLoading && <span style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка…</span>}
                </div>
              </div>
              <CeoNetProfitChart
                data={buildPlRowSeriesFromPl(block.pl_row_id, netProfitYear, plCurrent, plPrev)}
                seriesName={plRowLabel(plCurrent, block.pl_row_id) || block.pl_row_id}
              />
            </>
          )}

          {block.kind === 'ltv' && (
            <>
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
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23' }}>
                    {block.title?.trim() || 'LTV · срок сотрудничества'}
                  </div>
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
                      style={{ ...selectStyle, minWidth: 140 }}
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
            </>
          )}
        </Card>
      ))}
    </>
  )
}
