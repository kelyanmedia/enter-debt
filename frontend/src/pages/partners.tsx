import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, BtnPrimary, BtnOutline, Modal, Field, Input, Select, Empty } from '@/components/ui'
import api from '@/lib/api'

interface User { id: number; name: string }
interface Partner {
  id: number; name: string; contact_person?: string; phone?: string
  email?: string; partner_type: string; status: string; comment?: string
  manager?: { id: number; name: string }
}

const EMPTY = { name: '', contact_person: '', phone: '', email: '', partner_type: 'regular', manager_id: '', status: 'active', comment: '' }

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    const params = filterStatus ? `?status=${filterStatus}` : ''
    api.get(`partners${params}`).then(r => setPartners(r.data))
  }

  useEffect(() => {
    load()
    api.get('users').then(r => setUsers(r.data)).catch(() => {})
  }, [filterStatus])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setError('')
    setModal(true)
  }

  const openEdit = (p: Partner) => {
    setEditing(p)
    setForm({
      name: p.name, contact_person: p.contact_person || '',
      phone: p.phone || '', email: p.email || '',
      partner_type: p.partner_type, manager_id: String(p.manager?.id || ''),
      status: p.status, comment: p.comment || '',
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    if (!form.name) { setError('Введите название компании'); return }
    setSaving(true)
    try {
      const payload = { ...form, manager_id: form.manager_id ? Number(form.manager_id) : null }
      if (editing) {
        await api.put(`partners/${editing.id}`, payload)
      } else {
        await api.post('partners', payload)
      }
      setModal(false)
      load()
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const del = async (id: number) => {
    if (!confirm('Удалить партнёра и все его платежи?')) return
    await api.delete(`partners/${id}`)
    load()
  }

  return (
    <Layout>
      <PageHeader
        title="Партнёры"
        subtitle="Управление контрагентами"
        action={<BtnPrimary onClick={openAdd}>+ Добавить партнёра</BtnPrimary>}
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Все статусы</option>
            <option value="active">Активный</option>
            <option value="paused">Приостановлен</option>
            <option value="archive">Архив</option>
          </Select>
        </div>

        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Компания</Th>
                <Th>Контакт</Th>
                <Th>Тип</Th>
                <Th>Менеджер</Th>
                <Th>Статус</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {partners.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <PartnerAvatar name={p.name} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.email && <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.email}</div>}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div>{p.contact_person || '—'}</div>
                    {p.phone && <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.phone}</div>}
                  </Td>
                  <Td>{statusBadge(p.partner_type)}</Td>
                  <Td>{p.manager?.name || '—'}</Td>
                  <Td>{statusBadge(p.status)}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <BtnOutline onClick={() => openEdit(p)} style={{ padding: '5px 12px', fontSize: 12 }}>Ред.</BtnOutline>
                      <BtnOutline onClick={() => del(p.id)} style={{ padding: '5px 10px', fontSize: 12, color: '#e84040' }}>✕</BtnOutline>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {partners.length === 0 && <Empty text="Партнёров не найдено" />}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Редактировать партнёра' : 'Новый партнёр'}
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Название компании *">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ООО «Компания»" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Контактное лицо">
            <Input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="Имя Фамилия" />
          </Field>
          <Field label="Телефон">
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+998 90 000 00 00" />
          </Field>
        </div>
        <Field label="Email">
          <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="contact@company.uz" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Тип партнёра">
            <Select value={form.partner_type} onChange={e => setForm(f => ({ ...f, partner_type: e.target.value }))}>
              <option value="recurring">Рекуррентный</option>
              <option value="one_time">Разовый</option>
              <option value="service">Сервисный</option>
            </Select>
          </Field>
          <Field label="Статус">
            <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Активный</option>
              <option value="paused">Приостановлен</option>
              <option value="archive">Архив</option>
            </Select>
          </Field>
        </div>
        <Field label="Менеджер">
          <Select value={form.manager_id} onChange={e => setForm(f => ({ ...f, manager_id: e.target.value }))}>
            <option value="">Не назначен</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label="Комментарий">
          <Input value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} placeholder="Любые заметки..." />
        </Field>
      </Modal>
    </Layout>
  )
}
