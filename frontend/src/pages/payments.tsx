import { useEffect, useState, useCallback } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, formatAmount, formatDate, daysLeft, BtnPrimary, BtnOutline, Modal, Field, Input, Select, Empty } from '@/components/ui'
import api from '@/lib/api'

interface Partner { id: number; name: string }
interface User { id: number; name: string }
interface PaymentMonth {
  id: number; payment_id: number; month: string; amount?: number
  status: 'pending' | 'paid'; note?: string; paid_at?: string; created_at: string
}
interface Payment {
  id: number; partner_id: number; description: string; amount: number
  payment_type: string; status: string; deadline_date?: string; day_of_month?: number
  contract_months?: number; remind_days_before: number; created_at: string; postponed_until?: string
  notify_accounting: boolean; contract_url?: string
  partner: { id: number; name: string; manager?: { id: number; name: string } }
  months?: PaymentMonth[]
}

const EMPTY_FORM = {
  partner_id: '', payment_type: 'recurring', description: '', amount: '',
  day_of_month: '', deadline_date: '', remind_days_before: '3', contract_months: '',
  notify_accounting: true, contract_url: ''
}

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`
}

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function generateMonths(startYM: string, count: number): string[] {
  const [y, m] = startYM.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const total = m - 1 + i
    const yr = y + Math.floor(total / 12)
    const mo = (total % 12) + 1
    return `${yr}-${String(mo).padStart(2, '0')}`
  })
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterManager, setFilterManager] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [modal, setModal] = useState(false)
  const [confirmModal, setConfirmModal] = useState<Payment | null>(null)
  const [postponeDays, setPostponeDays] = useState(0)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Drawer state
  const [drawer, setDrawer] = useState<Payment | null>(null)
  const [drawerMonths, setDrawerMonths] = useState<PaymentMonth[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [addMonthForm, setAddMonthForm] = useState({ month: currentYM(), amount: '', note: '' })
  const [addMonthOpen, setAddMonthOpen] = useState(false)
  const [confirmingMonth, setConfirmingMonth] = useState<number | null>(null)
  const [monthSaved, setMonthSaved] = useState<number | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (filterStatus) params.append('status', filterStatus)
    if (filterType) params.append('payment_type', filterType)
    api.get(`payments?${params}`).then(r => {
      let data = r.data
      if (filterManager) data = data.filter((p: Payment) => String(p.partner?.manager?.id) === filterManager)
      setPayments(data)
    })
  }, [filterStatus, filterType, filterManager])

  useEffect(() => {
    load()
    api.get('partners').then(r => setPartners(r.data))
    api.get('users').then(r => setUsers(r.data)).catch(() => {})
  }, [filterStatus, filterType, filterManager])

  const openAdd = () => { setForm({ ...EMPTY_FORM }); setError(''); setModal(true) }

  const save = async () => {
    if (!form.partner_id || !form.description || !form.amount) { setError('Заполните все обязательные поля'); return }
    setSaving(true)
    try {
      await api.post('payments', {
        partner_id: Number(form.partner_id),
        payment_type: form.payment_type,
        description: form.description,
        amount: Number(form.amount),
        contract_months: form.contract_months ? Number(form.contract_months) : null,
        day_of_month: form.day_of_month ? Number(form.day_of_month) : null,
        deadline_date: form.deadline_date || null,
        remind_days_before: Number(form.remind_days_before),
        notify_accounting: form.notify_accounting,
        contract_url: form.contract_url || null,
      })
      setModal(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const confirmPaid = async (payment: Payment, days: number) => {
    await api.post(`payments/${payment.id}/confirm`, days ? { postpone_days: days } : {})
    setConfirmModal(null)
    load()
  }

  const deletePayment = async (id: number) => {
    if (!confirm('Удалить проект?')) return
    await api.delete(`payments/${id}`)
    load()
    if (drawer?.id === id) setDrawer(null)
  }

  // Drawer actions
  const openDrawer = async (p: Payment) => {
    setDrawer(p)
    setDrawerLoading(true)
    setAddMonthOpen(false)
    setAddMonthForm({ month: currentYM(), amount: '', note: '' })
    setMonthSaved(null)
    try {
      const r = await api.get(`payments/${p.id}/months`)
      setDrawerMonths(r.data)
    } finally {
      setDrawerLoading(false)
    }
  }

  const addMonth = async () => {
    if (!drawer) return
    try {
      const r = await api.post(`payments/${drawer.id}/months`, {
        month: addMonthForm.month,
        amount: addMonthForm.amount ? Number(addMonthForm.amount) : null,
        note: addMonthForm.note || null,
      })
      setDrawerMonths(prev => [...prev, r.data].sort((a, b) => a.month.localeCompare(b.month)))
      setAddMonthOpen(false)
      setAddMonthForm({ month: currentYM(), amount: '', note: '' })
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка добавления месяца')
    }
  }

  const confirmMonth = async (monthId: number) => {
    if (!drawer) return
    setConfirmingMonth(monthId)
    try {
      const r = await api.post(`payments/${drawer.id}/months/${monthId}/confirm`, {})
      setDrawerMonths(prev => prev.map(m => m.id === monthId ? r.data : m))
      setMonthSaved(monthId)
      setTimeout(() => setMonthSaved(null), 3000)
    } finally {
      setConfirmingMonth(null)
    }
  }

  const deleteMonth = async (monthId: number) => {
    if (!drawer || !confirm('Удалить месяц?')) return
    await api.delete(`payments/${drawer.id}/months/${monthId}`)
    setDrawerMonths(prev => prev.filter(m => m.id !== monthId))
  }

  const bulkAddMonths = async () => {
    if (!drawer || !drawer.contract_months) return
    const months = generateMonths(addMonthForm.month, drawer.contract_months)
    for (const m of months) {
      try {
        const r = await api.post(`payments/${drawer.id}/months`, { month: m, amount: null, note: null })
        setDrawerMonths(prev => {
          const exists = prev.find(x => x.month === m)
          if (exists) return prev
          return [...prev, r.data].sort((a, b) => a.month.localeCompare(b.month))
        })
      } catch { /* skip already existing */ }
    }
    setAddMonthOpen(false)
  }

  const paidMonths = drawerMonths.filter(m => m.status === 'paid').length
  const totalMonths = drawerMonths.length

  return (
    <Layout>
      <PageHeader
        title="Проекты"
        subtitle="Все проекты по партнёрам"
        action={<BtnPrimary onClick={openAdd}>+ Новый проект</BtnPrimary>}
      />

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <Select value={filterManager} onChange={e => setFilterManager(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Все менеджеры</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все статусы</option>
            <option value="pending">Ожидается</option>
            <option value="overdue">Просрочено</option>
            <option value="paid">Оплачено</option>
            <option value="postponed">Отложено</option>
          </Select>
          <Select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все типы</option>
            <option value="recurring">Рекуррентный</option>
            <option value="one_time">Разовый</option>
            <option value="service_expiry">Сервисный</option>
          </Select>
        </div>

        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Партнёр</Th>
                <Th>Услуга</Th>
                <Th>Тип</Th>
                <Th>Сумма</Th>
                <Th>Дедлайн</Th>
                <Th>Осталось</Th>
                <Th>Статус</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const dl = daysLeft(p.deadline_date, p.day_of_month)
                const isActive = drawer?.id === p.id
                return (
                  <tr
                    key={p.id}
                    onClick={() => openDrawer(p)}
                    style={{
                      borderBottom: '1px solid #e8e9ef',
                      cursor: 'pointer',
                      background: isActive ? '#f0f7f3' : undefined,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLTableRowElement).style.background = '#fafbfc' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isActive ? '#f0f7f3' : '' }}
                  >
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
                    <Td>{statusBadge(p.payment_type)}</Td>
                    <Td><span style={{ fontWeight: 700 }}>{Number(p.amount).toLocaleString('ru-RU')}</span></Td>
                    <Td>{p.deadline_date ? formatDate(p.deadline_date) : p.day_of_month ? `${p.day_of_month}-е число` : '—'}</Td>
                    <Td><span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span></Td>
                    <Td>{statusBadge(p.status)}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        {p.status !== 'paid' && (
                          <BtnOutline onClick={() => { setPostponeDays(0); setConfirmModal(p) }} style={{ padding: '5px 10px', fontSize: 12 }}>✅ Оплачено</BtnOutline>
                        )}
                        <BtnOutline onClick={() => deletePayment(p.id)} style={{ padding: '5px 10px', fontSize: 12, color: '#e84040' }}>✕</BtnOutline>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {payments.length === 0 && <Empty text="Проектов не найдено" />}
        </Card>
      </div>

      {/* ───── DRAWER ───── */}
      {drawer && (
        <>
          {/* backdrop */}
          <div
            onClick={() => setDrawer(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.18)', zIndex: 200 }}
          />
          {/* panel */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 460,
            background: '#fff', boxShadow: '-4px 0 32px rgba(0,0,0,.12)',
            zIndex: 201, display: 'flex', flexDirection: 'column', overflowY: 'auto',
          }}>
            {/* header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e8e9ef', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <PartnerAvatar name={drawer.partner.name} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{drawer.partner.name}</div>
                    <div style={{ fontSize: 12, color: '#8a8fa8' }}>{drawer.partner.manager?.name}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#444', marginTop: 8 }}>{drawer.description}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {statusBadge(drawer.payment_type)}
                  {statusBadge(drawer.status)}
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1a6b3c' }}>
                    {Number(drawer.amount).toLocaleString('ru-RU')} UZS
                  </span>
                  {drawer.contract_months && (
                    <span style={{ fontSize: 12, background: '#eef2ff', color: '#4361ee', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                      {drawer.contract_months} мес.
                    </span>
                  )}
                  <span style={{
                    fontSize: 11, borderRadius: 6, padding: '2px 8px', fontWeight: 600,
                    background: drawer.notify_accounting ? '#f0faf4' : '#f5f6fa',
                    color: drawer.notify_accounting ? '#1a6b3c' : '#8a8fa8',
                    border: `1px solid ${drawer.notify_accounting ? '#c3e6d0' : '#e8e9ef'}`,
                  }}>
                    {drawer.notify_accounting ? '📊 Бухгалтерия уведомляется' : '📊 Без бухгалтерии'}
                  </span>
                </div>
                {drawer.contract_url && (
                  <a
                    href={drawer.contract_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, color: '#4361ee', textDecoration: 'none', fontWeight: 600 }}
                  >
                    📄 Контракт →
                  </a>
                )}
              </div>
              <button onClick={() => setDrawer(null)} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
                color: '#8a8fa8', lineHeight: 1, padding: 4, marginTop: -2,
              }}>✕</button>
            </div>

            {/* progress bar */}
            {totalMonths > 0 && (
              <div style={{ padding: '12px 24px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a8fa8', marginBottom: 5 }}>
                  <span>Оплачено месяцев</span>
                  <span style={{ fontWeight: 600, color: paidMonths === totalMonths ? '#1a6b3c' : '#1a1d23' }}>
                    {paidMonths} / {totalMonths}
                  </span>
                </div>
                <div style={{ height: 6, background: '#e8e9ef', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.round((paidMonths / totalMonths) * 100)}%`,
                    background: paidMonths === totalMonths ? '#1a6b3c' : '#4361ee',
                    transition: 'width .3s',
                  }} />
                </div>
              </div>
            )}

            {/* months list */}
            <div style={{ padding: '16px 24px', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Разбивка по месяцам</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {drawer.contract_months && drawerMonths.length === 0 && (
                    <BtnOutline onClick={bulkAddMonths} style={{ fontSize: 12, padding: '5px 10px' }}>
                      ⚡ Авто ({drawer.contract_months} мес.)
                    </BtnOutline>
                  )}
                  <BtnPrimary onClick={() => setAddMonthOpen(v => !v)} style={{ fontSize: 12, padding: '5px 12px' }}>
                    + Месяц
                  </BtnPrimary>
                </div>
              </div>

              {/* add month form */}
              {addMonthOpen && (
                <div style={{ background: '#f5f6fa', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <Field label="Месяц">
                      <Input type="month" value={addMonthForm.month}
                        onChange={e => setAddMonthForm(f => ({ ...f, month: e.target.value }))} />
                    </Field>
                    <Field label="Сумма (если другая)">
                      <Input type="number" value={addMonthForm.amount} placeholder={String(drawer.amount)}
                        onChange={e => setAddMonthForm(f => ({ ...f, amount: e.target.value }))} />
                    </Field>
                  </div>
                  <Field label="Заметка">
                    <Input value={addMonthForm.note} placeholder="Необязательно"
                      onChange={e => setAddMonthForm(f => ({ ...f, note: e.target.value }))} />
                  </Field>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <BtnPrimary onClick={addMonth} style={{ fontSize: 12, padding: '6px 14px' }}>Добавить</BtnPrimary>
                    <BtnOutline onClick={() => setAddMonthOpen(false)} style={{ fontSize: 12, padding: '6px 14px' }}>Отмена</BtnOutline>
                  </div>
                </div>
              )}

              {drawerLoading && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#8a8fa8', fontSize: 13 }}>Загрузка...</div>
              )}

              {!drawerLoading && drawerMonths.length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#b0b4c8', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
                  Месяцы ещё не добавлены.<br />Нажмите «+ Месяц» или «Авто», чтобы создать график.
                </div>
              )}

              {drawerMonths.map(m => {
                const isPaid = m.status === 'paid'
                const effAmount = m.amount ?? drawer.amount
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '11px 14px', borderRadius: 10, marginBottom: 8,
                    background: isPaid ? '#f0faf4' : '#fafbfc',
                    border: `1px solid ${isPaid ? '#c3e6d0' : '#e8e9ef'}`,
                    transition: 'background .2s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 15,
                        background: isPaid ? '#d1f0de' : '#e8e9ef',
                      }}>
                        {isPaid ? '✅' : '⏳'}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{monthLabel(m.month)}</div>
                        <div style={{ fontSize: 11, color: '#8a8fa8' }}>
                          {isPaid
                            ? `Оплачено ${m.paid_at ? new Date(m.paid_at).toLocaleDateString('ru-RU') : ''}`
                            : m.note || 'Ожидается оплата'
                          }
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: isPaid ? '#1a6b3c' : '#1a1d23' }}>
                        {Number(effAmount).toLocaleString('ru-RU')}
                      </span>
                      {monthSaved === m.id && (
                        <span style={{ fontSize: 11, color: '#1a6b3c', fontWeight: 600 }}>✓ TG отправлен</span>
                      )}
                      {!isPaid && (
                        <button
                          onClick={() => confirmMonth(m.id)}
                          disabled={confirmingMonth === m.id}
                          style={{
                            background: '#1a6b3c', color: '#fff', border: 'none',
                            borderRadius: 7, padding: '5px 10px', fontSize: 11,
                            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            opacity: confirmingMonth === m.id ? .6 : 1,
                          }}
                        >
                          {confirmingMonth === m.id ? '...' : 'Оплачено'}
                        </button>
                      )}
                      <button
                        onClick={() => deleteMonth(m.id)}
                        style={{
                          background: 'none', border: 'none', color: '#ccc',
                          fontSize: 15, cursor: 'pointer', lineHeight: 1, padding: 2,
                        }}
                      >✕</button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* footer */}
            {totalMonths > 0 && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid #e8e9ef', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: '#8a8fa8' }}>Итого оплачено</span>
                <span style={{ fontWeight: 700, color: '#1a6b3c' }}>
                  {drawerMonths.filter(m => m.status === 'paid').reduce((s, m) => s + Number(m.amount ?? drawer.amount), 0).toLocaleString('ru-RU')} UZS
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add project Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Новый проект"
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Партнёр *">
          <Select value={form.partner_id} onChange={e => setForm(f => ({ ...f, partner_id: e.target.value }))}>
            <option value="">Выберите партнёра</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Услуга *">
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Абон. SEO, март 2026" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Тип платежа">
            <Select value={form.payment_type} onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}>
              <option value="recurring">Рекуррентный</option>
              <option value="one_time">Разовый</option>
              <option value="service_expiry">Сервисный</option>
            </Select>
          </Field>
          <Field label="Сумма (UZS) *">
            <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
          </Field>
        </div>
        {form.payment_type === 'recurring' && (
          <Field label="Период контракта (месяцев)">
            <Select value={form.contract_months} onChange={e => setForm(f => ({ ...f, contract_months: e.target.value }))}>
              <option value="">Не указан</option>
              <option value="1">1 месяц</option>
              <option value="3">3 месяца</option>
              <option value="6">6 месяцев</option>
              <option value="12">12 месяцев</option>
              <option value="24">24 месяца</option>
            </Select>
          </Field>
        )}
        {form.payment_type === 'regular' ? (
          <Field label="День месяца (например 5 или 10)">
            <Input type="number" min="1" max="31" value={form.day_of_month} onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))} placeholder="10" />
          </Field>
        ) : (
          <Field label="Дата дедлайна">
            <Input type="date" value={form.deadline_date} onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
          </Field>
        )}
        <Field label="Напомнить за (дней)">
          <Select value={form.remind_days_before} onChange={e => setForm(f => ({ ...f, remind_days_before: e.target.value }))}>
            <option value="1">1 день</option>
            <option value="2">2 дня</option>
            <option value="3">3 дня</option>
            <option value="5">5 дней</option>
            <option value="7">7 дней</option>
          </Select>
        </Field>
        <Field label="Ссылка на контракт">
          <Input
            value={form.contract_url}
            onChange={e => setForm(f => ({ ...f, contract_url: e.target.value }))}
            placeholder="https://docs.google.com/..."
          />
        </Field>
        <div
          onClick={() => setForm(f => ({ ...f, notify_accounting: !f.notify_accounting }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f5f6fa', borderRadius: 10, cursor: 'pointer', marginTop: 4 }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Оповещать бухгалтерию</div>
            <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 2 }}>
              {form.notify_accounting ? 'Бухгалтерия получит уведомление о платеже' : 'Бухгалтерия не будет уведомлена'}
            </div>
          </div>
          <div style={{
            width: 42, height: 24, borderRadius: 12, position: 'relative', flexShrink: 0,
            background: form.notify_accounting ? '#1a6b3c' : '#d0d3de',
            transition: 'background .2s',
          }}>
            <div style={{
              position: 'absolute', top: 3, left: form.notify_accounting ? 21 : 3,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,.2)', transition: 'left .2s',
            }} />
          </div>
        </div>
      </Modal>

      {/* Confirm payment modal */}
      <Modal open={!!confirmModal} onClose={() => setConfirmModal(null)} title="Подтвердить оплату"
        footer={<>
          <BtnOutline onClick={() => setConfirmModal(null)}>Отмена</BtnOutline>
          {postponeDays > 0
            ? <BtnPrimary onClick={() => confirmPaid(confirmModal!, postponeDays)}>⏰ Отложить на {postponeDays} дн.</BtnPrimary>
            : <BtnPrimary onClick={() => confirmPaid(confirmModal!, 0)}>✅ Подтвердить оплату</BtnPrimary>
          }
        </>}
      >
        {confirmModal && (
          <div>
            <div style={{ marginBottom: 16, padding: '14px', background: '#f5f6fa', borderRadius: 10, fontSize: 13 }}>
              <div><b>{confirmModal.partner.name}</b> · {confirmModal.description}</div>
              <div style={{ marginTop: 4, fontWeight: 700, color: '#1a6b3c' }}>{Number(confirmModal.amount).toLocaleString('ru-RU')} UZS</div>
            </div>
            <Field label="Или отложить напоминание">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[0, 1, 2, 3, 5, 7].map(d => (
                  <button key={d} onClick={() => setPostponeDays(d)} style={{
                    padding: '6px 14px', borderRadius: 20, border: '1px solid #e8e9ef', fontSize: 12, fontWeight: 600,
                    background: postponeDays === d ? '#1a6b3c' : '#fff', color: postponeDays === d ? '#fff' : '#1a1d23',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{d === 0 ? 'Оплачено' : `${d} дн.`}</button>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </Layout>
  )
}
