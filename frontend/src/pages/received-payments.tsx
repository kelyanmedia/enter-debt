import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, BtnOutline, Empty, formatMoneyNumber } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { isFinanceTeamRole } from '@/lib/roles'

interface ReceivedRow {
  kind: string
  paid_at: string
  amount: number | string
  partner_id: number
  partner_name: string
  payment_id: number
  project_description: string
  service_month: string | null
  line_description: string | null
  confirmed_by_id: number | null
  confirmed_by_name: string | null
  received_payment_method?: string | null
}

const METHOD_LABEL: Record<string, string> = {
  transfer: 'Перечисление',
  card: 'Карта',
  cash: 'Наличные',
}

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function currentYearMonth() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function prevYearMonth(y: number, m: number) {
  if (m <= 1) return { year: y - 1, month: 12 }
  return { year: y, month: m - 1 }
}

function serviceMonthLabel(ym: string | null) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '—'
  const [y, mo] = ym.split('-').map(Number)
  return `${MONTHS_RU[mo - 1]} ${y}`
}

function formatPaidAt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ReceivedPaymentsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [{ year, month }, setYearMonth] = useState(currentYearMonth)
  const [rows, setRows] = useState<ReceivedRow[]>([])
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [user, loading, router])

  const load = useCallback(() => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setFetching(true)
    api
      .get<ReceivedRow[]>(`dashboard/received-payments?year=${year}&month=${month}`)
      .then(r => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setFetching(false))
  }, [user, year, month])

  useEffect(() => {
    load()
  }, [load])

  const monthInputValue = `${year}-${String(month).padStart(2, '0')}`

  const totals = useMemo(() => {
    let sum = 0
    for (const r of rows) sum += Number(r.amount)
    return { count: rows.length, sum }
  }, [rows])

  const grouped = useMemo(() => {
    const partners = new Map<
      number,
      { name: string; projects: Map<number, { description: string; lines: ReceivedRow[] }> }
    >()
    for (const r of rows) {
      if (!partners.has(r.partner_id)) {
        partners.set(r.partner_id, { name: r.partner_name, projects: new Map() })
      }
      const p = partners.get(r.partner_id)!
      if (!p.projects.has(r.payment_id)) {
        p.projects.set(r.payment_id, { description: r.project_description, lines: [] })
      }
      p.projects.get(r.payment_id)!.lines.push(r)
    }
    const list = Array.from(partners.entries()).map(([partnerId, v]) => ({
      partnerId,
      partnerName: v.name,
      projects: Array.from(v.projects.entries()).map(([paymentId, pr]) => ({
        paymentId,
        description: pr.description,
        lines: pr.lines.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()),
      })),
    }))
    list.sort((a, b) => a.partnerName.localeCompare(b.partnerName, 'ru'))
    return list
  }, [rows])

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  const periodTitle = `${MONTHS_RU[month - 1]} ${year}`

  return (
    <Layout>
      <PageHeader
        title="Оплаты"
        subtitle="Поступления по факту подтверждения (дата «деньги пришли») — для фиксации в ДДС. Группировка: контрагент → проект → строки оплат."
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: '#8a8fa8' }}>Месяц поступления:</span>
          <input
            type="month"
            value={monthInputValue}
            onChange={e => {
              const v = e.target.value
              if (!v) return
              const [y, m] = v.split('-').map(Number)
              setYearMonth({ year: y, month: m })
            }}
            style={{
              border: '1px solid #e8e9ef',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'inherit',
              color: '#1a1d23',
            }}
          />
          <BtnOutline
            onClick={() => setYearMonth(currentYearMonth())}
            style={{ padding: '7px 14px', fontSize: 12 }}
          >
            Текущий месяц
          </BtnOutline>
          <BtnOutline
            onClick={() => setYearMonth(prevYearMonth(year, month))}
            style={{ padding: '7px 14px', fontSize: 12 }}
          >
            Прошлый месяц
          </BtnOutline>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
            {fetching ? 'Загрузка…' : `${totals.count} оплат · ${formatMoneyNumber(totals.sum)} Uzs`}
          </span>
        </div>

        <Card style={{ marginBottom: 16, padding: '14px 18px', background: '#f8fafc', border: '1px solid #e8e9ef' }}>
          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.55 }}>
            Учитываются только подтверждённые поступления: помесячно — кнопка «Оплата прошла» по строке графика; разовые
            проекты без графика — «Оплачено» по проекту. Отбор по календарному месяцу даты зачисления (
            <strong>{periodTitle}</strong>
            ).
          </div>
        </Card>

        {grouped.length === 0 && !fetching && <Empty text="За выбранный месяц подтверждённых поступлений нет" />}

        {grouped.map(block => (
          <Card key={block.partnerId} style={{ marginBottom: 16, overflow: 'hidden' }}>
            <div
              style={{
                padding: '12px 18px',
                background: '#f0faf4',
                borderBottom: '1px solid #e8e9ef',
                fontSize: 15,
                fontWeight: 700,
                color: '#145a32',
              }}
            >
              {block.partnerName}
            </div>
            <div style={{ padding: '12px 18px' }}>
              {block.projects.map((proj, j) => (
                <div key={proj.paymentId} style={{ marginBottom: j < block.projects.length - 1 ? 22 : 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1d23', marginBottom: 8 }}>
                    Проект #{proj.paymentId}: {proj.description}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e8e9ef' }}>
                        <Th>Дата поступления</Th>
                        <Th>Сумма (Uzs)</Th>
                        <Th>Период услуги</Th>
                        <Th>Строка / комментарий</Th>
                        <Th>Способ</Th>
                        <Th>Подтвердил</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {proj.lines.map((line, i) => (
                        <tr key={`${line.kind}-${line.payment_id}-${line.paid_at}-${i}`} style={{ borderBottom: '1px solid #f0f1f5' }}>
                          <Td style={{ color: '#475569' }}>{formatPaidAt(line.paid_at)}</Td>
                          <Td>
                            <span style={{ fontWeight: 700 }}>{formatMoneyNumber(line.amount)}</span>
                          </Td>
                          <Td style={{ color: '#6b7280' }}>
                            {line.kind === 'month_line' ? serviceMonthLabel(line.service_month) : '— (весь проект)'}
                          </Td>
                          <Td style={{ color: '#6b7280', maxWidth: 280 }}>
                            {line.line_description || (line.kind === 'project_whole' ? line.project_description : '—')}
                          </Td>
                          <Td style={{ color: '#6b7280', fontSize: 12 }}>
                            {line.received_payment_method
                              ? METHOD_LABEL[line.received_payment_method] || line.received_payment_method
                              : '—'}
                          </Td>
                          <Td style={{ color: '#6b7280' }}>{line.confirmed_by_name || '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Layout>
  )
}
