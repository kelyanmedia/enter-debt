import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, statusBadge, BtnPrimary, BtnOutline, Modal, Field, Input, Select, Empty, Badge } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'

interface User {
  id: number; name: string; email: string; role: string
  telegram_chat_id?: number; telegram_username?: string; is_active: boolean
}

const EMPTY = { name: '', email: '', password: '', role: 'manager', telegram_chat_id: '', telegram_username: '', is_active: 'true' }

export default function UsersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user && user.role !== 'admin') { router.push('/'); return }
    api.get('users').then(r => setUsers(r.data))
  }, [user])

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY }); setError(''); setModal(true) }
  const openEdit = (u: User) => {
    setEditing(u)
    setForm({ name: u.name, email: u.email, password: '', role: u.role, telegram_chat_id: String(u.telegram_chat_id || ''), telegram_username: u.telegram_username || '', is_active: String(u.is_active) })
    setError('')
    setModal(true)
  }

  const save = async () => {
    if (!form.name || !form.email) { setError('Заполните имя и email'); return }
    setSaving(true)
    try {
      if (editing) {
        const payload: any = { name: form.name, role: form.role, is_active: form.is_active === 'true', telegram_username: form.telegram_username || null }
        if (form.telegram_chat_id) payload.telegram_chat_id = Number(form.telegram_chat_id)
        await api.patch(`users/${editing.id}`, payload)
      } else {
        if (!form.password) { setError('Введите пароль'); setSaving(false); return }
        await api.post('users', { name: form.name, email: form.email, password: form.password, role: form.role, telegram_chat_id: form.telegram_chat_id ? Number(form.telegram_chat_id) : null, telegram_username: form.telegram_username || null })
      }
      setModal(false)
      api.get('users').then(r => setUsers(r.data))
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const roleNotifLabel: Record<string, string> = {
    admin: 'Все уведомления',
    manager: 'Свои партнёры',
    accountant: 'Только счёт-фактуры',
  }

  return (
    <Layout>
      <PageHeader title="Пользователи" subtitle="Роли и Telegram-доступы" action={<BtnPrimary onClick={openAdd}>+ Добавить пользователя</BtnPrimary>} />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Пользователь</Th>
                <Th>Роль</Th>
                <Th>Telegram</Th>
                <Th>Получает пуши</Th>
                <Th>Активен</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e8f5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#1a6b3c' }}>
                        {u.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: '#8a8fa8' }}>{u.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>{statusBadge(u.role)}</Td>
                  <Td>
                    {u.telegram_username ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>@{u.telegram_username}</span> : '—'}
                    {u.telegram_chat_id && <div style={{ fontSize: 11, color: '#8a8fa8' }}>ID: {u.telegram_chat_id}</div>}
                  </Td>
                  <Td style={{ fontSize: 12, color: '#8a8fa8' }}>{roleNotifLabel[u.role]}</Td>
                  <Td><Badge variant={u.is_active ? 'green' : 'gray'}>{u.is_active ? 'Да' : 'Нет'}</Badge></Td>
                  <Td><BtnOutline onClick={() => openEdit(u)} style={{ padding: '5px 12px', fontSize: 12 }}>Ред.</BtnOutline></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <Empty text="Пользователей нет" />}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Редактировать пользователя' : 'Новый пользователь'}
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Имя *">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Имя Фамилия" />
        </Field>
        <Field label="Email *">
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@entergroup.uz" disabled={!!editing} />
        </Field>
        {!editing && (
          <Field label="Пароль *">
            <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Минимум 6 символов" />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Роль">
            <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="admin">Администратор</option>
              <option value="manager">Менеджер</option>
              <option value="accountant">Бухгалтерия</option>
            </Select>
          </Field>
          <Field label="Активен">
            <Select value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value }))}>
              <option value="true">Да</option>
              <option value="false">Нет</option>
            </Select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Telegram Username">
            <Input value={form.telegram_username} onChange={e => setForm(f => ({ ...f, telegram_username: e.target.value }))} placeholder="username (без @)" />
          </Field>
          <Field label="Telegram Chat ID">
            <Input type="number" value={form.telegram_chat_id} onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} placeholder="123456789" />
          </Field>
        </div>
        <div style={{ padding: '10px 12px', background: '#f5f6fa', borderRadius: 9, fontSize: 12, color: '#8a8fa8' }}>
          💡 Chat ID можно узнать через @userinfobot в Telegram
        </div>
      </Modal>
    </Layout>
  )
}
