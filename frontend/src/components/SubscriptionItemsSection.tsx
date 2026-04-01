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

interface ItemRow {
  id: number
  category: string
  name: string
  vendor?: string | null
  amount?: string | null
  currency: string
  billing_note?: string | null
  next_due_date?: string | null
  notes?: string | null
  link_url?: string | null
  created_at: string
}

const EMPTY = {
  name: '',
  vendor: '',
  amount: '',
  currency: 'USD',
  billing_note: '',
  next_due_date: '',
  notes: '',
  link_url: '',
}

function num(v: string | null | undefined) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function SubscriptionItemsSection({
  category,
  listTitle,
}: {
  category: SubscriptionCategory
  listTitle: string
}) {
  const [rows, setRows] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<ItemRow | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ ...EMPTY })

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
    setForm({
      name: r.name,
      vendor: r.vendor ?? '',
      amount: r.amount != null ? String(r.amount) : '',
      currency: r.currency || 'USD',
      billing_note: r.billing_note ?? '',
      next_due_date: r.next_due_date ? r.next_due_date.slice(0, 10) : '',
      notes: r.notes ?? '',
      link_url: r.link_url ?? '',
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    setError('')
    if (!form.name.trim()) {
      setError('Укажите название')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        vendor: form.vendor.trim() || null,
        amount: form.amount ? Number(form.amount.replace(',', '.')) : null,
        currency: form.currency,
        billing_note: form.billing_note.trim() || null,
        next_due_date: form.next_due_date.trim() || null,
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

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1d23' }}>{listTitle}</div>
        <BtnPrimary onClick={openAdd}>+ Добавить строку</BtnPrimary>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <Th>Название</Th>
              <Th>Поставщик</Th>
              <Th>Сумма</Th>
              <Th>Периодичность</Th>
              <Th>След. оплата</Th>
              <Th>Заметки</Th>
              <Th>Ссылка</Th>
              <Th style={{ width: 88 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <Td style={{ fontWeight: 600 }}>{r.name}</Td>
                <Td style={{ color: '#64748b' }}>{r.vendor?.trim() || '—'}</Td>
                <Td style={{ fontWeight: 600 }}>
                  {num(r.amount) != null
                    ? r.currency === 'UZS'
                      ? `${formatMoneyNumber(Number(r.amount))} сум`
                      : `$${formatMoneyNumber(Number(r.amount))}`
                    : '—'}
                </Td>
                <Td style={{ color: '#64748b', fontSize: 12 }}>{r.billing_note?.trim() || '—'}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{r.next_due_date ? formatDate(r.next_due_date) : '—'}</Td>
                <Td style={{ color: '#64748b', fontSize: 12, maxWidth: 160 }}>
                  <span title={r.notes?.trim() || undefined}>{notePreview(r.notes)}</span>
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
        <Field label="Название *">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Интернет офис, Figma, SIM 7900…" />
        </Field>
        <Field label="Поставщик / оператор">
          <Input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} placeholder="Провайдер, банк, сервис" />
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
        <Field label="Периодичность">
          <Input
            value={form.billing_note}
            onChange={(e) => setForm((f) => ({ ...f, billing_note: e.target.value }))}
            placeholder="Ежемесячно, раз в год, по факту…"
          />
        </Field>
        <Field label="Следующая оплата">
          <Input type="date" value={form.next_due_date} onChange={(e) => setForm((f) => ({ ...f, next_due_date: e.target.value }))} />
        </Field>
        <Field label="Заметки">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Ответственный, тариф, комментарий"
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
