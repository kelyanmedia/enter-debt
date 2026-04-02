import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import {
  BtnIconEdit,
  BtnOutline,
  BtnPrimary,
  Card,
  ConfirmModal,
  Empty,
  Field,
  Input,
  Modal,
  Select,
} from '@/components/ui'

type AccessCategory = 'email' | 'telegram' | 'device' | 'service'

interface AccessEntry {
  id: number
  employee_name: string
  category: AccessCategory
  title: string
  service_type?: string | null
  shared_with_administration?: boolean
  login?: string | null
  password?: string | null
  phone_number?: string | null
  twofa_code?: string | null
  reserve_email?: string | null
  device_model?: string | null
  serial_number?: string | null
  charge_cycles?: number | null
  photo_url?: string | null
  notes?: string | null
}

const EMPTY = {
  employee_name: '',
  category: 'email' as AccessCategory,
  title: '',
  service_type: '',
  shared_with_administration: false,
  login: '',
  password: '',
  phone_number: '',
  twofa_code: '',
  reserve_email: '',
  device_model: '',
  serial_number: '',
  charge_cycles: '',
  photo_url: '',
  notes: '',
}

const CAT_RU: Record<AccessCategory, string> = {
  email: 'Почта',
  telegram: 'Телеграм',
  device: 'Техника',
  service: 'Сервис',
}

function CopyBtn({ value }: { value?: string | null }) {
  if (!value?.trim()) return <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(value)}
      style={{
        border: '1px solid #d6dae5',
        background: '#fff',
        borderRadius: 8,
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
      }}
      title="Скопировать"
    >
      Копировать
    </button>
  )
}

function SecretValue({ value }: { value?: string | null }) {
  const [hovered, setHovered] = useState(false)
  if (!value?.trim()) return <span style={{ color: '#94a3b8' }}>—</span>
  const hidden = '•'.repeat(Math.max(8, Math.min(16, value.length)))
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hovered ? '' : 'Наведите курсор, чтобы показать'}
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: hovered ? 0 : 1,
        color: hovered ? '#1a1d23' : '#64748b',
        userSelect: 'none',
      }}
    >
      {hovered ? value : hidden}
    </span>
  )
}

function InfoField({
  label,
  value,
  copy,
  secret,
}: {
  label: string
  value?: string | null
  copy?: boolean
  secret?: boolean
}) {
  return (
    <div
      style={{
        fontSize: 12,
        background: '#f8fafc',
        border: '1px solid #e8e9ef',
        borderRadius: 8,
        padding: '7px 8px',
        minHeight: 34,
      }}
    >
      <span style={{ color: '#64748b', marginRight: 4 }}>{label}:</span>
      {secret ? <SecretValue value={value} /> : <span>{value?.trim() || '—'}</span>}
      {copy && <span style={{ marginLeft: 6 }}><CopyBtn value={value} /></span>}
    </div>
  )
}

