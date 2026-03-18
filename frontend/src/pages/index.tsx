import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { StatCard, Card, CardHeader, CardTitle, Th, Td, PartnerAvatar, Badge, statusBadge, formatAmount, formatDate, daysLeft } from '@/components/ui'
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
  partner: { name: string; manager?: { name: string } }
}

interface NotifLog {
  id: number
  sent_to_name: string
  message_text: string
  status: string
  sent_at: string
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [logs, setLogs] = useState<NotifLog[]>([])

  useEffect(() => {
    api.get('dashboard').then(r => setStats(r.data))
    api.get('payments?status=overdue').then(r => setPayments(p => [...r.data.slice(0, 3), ...p]))
    api.get('payments?status=pending').then(r => setPayments(p => {
      const all = [...p, ...r.data].slice(0, 6)
      return all
    }))
    api.get('notifications').then(r => setLogs(r.data.slice(0, 5)))
  }, [])

  const fmtM = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'K' : String(n)

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e8e9ef', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Дашборд</div>
          <div style={{ fontSize: 13, color: '#8a8fa8' }}>Обзор дебиторской задолженности</div>
        </div>
      </div>

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          <StatCard
            featured
            label="Всего дебиторка"
            value={stats ? fmtM(stats.total_receivable) + ' UZS' : '—'}
            sub={`${stats?.partners_count ?? 0} активных партнёров`}
          />
          <StatCard
            label="Просрочено"
            value={String(stats?.overdue_count ?? '—')}
            sub="требуют внимания"
            subColor="#e84040"
          />
          <StatCard
            label="Ожидается"
            value={String(stats?.pending_count ?? '—')}
            sub="активных платежей"
            subColor="#f0900a"
          />
          <StatCard
            label="Оплачено в этом месяце"
            value={String(stats?.paid_this_month ?? '—')}
            sub={stats ? fmtM(stats.paid_amount_this_month) + ' UZS получено' : ''}
          />
        </div>

        {/* Payments table + activity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 14, marginBottom: 20 }}>
          <Card>
            <CardHeader>
              <CardTitle>Активные платежи</CardTitle>
              <a href="/payments" style={{ fontSize: 12, color: '#2d9b5a', fontWeight: 600, textDecoration: 'none' }}>Все →</a>
            </CardHeader>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Описание</Th>
                  <Th>Сумма</Th>
                  <Th>Осталось</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const dl = daysLeft(p.deadline_date, p.day_of_month)
                  return (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/payments'}>
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
                      <Td><span style={{ fontWeight: 700 }}>{Number(p.amount).toLocaleString('ru-RU')}</span></Td>
                      <Td><span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span></Td>
                      <Td>{statusBadge(p.status)}</Td>
                    </tr>
                  )
                })}
                {payments.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>Нет активных платежей</td></tr>
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
    </Layout>
  )
}
