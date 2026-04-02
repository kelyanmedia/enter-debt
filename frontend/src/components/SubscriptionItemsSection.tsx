import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import {
  Card,
  Th,
  Td,
  BtnPrimary,
  BtnOutline,
  BtnIconEdit,
  Empty,
  Modal,
  Field,
  Input,
  Select,
  MoneyInput,
  ConfirmModal,
  formatDate,
  formatMoneyNumber,
} from '@/components/ui'

export type SubscriptionCategory = 'household' | 'phones' | 'services'

type RecurrenceValue = 'once' | 'monthly' | 'yearly'
type StatusValue = 'active' | 'inactive'

interface ItemRow {
  id: number
  category: string
  name: string
  status?: string | null
  tag?: string | null
  payer_code?: string | null
  payment_method?: string | null
  phone_number?: string | null
  vendor?: string | null
  amount?: string | null
  currency: string
  billing_note?: string | null
  next_due_date?: string | null
  next_deadline_at?: string | null
  recurrence?: string | null
  reminder_days_before?: number | null
  notes?: string | null
  link_url?: string | null
  created_at: string
}

type FormState = {
  name: string
  status: StatusValue
  tag: string
  payer_code: string
  payment_method: string
  phone_number: string
  vendor: string
  amount: string
  currency: string
  billing_note: string
  next_deadline_local: string
  recurrence: RecurrenceValue
  reminder_days_before: string
  notes: string
  link_url: string
}

const EMPTY: FormState = {
  name: '',
  status: 'active',
  tag: '',
  payer_code: '',
  payment_method: '',
  phone_number: '',
  vendor: '',
  amount: '',
  currency: 'USD',
  billing_note: '',
  next_deadline_local: '',
  recurrence: 'once',
  reminder_days_before: '0',
  notes: '',
  link_url: '',
}

const SVC_HEADER_TH: CSSProperties = {
  background: '#16a34a',
  color: '#fff',
  borderBottom: '1px solid #15803d',
  textTransform: 'none',
  letterSpacing: 'normal',
  fontSize: 12,
}

function Pill({
  children,
  bg,
  color = '#1e293b',
}: {
  children: ReactNode
  bg: string
  color?: string
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

function statusPill(s?: string | null) {
  if (s === 'inactive')
    return <Pill bg="#f1f5f9" color="#64748b">Неактивный</Pill>
  return <Pill bg="#dcfce7" color="#166534">Активный</Pill>
}

function recurrencePill(r?: string | null) {
  if (r === 'monthly') return <Pill bg="#dbeafe" color="#1e40af">Ежемесячная</Pill>
  if (r === 'yearly') return <Pill bg="#dcfce7" color="#166534">Годовая</Pill>
  return <Pill bg="#f1f5f9" color="#475569">Разово</Pill>
}

function payerPill(code?: string | null) {
  if (code === 'WW') return <Pill bg="#e9d5ff" color="#6b21a8">WW</Pill>
  if (code === 'KM') return <Pill bg="#bbf7d0" color="#14532d">KM</Pill>
  return '—'
}

function num(v: string | null | undefined) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocalToIso(local: string): string | null {
  const t = local.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function formatDeadlineDisplay(iso?: string | null, fallbackDate?: string | null) {
  if (iso) {
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  if (fallbackDate) return formatDate(fallbackDate)
  return '—'
}

const RECURRENCE_RU: Record<string, string> = {
  once: 'Разово',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно',
}

const REMINDER_RU: Record<number, string> = {
  0: '—',
  1: 'TG за 1 дн.',
  2: 'TG за 2 дн.',
}

function statusTagFields(
  setForm: React.Dispatch<React.SetStateAction<FormState>>,
  form: FormState,
) {
  return (
    <>
      <Field label="Статус">
        <Select
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as StatusValue }))}
        >
          <option value="active">Активный</option>
          <option value="inactive">Неактивный</option>
        </Select>
      </Field>
      <Field label="Tag (email / метка)">
        <Input
          value={form.tag}
          onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
          placeholder="kelyanmedia@gmail.com, Сервис…"
        />
      </Field>
    </>
  )
}

function payerMethodFields(
  setForm: React.Dispatch<React.SetStateAction<FormState>>,
  form: FormState,
) {
  return (
    <>
      <Field label="Кто платит">
        <Select
          value={form.payer_code}
          onChange={(e) => setForm((f) => ({ ...f, payer_code: e.target.value }))}
        >
          <option value="">—</option>
          <option value="KM">KM</option>
          <option value="WW">WW</option>
        </Select>
      </Field>
      <Field label="Вид оплаты">
        <Input
          value={form.payment_method}
          onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
          placeholder="Visa, Uzcard, App Store…"
        />
      </Field>
    </>
  )
}