export function AccessEntriesSection({ view = 'all' }: { view?: 'all' | 'employees' | 'services' }) {
  const [canEdit, setCanEdit] = useState(true)
  const [rows, setRows] = useState<AccessEntry[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<AccessEntry | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ ...EMPTY })

  const load = useCallback(() => {
    setLoading(true)
    api.get('auth/me').then((r) => setCanEdit(r.data?.role === 'admin')).catch(() => setCanEdit(false))
    api
      .get<AccessEntry[]>('access-entries')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const serviceRows = useMemo(
    () => rows.filter((r) => r.category === 'service'),
    [rows],
  )
  const employeeRows = useMemo(
    () => rows.filter((r) => r.category !== 'service'),
    [rows],
  )
  const employeeGrouped = useMemo(() => {
    const out = new Map<string, AccessEntry[]>()
    for (const row of employeeRows) {
      const list = out.get(row.employee_name) || []
      list.push(row)
      out.set(row.employee_name, list)
    }
    return Array.from(out.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'))
  }, [employeeRows])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setError('')
    setModal(true)
  }

  const openAddService = () => {
    setEditing(null)
    setForm({ ...EMPTY, category: 'service' })
    setError('')
    setModal(true)
  }

  const openEdit = (row: AccessEntry) => {
    setEditing(row)
    setForm({
      employee_name: row.employee_name || '',
      category: row.category || 'email',
      title: row.title || '',
      service_type: row.service_type || '',
      shared_with_administration: !!row.shared_with_administration,
      login: row.login || '',
      password: row.password || '',
      phone_number: row.phone_number || '',
      twofa_code: row.twofa_code || '',
      reserve_email: row.reserve_email || '',
      device_model: row.device_model || '',
      serial_number: row.serial_number || '',
      charge_cycles: row.charge_cycles != null ? String(row.charge_cycles) : '',
      photo_url: row.photo_url || '',
      notes: row.notes || '',
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    setError('')
    if (!form.employee_name.trim()) return setError('Укажите сотрудника')
    if (!form.title.trim()) return setError('Укажите название доступа')
    setSaving(true)
    const payload = {
      employee_name: form.employee_name.trim(),
      category: form.category,
      title: form.title.trim(),
      service_type: form.service_type.trim() || null,
      shared_with_administration: !!form.shared_with_administration,
      login: form.login.trim() || null,
      password: form.password.trim() || null,
      phone_number: form.phone_number.trim() || null,
      twofa_code: form.twofa_code.trim() || null,
      reserve_email: form.reserve_email.trim() || null,
      device_model: form.device_model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      charge_cycles: form.charge_cycles.trim() ? Number(form.charge_cycles) : null,
      photo_url: form.photo_url.trim() || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) await api.patch(`access-entries/${editing.id}`, payload)
      else await api.post('access-entries', payload)
      setModal(false)
      load()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const runDelete = async () => {
    if (deleteId == null) return
    try {
      await api.delete(`access-entries/${deleteId}`)
      setDeleteId(null)
      load()
    } catch {
      /* */
    }
  }

  const isDevice = form.category === 'device'
  const isTelegram = form.category === 'telegram'
  const isService = form.category === 'service'
  const showEmployees = view !== 'services'
  const showServices = view !== 'employees'
  const employeesOnlyLayout = view === 'employees'
  const servicesOnlyLayout = view === 'services'

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: servicesOnlyLayout ? 'minmax(0, 1fr)' : employeesOnlyLayout ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(340px, 1fr)',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {showEmployees && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Список доступов сотрудников</div>
            {canEdit && <BtnPrimary onClick={openAdd}>+ Добавить доступ</BtnPrimary>}
          </div>

          {rows.length === 0 && !loading && <Card><Empty text="Пока нет доступов — добавьте первую запись" /></Card>}
          {loading && <Card><div style={{ color: '#8a8fa8', fontSize: 13 }}>Загрузка…</div></Card>}

          {employeeGrouped.map(([employee, items]) => (
            <Card key={employee} style={{ marginBottom: 12, padding: '14px 16px', background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)' }}>
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 17 }}>{employee}</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {items.map((r) => (
                  <div key={r.id} style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: '10px 12px', background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 11, color: '#1a6b3c', marginRight: 8, fontWeight: 700, background: '#e8f5ee', padding: '2px 8px', borderRadius: 999 }}>
                          {CAT_RU[r.category]}
                        </span>
                        <span style={{ fontWeight: 600 }}>{r.title}</span>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <BtnIconEdit onClick={() => openEdit(r)} />
                          <BtnOutline onClick={() => setDeleteId(r.id)} style={{ padding: '4px 8px', color: '#e84040' }}>✕</BtnOutline>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
                      <InfoField label="Логин" value={r.login} copy />
                      <InfoField label="Пароль" value={r.password} copy secret />
                      <InfoField label="Телефон" value={r.phone_number} copy />
                      <InfoField label="2FA" value={r.twofa_code} copy secret />
                      <InfoField label="Резервная почта" value={r.reserve_email} copy />
                      <InfoField label="Ноутбук" value={r.device_model} />
                      <InfoField label="Серия" value={r.serial_number} />
                      <InfoField label="Циклы зарядки" value={r.charge_cycles == null ? null : String(r.charge_cycles)} />
                      <div style={{ fontSize: 12 }}>
                        <b>Фото:</b>{' '}
                        {r.photo_url ? <a href={r.photo_url} target="_blank" rel="noreferrer">открыть</a> : '—'}
                      </div>
                    </div>
                    {r.notes?.trim() && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap' }}>
                        {r.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
        )}

        {showServices && (
        <div>
          <Card style={{ padding: '12px 14px', position: servicesOnlyLayout ? 'relative' : 'sticky', top: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Доступы сервисов</div>
              {canEdit && (
                <BtnPrimary onClick={openAddService} style={{ padding: '6px 10px', fontSize: 12 }}>
                  + Сервис
                </BtnPrimary>
              )}
            </div>
            {serviceRows.length === 0 ? (
              <Empty text="Пока нет сервисных доступов" />
            ) : (
              <div style={{ display: 'grid', gap: 8, maxHeight: '70vh', overflowY: 'auto', paddingRight: 2 }}>
                {serviceRows.map((r) => (
                  <div key={r.id} style={{ border: '1px solid #e8e9ef', borderRadius: 10, padding: '10px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{r.title}</div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <BtnIconEdit onClick={() => openEdit(r)} />
                          <BtnOutline onClick={() => setDeleteId(r.id)} style={{ padding: '4px 8px', color: '#e84040' }}>✕</BtnOutline>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>Тип: {r.service_type || '—'}</div>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <InfoField label="Логин" value={r.login} copy />
                      <InfoField label="Пароль" value={r.password} copy secret />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Редактировать доступ' : 'Новый доступ'}
        footer={(
          <>
            <BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline>
            <BtnPrimary onClick={() => void save()} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</BtnPrimary>
          </>
        )}
      >
        {error && <div style={{ marginBottom: 10, color: '#e84040', fontSize: 13 }}>{error}</div>}
        <Field label="Сотрудник *">
          <Input value={form.employee_name} onChange={(e) => setForm((f) => ({ ...f, employee_name: e.target.value }))} placeholder="Имя сотрудника" />
        </Field>
        <Field label="Категория *">
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as AccessCategory }))}>
            <option value="email">Почта</option>
            <option value="telegram">Телеграм</option>
            <option value="device">Техника</option>
            <option value="service">Сервис</option>
          </Select>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.shared_with_administration}
            onChange={(e) => setForm((f) => ({ ...f, shared_with_administration: e.target.checked }))}
          />
          Дать доступ роли «Администрация» к этой записи
        </label>
        <Field label="Название / сервис *">
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Gmail, Telegram, MacBook Pro..." />
        </Field>
        {isService && (
          <Field label="Тип сервиса">
            <Input
              value={form.service_type}
              onChange={(e) => setForm((f) => ({ ...f, service_type: e.target.value }))}
              placeholder="SaaS / Хостинг / Почта / CRM"
            />
          </Field>
        )}
        <Field label="Логин">
          <Input value={form.login} onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))} />
        </Field>
        <Field label="Пароль">
          <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        </Field>
        {(isTelegram || form.category === 'service') && (
          <>
            <Field label="Телефон">
              <Input value={form.phone_number} onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))} />
            </Field>
            <Field label="Код/пароль 2FA">
              <Input type="password" value={form.twofa_code} onChange={(e) => setForm((f) => ({ ...f, twofa_code: e.target.value }))} />
            </Field>
            <Field label="Резервная почта">
              <Input value={form.reserve_email} onChange={(e) => setForm((f) => ({ ...f, reserve_email: e.target.value }))} />
            </Field>
          </>
        )}
        {isDevice && (
          <>
            <Field label="Модель ноутбука/техники">
              <Input value={form.device_model} onChange={(e) => setForm((f) => ({ ...f, device_model: e.target.value }))} />
            </Field>
            <Field label="Серийный номер">
              <Input value={form.serial_number} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))} />
            </Field>
            <Field label="Циклы зарядки">
              <Input value={form.charge_cycles} onChange={(e) => setForm((f) => ({ ...f, charge_cycles: e.target.value }))} inputMode="numeric" />
            </Field>
            <Field label="Фото (ссылка)">
              <Input value={form.photo_url} onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value }))} placeholder="https://..." />
            </Field>
          </>
        )}
        <Field label="Заметки / данные для копирования">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e8e9ef', borderRadius: 10, padding: '10px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
            placeholder="Можно вставить многострочный текст: логины, пароли, комментарии..."
          />
        </Field>
      </Modal>

      {canEdit && (
        <ConfirmModal
          open={deleteId !== null}
          onClose={() => setDeleteId(null)}
          title="Удалить доступ?"
          message="Запись будет удалена без восстановления."
          confirmLabel="Удалить"
          onConfirm={runDelete}
        />
      )}
    </>
  )
}
