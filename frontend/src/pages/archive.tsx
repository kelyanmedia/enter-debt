import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, formatAmount, formatDate, BtnOutline, Empty } from '@/components/ui'
import api from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

interface ArchivedPayment {
  id: number
  description: string
  amount: number
  payment_type: string
  status: string
  paid_at?: string
  created_at: string
  updated_at?: string
  partner: { id: number; name: string; manager?: { name: string } }
  confirmed_by_user?: { name: string }
}

interface ArchivedPartner {
  id: number
  name: string
  contact_person?: string
  phone?: string
  partner_type: string
  created_at: string
  updated_at?: string
  manager?: { name: string }
  open_payments_count: number
  overdue_count: number
}

type Tab = 'payments' | 'partners'

export default function ArchivePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('payments')
  const [payments, setPayments] = useState<ArchivedPayment[]>([])
  const [partners, setPartners] = useState<ArchivedPartner[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') router.replace('/')
  }, [user, loading, router])

  const load = async () => {
    if (!user || user.role !== 'admin') return
    setFetching(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)
      if (tab === 'payments') {
        const r = await api.get(`archive/payments?${params}`)
        setPayments(r.data)
      } else {
        const r = await api.get(`archive/partners?${params}`)
        setPartners(r.data)
      }
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => { load() }, [tab, dateFrom, dateTo, user])

  const restorePartner = async (id: number) => {
    if (!confirm('Восстановить партнёра в активные?')) return
    await api.post(`archive/partners/${id}/restore`)
    load()
  }

  if (loading || !user || user.role !== 'admin') return null

  const tabStyle = (t: Tab) => ({
    padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
    background: tab === t ? '#1a6b3c' : '#f0f1f5',
    color: tab === t ? '#fff' : '#6b7280',
    transition: 'all .15s',
  })

  return (
    <Layout>
      <PageHeader
        title="Архив"
        subtitle="История архивных записей — только для администратора"
      />

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button style={tabStyle('payments')} onClick={() => setTab('payments')}>Платежи</button>
          <button style={tabStyle('partners')} onClick={() => setTab('partners')}>Партнёры</button>
        </div>

        {/* Date filters */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em' }}>С</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ border: '1px solid #e8e9ef', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', color: '#1a1d23', fontFamily: 'inherit', background: '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em' }}>По</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ border: '1px solid #e8e9ef', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', color: '#1a1d23', fontFamily: 'inherit', background: '#fff' }}
            />
          </div>
          {(dateFrom || dateTo) && (
            <BtnOutline onClick={() => { setDateFrom(''); setDateTo('') }} style={{ padding: '8px 14px', fontSize: 12 }}>
              Сбросить
            </BtnOutline>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#8a8fa8' }}>
            {fetching ? 'Загрузка...' : `${tab === 'payments' ? payments.length : partners.length} записей`}
          </div>
        </div>

        {/* Payments table */}
        {tab === 'payments' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Описание</Th>
                  <Th>Тип</Th>
                  <Th>Сумма</Th>
                  <Th>Статус при архивации</Th>
                  <Th>Дата оплаты</Th>
                  <Th>Подтвердил</Th>
                  <Th>Добавлен</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f1f5' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PartnerAvatar name={p.partner.name} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                          {p.partner.manager && <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.partner.manager.name}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td style={{ color: '#6b7280', maxWidth: 200 }}>{p.description}</Td>
                    <Td>{statusBadge(p.payment_type)}</Td>
                    <Td><span style={{ fontWeight: 700 }}>{Number(p.amount).toLocaleString('ru-RU')}</span></Td>
                    <Td>{statusBadge(p.status)}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.paid_at ? formatDate(p.paid_at) : '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.confirmed_by_user?.name || '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payments.length === 0 && !fetching && <Empty text="Архивных платежей нет" />}
          </Card>
        )}

        {/* Partners table */}
        {tab === 'partners' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Тип</Th>
                  <Th>Менеджер</Th>
                  <Th>Контакт</Th>
                  <Th>Открытых платежей</Th>
                  <Th>Добавлен</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f1f5' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PartnerAvatar name={p.name} />
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                      </div>
                    </Td>
                    <Td>{statusBadge(p.partner_type)}</Td>
                    <Td style={{ color: '#6b7280' }}>{p.manager?.name || '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.contact_person || p.phone || '—'}</Td>
                    <Td>
                      {p.open_payments_count > 0
                        ? <span style={{ fontWeight: 600, color: p.overdue_count > 0 ? '#e84040' : '#1a6b3c' }}>{p.open_payments_count}</span>
                        : <span style={{ color: '#8a8fa8' }}>0</span>
                      }
                    </Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                    <Td>
                      <BtnOutline onClick={() => restorePartner(p.id)} style={{ padding: '5px 12px', fontSize: 12, color: '#1a6b3c' }}>
                        ↩ Восстановить
                      </BtnOutline>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {partners.length === 0 && !fetching && <Empty text="Архивных партнёров нет" />}
          </Card>
        )}
      </div>
    </Layout>
  )
}
