import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Field, Input, BtnPrimary, BtnOutline, Modal } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import {
  PAYMENT_DETAILS_EXAMPLE_LINES,
  PAYMENT_DETAILS_HOVER_WHY,
  PAYMENT_DETAILS_PLACEHOLDER,
} from '@/lib/paymentRequisitesCopy'

const roleLabel: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  accountant: 'Бухгалтерия',
  financier: 'Финансист',
  administration: 'Администрация',
  employee: 'Сотрудник',
}

type TelegramCcSettings = {
  notify_all: boolean
  manager_ids: number[]
  managers: { id: number; name: string }[]
}

type TelegramDividendSettings = {
  available_categories: { slug: string; label: string }[]
  allowed_categories: string[]
  default_category: string
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
  const [paymentDetails, setPaymentDetails] = useState('')
  const [requisitesHintOpen, setRequisitesHintOpen] = useState(false)
  const [ccBusy, setCcBusy] = useState(false)
  const [ccSaving, setCcSaving] = useState(false)
  const [ccMsg, setCcMsg] = useState('')
  const [ccNotifyAll, setCcNotifyAll] = useState(false)
  const [ccManagerIds, setCcManagerIds] = useState<number[]>([])
  const [ccManagers, setCcManagers] = useState<{ id: number; name: string }[]>([])
  const [dividendBusy, setDividendBusy] = useState(false)
  const [dividendSaving, setDividendSaving] = useState(false)
  const [dividendMsg, setDividendMsg] = useState('')
  const [dividendCategories, setDividendCategories] = useState<{ slug: string; label: string }[]>([])
  const [dividendAllowed, setDividendAllowed] = useState<string[]>([])
  const [dividendDefault, setDividendDefault] = useState('dividends')

  useEffect(() => {
    if (user?.email) setEmail(user.email)
  }, [user?.email])

  useEffect(() => {
    if (user?.role === 'employee') setPaymentDetails(user.payment_details ?? '')
  }, [user?.role, user?.payment_details])

  useEffect(() => {
    if (user?.role !== 'admin') return
    let cancelled = false
    setCcBusy(true)
    setCcMsg('')
    api
      .get<TelegramCcSettings>('auth/me/telegram-cc-settings')
      .then(({ data }) => {
        if (cancelled) return
        setCcNotifyAll(Boolean(data.notify_all))
        setCcManagerIds(Array.isArray(data.manager_ids) ? data.manager_ids : [])
        setCcManagers(Array.isArray(data.managers) ? data.managers : [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const ax = e as { response?: { data?: { detail?: string } } }
        setCcMsg(`Ошибка загрузки настроек: ${ax.response?.data?.detail || 'сеть или сервер'}`)
      })
      .finally(() => {
        if (!cancelled) setCcBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.role])

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'financier') return
    let cancelled = false
    setDividendBusy(true)
    setDividendMsg('')
    api
      .get<TelegramDividendSettings>('auth/me/telegram-dividend-settings')
      .then(({ data }) => {
        if (cancelled) return
        setDividendCategories(Array.isArray(data.available_categories) ? data.available_categories : [])
        setDividendAllowed(Array.isArray(data.allowed_categories) ? data.allowed_categories : [])
        setDividendDefault(typeof data.default_category === 'string' ? data.default_category : 'dividends')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const ax = e as { response?: { data?: { detail?: string } } }
        setDividendMsg(`Ошибка загрузки настроек /d: ${ax.response?.data?.detail || 'сеть или сервер'}`)
      })
      .finally(() => {
        if (!cancelled) setDividendBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [user?.role])

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
    const pdNorm = (a: string) => a.trim()
    const paymentDetailsChanged =
      user.role === 'employee' && pdNorm(paymentDetails) !== pdNorm(user.payment_details ?? '')
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
    if (!emailChanged && !wantPw && !paymentDetailsChanged) {
      setError('Измените email, пароль или реквизиты')
      return
    }

    setSaving(true)
    try {
      const payload: { current_password: string; email: string; new_password?: string; payment_details?: string | null } = {
        current_password: currentPassword,
        email: emailTrim,
      }
      if (wantPw) payload.new_password = newPassword.trim()
      if (paymentDetailsChanged) payload.payment_details = pdNorm(paymentDetails) || null
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
            : user.role === 'financier'
              ? 'Логин и пароль. Доступ к разделу «Финансы» (CEO, P&L, ДДС, оплаты, расходы).'
              : user.role === 'employee'
                ? 'Смена пароля, email и реквизиты для выплат (нужен текущий пароль для сохранения).'
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
            {(user.role === 'admin' || user.role === 'financier') && (
              <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 10, lineHeight: 1.45 }}>
                {user.role === 'admin'
                  ? 'Как администратору: так вы проверяете, что до вашего чата доходят сервисные сообщения и отчёты.'
                  : 'Проверка доставки сообщений бота в ваш Telegram.'}
                <div style={{ marginTop: 8 }}>
                  Горячие команды бота: <code>/pay текст</code> — заявка администрации,{' '}
                  <code>/d сумма [комментарий]</code> — фиксирует, сколько вы забрали из прибыли (добавляется в
                  ДДС как расход в строку «Изъятие прибыли (/d)», категория «Дивиденды»).
                </div>
              </div>
            )}
          </div>

          {user.role === 'admin' && (
            <div
              style={{
                marginBottom: 20,
                padding: '14px 16px',
                background: '#f8f9fc',
                borderRadius: 10,
                border: '1px solid #eceef2',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
                Telegram: чьи пуши и активность видеть
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5, marginBottom: 12 }}>
                Эти настройки влияют на копии переписки менеджер ↔ бухгалтерия и файлы из бота.
              </div>
              {ccMsg && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: ccMsg.startsWith('Ошибка') ? '#fef0f0' : '#e8f5ee',
                    color: ccMsg.startsWith('Ошибка') ? '#b91c1c' : '#1a6b3c',
                  }}
                >
                  {ccMsg}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, color: '#1a1d23' }}>
                <input
                  type="checkbox"
                  checked={ccNotifyAll}
                  onChange={e => setCcNotifyAll(e.target.checked)}
                  disabled={ccBusy || ccSaving}
                />
                Видеть активность всех менеджеров
              </label>
              {!ccNotifyAll && (
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: '8px 10px',
                    maxHeight: 180,
                    overflowY: 'auto',
                    marginBottom: 10,
                    background: '#fff',
                  }}
                >
                  {ccManagers.length === 0 && (
                    <div style={{ fontSize: 12, color: '#8a8fa8' }}>Нет активных менеджеров в этой компании.</div>
                  )}
                  {ccManagers.map(m => (
                    <label
                      key={m.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: '#1a1d23' }}
                    >
                      <input
                        type="checkbox"
                        checked={ccManagerIds.includes(m.id)}
                        disabled={ccBusy || ccSaving}
                        onChange={e => {
                          setCcManagerIds(prev =>
                            e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id),
                          )
                        }}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
              <BtnOutline
                type="button"
                disabled={ccBusy || ccSaving}
                onClick={async () => {
                  setCcMsg('')
                  setCcSaving(true)
                  try {
                    const payload = {
                      notify_all: ccNotifyAll,
                      manager_ids: ccNotifyAll ? [] : ccManagerIds,
                    }
                    const { data } = await api.put<TelegramCcSettings>('auth/me/telegram-cc-settings', payload)
                    setCcNotifyAll(Boolean(data.notify_all))
                    setCcManagerIds(Array.isArray(data.manager_ids) ? data.manager_ids : [])
                    setCcManagers(Array.isArray(data.managers) ? data.managers : [])
                    setCcMsg('Сохранено.')
                  } catch (e: unknown) {
                    const ax = e as { response?: { data?: { detail?: string } } }
                    setCcMsg(`Ошибка: ${ax.response?.data?.detail || 'не удалось сохранить'}`)
                  } finally {
                    setCcSaving(false)
                  }
                }}
              >
                {ccSaving ? 'Сохранение…' : 'Сохранить настройки Telegram-активности'}
              </BtnOutline>
            </div>
          )}

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

            {user.role === 'employee' && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{ fontSize: 13, fontWeight: 600, color: '#1a1d23' }}
                    title={PAYMENT_DETAILS_HOVER_WHY}
                  >
                    Реквизиты для выплат (Visa, Uzcard, карта, IBAN…)
                  </span>
                  <button
                    type="button"
                    onClick={() => setRequisitesHintOpen(true)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: '1px solid #c5c8d4',
                      background: '#f8f9fc',
                      color: '#64748b',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                    title="Открыть пример заполнения"
                  >
                    ?
                  </button>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#64748b',
                    marginBottom: 8,
                    lineHeight: 1.45,
                    padding: '8px 10px',
                    background: '#f1f5f9',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <strong style={{ color: '#475569' }}>Как писать:</strong> укажите{' '}
                  <strong>номер карты или счёта</strong> и <strong>фамилию, имя</strong> (как в банке); для крипты —{' '}
                  <strong>сеть</strong> (например USDT TRC20) и <strong>полный адрес кошелька</strong>. Наведите на поле
                  ниже — кратко, <strong>зачем</strong> такой формат.
                </div>
                <textarea
                  value={paymentDetails}
                  onChange={e => setPaymentDetails(e.target.value)}
                  placeholder={PAYMENT_DETAILS_PLACEHOLDER}
                  title={PAYMENT_DETAILS_HOVER_WHY}
                  rows={6}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    minHeight: 120,
                  }}
                />
                <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 6, lineHeight: 1.45 }}>
                  После сохранения в разделе «Команда» у администратора блок реквизитов подсвечивается жёлтым в течение месяца.
                </div>
              </div>
            )}

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

        {(user.role === 'admin' || user.role === 'financier') && (
          <Card style={{ padding: '22px 24px', marginTop: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
              Отчёт о поступлениях в Telegram
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55, marginBottom: 16 }}>
              Каждую пятницу в <b>18:00</b> по Ташкенту в Telegram уходит текстовый отчёт: общая сумма поступлений за
              текущую неделю (с понедельника 00:00 до пятницы 18:00 или до момента отправки) и разбивка по каждому
              проекту — те же данные, что в разделе «Оплаты» по дате зачисления (<code style={{ fontSize: 12 }}>paid_at</code>
              ). Получатель — привязанный Telegram; у нескольких администраторов с chat id — всем админам.
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

            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
                Команда <code style={{ fontSize: 12 }}>/d</code> в Telegram
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.55, marginBottom: 12 }}>
                Команда <code style={{ fontSize: 12 }}>/d сумма комментарий</code> записывает расход в ДДС
                <b> текущей датой</b>, а бот после ввода суммы спрашивает категорию P&amp;L кнопками. Здесь настраивается,
                какие категории показывать и какая будет отмечена по умолчанию.
              </div>
              {dividendMsg && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: '10px 12px',
                    borderRadius: 9,
                    fontSize: 13,
                    background: dividendMsg.startsWith('Ошибка') ? '#fef0f0' : '#e8f5ee',
                    color: dividendMsg.startsWith('Ошибка') ? '#b91c1c' : '#1a6b3c',
                  }}
                >
                  {dividendMsg}
                </div>
              )}
              {dividendBusy ? (
                <div style={{ fontSize: 13, color: '#8a8fa8' }}>Загрузка настроек /d…</div>
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                      Категории, которые бот показывает после <code>/d</code>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {dividendCategories.map((row) => {
                        const checked = dividendAllowed.includes(row.slug)
                        return (
                          <label
                            key={row.slug}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              fontSize: 13,
                              color: '#334155',
                              userSelect: 'none',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setDividendMsg('')
                                setDividendAllowed((prev) =>
                                  checked ? prev.filter((x) => x !== row.slug) : [...prev, row.slug],
                                )
                                if (!checked && !dividendDefault) setDividendDefault(row.slug)
                                if (checked && dividendDefault === row.slug) {
                                  const next = dividendAllowed.filter((x) => x !== row.slug)
                                  setDividendDefault(next[0] || '')
                                }
                              }}
                            />
                            <span>{row.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                      Категория по умолчанию
                    </div>
                    <select
                      value={dividendDefault}
                      onChange={(e) => setDividendDefault(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        fontSize: 14,
                        fontFamily: 'inherit',
                        background: '#fff',
                      }}
                    >
                      {dividendCategories
                        .filter((row) => dividendAllowed.includes(row.slug))
                        .map((row) => (
                          <option key={row.slug} value={row.slug}>
                            {row.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <BtnPrimary
                    type="button"
                    disabled={dividendSaving}
                    onClick={async () => {
                      setDividendMsg('')
                      setDividendSaving(true)
                      try {
                        const allowed = dividendAllowed.filter((x, i, arr) => arr.indexOf(x) === i)
                        const fallbackDefault = dividendDefault || allowed[0] || 'dividends'
                        const { data } = await api.put<TelegramDividendSettings>('auth/me/telegram-dividend-settings', {
                          allowed_categories: allowed,
                          default_category: fallbackDefault,
                        })
                        setDividendCategories(Array.isArray(data.available_categories) ? data.available_categories : [])
                        setDividendAllowed(Array.isArray(data.allowed_categories) ? data.allowed_categories : [])
                        setDividendDefault(typeof data.default_category === 'string' ? data.default_category : 'dividends')
                        setDividendMsg('Настройки /d сохранены')
                      } catch (e: unknown) {
                        const ax = e as { response?: { data?: { detail?: string } } }
                        setDividendMsg(`Ошибка: ${ax.response?.data?.detail || 'не удалось сохранить'}`)
                      } finally {
                        setDividendSaving(false)
                      }
                    }}
                  >
                    {dividendSaving ? 'Сохранение…' : 'Сохранить настройки /d'}
                  </BtnPrimary>
                </>
              )}
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={requisitesHintOpen}
        onClose={() => setRequisitesHintOpen(false)}
        title="Как заполнить реквизиты"
        footer={<BtnPrimary onClick={() => setRequisitesHintOpen(false)}>Понятно</BtnPrimary>}
      >
        <p style={{ margin: '0 0 12px', fontSize: 14, color: '#475569', lineHeight: 1.55 }}>
          <strong>Зачем так:</strong> бухгалтерия копирует ваш текст в банк или криптоплатёж. Если сразу видно номер, ФИО как в
          договоре с банком и (при крипте) сеть + полный адрес — не нужно отдельно писать вам в личку, реже ошибки и возвраты,
          выплата уходит быстрее. Данные доступны только админам вашей организации.
        </p>
        <div
          style={{
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#334155',
            lineHeight: 1.5,
            padding: '12px 14px',
            background: '#f8fafc',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            whiteSpace: 'pre-wrap',
          }}
        >
          {PAYMENT_DETAILS_EXAMPLE_LINES.join('\n')}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
          Можете скопировать пример, заменить на свои данные и сохранить. Одно поле — удобно вставлять в платёжку раз в месяц целиком.
        </p>
      </Modal>
    </Layout>
  )
}
