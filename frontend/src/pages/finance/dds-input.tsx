import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import {
  PageHeader,
  Card,
  BtnOutline,
  BtnPrimary,
  Modal,
  Field,
  Input,
  Select,
  MoneyInput,
  ConfirmModal,
} from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'

interface Meta {
  payment_methods: { id: string; label: string }[]
  expense_categories: { slug: string; label: string }[]
  income_categories: { slug: string; label: string }[]
}

function currentYMD() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const emptyForm = {
  entry_date: currentYMD(),
  label: '',
  amount_uzs: '',
  amount_usd: '',
  payment_method: 'transfer',
  flow_category: '',
  recipient: '',
  notes: '',
}

export default function DdsInputPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [modalDir, setModalDir] = useState<'income' | 'expense' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')

  const allowed = user?.role === 'administration'

  useEffect(() => {
    if (!loading && user && !allowed) {
      router.replace('/debitor')
    }
  }, [loading, user, allowed, router])

  const loadMeta = useCallback(() => {
    api
      .get<Meta>('finance/cash-flow/meta')
      .then((r) => setMeta(r.data))
      .catch(() => setMeta(null))
  }, [])

  useEffect(() => {
    if (!loading && allowed) loadMeta()
  }, [loading, allowed, loadMeta])

  const openModal = (dir: 'income' | 'expense') => {
    setModalDir(dir)
    setForm({ ...emptyForm, entry_date: currentYMD(), payment_method: 'transfer', flow_category: '' })
    setError('')
    setDoneMsg('')
  }

  const requestSave = () => {
    if (!form.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(form.entry_date)) {
      setError('Укажите дату операции (день, месяц, год)')
      return
    }
    if (!form.label.trim()) {
      setError('Укажите название / назначение')
      return
    }
    if (!form.flow_category.trim()) {
      setError(modalDir === 'income' ? 'Выберите категорию прихода' : 'Выберите категорию расхода')
      return
    }
    setError('')
    setConfirmOpen(true)
  }

  const doSave = async () => {
    if (!modalDir) return
    setConfirmOpen(false)
    setSaving(true)
    setError('')
    try {
      await api.post('finance/cash-flow/entries', {
        entry_date: form.entry_date,
        direction: modalDir,
        label: form.label.trim(),
        amount_uzs: form.amount_uzs || '0',
        amount_usd: form.amount_usd || '0',
        payment_method: form.payment_method,
        flow_category: form.flow_category.trim().toLowerCase(),
        recipient: form.recipient.trim() || null,
        notes: form.notes.trim() || null,
        payment_id: null,
      })
      setModalDir(null)
      setDoneMsg('Запись добавлена в движение денежных средств (ДДС).')
      setForm(emptyForm)
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
      setError(typeof d === 'string' ? d : d ? JSON.stringify(d) : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !user) return null
  if (!allowed) return null

  const catOptions =
    modalDir === 'income'
      ? meta?.income_categories ?? []
      : meta?.expense_categories ?? []

  return (
    <Layout>
      <PageHeader
        title="Ввод ДДС"
        subtitle="Только добавление строк прихода и расхода. Отчёт ДДС и остальной раздел «Финансы» недоступны."
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1, maxWidth: 900 }}>
        {doneMsg && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 10,
              background: '#e8f5ee',
              color: '#166534',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {doneMsg}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18 }}>
          <button
            type="button"
            onClick={() => openModal('income')}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              border: '2px solid #bbf7d0',
              borderRadius: 14,
              padding: 0,
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,.06)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: '1px solid #ecfdf5',
                background: 'linear-gradient(180deg, #f0fdf4 0%, #fff 100%)',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '.06em', color: '#15803d' }}>ПРИХОД</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#166534',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '6px 12px',
                  background: '#fff',
                }}
              >
                + Строка
              </span>
            </div>
            <div style={{ padding: '16px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              Нажмите, чтобы ввести строку <b>прихода</b> с датой операции (как в учёте выплат): месяц в ДДС возьмётся из этой даты.
            </div>
          </button>

          <button
            type="button"
            onClick={() => openModal('expense')}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              border: '2px solid #fed7aa',
              borderRadius: 14,
              padding: 0,
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,.06)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderBottom: '1px solid #fff7ed',
                background: 'linear-gradient(180deg, #fffbeb 0%, #fff 100%)',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '.06em', color: '#c2410c' }}>РАСХОД</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#c2410c',
                  border: '1px solid #fed7aa',
                  borderRadius: 8,
                  padding: '6px 12px',
                  background: '#fff',
                }}
              >
                + Строка
              </span>
            </div>
            <div style={{ padding: '16px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
              Нажмите, чтобы ввести строку <b>расхода</b> с датой операции (как в учёте выплат): месяц в ДДС возьмётся из этой даты.
            </div>
          </button>
        </div>
      </div>

      <Modal
        open={modalDir !== null}
        onClose={() => !saving && setModalDir(null)}
        title={modalDir === 'income' ? 'Приход (ДДС)' : 'Расход (ДДС)'}
        footer={
          <>
            <BtnOutline onClick={() => !saving && setModalDir(null)}>Отмена</BtnOutline>
            <BtnPrimary onClick={requestSave} disabled={saving}>
              {saving ? 'Отправка…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        {error && (
          <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#8a8fa8', marginBottom: 12 }}>
          Дата операции сохраняется в базе; строка попадает в месяц ДДС по этой дате (календарный месяц). Просмотр сводного отчёта для этой роли не открывается.
        </div>
        <Field label="Дата операции *">
          <Input
            type="date"
            value={form.entry_date}
            onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
          />
        </Field>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.45, marginTop: -6, marginBottom: 4 }}>
          День, месяц и год — как при отметке фактических выплат в разделе расходов.
        </div>
        <Field label="Название / назначение *">
          <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Кратко, как в учёте" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Сумма, UZS">
            <MoneyInput value={form.amount_uzs} onChange={(v) => setForm((f) => ({ ...f, amount_uzs: v }))} />
          </Field>
          <Field label="Сумма, USD">
            <MoneyInput value={form.amount_usd} onChange={(v) => setForm((f) => ({ ...f, amount_usd: v }))} />
          </Field>
        </div>
        <Field label="Форма оплаты">
          <Select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
            {(meta?.payment_methods ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={modalDir === 'income' ? 'Категория прихода *' : 'Категория расхода *'}>
          <Select value={form.flow_category} onChange={(e) => setForm((f) => ({ ...f, flow_category: e.target.value }))}>
            <option value="">— Выберите —</option>
            {catOptions.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Получатель / контрагент (необязательно)">
          <Input value={form.recipient} onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))} placeholder="Кому / от кого" />
        </Field>
        <Field label="Комментарий (необязательно)">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Кратко" />
        </Field>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Проверка перед отправкой"
        message="Вы точно всё проверили? Строка будет добавлена в ДДС в календарный месяц выбранной даты."
        confirmLabel="Да, отправить"
        onConfirm={doSave}
        danger={false}
      />
    </Layout>
  )
}
