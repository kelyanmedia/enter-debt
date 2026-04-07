import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, BtnOutline, BtnPrimary, Modal, formatMoneyNumber } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { deletePlManualLine, postPlManualLine, putPlManualCell } from '@/lib/plManualLinesApi'
import { isFinanceTeamRole } from '@/lib/roles'

interface PLCell {
  uzs: string
  usd: string
}

interface PLRow {
  row_id: string
  label: string
  section: string
  is_calculated: boolean
  is_manual?: boolean
  manual_line_id?: number | null
  link_to_net_profit?: boolean
  cells: PLCell[]
}

interface PLReport {
  year: number
  columns: string[]
  rows: PLRow[]
}

const MONTHS_RU = [
  'Янв.', 'Февр.', 'Март', 'Апр.', 'Май', 'Июнь',
  'Июль', 'Авг.', 'Сент.', 'Окт.', 'Нояб.', 'Дек.',
]

function columnTitle(ym: string) {
  const [, m] = ym.split('-')
  const mi = Number(m) - 1
  if (mi < 0 || mi > 11) return ym
  return MONTHS_RU[mi]
}

function formatApiError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string }
  const st = err.response?.status
  if (st === 401) return 'Сессия истекла — войдите снова.'
  if (st === 403) return 'Недостаточно прав (нужны роли администратор или финансист).'
  if (st === 404) {
    const d = err.response?.data?.detail
    if (typeof d === 'string' && /not found/i.test(d)) {
      return 'Сервер не отдаёт API ручных строк P&L (404). Перезапустите backend с актуальной версией кода (маршрут POST /api/finance/pl-manual-lines). Если фронт на отдельном хосте — проверьте прокси: весь префикс /api/* должен идти на API, не только GET /api/finance/pl.'
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

function formatCell(c: PLCell) {
  const u = Number(c.uzs)
  const d = Number(c.usd)
  if (!Number.isFinite(u)) return '—'
  if (!u && !d) return '—'
  const parts: string[] = []
  if (u) parts.push(formatMoneyNumber(u))
  if (d) parts.push(`$${formatMoneyNumber(d)}`)
  return parts.join(' · ')
}

function formatPercentCell(c: PLCell) {
  const v = Number(c.uzs)
  if (!Number.isFinite(v)) return '—'
  return `${formatMoneyNumber(v)}%`
}

const SECTION_TITLE: Record<string, { title: string; bg: string; color: string }> = {
  revenue: { title: 'Выручка', bg: '#ecfdf5', color: '#166534' },
  expenses_fixed: { title: 'Постоянные расходы', bg: '#fef2f2', color: '#b91c1c' },
  summary: { title: 'Итог', bg: '#f0fdf4', color: '#14532d' },
}

const inputCellStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 96,
  padding: '4px 6px',
  fontSize: 12,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  textAlign: 'right' as const,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function ManualCellEditor({
  lineId,
  periodMonth,
  cell,
  onSaved,
  disabled,
}: {
  lineId: number
  periodMonth: string
  cell: PLCell
  onSaved: () => void
  disabled?: boolean
}) {
  const [uzs, setUzs] = useState(() => (Number(cell.uzs) ? String(Number(cell.uzs)) : ''))
  const [usd, setUsd] = useState(() => (Number(cell.usd) ? String(Number(cell.usd)) : ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setUzs(Number(cell.uzs) ? String(Number(cell.uzs)) : '')
    setUsd(Number(cell.usd) ? String(Number(cell.usd)) : '')
  }, [cell.uzs, cell.usd])

  const save = async () => {
    const u = parseFloat(uzs.replace(/\s/g, '').replace(',', '.')) || 0
    const d = parseFloat(usd.replace(/\s/g, '').replace(',', '.')) || 0
    const cu = Number(cell.uzs) || 0
    const cd = Number(cell.usd) || 0
    if (Math.abs(u - cu) < 0.005 && Math.abs(d - cd) < 0.005) return
    setSaving(true)
    try {
      await putPlManualCell(lineId, {
        period_month: periodMonth,
        uzs: u,
        usd: d,
      })
      onSaved()
    } catch {
      /* ignore */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled || saving}
        value={uzs}
        onChange={e => setUzs(e.target.value)}
        onBlur={() => void save()}
        placeholder="UZS"
        style={inputCellStyle}
        title="Сум (UZS)"
      />
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled || saving}
        value={usd}
        onChange={e => setUsd(e.target.value)}
        onBlur={() => void save()}
        placeholder="USD"
        style={{ ...inputCellStyle, maxWidth: 72, fontSize: 11, color: '#64748b' }}
        title="USD (опционально)"
      />
    </div>
  )
}

export default function FinancePlPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [report, setReport] = useState<PLReport | null>(null)
  const [fetching, setFetching] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newSection, setNewSection] = useState<'revenue' | 'expenses_fixed' | 'summary'>('expenses_fixed')
  const [newLabel, setNewLabel] = useState('')
  const [newLinkToNetProfit, setNewLinkToNetProfit] = useState(false)
  const [creating, setCreating] = useState(false)
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [loading, user, router])

  const load = useCallback(() => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setFetching(true)
    api
      .get<PLReport>(`finance/pl?year=${year}`)
      .then((r) => setReport(r.data))
      .catch(() => setReport(null))
      .finally(() => setFetching(false))
  }, [user, year])

  useEffect(() => {
    load()
  }, [load])

  const createManualLine = async () => {
    const label = newLabel.trim()
    if (!label) return
    setCreating(true)
    setModalError('')
    try {
      await postPlManualLine({
        section: newSection,
        label,
        sort_order: 0,
        link_to_net_profit: newSection === 'expenses_fixed' ? newLinkToNetProfit : false,
      })
      setAddOpen(false)
      setNewLabel('')
      setNewLinkToNetProfit(false)
      setModalError('')
      load()
    } catch (e) {
      setModalError(formatApiError(e))
    } finally {
      setCreating(false)
    }
  }

  const deleteManualLine = async (lineId: number) => {
    if (!window.confirm('Удалить эту строку и все введённые по месяцам суммы?')) return
    try {
      await deletePlManualLine(lineId)
      load()
    } catch (e) {
      window.alert(formatApiError(e))
    }
  }

  const yearOptions = useMemo(() => {
    const y = now.getFullYear()
    return Array.from({ length: 8 }, (_, i) => y - i)
  }, [now])

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  const cols = report?.columns ?? []

  return (
    <Layout>
      <PageHeader
        title="P&L"
        subtitle="Выручка по категориям проектов (факт оплат по графику). «Общая прибыль» показывает, сколько компания заработала за месяц после постоянных расходов, но без строк, привязанных к чистой прибыли; «Рентабельность» считает это в процентах от выручки. Строки с привязкой к чистой прибыли не уменьшают операционный результат и попадают в «Чистую прибыль»."
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '12px 10px 28px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
            Год
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontFamily: 'inherit',
                fontSize: 13,
              }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <BtnOutline type="button" onClick={() => load()} style={{ fontSize: 12, padding: '6px 12px' }}>
            Обновить
          </BtnOutline>
          <BtnPrimary
            type="button"
            onClick={() => {
              setModalError('')
              setNewLinkToNetProfit(false)
              setAddOpen(true)
            }}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            + Ручная строка
          </BtnPrimary>
          {fetching && <span style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка…</span>}
        </div>

        <Card style={{ padding: 0, overflow: 'auto', width: '100%', maxWidth: '100%' }}>
          {!report || cols.length === 0 ? (
            <div style={{ padding: 40, color: '#64748b', fontSize: 14 }}>
              {fetching ? 'Загрузка…' : 'Нет данных за выбранный год.'}
            </div>
          ) : (
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                minWidth: 'max(1080px, 100%)',
                tableLayout: 'auto',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      borderBottom: '2px solid #e2e8f0',
                      position: 'sticky',
                      left: 0,
                      background: '#f8fafc',
                      zIndex: 2,
                      minWidth: 220,
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#64748b',
                      textTransform: 'uppercase',
                    }}
                  >
                    Статья
                  </th>
                  {cols.map((ym) => (
                    <th
                      key={ym}
                      style={{
                        padding: '10px 8px',
                        borderBottom: '2px solid #e2e8f0',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: '#475569',
                        whiteSpace: 'nowrap',
                        minWidth: 88,
                        fontSize: 13,
                      }}
                    >
                      {columnTitle(ym)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let prevSection = ''
                  const blocks: ReactNode[] = []
                  for (const row of report.rows) {
                    if (row.section !== prevSection) {
                      prevSection = row.section
                      const meta = SECTION_TITLE[row.section] || {
                        title: row.section,
                        bg: '#f1f5f9',
                        color: '#334155',
                      }
                      blocks.push(
                        <tr key={`sec-${row.section}`}>
                          <td
                            colSpan={cols.length + 1}
                            style={{
                              background: meta.bg,
                              color: meta.color,
                              fontWeight: 800,
                              fontSize: 14,
                              lineHeight: 1.35,
                              textTransform: 'uppercase',
                              letterSpacing: '.05em',
                              padding: '10px 14px',
                              borderTop: '1px solid #e2e8f0',
                              borderBottom: '1px solid #e2e8f0',
                            }}
                          >
                            {meta.title}
                          </td>
                        </tr>,
                      )
                    }
                    const isManual = Boolean(row.is_manual && row.manual_line_id)
                    const isPercentRow = row.row_id === 'profitability_percent'
                    blocks.push(
                      <tr
                        key={row.row_id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: row.is_calculated ? '#fafafa' : isManual ? '#fffbeb' : '#fff',
                        }}
                      >
                        <td
                          style={{
                            padding: '10px 14px',
                            fontSize: 13,
                            fontWeight: row.is_calculated ? 700 : 600,
                            color: '#1e293b',
                            position: 'sticky',
                            left: 0,
                            background: row.is_calculated ? '#fafafa' : isManual ? '#fffbeb' : '#fff',
                            zIndex: 1,
                            borderRight: '1px solid #f1f5f9',
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <span>
                              {row.label}
                              {isManual && (
                                <span style={{ fontSize: 10, color: '#a16207', marginLeft: 6, fontWeight: 600 }}>
                                  (ручной ввод)
                                </span>
                              )}
                              {row.link_to_net_profit && (
                                <span style={{ fontSize: 10, color: '#166534', marginLeft: 6, fontWeight: 700 }}>
                                  (чистая прибыль)
                                </span>
                              )}
                            </span>
                            {isManual && row.manual_line_id != null && (
                              <button
                                type="button"
                                onClick={() => void deleteManualLine(row.manual_line_id!)}
                                style={{
                                  fontSize: 11,
                                  color: '#b91c1c',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                  textDecoration: 'underline',
                                }}
                              >
                                Удалить
                              </button>
                            )}
                          </div>
                        </td>
                        {row.cells.map((cell, i) => (
                          <td
                            key={cols[i]}
                            style={{
                              padding: '8px 6px',
                              textAlign: 'right',
                              fontSize: 13,
                              fontWeight: row.is_calculated ? 700 : 600,
                              color: '#334155',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'top',
                              lineHeight: 1.4,
                            }}
                          >
                            {isManual && row.manual_line_id != null ? (
                              <ManualCellEditor
                                lineId={row.manual_line_id}
                                periodMonth={cols[i]!}
                                cell={cell}
                                onSaved={load}
                              />
                            ) : (
                              isPercentRow ? formatPercentCell(cell) : formatCell(cell)
                            )}
                          </td>
                        ))}
                      </tr>,
                    )
                  }
                  return blocks
                })()}
              </tbody>
            </table>
          )}
        </Card>

        <Modal
          open={addOpen}
          onClose={() => {
            setModalError('')
            setNewLinkToNetProfit(false)
            setAddOpen(false)
          }}
          title="Новая ручная строка"
          width={440}
          footer={
            <>
              <BtnOutline type="button" onClick={() => { setModalError(''); setNewLinkToNetProfit(false); setAddOpen(false) }}>
                Отмена
              </BtnOutline>
              <BtnPrimary type="button" disabled={creating || !newLabel.trim()} onClick={() => void createManualLine()}>
                {creating ? 'Создаём…' : 'Добавить'}
              </BtnPrimary>
            </>
          }
        >
          {modalError && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                background: '#fef2f2',
                color: '#b91c1c',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {modalError}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
            <strong>Выручка</strong> — суммы попадают в «Итого выручка» и дальше в операционный результат (как проекты и ДДС-приход).
            <br />
            <strong>Постоянные расходы</strong> — в сумму расходов; если включить привязку к чистой прибыли, строка уйдёт в
            «Чистую прибыль» и не будет уменьшать операционный результат.
            <br />
            <strong>Итог</strong> — только строка под отчётом, без изменения расчётных итогов выше.
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Раздел</div>
            <select
              value={newSection}
              onChange={e => {
                const section = e.target.value as 'revenue' | 'expenses_fixed' | 'summary'
                setNewSection(section)
                if (section !== 'expenses_fixed') setNewLinkToNetProfit(false)
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                fontFamily: 'inherit',
              }}
            >
              <option value="revenue">Выручка</option>
              <option value="expenses_fixed">Постоянные расходы</option>
              <option value="summary">Итог</option>
            </select>
          </div>
          {newSection === 'expenses_fixed' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                Привязать к чистой прибыли?
              </div>
              <select
                value={newLinkToNetProfit ? 'yes' : 'no'}
                onChange={(e) => setNewLinkToNetProfit(e.target.value === 'yes')}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              >
                <option value="no">Нет, это обычный расход</option>
                <option value="yes">Да, это дивиденды / чистая прибыль</option>
              </select>
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Название статьи</div>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder={newSection === 'expenses_fixed' ? 'Например: Жама Д' : 'Например: Постоянные расходы — офис (план)'}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </Modal>

        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, margin: 0, maxWidth: '100%' }}>
          Выручка по проектам — оплаченные строки графика. Ручные строки в «Выручка» суммируются в «Итого выручка» и
          участвуют в операционном результате; в «Постоянные расходы» — в «Итого расходы». Если для ручного расхода
          включена привязка к чистой прибыли, он исключается из операционного результата и попадает в строку
          «Чистая прибыль». «Общая прибыль» показывает прибыль без изъятия денег учредителями, а «Рентабельность» —
          эту же прибыль в процентах от выручки.
        </p>
      </div>
    </Layout>
  )
}
