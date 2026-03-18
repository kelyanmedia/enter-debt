import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, formatAmount, formatDate, daysLeft, BtnPrimary, BtnOutline, Modal, Field, Input, Select, Empty } from '@/components/ui'
import api from '@/lib/api'

interface Partner { id: number; name: string }
interface User { id: number; name: string }
interface Payment {
  id: number; partner_id: number; description: string; amount: number
  payment_type: string; status: string; deadline_date?: string; day_of_month?: number
  remind_days_before: number; created_at: string; postponed_until?: string
  partner: { id: number; name: string; manager?: { name: string } }
}

const EMPTY_FORM = { partner_id: '', payment_type: 'regular', description: '', amount: '', day_of_month: '', deadline_date: '', remind_days_before: '3' }

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [modal, setModal] = useState(false)
  const [confirmModal, setConfirmModal] = useState<Payment | null>(null)
  const [postponeDays, setPostponeDays] = useState(0)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    const params = new URLSearchParams()
    if (filterStatus) params.append('status', filterStatus)
    if (filterType) params.append('payment_type', filterType)
    api.get(`payments?${params}`).then(r => setPayments(r.data))
  }

  useEffect(() => {
    load()
    api.get('partners').then(r => setPartners(r.data))
  }, [filterStatus, filterType])

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
        day_of_month: form.day_of_month ? Number(form.day_of_month) : null,
        deadline_date: form.deadline_date || null,
        remind_days_before: Number(form.remind_days_before),
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
    if (!confirm('Удалить платёж?')) return
    await api.delete(`payments/${id}`)
    load()
  }

  return (
    <Layout>
      <PageHeader
        title="Платежи"
        subtitle="Все платежи по партнёрам"
        action={<BtnPrimary onClick={openAdd}>+ Новый платёж</BtnPrimary>}
      />

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все статусы</option>
            <option value="pending">Ожидается</option>
            <option value="overdue">Просрочено</option>
            <option value="paid">Оплачено</option>
            <option value="postponed">Отложено</option>
          </Select>
          <Select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все типы</option>
            <option value="regular">Регулярный</option>
            <option value="one_time">Разовый</option>
            <option value="service_expiry">Сервисный</option>
          </Select>
        </div>

        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Партнёр</Th>
                <Th>Описание</Th>
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
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
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
                      <div style={{ display: 'flex', gap: 6 }}>
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
          {payments.length === 0 && <Empty text="Платежей не найдено" />}
        </Card>
      </div>

      {/* Add Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Новый платёж"
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Партнёр *">
          <Select value={form.partner_id} onChange={e => setForm(f => ({ ...f, partner_id: e.target.value }))}>
            <option value="">Выберите партнёра</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Описание *">
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Абон. SEO, март 2026" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Тип платежа">
            <Select value={form.payment_type} onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}>
              <option value="regular">Регулярный</option>
              <option value="one_time">Разовый</option>
              <option value="service_expiry">Сервисный</option>
            </Select>
          </Field>
          <Field label="Сумма (UZS) *">
            <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
          </Field>
        </div>
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
