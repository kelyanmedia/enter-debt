import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Field, Input, BtnPrimary } from '@/components/ui'
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
      </div>
    </Layout>
  )
}
