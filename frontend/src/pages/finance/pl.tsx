import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, BtnOutline, formatMoneyNumber } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
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

function formatCell(c: PLCell) {
  const u = Number(c.uzs)
  const d = Number(c.usd)
  if (!Number.isFinite(u)) return '—'
  if (!u && !d) return '—'
  const parts: string[] = []
  if (u) parts.push(formatMoneyNumber(u))
  if (d) parts.push(`$${formatMoneyNumber(d)}`)
  return parts.join('\n')
}

const SECTION_TITLE: Record<string, { title: string; bg: string; color: string }> = {
  revenue: { title: 'Выручка', bg: '#ecfdf5', color: '#166534' },
  expenses_fixed: { title: 'Постоянные расходы', bg: '#fef2f2', color: '#b91c1c' },
  summary: { title: 'Итог', bg: '#f0fdf4', color: '#14532d' },
}

export default function FinancePlPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [report, setReport] = useState<PLReport | null>(null)
  const [fetching, setFetching] = useState(false)

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
        subtitle="Выручка по категориям проектов (факт оплат по графику). Расходы ДДС — по категориям, в т.ч. «Агаси Д (дивиденды)» для личного вывода. В итоге: операционный результат без Агаси Д; «Чистая прибыль» — только суммы Агаси Д из ДДС."
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
                        minWidth: 72,
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
                    blocks.push(
                      <tr
                        key={row.row_id}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: row.is_calculated ? '#fafafa' : '#fff',
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
                            background: row.is_calculated ? '#fafafa' : '#fff',
                            zIndex: 1,
                            borderRight: '1px solid #f1f5f9',
                            lineHeight: 1.4,
                          }}
                        >
                          {row.label}
                        </td>
                        {row.cells.map((cell, i) => (
                          <td
                            key={cols[i]}
                            style={{
                              padding: '10px 8px',
                              textAlign: 'right',
                              fontSize: 13,
                              fontWeight: row.is_calculated ? 700 : 600,
                              color: '#334155',
                              whiteSpace: 'pre-line',
                              verticalAlign: 'top',
                              lineHeight: 1.4,
                            }}
                          >
                            {formatCell(cell)}
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

        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, margin: 0, maxWidth: '100%' }}>
          Выручка по проектам — оплаченные строки графика (месяц по дате оплаты или периоду строки). Дополнительный приход
          и расходы по статьям — из раздела «ДДС». Личный вывод средств вносите расходом с категорией «Агаси Д (дивиденды)» —
          эти суммы попадают в строку «Чистая прибыль (Агаси Д)» и не смешиваются с операционным результатом. Блок «Доступные
          средства» на странице ДДС показывает остатки по счёту/картам/вкладам, это не та же величина, что прибыль в P&L.
          Зарплатный фонд объединяет выплаты в «Команда» и расходы ДДС с категорией «Зарплата» (в т.ч. шаблон Влад, Обиджон,
          Суннат, Рустам). Не дублируйте в ДДС приход то, что уже отражено оплатами по проектам, если не нужен отдельный
          кассовый учёт.
        </p>
      </div>
    </Layout>
  )
}