export function SubscriptionItemsSection({
  category,
  listTitle,
}: {
  category: SubscriptionCategory
  listTitle: string
}) {
  const isPhones = category === 'phones'
  const isServices = category === 'services'
  const [rows, setRows] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<ItemRow | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<FormState>({ ...EMPTY })

  const load = useCallback(() => {
    setLoading(true)
    api
      .get<ItemRow[]>('subscription-items', { params: { category } })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [category])

  useEffect(() => {
    load()
  }, [load])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setError('')
    setModal(true)
  }

  const openEdit = (r: ItemRow) => {
    setEditing(r)
    const st: StatusValue = r.status === 'inactive' ? 'inactive' : 'active'
    setForm({
      name: r.name,
      status: st,
      tag: r.tag ?? '',
      payer_code: r.payer_code === 'KM' || r.payer_code === 'WW' ? r.payer_code : '',
      payment_method: r.payment_method ?? '',
      phone_number: r.phone_number ?? '',
      vendor: r.vendor ?? '',
      amount: r.amount != null ? String(r.amount) : '',
      currency: r.currency || 'USD',
      billing_note: r.billing_note ?? '',
      next_deadline_local: toDatetimeLocalValue(r.next_deadline_at),
      recurrence: (r.recurrence === 'monthly' || r.recurrence === 'yearly' ? r.recurrence : 'once') as RecurrenceValue,
      reminder_days_before: String(
        r.reminder_days_before === 1 || r.reminder_days_before === 2 ? r.reminder_days_before : 0,
      ),
      notes: r.notes ?? '',
      link_url: r.link_url ?? '',
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    setError('')
    if (!form.name.trim()) {
      setError(isPhones ? 'Укажите ФИО или название' : isServices ? 'Укажите название сервиса' : 'Укажите название')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        status: form.status,
        tag: form.tag.trim() || null,
        payer_code: form.payer_code === 'KM' || form.payer_code === 'WW' ? form.payer_code : null,
        payment_method: form.payment_method.trim() || null,
        phone_number: form.phone_number.trim() || null,
        vendor: form.vendor.trim() || null,
        amount: form.amount ? Number(form.amount.replace(',', '.')) : null,
        currency: form.currency,
        billing_note: form.billing_note.trim() || null,
        next_deadline_at: fromDatetimeLocalToIso(form.next_deadline_local),
        recurrence: form.recurrence,
        reminder_days_before: Number(form.reminder_days_before) as 0 | 1 | 2,
        notes: form.notes.trim() || null,
        link_url: form.link_url.trim() || null,
      }
      if (editing) {
        await api.patch(`subscription-items/${editing.id}`, body)
      } else {
        await api.post('subscription-items', { ...body, category })
      }
      setModal(false)
      load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const runDelete = async () => {
    if (deleteId == null) return
    try {
      await api.delete(`subscription-items/${deleteId}`)
      setDeleteId(null)
      load()
    } catch {
      /* */
    }
  }

  const notePreview = (s: string | null | undefined, max = 48) => {
    if (!s?.trim()) return '—'
    const t = s.trim()
    return t.length <= max ? t : `${t.slice(0, max)}…`
  }

  const renderServicesCells = (r: ItemRow) => {
    const sum =
      num(r.amount) != null
        ? r.currency === 'UZS'
          ? `${formatMoneyNumber(Number(r.amount))} сум`
          : `$${formatMoneyNumber(Number(r.amount))}`
        : '—'
    const rem = REMINDER_RU[r.reminder_days_before === 1 || r.reminder_days_before === 2 ? r.reminder_days_before : 0] ?? '—'
    const deadline = formatDeadlineDisplay(r.next_deadline_at, r.next_due_date)
    return (
      <>
        <Td style={{ fontWeight: 600 }}>{r.name}</Td>
        <Td>{statusPill(r.status)}</Td>
        <Td style={{ color: '#475569', fontSize: 13, maxWidth: 200 }}>
          <span title={r.tag?.trim() || undefined} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.tag?.trim() || '—'}
          </span>
        </Td>
        <Td>{recurrencePill(r.recurrence)}</Td>
        <Td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{deadline}</Td>
        <Td style={{ fontWeight: 600 }}>{sum}</Td>
        <Td>{payerPill(r.payer_code)}</Td>
        <Td style={{ color: '#64748b', fontSize: 12, maxWidth: 140 }}>
          <span title={r.payment_method?.trim() || undefined}>{notePreview(r.payment_method, 32)}</span>
        </Td>
        <Td style={{ color: '#64748b', fontSize: 12 }}>{rem}</Td>
        <Td style={{ color: '#64748b', fontSize: 12, maxWidth: 120 }}>
          <span title={r.notes?.trim() || undefined}>{notePreview(r.notes, 36)}</span>
        </Td>
        <Td>
          {r.link_url?.trim() ? (
            <a href={r.link_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 12 }}>
              открыть
            </a>
          ) : (
            '—'
          )}
        </Td>
        <Td>
          <div style={{ display: 'flex', gap: 4 }}>
            <BtnIconEdit onClick={() => openEdit(r)} />
            <BtnOutline onClick={() => setDeleteId(r.id)} style={{ padding: '4px 8px', fontSize: 11, color: '#e84040' }}>
              ✕
            </BtnOutline>
          </div>
        </Td>
      </>
    )
  }

  const renderRowCells = (r: ItemRow) => {
    if (isServices) return renderServicesCells(r)

    const sum =
      num(r.amount) != null
        ? r.currency === 'UZS'
          ? `${formatMoneyNumber(Number(r.amount))} сум`
          : `$${formatMoneyNumber(Number(r.amount))}`
        : '—'
    const rec = RECURRENCE_RU[r.recurrence || 'once'] || r.recurrence || '—'
    const rem = REMINDER_RU[r.reminder_days_before === 1 || r.reminder_days_before === 2 ? r.reminder_days_before : 0] ?? '—'
    const deadline = formatDeadlineDisplay(r.next_deadline_at, r.next_due_date)
    const phone = r.phone_number?.trim() || '—'
    const nameCell = <Td style={{ fontWeight: 600 }}>{r.name}</Td>
    const phoneCell = <Td style={{ fontFamily: 'monospace', fontSize: 13 }}>{phone}</Td>
    const vendorCell = <Td style={{ color: '#64748b' }}>{r.vendor?.trim() || '—'}</Td>
    const sumCell = <Td style={{ fontWeight: 600 }}>{sum}</Td>
    const recCell = <Td style={{ color: '#64748b', fontSize: 12 }}>{rec}</Td>
    const dlCell = <Td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{deadline}</Td>
    const remCell = <Td style={{ color: '#64748b', fontSize: 12 }}>{rem}</Td>
    const statusMini = <Td style={{ fontSize: 12 }}>{r.status === 'inactive' ? 'Неакт.' : 'Активн.'}</Td>
    const notesCell = (
      <Td style={{ color: '#64748b', fontSize: 12, maxWidth: 160 }}>
        <span title={r.notes?.trim() || undefined}>{notePreview(r.notes)}</span>
      </Td>
    )
    const linkCell = (
      <Td>
        {r.link_url?.trim() ? (
          <a href={r.link_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: 12 }}>
            открыть
          </a>
        ) : (
          '—'
        )}
      </Td>
    )
    const actions = (
      <Td>
        <div style={{ display: 'flex', gap: 4 }}>
          <BtnIconEdit onClick={() => openEdit(r)} />
          <BtnOutline onClick={() => setDeleteId(r.id)} style={{ padding: '4px 8px', fontSize: 11, color: '#e84040' }}>
            ✕
          </BtnOutline>
        </div>
      </Td>
    )

    if (isPhones) {
      return (
        <>
          {phoneCell}
          {nameCell}
          {sumCell}
          {recCell}
          {dlCell}
          {remCell}
          {statusMini}
          {notesCell}
          {linkCell}
          {actions}
        </>
      )
    }
    return (
      <>
        {nameCell}
        {phoneCell}
        {vendorCell}
        {sumCell}
        {recCell}
        {dlCell}
        {remCell}
        {statusMini}
        {notesCell}
        {linkCell}
        {actions}
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1d23' }}>{listTitle}</div>
        <BtnPrimary onClick={openAdd}>+ Добавить строку</BtnPrimary>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20, ...(isServices ? { overflowX: 'auto' } : {}) }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isServices ? 980 : undefined }}>
          <thead>
            <tr style={isServices ? { background: '#16a34a' } : { background: '#f8fafc' }}>
              {isServices ? (
                <>
                  <Th style={SVC_HEADER_TH}>Сервис</Th>
                  <Th style={SVC_HEADER_TH}>Статус</Th>
                  <Th style={SVC_HEADER_TH}>Tag</Th>
                  <Th style={SVC_HEADER_TH}>Оплата</Th>
                  <Th style={SVC_HEADER_TH}>Продление</Th>
                  <Th style={SVC_HEADER_TH}>Сумма</Th>
                  <Th style={SVC_HEADER_TH}>Кто платит</Th>
                  <Th style={SVC_HEADER_TH}>Вид оплаты</Th>
                  <Th style={SVC_HEADER_TH}>Напоминание</Th>
                  <Th style={SVC_HEADER_TH}>Заметки</Th>
                  <Th style={SVC_HEADER_TH}>Ссылка</Th>
                  <Th style={{ ...SVC_HEADER_TH, width: 88 }} />
                </>
              ) : isPhones ? (
                <>
                  <Th>Номер телефона</Th>
                  <Th>ФИО / название</Th>
                  <Th>Сумма</Th>
                  <Th>Периодичность</Th>
                  <Th>Срок оплаты</Th>
                  <Th>Напоминание</Th>
                  <Th>Статус</Th>
                  <Th>Заметки</Th>
                  <Th>Ссылка</Th>
                  <Th style={{ width: 88 }} />
                </>
              ) : (
                <>
                  <Th>Название</Th>
                  <Th>Телефон</Th>
                  <Th>Поставщик</Th>
                  <Th>Сумма</Th>
                  <Th>Периодичность</Th>
                  <Th>Срок оплаты</Th>
                  <Th>Напоминание</Th>
                  <Th>Статус</Th>
                  <Th>Заметки</Th>
                  <Th>Ссылка</Th>
                  <Th style={{ width: 88 }} />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                {renderRowCells(r)}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <Empty text="Пока нет записей — добавьте позиции для этой категории" />}
        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>Загрузка…</div>
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Редактировать' : 'Новая запись'}
        footer={(
          <>
            <BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline>
            <BtnPrimary onClick={() => void save()} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</BtnPrimary>
          </>
        )}
      >
        {error && (
          <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}
        {isServices ? (
          <>
            <Field label="Сервис *">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Notion, ChatGPT, ЭДО…" />
            </Field>
            {statusTagFields(setForm, form)}
          </>
        ) : isPhones ? (
          <>
            <Field label="Номер телефона">
              <Input
                value={form.phone_number}
                onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
                placeholder="998901234567"
                inputMode="numeric"
              />
            </Field>
            <Field label="ФИО / название *">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Алена, Enter Group…" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Название *">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Интернет офис, Figma, SIM…" />
            </Field>
            <Field label="Телефон (по желанию)">
              <Input
                value={form.phone_number}
                onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
                placeholder="Для контакта или учёта"
              />
            </Field>
            <Field label="Поставщик / оператор">
              <Input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} placeholder="Провайдер, банк, сервис" />
            </Field>
          </>
        )}
        {!isServices && statusTagFields(setForm, form)}
        <Field label="Повтор платежа">
          <Select
            value={form.recurrence}
            onChange={(e) =>
              setForm((f) => ({ ...f, recurrence: e.target.value as RecurrenceValue }))
            }
          >
            <option value="once">Разово</option>
            <option value="monthly">Ежемесячно</option>
            <option value="yearly">Ежегодно</option>
          </Select>
        </Field>
        <Field label="Срок оплаты (дата и время)">
          <Input
            type="datetime-local"
            value={form.next_deadline_local}
            onChange={(e) => setForm((f) => ({ ...f, next_deadline_local: e.target.value }))}
          />
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
            Напоминания в Telegram (за 1–2 дня) считаются по календарным дням до этой даты (Asia/Tashkent).
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Сумма">
            <MoneyInput value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="—" />
          </Field>
          <Field label="Валюта">
            <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </Select>
          </Field>
        </div>
        {payerMethodFields(setForm, form)}
        <Field label="Telegram админам и «Администрации»">
          <Select
            value={form.reminder_days_before}
            onChange={(e) => setForm((f) => ({ ...f, reminder_days_before: e.target.value }))}
          >
            <option value="0">Не напоминать</option>
            <option value="1">За 1 день до срока</option>
            <option value="2">За 2 дня до срока</option>
          </Select>
        </Field>
        {isServices && (
          <Field label="Телефон (необязательно)">
            <Input
              value={form.phone_number}
              onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
              placeholder="Если нужен для учёта"
            />
          </Field>
        )}
        <Field label="Дополнительно к оплате (необязательно)">
          <Input
            value={form.billing_note}
            onChange={(e) => setForm((f) => ({ ...f, billing_note: e.target.value }))}
            placeholder="Тариф, договор, комментарий…"
          />
        </Field>
        <Field label="Заметки">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Ответственный, детали"
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #e8e9ef',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </Field>
        <Field label="Ссылка">
          <Input value={form.link_url} onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))} placeholder="https://…" />
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Удалить запись?"
        message="Строка будет удалена без восстановления."
        confirmLabel="Удалить"
        onConfirm={runDelete}
      />
    </>
  )
}
