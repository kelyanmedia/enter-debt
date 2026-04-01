import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, BtnPrimary, BtnOutline, BtnIconEdit, Modal, ConfirmModal, Field, Input, Select, Empty, formatDate } from '@/components/ui'
import api from '@/lib/api'

interface User { id: number; name: string }
interface Partner {
  id: number; name: string; contact_person?: string; phone?: string
  email?: string; partner_type: string; status: string; comment?: string
  cooperation_start_date?: string | null
  client_joined_date?: string | null
  manager?: { id: number; name: string }
}

const EMPTY = {
  name: '', contact_person: '', phone: '', email: '', partner_type: 'A', manager_id: '', status: 'active', comment: '',
  cooperation_start_date: '', client_joined_date: '',
}

/** LTV (в таблице): от даты начала работы, иначе от «Старт работы». */
function partnerTenureText(cooperationStart?: string | null, clientJoined?: string | null): string {
  const raw = (cooperationStart || clientJoined || '').slice(0, 10)
  if (!raw || raw.length < 8) return '—'
  const parts = raw.split('-').map(Number)
  const y = parts[0]
  const mo = parts[1]
  const d = parts[2] || 1
  if (!y || !mo) return '—'
  const start = new Date(y, mo - 1, d)
  const now = new Date()
  if (start.getTime() > now.getTime()) return '—'
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 0) return '—'
  const years = Math.floor(months / 12)
  const m = months % 12
  if (years === 0) return `${m} мес.`
  if (m === 0) return `${years} г.`
  return `${years} г. ${m} мес.`
}

export default function PartnersPage() {
  const { user } = useAuth()
  const [partners, setPartners] = useState<Partner[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)

  const load = () => {
    const params = filterStatus ? `?status=${filterStatus}` : ''
    api.get(`partners${params}`).then(r => setPartners(r.data)).catch(() => setPartners([]))
  }

  useEffect(() => {
    load()
    api.get('users/managers-for-select').then(r => setUsers(r.data)).catch(() => {})
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
      cooperation_start_date: p.cooperation_start_date?.slice(0, 10) || '',
      client_joined_date: p.client_joined_date?.slice(0, 10) || '',
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    if (!form.name) { setError('Введите название компании'); return }
    if (user?.role === 'administration' && !form.manager_id) {
      setError('Выберите менеджера, за которым закрепляется компания')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        contact_person: form.contact_person || null,
        phone: form.phone || null,
        email: form.email || null,
        partner_type: form.partner_type,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        status: form.status,
        comment: form.comment || null,
        cooperation_start_date: form.cooperation_start_date || null,
        client_joined_date: form.client_joined_date || null,
      }
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

  const confirmDeletePartner = async () => {
    if (deleteConfirmId === null) return
    await api.delete(`partners/${deleteConfirmId}`)
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
                <Th>Начало работы</Th>
                <Th>Старт работы</Th>
                <Th>LTV</Th>
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
                  <Td style={{ fontSize: 13 }}>{p.cooperation_start_date ? formatDate(p.cooperation_start_date) : '—'}</Td>
                  <Td style={{ fontSize: 13 }}>{p.client_joined_date ? formatDate(p.client_joined_date) : '—'}</Td>
                  <Td style={{ fontSize: 13, color: '#4b5563' }}>{partnerTenureText(p.cooperation_start_date, p.client_joined_date)}</Td>
                  <Td>{p.manager?.name || '—'}</Td>
                  <Td>{statusBadge(p.status)}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <BtnIconEdit onClick={() => openEdit(p)} />
                      <BtnOutline onClick={() => setDeleteConfirmId(p.id)} style={{ padding: '5px 10px', fontSize: 12, color: '#e84040' }}>✕</BtnOutline>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {partners.length === 0 && <Empty text="Партнёров не найдено" />}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Редактировать партнёра' : 'Новый партнёр'} width={520}
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
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Начало работы с клиентом">
            <Input
              type="date"
              value={form.cooperation_start_date}
              onChange={e => setForm(f => ({ ...f, cooperation_start_date: e.target.value }))}
            />
          </Field>
          <Field label="Старт работы (приход в компанию)">
            <Input
              type="date"
              value={form.client_joined_date}
              onChange={e => setForm(f => ({ ...f, client_joined_date: e.target.value }))}
            />
          </Field>
        </div>
        <div style={{ fontSize: 12, color: '#8a8fa8', lineHeight: 1.45, marginTop: -6, marginBottom: 10 }}>
          LTV в таблице считается от даты начала работы; если она не заполнена — от даты «Старт работы».
        </div>
        <Field label="Менеджер">
          {user?.role === 'manager' ? (
            <div style={{ fontSize: 13, padding: '8px 0', color: '#1a1d23' }}>
              Вы: <b>{user.name}</b> (партнёр закрепляется за вами)
            </div>
          ) : (
            <Select value={form.manager_id} onChange={e => setForm(f => ({ ...f, manager_id: e.target.value }))}>
              <option value="">Не назначен</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Комментарий">
          <Input value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} placeholder="Любые заметки..." />
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title="Удалить партнёра?"
        message="Будут удалены партнёр и все связанные платежи. Это действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={confirmDeletePartner}
      />
    </Layout>
  )
}
