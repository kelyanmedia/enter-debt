import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, Empty, formatMoneyNumber } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { isFinanceTeamRole } from '@/lib/roles'

interface PayrollExpenseRow {
  id: number
  user_id: number
  employee_name: string
  paid_on: string
  period_year?: number | null
  period_month?: number | null
  amount: string
  currency: string
  note?: string | null
  has_receipt: boolean
  created_at: string
}

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthKeyFromPaidOn(iso: string) {
  return iso.slice(0, 7)
}

function monthSectionTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || m < 1 || m > 12) return ym
  return `${MONTHS_RU[m - 1]} ${y}`
}

function periodLabel(y?: number | null, m?: number | null) {
  if (y == null || m == null || m < 1 || m > 12) return '—'
  return `${MONTHS_RU[m - 1]} ${y}`
}

/** Дата, когда сотрудник получил выплату (paid_on) */
function formatPaymentDate(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function payoutWord(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'выплата'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'выплаты'
  return 'выплат'
}

export default function FinanceExpensesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<PayrollExpenseRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set([currentYearMonth()]))
  const defaultExpandedOnce = useRef(false)

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [loading, user, router])

  const load = useCallback(() => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setFetching(true)
    api
      .get<PayrollExpenseRow[]>('employee-payment-records/payroll-expenses')
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setFetching(false))
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  /** Первый заход: раскрыть текущий месяц; если в нём нет строк — последний месяц с данными */
  useEffect(() => {
    if (rows.length === 0 || defaultExpandedOnce.current) return
    defaultExpandedOnce.current = true
    const keys = Array.from(new Set(rows.map((r) => monthKeyFromPaidOn(r.paid_on)))).sort().reverse()
    const cur = currentYearMonth()
    const pick = keys.includes(cur) ? cur : keys[0]
    if (pick) setExpandedMonths(new Set([pick]))
  }, [rows])

  const byMonth = useMemo(() => {
    const map = new Map<string, PayrollExpenseRow[]>()
    for (const r of rows) {
      const k = monthKeyFromPaidOn(r.paid_on)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    for (const list of Array.from(map.values())) {
      list.sort((a, b) => {
        const da = a.paid_on.localeCompare(b.paid_on)
        if (da !== 0) return da
        return b.id - a.id
      })
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  }, [rows])

  const monthTotals = useCallback((list: PayrollExpenseRow[]) => {
    let uzs = 0
    let usd = 0
    for (const r of list) {
      const n = Number(r.amount)
      if (!Number.isFinite(n)) continue
      if (r.currency === 'UZS') uzs += n
      else usd += n
    }
    return { uzs, usd }
  }, [])

  const totals = useMemo(() => {
    let uzs = 0
    let usd = 0
    for (const r of rows) {
      const n = Number(r.amount)
      if (!Number.isFinite(n)) continue
      if (r.currency === 'UZS') uzs += n
      else usd += n
    }
    return { uzs, usd }
  }, [rows])

  const toggleMonth = (ym: string) => {
    setExpandedMonths((prev) => {
      const n = new Set(prev)
      if (n.has(ym)) n.delete(ym)
      else n.add(ym)
      return n
    })
  }

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  const curYm = currentYearMonth()

  return (
    <Layout>
      <PageHeader
        title="Расходы"
        subtitle="Выплаты сотрудникам, которые администратор вносит в «Команда» → «История выплат» → «Запись о выплате». Учёт только в БД текущей компании."
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
          Источник данных — те же записи, что в кабинете сотрудника; сюда попадают только строки, созданные админом (
          не самостоятельные отметки сотрудника). Редактирование — в разделе{' '}
          <Link href="/staff" style={{ color: '#1a6b3c', fontWeight: 600 }}>
            Команда
          </Link>
          . Список сгруппирован по <strong>месяцу даты выплаты</strong> (когда деньги получены); по умолчанию открыт{' '}
          <strong>текущий месяц</strong>.
        </div>

        <Card style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23' }}>Итого по списку</span>
            {totals.uzs > 0 && (
              <span style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
                {formatMoneyNumber(totals.uzs)} UZS
              </span>
            )}
            {totals.usd > 0 && (
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f' }}>
                ${formatMoneyNumber(totals.usd)}
              </span>
            )}
            {totals.uzs <= 0 && totals.usd <= 0 && !fetching && <span style={{ color: '#94a3b8' }}>—</span>}
            {fetching && <span style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка…</span>}
            <button
              type="button"
              onClick={() => load()}
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                fontWeight: 600,
                color: '#1a6b3c',
                background: '#f0faf4',
                border: '1px solid #c3e6d0',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Обновить
            </button>
          </div>

          {rows.length === 0 && !fetching ? (
            <Empty text="Пока нет выплат, внесённых администратором. Добавьте запись в «Команда» → история выплат сотрудника." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byMonth.map(([ym, monthRows]) => {
                const open = expandedMonths.has(ym)
                const mt = monthTotals(monthRows)
                const isCurrent = ym === curYm
                return (
                  <div
                    key={ym}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#fff',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleMonth(ym)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        border: 'none',
                        background: open ? '#f0fdf4' : '#f8fafc',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: `2px solid ${open ? '#1a6b3c' : '#cbd5e1'}`,
                          background: open ? '#1a6b3c' : '#fff',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                        aria-hidden
                      >
                        {open ? '✓' : ''}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b' }}>
                          {monthSectionTitle(ym)}
                          {isCurrent && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#166534',
                                background: '#dcfce7',
                                padding: '2px 8px',
                                borderRadius: 6,
                              }}
                            >
                              текущий месяц
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {monthRows.length} {payoutWord(monthRows.length)}
                          {mt.uzs > 0 && (
                            <span style={{ marginLeft: 8, fontWeight: 700, color: '#166534' }}>
                              · {formatMoneyNumber(mt.uzs)} UZS
                            </span>
                          )}
                          {mt.usd > 0 && (
                            <span style={{ marginLeft: 8, fontWeight: 700, color: '#1e3a5f' }}>
                              · ${formatMoneyNumber(mt.usd)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 18, color: '#64748b', flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
                    </button>
                    {open && (
                      <div style={{ padding: '0 12px 14px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              <Th>Дата выплаты</Th>
                              <Th>Сотрудник</Th>
                              <Th>Сумма</Th>
                              <Th>Период задач</Th>
                              <Th>Комментарий</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthRows.map((r) => (
                              <tr key={r.id} style={{ borderBottom: '1px solid #eef2f7' }}>
                                <Td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatPaymentDate(r.paid_on)}</Td>
                                <Td style={{ fontWeight: 600 }}>{r.employee_name}</Td>
                                <Td>
                                  {formatMoneyNumber(Number(r.amount))} {r.currency}
                                </Td>
                                <Td>{periodLabel(r.period_year, r.period_month)}</Td>
                                <Td style={{ color: '#64748b', fontSize: 13 }}>{r.note?.trim() || '—'}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </Layout>
  )
}
