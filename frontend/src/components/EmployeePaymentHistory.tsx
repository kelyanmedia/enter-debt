import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
import {
  BtnOutline,
  BtnPrimary,
  Card,
  Modal,
  Field,
  Input,
  Select,
  MoneyInput,
  ConfirmModal,
  formatDate,
  formatMoneyNumber,
} from '@/components/ui'

const MONTH_OPTIONS = [
  { v: 1, l: 'Январь' },
  { v: 2, l: 'Февраль' },
  { v: 3, l: 'Март' },
  { v: 4, l: 'Апрель' },
  { v: 5, l: 'Май' },
  { v: 6, l: 'Июнь' },
  { v: 7, l: 'Июль' },
  { v: 8, l: 'Август' },
  { v: 9, l: 'Сентябрь' },
  { v: 10, l: 'Октябрь' },
  { v: 11, l: 'Ноябрь' },
  { v: 12, l: 'Декабрь' },
]

interface PaymentRow {
  id: number
  user_id: number
  paid_on: string
  period_year?: number | null
  period_month?: number | null
  amount: string
  budget_amount?: string
  currency: string
  note?: string | null
  has_receipt: boolean
  entered_by: string
  created_at: string
}

const emptyForm = () => ({
  paid_on: new Date().toISOString().slice(0, 10),
  amount: '',
  budget_amount: '',
  include_budget: false,
  currency: 'USD',
  note: '',
  period_year: '',
  period_month: '',
  file: null as File | null,
})

