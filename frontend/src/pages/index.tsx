import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/context/AuthContext'
import { StatCard, Card, CardHeader, CardTitle, Th, Td, PartnerAvatar, Badge, statusBadge, formatDate, daysLeft, formatAmount, formatMoneyNumber } from '@/components/ui'
import api from '@/lib/api'

interface Stats {
  total_receivable: number
  overdue_count: number
  pending_count: number
  paid_this_month: number
  paid_amount_this_month: number
  partners_count: number
}

interface Payment {
  id: number
  description: string
  amount: number
  status: string
  payment_type: string
  deadline_date?: string
  day_of_month?: number
  created_at: string
  source_payment_month_id?: number | null
  partner: { name: string; manager?: { name: string } }
}

interface NotifLog {
  id: number
  sent_to_name: string
  message_text: string
  status: string
  sent_at: string
}

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DATE_INPUT_STYLE: React.CSSProperties = {
  border: '1px solid #e8e9ef', borderRadius: 8, padding: '6px 10px',
  fontSize: 13, color: '#1a1d23', background: '#fff',
  outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
}

export default function Dashboard() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && user.role === 'manager') router.replace('/debitor')
  }, [user, loading, router])

  const [stats, setStats] = useState<Stats | null>(null)
  const [allPayments, setAllPayments] = useState<Payment[]>([])
  const [logs, setLogs] = useState<NotifLog[]>([])
  const [dashboardError, setDashboardError] = useState(false)
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)

  const loadStats = (from: string, to: string) => {
    const params = new URLSearchParams()
    if (from) params.append('date_from', from)
    if (to) params.append('date_to', to)
    api.get(`dashboard?${params}`)
      .then(r => {
        setStats(r.data)
        setDashboardError(false)
      })
      .catch(() => {
        setStats(null)
        setDashboardError(true)
      })
  }

  useEffect(() => {
    if (!user || user.role === 'manager') return
    loadStats(dateFrom, dateTo)
    Promise.all([
      api.get('payments?status=overdue&expand_month_lines=1'),
      api.get('payments?status=pending&expand_month_lines=1'),
    ])
      .then(([r1, r2]) => {
        const combined = [...r1.data, ...r2.data] as Payment[]
        const seen = new Set<string>()
        setAllPayments(
          combined.filter(p => {
            const k =
              p.source_payment_month_id != null
                ? `${p.id}-m${p.source_payment_month_id}`
                : String(p.id)
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })
        )
      })
      .catch(() => setAllPayments([]))
    api.get('notifications')
      .then(r => setLogs(r.data.slice(0, 5)))
      .catch(() => setLogs([]))
  }, [user])

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from)
    setDateTo(to)
    loadStats(from, to)
  }

  const payments = useMemo(() => {
    let list = allPayments
    if (dateFrom) list = list.filter(p => new Date(p.created_at) >= new Date(dateFrom))
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
      list = list.filter(p => new Date(p.created_at) <= to)
    }
    return list
  }, [allPayments, dateFrom, dateTo])

  const periodLabel = dateFrom || dateTo
    ? `${dateFrom ? new Date(dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '...'} — ${dateTo ? new Date(dateTo).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '...'}`
    : 'Весь период'

  return (
    <Layout>
      {/* Layout обрабатывает редирект на /login и spinner; контент только для admin/accountant */}
      {!loading && user && user.role !== 'manager' && <>
      {/* Header with global date filter */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e8e9ef', padding: '0 24px', minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Дашборд</div>
          <div style={{ fontSize: 13, color: '#8a8fa8' }}>Обзор дебиторской задолженности</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#8a8fa8' }}>Период:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => handleDateChange(e.target.value, dateTo)}
            style={DATE_INPUT_STYLE}
          />
          <span style={{ fontSize: 12, color: '#8a8fa8' }}>—</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => handleDateChange(dateFrom, e.target.value)}
            style={DATE_INPUT_STYLE}
          />
          <button
            onClick={() => handleDateChange(firstOfMonth(), today())}
            style={{ fontSize: 11, color: '#1a6b3c', background: '#f0faf4', border: '1px solid #c3e6d0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}
          >Этот месяц</button>
          <button
            onClick={() => handleDateChange('', '')}
            style={{ fontSize: 11, color: '#8a8fa8', background: '#f5f6fa', border: '1px solid #e8e9ef', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
          >Всё время</button>
        </div>
      </div>

      {dashboardError && (
        <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
          <div style={{ padding: '11px 14px', background: '#fff8f0', border: '1px solid #f0d9c0', borderRadius: 10, fontSize: 13, color: '#8a4a00', lineHeight: 1.45 }}>
            Не удалось связаться с API (сервер выключен или неверный BACKEND_URL). Запустите backend и проверьте{' '}
            <code style={{ fontSize: 12, background: '#fff', padding: '1px 6px', borderRadius: 4 }}>frontend/.env.local</code>
            {' — '}часто нужно <code style={{ fontSize: 12, background: '#fff', padding: '1px 6px', borderRadius: 4 }}>BACKEND_URL=http://127.0.0.1:8001</code>
          </div>
        </div>
      )}

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 14,
            marginBottom: 20,
            alignItems: 'stretch',
          }}
        >
          <Link
            href="/debitor"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', minHeight: 0, minWidth: 0, width: '100%' }}
          >
            <StatCard
              featured
              label="Дебиторка за период"
              value={stats ? formatAmount(stats.total_receivable) : '—'}
              sub={`${stats?.partners_count ?? 0} активных партнёров · подробнее`}
            />
          </Link>
          <StatCard
            label="Просрочено"
            value={String(stats?.overdue_count ?? '—')}
            sub={`за ${periodLabel}`}
            subColor="#e84040"
          />
          <StatCard
            label="Ожидается"
            value={String(stats?.pending_count ?? '—')}
            sub={`за ${periodLabel}`}
            subColor="#f0900a"
          />
          <StatCard
            featured
            compactValue
            label="Оплачено за период"
            value={stats ? formatAmount(stats.paid_amount_this_month) : '—'}
            sub={stats != null ? `${stats.paid_this_month} оплат · получено` : ''}
          />
        </div>

        {/* Payments table + activity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, marginBottom: 20 }}>
          <Card>
            <CardHeader>
              <CardTitle>Активные проекты · <span style={{ fontWeight: 400, color: '#8a8fa8', fontSize: 12 }}>{periodLabel}</span></CardTitle>
              <a href="/payments" style={{ fontSize: 12, color: '#2d9b5a', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>Все →</a>
            </CardHeader>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Описание</Th>
                  <Th>Сумма</Th>
                  <Th>Дата добавления</Th>
                  <Th>Осталось</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const dl = daysLeft(p.deadline_date, p.day_of_month)
                  const rowKey =
                    p.source_payment_month_id != null ? `${p.id}-m-${p.source_payment_month_id}` : p.id
                  return (
                    <tr key={rowKey} style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/payments'}>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <PartnerAvatar name={p.partner.name} />
                          <div>
                            <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                            <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.partner.manager?.name}</div>
                          </div>
                        </div>
                      </Td>
                      <Td style={{ color: '#8a8fa8' }}>{p.description}</Td>
                      <Td><span style={{ fontWeight: 700 }}>{formatMoneyNumber(p.amount)}</span></Td>
                      <Td style={{ color: '#8a8fa8', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                      <Td><span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span></Td>
                      <Td>{statusBadge(p.status)}</Td>
                    </tr>
                  )
                })}
                {payments.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>
                    Нет активных проектов за выбранный период
                  </td></tr>
                )}
              </tbody>
            </table>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader><CardTitle>Последние уведомления</CardTitle></CardHeader>
            <div>
              {logs.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 20px', borderBottom: '1px solid #e8e9ef' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.status === 'success' ? '#2d9b5a' : '#e84040', flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{l.sent_to_name}</div>
                    <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 2 }}>{formatDate(l.sent_at)}</div>
                  </div>
                  <Badge variant={l.status === 'success' ? 'green' : 'red'}>{l.status === 'success' ? 'OK' : 'Ошибка'}</Badge>
                </div>
              ))}
              {logs.length === 0 && <div style={{ padding: '32px', textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>Нет уведомлений</div>}
            </div>
          </Card>
        </div>
      </div>
      </>}
    </Layout>
  )
}
