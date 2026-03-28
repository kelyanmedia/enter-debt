import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import {
  PageHeader,
  StatCard,
  Card,
  Th,
  Td,
  PartnerAvatar,
  statusBadge,
  formatDate,
  daysLeft,
  formatAmount,
  formatMoneyNumber,
  Empty,
  Select,
} from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
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
  project_category?: string | null
  deadline_date?: string
  day_of_month?: number
  created_at: string
  partner: { name: string; manager?: { id: number; name: string } }
}

function categoryBadge(cat?: string | null) {
  if (cat === 'web')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff4ff', padding: '3px 8px', borderRadius: 6 }}>Web</span>
    )
  if (cat === 'seo')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fff8ee', padding: '3px 8px', borderRadius: 6 }}>SEO</span>
    )
  if (cat === 'ppc')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '3px 8px', borderRadius: 6 }}>PPC</span>
    )
  return <span style={{ color: '#c5c8d4', fontSize: 12 }}>—</span>
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
  border: '1px solid #e8e9ef',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 13,
  color: '#1a1d23',
  background: '#fff',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

interface ManagerOption {
  id: number
  name: string
}

export default function DebitorPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [allPayments, setAllPayments] = useState<Payment[]>([])
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [filterManager, setFilterManager] = useState('')
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'pending'>('all')
  const [filterCategory, setFilterCategory] = useState('')

  const loadStats = useCallback(
    (from: string, to: string, mgr: string) => {
      const params = new URLSearchParams()
      if (from) params.append('date_from', from)
      if (to) params.append('date_to', to)
      if ((user?.role === 'admin' || user?.role === 'accountant') && mgr) params.append('manager_id', mgr)
      api
        .get(`dashboard?${params}`)
        .then(r => setStats(r.data))
        .catch(() => setStats(null))
    },
    [user?.role]
  )

  const loadPayments = useCallback(() => {
    Promise.all([api.get('payments?status=overdue'), api.get('payments?status=pending')])
      .then(([r1, r2]) => {
        const combined = [...r1.data, ...r2.data]
        const seen = new Set<number>()
        setAllPayments(combined.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true))))
      })
      .catch(() => setAllPayments([]))
  }, [])

  useEffect(() => {
    loadStats(dateFrom, dateTo, filterManager)
  }, [dateFrom, dateTo, filterManager, loadStats])

  useEffect(() => {
    loadPayments()
  }, [loadPayments])

  useEffect(() => {
    api.get<ManagerOption[]>('users/managers-for-select').then(r => setManagers(r.data)).catch(() => setManagers([]))
  }, [])

  useEffect(() => {
    if (user?.role === 'manager') setFilterManager(String(user.id))
  }, [user])

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from)
    setDateTo(to)
    loadStats(from, to, filterManager)
  }

  const payments = useMemo(() => {
    let list = allPayments
    if (filterManager) {
      list = list.filter(p => String(p.partner?.manager?.id) === filterManager)
    }
    if (statusFilter === 'overdue') list = list.filter(p => p.status === 'overdue')
    if (statusFilter === 'pending') list = list.filter(p => p.status === 'pending')
    if (filterCategory) list = list.filter(p => (p.project_category || '') === filterCategory)
    if (dateFrom) list = list.filter(p => new Date(p.created_at) >= new Date(dateFrom))
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      list = list.filter(p => new Date(p.created_at) <= to)
    }
    return list.sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1
      if (a.status !== 'overdue' && b.status === 'overdue') return 1
      return 0
    })
  }, [allPayments, dateFrom, dateTo, statusFilter, filterManager, filterCategory])

  const periodLabel =
    dateFrom || dateTo
      ? `${dateFrom ? new Date(dateFrom).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '…'} — ${dateTo ? new Date(dateTo).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '…'}`
      : 'Весь период'

  const totalRowSum = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount), 0),
    [payments]
  )

  return (
    <Layout>
      <PageHeader
        title="Дебиторка"
        subtitle="Дебиторская задолженность по проектам: статистика за период и список неоплаченных сумм."
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
          <span style={{ fontSize: 12, color: '#8a8fa8' }}>Период для статистики:</span>
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
            type="button"
            onClick={() => handleDateChange(firstOfMonth(), today())}
            style={{
              fontSize: 11,
              color: '#1a6b3c',
              background: '#f0faf4',
              border: '1px solid #c3e6d0',
              borderRadius: 7,
              padding: '5px 10px',
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: 'inherit',
            }}
          >
            Этот месяц
          </button>
          <button
            type="button"
            onClick={() => handleDateChange('', '')}
            style={{
              fontSize: 11,
              color: '#8a8fa8',
              background: '#f5f6fa',
              border: '1px solid #e8e9ef',
              borderRadius: 7,
              padding: '5px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Всё время
          </button>

          {user?.role === 'admin' && (
            <>
              <span style={{ marginLeft: 12, fontSize: 12, color: '#8a8fa8' }}>Менеджер:</span>
              <Select
                value={filterManager}
                onChange={e => setFilterManager(e.target.value)}
                style={{ ...DATE_INPUT_STYLE, cursor: 'pointer', maxWidth: 220 }}
              >
                <option value="">Все менеджеры</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </>
          )}

          <span style={{ marginLeft: user?.role === 'admin' ? 8 : 12, fontSize: 12, color: '#8a8fa8' }}>В таблице:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as 'all' | 'overdue' | 'pending')}
            style={{
              ...DATE_INPUT_STYLE,
              cursor: 'pointer',
              maxWidth: 200,
            }}
          >
            <option value="all">Все неоплаченные</option>
            <option value="overdue">Только просрочено</option>
            <option value="pending">Только ожидается</option>
          </select>

          <span style={{ marginLeft: 8, fontSize: 12, color: '#8a8fa8' }}>Категория:</span>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            style={{ ...DATE_INPUT_STYLE, cursor: 'pointer', maxWidth: 160 }}
          >
            <option value="">Все</option>
            <option value="web">Web</option>
            <option value="seo">SEO</option>
            <option value="ppc">PPC</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 22 }}>
          <StatCard
            featured
            label="Дебиторка за период"
            value={stats ? formatAmount(stats.total_receivable) : '—'}
            sub={`${stats?.partners_count ?? 0} активных партнёров`}
          />
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
            label={dateFrom || dateTo ? 'Оплачено за период' : 'Оплачено (всего)'}
            value={String(stats?.paid_this_month ?? '—')}
            sub={stats ? `${formatAmount(stats.paid_amount_this_month)} получено` : ''}
            subColor="#1a6b3c"
          />
        </div>

        <Card>
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e8e9ef',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Неоплаченные проекты</div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4 }}>
                Период: {periodLabel} · в таблице сумма по отфильтрованным строкам:{' '}
                <strong style={{ color: '#1a1d23' }}>{formatAmount(totalRowSum)}</strong>
              </div>
            </div>
            <a
              href="/payments"
              style={{ fontSize: 13, color: '#1a6b3c', fontWeight: 600, textDecoration: 'none' }}
            >
              Все проекты →
            </a>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Партнёр</Th>
                <Th>Менеджер</Th>
                <Th>Категория</Th>
                <Th>Проект</Th>
                <Th>Сумма</Th>
                <Th>Добавлен</Th>
                <Th>Срок / осталось</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const dl = daysLeft(p.deadline_date, p.day_of_month)
                return (
                  <tr
                    key={p.id}
                    style={{ borderBottom: '1px solid #e8e9ef', cursor: 'pointer' }}
                    onClick={() => router.push('/payments')}
                  >
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PartnerAvatar name={p.partner.name} />
                        <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                      </div>
                    </Td>
                    <Td style={{ color: '#5b6470', fontSize: 13 }}>{p.partner.manager?.name || '—'}</Td>
                    <Td>{categoryBadge(p.project_category)}</Td>
                    <Td style={{ color: '#5b6470', maxWidth: 280 }}>{p.description}</Td>
                    <Td>
                      <span style={{ fontWeight: 700 }}>{formatMoneyNumber(p.amount)}</span>
                    </Td>
                    <Td style={{ color: '#8a8fa8', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                    <Td>
                      <span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span>
                    </Td>
                    <Td>{statusBadge(p.status)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {payments.length === 0 && <Empty text="Нет неоплаченных проектов по выбранным фильтрам" />}
        </Card>
      </div>
    </Layout>
  )
}