export function EmployeePaymentHistory({
  mode,
  userId,
  startWithAddForm = false,
}: {
  mode: 'employee' | 'admin'
  userId?: number
  startWithAddForm?: boolean
}) {
  const { user: authUser } = useAuth()
  const showBudgetSplit = mode === 'admin' || !!authUser?.is_ad_budget_employee
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const load = useCallback(() => {
    if (mode === 'admin' && (userId == null || userId < 1)) return
    setLoading(true)
    const params = mode === 'admin' ? { user_id: userId } : {}
    api
      .get<PaymentRow[]>('employee-payment-records', { params })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [mode, userId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (startWithAddForm) {
      setForm(emptyForm())
      setAddOpen(true)
    }
  }, [startWithAddForm])

  const openAdd = () => {
    setForm(emptyForm())
    setError('')
    setAddOpen(true)
  }

  const submit = async () => {
    setError('')
    if (mode === 'admin' && !form.note.trim()) {
      setError('Укажите, за что выплата')
      return
    }
    if (!form.amount.trim()) {
      setError('Укажите сумму')
      return
    }
    if (showBudgetSplit && form.include_budget) {
      const at = Number(String(form.amount).replace(/\s/g, '').replace(',', '.'))
      const bt = Number(String(form.budget_amount).replace(/\s/g, '').replace(',', '.'))
      if (!form.budget_amount.trim() || !Number.isFinite(bt) || bt <= 0) {
        setError('Укажите сумму бюджета или снимите галочку')
        return
      }
      if (!Number.isFinite(at) || bt > at) {
        setError('Бюджет не может превышать общую сумму перевода')
        return
      }
    }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('paid_on', form.paid_on)
      fd.append('amount', form.amount.replace(',', '.'))
      fd.append('currency', form.currency)
      fd.append('note', form.note.trim())
      if (form.period_year && form.period_month) {
        fd.append('period_year', form.period_year)
        fd.append('period_month', form.period_month)
      }
      if (mode === 'admin' && userId != null) fd.append('user_id', String(userId))
      if (form.file) fd.append('file', form.file)
      if (showBudgetSplit && form.include_budget && form.budget_amount.trim()) {
        fd.append('budget_amount', form.budget_amount.replace(',', '.'))
      }
      await api.post('employee-payment-records', fd)
      setAddOpen(false)
      load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const downloadReceipt = async (id: number) => {
    try {
      const r = await api.get(`employee-payment-records/${id}/receipt`, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 120_000)
    } catch {
      /* */
    }
  }

  const runDelete = async () => {
    if (deleteId == null) return
    try {
      await api.delete(`employee-payment-records/${deleteId}`)
      setDeleteId(null)
      load()
    } catch {
      /* */
    }
  }

  const periodLabel = (r: PaymentRow) => {
    if (r.period_year != null && r.period_month != null) {
      const m = MONTH_OPTIONS.find((x) => x.v === r.period_month)?.l ?? r.period_month
      return `${m} ${r.period_year}`
    }
    return '—'
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            История выплат
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.45 }}>
            {mode === 'employee'
              ? 'Фиксируйте дату, период и сумму, если вам перевели деньги. Можно прикрепить чек.'
              : 'Выплаты по этому сотруднику: видны вам и ему в кабинете.'}
          </div>
        </div>
        <BtnPrimary onClick={openAdd} style={{ fontSize: 12, padding: '8px 14px' }}>
          + Запись о выплате
        </BtnPrimary>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Дата выплаты</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Период</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Сумма</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Комментарий</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Кто внёс</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase' }}>Чек</th>
              <th style={{ width: 56 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>{formatDate(r.paid_on)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#64748b' }}>{periodLabel(r)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                  <div>{r.currency === 'UZS' ? `${formatMoneyNumber(Number(r.amount))} сум` : `$${formatMoneyNumber(Number(r.amount))}`}</div>
                  {Number(r.budget_amount ?? 0) > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginTop: 4 }}>
                      из них бюджет (не в P&L):{' '}
                      {r.currency === 'UZS'
                        ? `${formatMoneyNumber(Number(r.budget_amount))} сум`
                        : `$${formatMoneyNumber(Number(r.budget_amount))}`}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569', maxWidth: 220 }}>
                  <span title={r.note || undefined}>{r.note?.trim() ? (r.note.length > 80 ? `${r.note.slice(0, 80)}…` : r.note) : '—'}</span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: '#64748b' }}>
                  {r.entered_by === 'admin' ? 'Админ' : 'Сотрудник'}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {r.has_receipt ? (
                    <BtnOutline type="button" onClick={() => void downloadReceipt(r.id)} style={{ padding: '4px 10px', fontSize: 11 }}>
                      Открыть
                    </BtnOutline>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {(mode === 'admin' || r.entered_by === 'self') ? (
                    <BtnOutline type="button" onClick={() => setDeleteId(r.id)} style={{ padding: '4px 8px', fontSize: 11, color: '#e84040' }}>
                      ✕
                    </BtnOutline>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>Пока нет записей</div>
        )}
        {loading && <div style={{ padding: 16, textAlign: 'center', color: '#8a8fa8', fontSize: 13 }}>Загрузка…</div>}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={mode === 'admin' ? 'Выплата сотруднику' : 'Добавить выплату'}
        footer={(
          <>
            <BtnOutline onClick={() => setAddOpen(false)}>Отмена</BtnOutline>
            <BtnPrimary onClick={() => void submit()} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</BtnPrimary>
          </>
        )}
      >
        {error && (
          <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}
        <Field label="Дата выплаты *">
          <Input type="date" value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
        </Field>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>Период (за какой месяц работы), необязательно</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <Field label="Месяц">
            <Select value={form.period_month} onChange={(e) => setForm((f) => ({ ...f, period_month: e.target.value }))}>
              <option value="">—</option>
              {MONTH_OPTIONS.map((m) => (
                <option key={m.v} value={m.v}>{m.l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Год">
            <Input
              type="number"
              min={2000}
              max={2100}
              placeholder="2026"
              value={form.period_year}
              onChange={(e) => setForm((f) => ({ ...f, period_year: e.target.value }))}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Сумма перевода *">
            <MoneyInput value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} placeholder="0" />
          </Field>
          <Field label="Валюта">
            <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </Select>
          </Field>
        </div>
        {showBudgetSplit && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: form.include_budget ? 10 : 14,
                cursor: 'pointer',
                fontSize: 13,
                color: '#334155',
              }}
            >
              <input
                type="checkbox"
                checked={form.include_budget}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    include_budget: e.target.checked,
                    budget_amount: e.target.checked ? f.budget_amount : '',
                  }))
                }
              />
              <span>
                {mode === 'employee'
                  ? 'Указать долю рекламного бюджета в переводе (остальное — услуга, попадёт в P&L). Без галочки вся сумма считается бюджетом клиента.'
                  : 'В переводе есть бюджет клиента (не учитывать в P&L и «Расходах»)'}
              </span>
            </label>
            {form.include_budget && (
              <Field label="Сумма бюджета (реклама) в этой выплате">
                <MoneyInput
                  value={form.budget_amount}
                  onChange={(v) => setForm((f) => ({ ...f, budget_amount: v }))}
                  placeholder="0"
                />
              </Field>
            )}
          </>
        )}
        <Field label={mode === 'admin' ? 'За что оплатили *' : 'Комментарий'}>
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder={mode === 'admin' ? 'Например: выплата за март, акт №…' : 'По желанию'}
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
        <Field label="Чек (PDF или фото)">
          <Input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
            onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
          />
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Удалить запись?"
        message="Строка истории выплат будет удалена. Файл чека тоже."
        confirmLabel="Удалить"
        onConfirm={runDelete}
      />
    </>
  )
}
