import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Field, Input, BtnPrimary, BtnOutline } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'

const roleLabel: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  accountant: 'Бухгалтерия',
}

export default function ProfilePage() {
  const { user, loading, refreshUser } = useAuth()
  const [email, setEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [tgPingBusy, setTgPingBusy] = useState(false)
  const [tgPingMsg, setTgPingMsg] = useState('')

  useEffect(() => {
    if (user?.email) setEmail(user.email)
  }, [user?.email])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setOk('')
    if (!user) return
    if (!currentPassword.trim()) {
      setError('Введите текущий пароль')
      return
    }
    const emailTrim = email.trim().toLowerCase()
    const emailChanged = emailTrim !== user.email
    const wantPw = newPassword.trim() || newPassword2.trim()
    if (wantPw) {
      if (newPassword !== newPassword2) {
        setError('Новые пароли не совпадают')
        return
      }
      if (newPassword.trim().length < 4) {
        setError('Новый пароль: минимум 4 символа')
        return
      }
    }
    if (!emailChanged && !wantPw) {
      setError('Измените email или задайте новый пароль')
      return
    }

    setSaving(true)
    try {
      const payload: { current_password: string; email: string; new_password?: string } = {
        current_password: currentPassword,
        email: emailTrim,
      }
      if (wantPw) payload.new_password = newPassword.trim()
      await api.patch('auth/me', payload)
      setCurrentPassword('')
      setNewPassword('')
      setNewPassword2('')
      setOk('Сохранено')
      await refreshUser()
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !user) return null

  return (
    <Layout>
      <PageHeader
        title="Профиль"
        subtitle={
          user.role === 'admin'
            ? 'Логин и пароль своей учётной записи. Остальных пользователей — в разделе «Пользователи».'
            : 'Логин (email) и пароль для входа в панель'
        }
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1, maxWidth: 520 }}>
        <Card style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: 13, color: '#8a8fa8', marginBottom: 16 }}>
            <span style={{ fontWeight: 600, color: '#1a1d23' }}>{user.name}</span>
            {' · '}
            {roleLabel[user.role] ?? user.role}
          </div>

          <div
            style={{
              marginBottom: 20,
              padding: '14px 16px',
              background: '#f8f9fc',
              borderRadius: 10,
              border: '1px solid #eceef2',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>Telegram</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55, marginBottom: 12 }}>
              Пуши об оплатах, актах и отчёты приходят в бот EnterDebt. Привязка — через <b>/start</b> в боте и
              одобрение заявки администратором в разделе «Пользователи».
            </div>
            {user.telegram_chat_id ? (
              <div style={{ fontSize: 13, color: '#1a1d23', marginBottom: 10 }}>
                <span style={{ color: '#6b7280' }}>Статус:</span>{' '}
                <span style={{ fontWeight: 600, color: '#15803d' }}>привязан</span>
                <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 6 }}>
                  Chat ID: <code style={{ fontSize: 12 }}>{user.telegram_chat_id}</code>
                  {user.telegram_username ? (
                    <>
                      {' · '}@{user.telegram_username}
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, marginBottom: 10, color: '#b45309' }}>
                <b>Не привязан</b> — пуши в Telegram не дойдут, пока не пройдёте регистрацию в боте.
              </div>
            )}
            {tgPingMsg && (
              <div
                style={{
                  marginBottom: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  background: tgPingMsg.startsWith('Ошибка') ? '#fef0f0' : '#e8f5ee',
                  color: tgPingMsg.startsWith('Ошибка') ? '#b91c1c' : '#1a6b3c',
                }}
              >
                {tgPingMsg}
              </div>
            )}
            <BtnOutline
              type="button"
              disabled={tgPingBusy}
              onClick={async () => {
                setTgPingMsg('')
                setTgPingBusy(true)
                try {
                  await api.post('auth/me/telegram-ping')
                  setTgPingMsg('Тестовое сообщение отправлено — проверьте Telegram.')
                  await refreshUser()
                } catch (e: unknown) {
                  const ax = e as { response?: { data?: { detail?: string } } }
                  const d = ax.response?.data?.detail
                  setTgPingMsg(`Ошибка: ${typeof d === 'string' ? d : 'не удалось отправить'}`)
                } finally {
                  setTgPingBusy(false)
                }
              }}
            >
              {tgPingBusy ? 'Отправка…' : 'Отправить тестовое уведомление в Telegram'}
            </BtnOutline>
            {user.role === 'admin' && (
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 10, lineHeight: 1.45 }}>
                Как администратору: так вы проверяете, что до вашего чата доходят сервисные сообщения и отчёты.
              </div>
            )}
          </div>

          <form onSubmit={submit}>
            <Field label="Email (логин)">
              <Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </Field>
            <Field label="Текущий пароль">
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Обязателен для сохранения изменений"
              />
            </Field>
            <Field label="Новый пароль (если меняете)">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Не заполняйте, если только меняете email"
              />
            </Field>
            <Field label="Повтор нового пароля">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword2}
                onChange={e => setNewPassword2(e.target.value)}
              />
            </Field>

            {error && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fef0f0', borderRadius: 9, fontSize: 13, color: '#b91c1c' }}>
                {error}
              </div>
            )}
            {ok && (
              <div style={{ marginBottom: 12, padding: '10px 12px', background: '#e8f5ee', borderRadius: 9, fontSize: 13, color: '#1a6b3c' }}>
                {ok}
              </div>
            )}

            <BtnPrimary type="submit" disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </form>
        </Card>

        {user.role === 'admin' && (
          <Card style={{ padding: '22px 24px', marginTop: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
              Отчёт о поступлениях в Telegram
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55, marginBottom: 16 }}>
              Каждую пятницу в <b>18:00</b> по Ташкенту в Telegram уходит текстовый отчёт: общая сумма поступлений за
              текущую неделю (с понедельника 00:00 до пятницы 18:00 или до момента отправки) и разбивка по каждому
              проекту — те же данные, что в разделе «Оплаты» по дате зачисления (<code style={{ fontSize: 12 }}>paid_at</code>
              ). Получатель — ваш привязанный Telegram (как у бота); если у нескольких админов есть chat id — всем.
            </div>
            {reportMsg && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 13,
                  background: reportMsg.startsWith('Ошибка') ? '#fef0f0' : '#e8f5ee',
                  color: reportMsg.startsWith('Ошибка') ? '#b91c1c' : '#1a6b3c',
                }}
              >
                {reportMsg}
              </div>
            )}
            <BtnOutline
              type="button"
              disabled={reportBusy}
              onClick={async () => {
                setReportMsg('')
                setReportBusy(true)
                try {
                  const r = await api.post<{
                    ok: boolean
                    detail?: string
                    period_start?: string
                    period_end?: string
                    total?: string
                    row_count?: number
                  }>('dashboard/weekly-cash-report/send')
                  const d = r.data
                  if (d.ok) {
                    const from = d.period_start ? new Date(d.period_start).toLocaleString('ru-RU') : ''
                    const to = d.period_end ? new Date(d.period_end).toLocaleString('ru-RU') : ''
                    setReportMsg(
                      `Отправлено. Период: ${from} — ${to}. Строк: ${d.row_count ?? 0}. Сумма: ${d.total ?? '—'}`,
                    )
                  } else {
                    setReportMsg(`Ошибка: ${d.detail || 'не удалось отправить'}`)
                  }
                } catch (e: unknown) {
                  const ax = e as { response?: { data?: { detail?: string } } }
                  setReportMsg(`Ошибка: ${ax.response?.data?.detail || 'сеть или сервер'}`)
                } finally {
                  setReportBusy(false)
                }
              }}
            >
              {reportBusy ? 'Отправка…' : 'Отправить отчёт сейчас'}
            </BtnOutline>
          </Card>
        )}
      </div>
    </Layout>
  )
}
