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
  source_payment_month_id?: number | null
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

/** Первый и последний день следующего календарного месяца (локальное время) */
function boundsNextMonth(): [string, string] {
  const d = new Date()
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const ny = next.getFullYear()
  const nm = next.getMonth()
  const first = `${ny}-${String(nm + 1).padStart(2, '0')}-01`
  const lastD = new Date(ny, nm + 1, 0).getDate()
  const last = `${ny}-${String(nm + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`
  return [first, last]
}

function ymdTuple(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

function cmpYmd(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

/** Платёж попадает в выбранный период по дате срока оплаты (или по дате добавления проекта, если срока нет) */
function paymentDueInSelectedPeriod(p: Payment, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true
  const anchor = (p.deadline_date && p.deadline_date.slice(0, 10)) || (p.created_at && p.created_at.slice(0, 10)) || ''
  const d = ymdTuple(anchor)
  if (!d) return true
  const from = dateFrom ? ymdTuple(dateFrom) : null
  const to = dateTo ? ymdTuple(dateTo) : null
  if (from && cmpYmd(d, from) < 0) return false
  if (to && cmpYmd(d, to) > 0) return false
  return true
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

/** Подсказки для карточек дебиторки (значок «!» в углу) */
const DEBITOR_STAT_HINT = {
  receivable:
    'Сумма неоплаченных платежей (строки графика или разовые проекты), у которых срок оплаты попадает в выбранный период. Длинный договор с 12 месяцами даёт 12 отдельных платежей — каждый со своей датой. Фильтры менеджера и категории учитываются. Оплаченное сюда не входит.',
  overdue:
    'Число платежей с просроченным сроком (красный в колонке «Срок») в выбранном периоде по дате оплаты.',
  pending:
    'Число платежей без просрочки, но со сроком в выбранном периоде (жёлтый — до 14 дней до срока, серый — дальше).',
  paid:
    'Число зафиксированных оплат и сумма по фактической дате зачисления: помесячные оплаты (отметка «оплата прошла» по месяцу) и разовые проекты без графика (кнопка «Оплачено»). Если выбраны даты — только оплаты в этом диапазоне; «Всё время» — за всю историю.',
} as const

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

  /** База для карточек и таблицы: неоплаченные платежи с сроком в периоде (не по дате создания проекта) */
  const debitorBase = useMemo(() => {
    let list = allPayments
    if (filterManager) list = list.filter(p => String(p.partner?.manager?.id) === filterManager)
    if (filterCategory) list = list.filter(p => (p.project_category || '') === filterCategory)
    list = list.filter(p => paymentDueInSelectedPeriod(p, dateFrom, dateTo))
    return list
  }, [allPayments, dateFrom, dateTo, filterManager, filterCategory])

  const debitorReceivableStats = useMemo(() => {
    const overdue_count = debitorBase.filter(p => p.status === 'overdue').length
    const pending_count = debitorBase.filter(p => p.status === 'pending').length
    const total_receivable = debitorBase.reduce((s, p) => s + Number(p.amount), 0)
    const partners_count = new Set(debitorBase.map(p => p.partner?.name).filter(Boolean)).size
    return { overdue_count, pending_count, total_receivable, partners_count }
  }, [debitorBase])

  const payments = useMemo(() => {
    let list = debitorBase
    if (statusFilter === 'overdue') list = list.filter(p => p.status === 'overdue')
    if (statusFilter === 'pending') list = list.filter(p => p.status === 'pending')
    return list.sort((a, b) => {
      if (a.status === 'overdue' && b.status !== 'overdue') return -1
      if (a.status !== 'overdue' && b.status === 'overdue') return 1
      const ad = (a.deadline_date || a.created_at || '').slice(0, 10)
      const bd = (b.deadline_date || b.created_at || '').slice(0, 10)
      if (ad !== bd) return ad < bd ? -1 : ad > bd ? 1 : 0
      const ak = a.source_payment_month_id != null ? `${a.id}-${a.source_payment_month_id}` : String(a.id)
      const bk = b.source_payment_month_id != null ? `${b.id}-${b.source_payment_month_id}` : String(b.id)
      return ak.localeCompare(bk)
    })
  }, [debitorBase, statusFilter])

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
        subtitle="Платежи по сроку оплаты: кто должен заплатить в выбранном месяце (в т.ч. отдельные месяцы длинного договора). Красный — просрочка, жёлтый — срок ближе 14 дней."
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
          <span style={{ fontSize: 12, color: '#8a8fa8' }}>Срок оплаты в периоде:</span>
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
            onClick={() => {
              const [f, t] = boundsNextMonth()
              handleDateChange(f, t)
            }}
            style={{
              fontSize: 11,
              color: '#1e40af',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 7,
              padding: '5px 10px',
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: 'inherit',
            }}
          >
            Следующий месяц
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
            value={formatAmount(debitorReceivableStats.total_receivable)}
            sub={`${debitorReceivableStats.partners_count} партнёров в списке`}
            infoText={DEBITOR_STAT_HINT.receivable}
          />
          <StatCard
            label="Просрочено"
            value={String(debitorReceivableStats.overdue_count)}
            sub={`за ${periodLabel}`}
            subColor="#e84040"
            infoText={DEBITOR_STAT_HINT.overdue}
          />
          <StatCard
            label="Ожидается"
            value={String(debitorReceivableStats.pending_count)}
            sub={`за ${periodLabel}`}
            subColor="#ca8a04"
            infoText={DEBITOR_STAT_HINT.pending}
          />
          <StatCard
            label={dateFrom || dateTo ? 'Оплачено за период' : 'Оплачено (всего)'}
            value={String(stats?.paid_this_month ?? '—')}
            sub={stats ? `${formatAmount(stats.paid_amount_this_month)} получено` : ''}
            subColor="#1a6b3c"
            infoText={DEBITOR_STAT_HINT.paid}
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
              <div style={{ fontSize: 14, fontWeight: 700 }}>Неоплаченные платежи</div>
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4 }}>
                Срок оплаты в периоде: {periodLabel} · сумма строк в таблице:{' '}
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
                <Th>Добавлен проект</Th>
                <Th>Срок оплаты</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const dl = daysLeft(p.deadline_date, p.day_of_month, 'cashflow')
                const rowKey =
                  p.source_payment_month_id != null ? `${p.id}-m-${p.source_payment_month_id}` : p.id
                return (
                  <tr
                    key={rowKey}
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
                      {p.deadline_date ? (
                        <div>
                          <div style={{ fontWeight: 600, color: '#1a1d23', fontSize: 13 }}>
                            {formatDate(p.deadline_date)}
                          </div>
                          <div style={{ fontWeight: 600, color: dl.color, fontSize: 12, marginTop: 2 }}>
                            {dl.label}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span>
                      )}
                    </Td>
                    <Td>{statusBadge(p.status)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {payments.length === 0 && (
            <Empty text="Нет неоплаченных платежей с таким сроком оплаты и фильтрами. Проверьте «Всё время» или следующий месяц." />
          )}
        </Card>
      </div>
    </Layout>
  )
}
