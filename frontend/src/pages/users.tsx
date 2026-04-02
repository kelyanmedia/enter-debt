import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, statusBadge, BtnPrimary, BtnOutline, BtnIconEdit, Modal, ConfirmModal, Field, Input, Select, Empty, Badge, IntegerGroupedInput, formatMoneyNumber } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'

interface User {
  id: number; name: string; email: string; role: string
  telegram_chat_id?: number; telegram_username?: string; is_active: boolean
  web_access?: boolean
  see_all_partners?: boolean
  visible_manager_ids?: number[]
  payment_details?: string | null
  multi_company_access?: boolean
  last_login_at?: string | null
}
interface PartnerRow { id: number; name: string }

interface TelegramJoinRequest {
  id: number
  telegram_chat_id: number
  telegram_username?: string
  full_name?: string
  status: string
  created_at: string
}

const EMPTY = {
  name: '', email: '', password: '', role: 'manager', telegram_chat_id: '', telegram_username: '', is_active: 'true',
  see_all_partners: 'false', new_password: '', payment_details: '', multi_company_access: 'false',
}

export default function UsersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<TelegramJoinRequest[]>([])
  const [approveReq, setApproveReq] = useState<TelegramJoinRequest | null>(null)
  const [approveForm, setApproveForm] = useState({ role: 'manager' as 'manager' | 'accountant', name: '', email: '' })
  const [approveSaving, setApproveSaving] = useState(false)
  const [allPartners, setAllPartners] = useState<PartnerRow[]>([])
  const [assignedPartnerIds, setAssignedPartnerIds] = useState<number[]>([])
  const [rejectJoinId, setRejectJoinId] = useState<number | null>(null)
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null)
  const [visibleManagerIds, setVisibleManagerIds] = useState<number[]>([])
  const [managerOptions, setManagerOptions] = useState<User[]>([])

  const loadAll = () => {
    api.get('users').then(r => setUsers(r.data)).catch(() => setUsers([]))
    api.get('telegram-join/pending').then(r => setPending(r.data)).catch(() => setPending([]))
  }

  useEffect(() => {
    if (user && user.role !== 'admin') { router.push('/'); return }
    loadAll()
  }, [user])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setAssignedPartnerIds([])
    setVisibleManagerIds([])
    setError('')
    setModal(true)
  }
  const openEdit = async (u: User) => {
    setEditing(u)
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      telegram_chat_id: String(u.telegram_chat_id || ''),
      telegram_username: u.telegram_username || '',
      is_active: String(u.is_active),
      see_all_partners: u.see_all_partners ? 'true' : 'false',
      new_password: '',
      payment_details: u.payment_details || '',
      multi_company_access: u.multi_company_access ? 'true' : 'false',
    })
    setError('')
    setAssignedPartnerIds([])
    setVisibleManagerIds(Array.isArray(u.visible_manager_ids) ? u.visible_manager_ids : [])
    if (u.role === 'manager') {
      try {
        const [ap, pr] = await Promise.all([
          api.get(`users/${u.id}/assigned-partners`),
          api.get('partners'),
        ])
        setAssignedPartnerIds(ap.data.partner_ids || [])
        setAllPartners(pr.data.map((p: PartnerRow) => ({ id: p.id, name: p.name })))
      } catch {
        setAllPartners([])
      }
    } else {
      setAllPartners([])
    }
    setModal(true)
  }

  useEffect(() => {
    if (!modal || form.role !== 'administration') return
    api
      .get<User[]>('users')
      .then(r => setManagerOptions(r.data.filter(x => x.role === 'manager')))
      .catch(() => setManagerOptions([]))
  }, [modal, form.role])

  const save = async () => {
    if (!form.name || !form.email) { setError('Заполните имя и email'); return }
    if (form.role === 'administration' && visibleManagerIds.length === 0) {
      setError('Отметьте хотя бы одного менеджера, чьи компании и проекты видит администрация')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const payload: any = {
          name: form.name,
          role: form.role,
          is_active: form.is_active === 'true',
          telegram_username: form.telegram_username || null,
        }
        if (form.telegram_chat_id) payload.telegram_chat_id = Number(form.telegram_chat_id)
        if (form.role === 'manager') payload.see_all_partners = form.see_all_partners === 'true'
        if (form.role === 'administration') payload.visible_manager_ids = visibleManagerIds
        if (form.role === 'employee') {
          payload.payment_details = form.payment_details.trim() || null
          payload.multi_company_access = form.multi_company_access === 'true'
        }
        if (form.new_password.trim()) payload.password = form.new_password.trim()
        await api.patch(`users/${editing.id}`, payload)
        if (form.role === 'manager' && form.see_all_partners === 'false') {
          await api.put(`users/${editing.id}/assigned-partners`, { partner_ids: assignedPartnerIds })
        }
      } else {
        if (!form.password) { setError('Введите пароль'); setSaving(false); return }
        await api.post('users', {
          name: form.name,
          email: form.email.trim().toLowerCase(),
          password: form.password,
          role: form.role,
          is_active: form.is_active === 'true',
          web_access: true,
          telegram_chat_id: form.telegram_chat_id ? Number(form.telegram_chat_id) : null,
          telegram_username: form.telegram_username || null,
          see_all_partners: form.role === 'manager' ? form.see_all_partners === 'true' : false,
          visible_manager_ids: form.role === 'administration' ? visibleManagerIds : undefined,
          payment_details: form.role === 'employee' ? (form.payment_details.trim() || null) : undefined,
          multi_company_access: form.role === 'employee' ? form.multi_company_access === 'true' : false,
        })
      }
      setModal(false)
      loadAll()
    } catch (e: any) {
      const d = e.response?.data?.detail
      setError(typeof d === 'string' ? d : JSON.stringify(d) || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const roleNotifLabel: Record<string, string> = {
    admin: 'Все уведомления',
    manager: 'Свои партнёры',
    accountant: 'Только счёт-фактуры',
    administration: 'Партнёры выбранных менеджеров',
    employee: 'Только учёт задач (веб)',
  }

  const openApprove = (r: TelegramJoinRequest) => {
    setApproveReq(r)
    setApproveForm({
      role: 'manager',
      name: r.full_name || '',
      email: '',
    })
    setApproveSaving(false)
  }

  const submitApprove = async () => {
    if (!approveReq) return
    if (!approveForm.name.trim()) return
    if (approveForm.role === 'manager' && !approveForm.email.trim()) return
    setApproveSaving(true)
    try {
      const payload: any = { role: approveForm.role, name: approveForm.name.trim() }
      if (approveForm.role === 'manager') payload.email = approveForm.email.trim()
      await api.post(`telegram-join/${approveReq.id}/approve`, payload)
      setApproveReq(null)
      loadAll()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка одобрения')
    } finally {
      setApproveSaving(false)
    }
  }

  const runRejectJoin = async () => {
    if (rejectJoinId === null) return
    try {
      await api.post(`telegram-join/${rejectJoinId}/reject`)
      loadAll()
    } catch (e: any) {
      alert(e.response?.data?.detail || 'Ошибка')
    }
  }

  const runDeleteUser = async () => {
    if (deleteUserId === null) return
    try {
      await api.delete(`users/${deleteUserId}`)
      loadAll()
    } catch (e: any) {
      const d = e.response?.data?.detail
      alert(typeof d === 'string' ? d : d ? JSON.stringify(d) : 'Ошибка удаления')
    }
  }

  const deleteUserTarget = deleteUserId != null ? users.find(x => x.id === deleteUserId) : null

  const formatLastLogin = (iso?: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Layout>
      <PageHeader title="Пользователи" subtitle="Роли и Telegram-доступы" action={<BtnPrimary onClick={openAdd}>+ Добавить пользователя</BtnPrimary>} />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <Card style={{ marginBottom: 18, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ maxWidth: 560 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1d23' }}>Сотрудники (freelance)</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
              Выдайте роль <b>Сотрудник</b> — в кабинете отдельно «Мои задачи» и «История выплат». Реквизиты — в профиле; сводка по задачам и выплатам — в разделе{' '}
              <b>Команда</b>.
            </div>
          </div>
          <BtnOutline onClick={() => router.push('/staff')} style={{ padding: '8px 16px', fontWeight: 600 }}>
            Команда →
          </BtnOutline>
        </Card>
        {pending.length > 0 && (
          <Card style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Заявки из Telegram (модерация)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pending.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, padding: '10px 12px', background: '#f8f9fc', borderRadius: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.full_name || 'Без имени'}</div>
                    <div style={{ fontSize: 12, color: '#8a8fa8' }}>
                      @{r.telegram_username || '—'} · Chat ID: {formatMoneyNumber(r.telegram_chat_id)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <BtnPrimary onClick={() => openApprove(r)} style={{ padding: '6px 14px', fontSize: 12 }}>Одобрить</BtnPrimary>
                    <BtnOutline onClick={() => setRejectJoinId(r.id)} style={{ padding: '6px 14px', fontSize: 12 }}>Отклонить</BtnOutline>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Пользователь</Th>
                <Th>Роль</Th>
                <Th>Telegram</Th>
                <Th>Получает пуши</Th>
                <Th>Доступ к данным</Th>
                <Th>Последний вход (веб)</Th>
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
                    {u.telegram_chat_id != null && u.telegram_chat_id !== 0 && (
                      <div style={{ fontSize: 11, color: '#8a8fa8' }}>ID: {formatMoneyNumber(u.telegram_chat_id)}</div>
                    )}
                  </Td>
                  <Td style={{ fontSize: 12, color: '#8a8fa8' }}>
                    {u.web_access === false ? 'Только Telegram' : roleNotifLabel[u.role]}
                  </Td>
                  <Td style={{ fontSize: 11, color: '#8a8fa8' }}>
                    {u.role === 'manager'
                      ? (u.see_all_partners ? 'Все партнёры' : 'Только назначенные')
                      : u.role === 'administration'
                        ? `${(u.visible_manager_ids || []).length} менеджер(ов)`
                        : u.role === 'employee'
                          ? 'Только «Мои задачи»'
                          : '—'}
                  </Td>
                  <Td style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>{formatLastLogin(u.last_login_at)}</Td>
                  <Td><Badge variant={u.is_active ? 'green' : 'gray'}>{u.is_active ? 'Да' : 'Нет'}</Badge></Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <BtnIconEdit onClick={() => openEdit(u)} />
                      {user?.role === 'admin' && user.id !== u.id && u.is_active && (
                        <BtnOutline
                          onClick={() => setDeleteUserId(u.id)}
                          style={{ padding: '5px 10px', fontSize: 12, color: '#e84040' }}
                        >
                          ✕
                        </BtnOutline>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <Empty text="Пользователей нет" />}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Карточка пользователя' : 'Новый пользователь'}
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Имя *">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Имя Фамилия" />
        </Field>
        <Field label="Email (логин для входа) *">
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="rustam@company.uz" disabled={!!editing} />
        </Field>
        {!editing && (
          <Field label="Пароль *">
            <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Минимум 6 символов" />
          </Field>
        )}
        {editing && (
          <>
            <div style={{ padding: '10px 12px', background: '#f0f4fa', borderRadius: 9, fontSize: 12, color: '#4a5568', marginBottom: 12 }}>
              Текущий пароль в базе хранится в зашифрованном виде — показать его нельзя. Чтобы сменить доступ, введите <b>новый пароль</b> ниже.
            </div>
            <Field label="Новый пароль (оставьте пустым, если не меняете)">
              <Input type="password" value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} placeholder="••••••••" autoComplete="new-password" />
            </Field>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Роль">
            <Select
              value={form.role}
              onChange={e => {
                const r = e.target.value
                setForm(f => ({ ...f, role: r }))
                if (r !== 'administration') setVisibleManagerIds([])
              }}
            >
              <option value="admin">Администратор</option>
              <option value="manager">Менеджер</option>
              <option value="accountant">Бухгалтерия</option>
              <option value="administration">Администрация</option>
              <option value="employee">Сотрудник (freelance)</option>
            </Select>
          </Field>
          <Field label="Активен">
            <Select value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value }))}>
              <option value="true">Да</option>
              <option value="false">Нет</option>
            </Select>
          </Field>
        </div>
        {form.role === 'administration' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              Менеджеры, чьих партнёров и проекты видит эта учётная запись *
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e8e9ef', borderRadius: 8, padding: 8 }}>
              {managerOptions.length === 0 ? (
                <div style={{ fontSize: 12, color: '#8a8fa8' }}>Загрузка списка менеджеров…</div>
              ) : (
                managerOptions.map(m => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={visibleManagerIds.includes(m.id)}
                      onChange={(e) => {
                        setVisibleManagerIds(prev =>
                          e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id),
                        )
                      }}
                    />
                    {m.name}
                  </label>
                ))
              )}
            </div>
            <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 6, lineHeight: 1.45 }}>
              При создании компании и проекта пользователь выбирает одного из отмеченных менеджеров как ответственного.
            </div>
          </div>
        )}
        {form.role === 'employee' && (
          <>
            <Field label="Реквизиты для выплат (Visa, Uzcard, карта, IBAN…)">
              <textarea
                value={form.payment_details}
                onChange={e => setForm(f => ({ ...f, payment_details: e.target.value }))}
                placeholder="Всё в одном поле — как вам удобно копировать раз в месяц"
                rows={4}
                style={{
                  width: '100%',
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: '10px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </Field>
            <Field label="Несколько компаний в кабинете">
              <Select
                value={form.multi_company_access}
                onChange={(e) => setForm((f) => ({ ...f, multi_company_access: e.target.value }))}
              >
                <option value="false">Нет — только компания, выбранная при входе (отдельные выплаты в каждой БД)</option>
                <option value="true">Да — переключатель компаний в боковой панели (у каждой компании свои задачи и выплаты)</option>
              </Select>
            </Field>
          </>
        )}
        {form.role === 'manager' && (
          <Field label="Менеджер видит проекты всех партнёров">
            <Select value={form.see_all_partners} onChange={e => setForm(f => ({ ...f, see_all_partners: e.target.value }))}>
              <option value="false">Нет — только выбранные ниже партнёры</option>
              <option value="true">Да — полный доступ по всем партнёрам</option>
            </Select>
          </Field>
        )}
        {editing && form.role === 'manager' && form.see_all_partners === 'false' && allPartners.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Партнёры, доступные этому менеджеру</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e8e9ef', borderRadius: 8, padding: 8 }}>
              {allPartners.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={assignedPartnerIds.includes(p.id)}
                    onChange={(e) => {
                      setAssignedPartnerIds(prev => e.target.checked ? [...prev, p.id] : prev.filter(x => x !== p.id))
                    }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Telegram Username">
            <Input value={form.telegram_username} onChange={e => setForm(f => ({ ...f, telegram_username: e.target.value }))} placeholder="username (без @)" />
          </Field>
          <Field label="Telegram Chat ID">
            <IntegerGroupedInput
              value={form.telegram_chat_id}
              onChange={v => setForm(f => ({ ...f, telegram_chat_id: v }))}
              placeholder="123456789"
            />
          </Field>
        </div>
        <div style={{ padding: '10px 12px', background: '#f5f6fa', borderRadius: 9, fontSize: 12, color: '#8a8fa8' }}>
          💡 Chat ID можно узнать через @userinfobot в Telegram. Добавлять пользователей может только администратор.
        </div>
      </Modal>

      <Modal
        open={!!approveReq}
        onClose={() => setApproveReq(null)}
        title="Одобрить заявку Telegram"
        footer={(
          <>
            <BtnOutline onClick={() => setApproveReq(null)}>Отмена</BtnOutline>
            <BtnPrimary onClick={submitApprove} disabled={approveSaving || !approveForm.name.trim() || (approveForm.role === 'manager' && !approveForm.email.trim())}>
              {approveSaving ? 'Сохраняем...' : 'Подтвердить'}
            </BtnPrimary>
          </>
        )}
      >
        <div style={{ fontSize: 12, color: '#8a8fa8', marginBottom: 12 }}>
          После подтверждения пользователь получит сообщение в Telegram: менеджеру — ссылку и пароль в панель; бухгалтерии — только текст о том, что пуши будут здесь.
        </div>
        <Field label="Роль">
          <Select value={approveForm.role} onChange={e => setApproveForm(f => ({ ...f, role: e.target.value as 'manager' | 'accountant' }))}>
            <option value="manager">Менеджер (веб + Telegram)</option>
            <option value="accountant">Бухгалтерия (только Telegram)</option>
          </Select>
        </Field>
        <Field label="Имя *">
          <Input value={approveForm.name} onChange={e => setApproveForm(f => ({ ...f, name: e.target.value }))} placeholder="Как в системе" />
        </Field>
        {approveForm.role === 'manager' && (
          <Field label="Email (логин) *">
            <Input type="email" value={approveForm.email} onChange={e => setApproveForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.uz" />
          </Field>
        )}
      </Modal>

      <ConfirmModal
        open={rejectJoinId !== null}
        onClose={() => setRejectJoinId(null)}
        title="Отклонить заявку?"
        message="Пользователь получит уведомление в Telegram."
        confirmLabel="Отклонить"
        onConfirm={runRejectJoin}
      />
      <ConfirmModal
        open={deleteUserId !== null}
        onClose={() => setDeleteUserId(null)}
        title="Удалить пользователя?"
        message={
          deleteUserTarget ? (
            <>
              <span style={{ display: 'block', marginBottom: 8 }}>
                <b>{deleteUserTarget.name}</b> ({deleteUserTarget.email})
              </span>
              Аккаунт будет деактивирован, вход в веб-панель станет невозможен.
            </>
          ) : (
            'Аккаунт будет деактивирован.'
          )
        }
        confirmLabel="Удалить"
        onConfirm={runDeleteUser}
      />
    </Layout>
  )
}
