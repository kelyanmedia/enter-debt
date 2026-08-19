import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import DatePicker from '@/components/DatePicker'
import api from '@/lib/api'
import { useAuth } from '@/context/AuthContext'
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
} from '@/components/ui'

interface CompanyAsset {
  id: number
  name: string
  purchased_on?: string | null
  serial_number?: string | null
  seller_contacts?: string | null
  notes?: string | null
  assigned_to_user_id?: number | null
  assigned_to_user_name?: string | null
  issued_on?: string | null
  issued_items?: string | null
  storage_location?: string | null
  icloud_login?: string | null
  icloud_password?: string | null
  has_icloud_password: boolean
  has_photo: boolean
  created_at?: string | null
}

interface EmployeeOption {
  id: number
  name: string
  role?: string
}

const EMPTY_FORM = {
  name: '',
  purchased_on: '',
  serial_number: '',
  seller_contacts: '',
  notes: '',
  assigned_to_user_id: '',
  issued_on: '',
  issued_items: '',
  storage_location: '',
  icloud_login: '',
  icloud_password: '',
  clear_icloud_password: false,
  file: null as File | null,
  remove_photo: false,
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function AssetPhoto({
  assetId,
  hasPhoto,
  alt,
  style,
}: {
  assetId: number
  hasPhoto: boolean
  alt: string
  style?: CSSProperties
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!hasPhoto) {
      setSrc(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get(`company-assets/${assetId}/photo`, { responseType: 'blob' })
        if (cancelled) return
        revoked = URL.createObjectURL(r.data)
        setSrc(revoked)
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [assetId, hasPhoto])

  if (!hasPhoto || failed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 100%)',
          color: '#94a3b8',
          fontSize: 36,
          ...style,
        }}
        aria-hidden
      >
        🏷️
      </div>
    )
  }
  if (!src) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          color: '#94a3b8',
          fontSize: 12,
          ...style,
        }}
      >
        …
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
        ...style,
      }}
    />
  )
}

export function CompanyAssetsSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [rows, setRows] = useState<CompanyAsset[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [detail, setDetail] = useState<CompanyAsset | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CompanyAsset | null>(null)
  const [showIcloudPassword, setShowIcloudPassword] = useState(false)

  const editingAsset = editingId == null ? null : rows.find((row) => row.id === editingId) || null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get<CompanyAsset[]>('company-assets')
      setRows(r.data)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isAdmin) return
    void api.get<EmployeeOption[]>('users').then((r) => setEmployees(r.data)).catch(() => setEmployees([]))
  }, [isAdmin])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.name, r.serial_number, r.seller_contacts, r.notes, r.assigned_to_user_name, r.issued_items, r.storage_location, r.icloud_login]
        .map((x) => String(x || '').toLowerCase())
        .some((h) => h.includes(q)),
    )
  }, [rows, search])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, purchased_on: todayYmd() })
    setShowIcloudPassword(false)
    setModalOpen(true)
  }

  const openEdit = (row: CompanyAsset) => {
    setEditingId(row.id)
    setForm({
      name: row.name,
      purchased_on: row.purchased_on || '',
      serial_number: row.serial_number || '',
      seller_contacts: row.seller_contacts || '',
      notes: row.notes || '',
      assigned_to_user_id: row.assigned_to_user_id ? String(row.assigned_to_user_id) : '',
      issued_on: row.issued_on || '',
      issued_items: row.issued_items || '',
      storage_location: row.storage_location || '',
      icloud_login: row.icloud_login || '',
      icloud_password: '',
      clear_icloud_password: false,
      file: null,
      remove_photo: false,
    })
    setModalOpen(true)
    setDetail(null)
    setShowIcloudPassword(false)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const save = async () => {
    if (!form.name.trim()) {
      alert('Укажите название актива')
      return
    }
    const fd = new FormData()
    fd.append('name', form.name.trim())
    if (form.purchased_on) fd.append('purchased_on', form.purchased_on)
    fd.append('serial_number', form.serial_number.trim())
    fd.append('seller_contacts', form.seller_contacts.trim())
    fd.append('notes', form.notes.trim())
    if (form.assigned_to_user_id) fd.append('assigned_to_user_id', form.assigned_to_user_id)
    else if (editingId != null) fd.append('clear_assigned_to_user', 'true')
    if (form.issued_on) fd.append('issued_on', form.issued_on)
    fd.append('issued_items', form.issued_items.trim())
    fd.append('storage_location', form.storage_location.trim())
    fd.append('icloud_login', form.icloud_login.trim())
    if (form.icloud_password) fd.append('icloud_password', form.icloud_password)
    if (editingId != null && form.clear_icloud_password) fd.append('clear_icloud_password', 'true')
    if (form.file) fd.append('photo', form.file)
    if (editingId != null && form.remove_photo) fd.append('remove_photo', 'true')
    setSaving(true)
    try {
      if (editingId == null) {
        await api.post('company-assets', fd)
      } else {
        await api.patch(`company-assets/${editingId}`, fd)
      }
      closeModal()
      await load()
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(typeof d === 'string' ? d : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleteTarget) return
    try {
      await api.delete(`company-assets/${deleteTarget.id}`)
      setDeleteTarget(null)
      if (detail?.id === deleteTarget.id) setDetail(null)
      await load()
    } catch {
      alert('Не удалось удалить')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        {isAdmin ? (
          <BtnPrimary type="button" onClick={openCreate}>
            Добавить имущество
          </BtnPrimary>
        ) : null}
        <BtnOutline type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Загрузка…' : 'Обновить'}
        </BtnOutline>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск: стол, серийный номер, продавец…"
          style={{ flex: '1 1 220px', maxWidth: 360 }}
        />
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {filtered.length} {filtered.length === 1 ? 'актив' : filtered.length < 5 ? 'актива' : 'активов'}
        </span>
      </div>

      {!loading && filtered.length === 0 ? (
        <Card style={{ padding: 32 }}>
          <Empty
            text={
              search.trim()
                ? 'Ничего не найдено. Измените запрос или добавьте новый актив.'
                : 'Пока нет записей. Добавьте стол, пенал, технику — с датой, фото, серийным номером и контактами продавца.'
            }
          />
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((r) => (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDetail(r)
                }
              }}
              style={{
                background: '#fff',
                border: '1px solid #e8e9ef',
                borderRadius: 14,
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'box-shadow .15s, transform .15s',
              }}
              onClick={() => setDetail(r)}
            >
              <div style={{ height: 168, overflow: 'hidden', borderBottom: '1px solid #eef2f7' }}>
                <AssetPhoto assetId={r.id} hasPhoto={r.has_photo} alt={r.name} />
              </div>
              <div style={{ padding: '14px 16px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1d23', lineHeight: 1.35 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{formatDate(r.purchased_on)}</div>
                  </div>
                  {isAdmin ? (
                    <BtnIconEdit
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(r)
                      }}
                      title="Редактировать"
                    />
                  ) : null}
                </div>
                {r.serial_number?.trim() ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
                    <span style={{ color: '#94a3b8' }}>S/N:</span> {r.serial_number}
                  </div>
                ) : null}
                {r.assigned_to_user_name?.trim() ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#166534', fontWeight: 600 }}>
                    Выдано: {r.assigned_to_user_name}{r.issued_on ? ` · ${formatDate(r.issued_on)}` : ''}
                  </div>
                ) : null}
                {r.storage_location?.trim() ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
                    <span style={{ color: '#94a3b8' }}>Место:</span> {r.storage_location}
                  </div>
                ) : null}
                {r.seller_contacts?.trim() ? (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: '#475569',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={r.seller_contacts}
                  >
                    <span style={{ color: '#94a3b8' }}>Продавец:</span> {r.seller_contacts}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null)
          setShowIcloudPassword(false)
        }}
        title={detail?.name || 'Имущество'}
        width={640}
        footer={
          <>
            {isAdmin && detail ? (
              <>
                <BtnOutline type="button" onClick={() => openEdit(detail)} style={{ color: '#b91c1c', marginRight: 'auto' }}>
                  Редактировать
                </BtnOutline>
                <BtnOutline type="button" onClick={() => setDeleteTarget(detail)} style={{ color: '#b91c1c' }}>
                  Удалить
                </BtnOutline>
              </>
            ) : null}
            <BtnOutline type="button" onClick={() => { setDetail(null); setShowIcloudPassword(false) }}>
              Закрыть
            </BtnOutline>
          </>
        }
      >
        {detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {detail.has_photo ? (
              <div
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid #e8e9ef',
                  maxHeight: 320,
                  background: '#f8fafc',
                }}
              >
                <AssetPhoto assetId={detail.id} hasPhoto={detail.has_photo} alt={detail.name} style={{ maxHeight: 320, objectFit: 'contain' }} />
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <Field label="Дата покупки">
                <Input value={formatDate(detail.purchased_on)} readOnly style={{ background: '#f8fafc' }} />
              </Field>
              <Field label="Серийный номер">
                <Input value={detail.serial_number?.trim() || '—'} readOnly style={{ background: '#f8fafc' }} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <Field label="Выдано сотруднику">
                <Input value={detail.assigned_to_user_name?.trim() || 'Не выдано'} readOnly style={{ background: '#f8fafc' }} />
              </Field>
              <Field label="Дата выдачи">
                <Input value={formatDate(detail.issued_on)} readOnly style={{ background: '#f8fafc' }} />
              </Field>
            </div>
            <Field label="Что выдано вместе с имуществом">
              <textarea
                readOnly
                value={detail.issued_items?.trim() || '—'}
                style={{ width: '100%', minHeight: 64, border: '1px solid #e8e9ef', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, background: '#f8fafc', fontFamily: 'inherit', resize: 'vertical' }}
              />
            </Field>
            <Field label="Место / хранение">
              <Input value={detail.storage_location?.trim() || '—'} readOnly style={{ background: '#f8fafc' }} />
            </Field>
            <div style={{ padding: 12, borderRadius: 10, background: '#f8fafc', border: '1px solid #e8e9ef' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#334155', marginBottom: 8 }}>iCloud для удалённого управления</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <Field label="Apple ID / почта">
                  <Input value={detail.icloud_login?.trim() || '—'} readOnly style={{ background: '#fff' }} />
                </Field>
                <Field label="Пароль iCloud">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Input value={showIcloudPassword ? (detail.icloud_password || '—') : (detail.has_icloud_password ? '••••••••••' : '—')} readOnly type={showIcloudPassword ? 'text' : 'password'} style={{ background: '#fff' }} />
                    {isAdmin && detail.has_icloud_password ? (
                      <BtnOutline type="button" onClick={() => setShowIcloudPassword((v) => !v)}>
                        {showIcloudPassword ? 'Скрыть' : 'Показать'}
                      </BtnOutline>
                    ) : null}
                  </div>
                </Field>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>Логин и пароль показываются только администратору.</div>
            </div>
            <Field label="Контакты продавца">
              <Input value={detail.seller_contacts?.trim() || '—'} readOnly style={{ background: '#f8fafc' }} />
            </Field>
            <Field label="Комментарий">
              <textarea
                readOnly
                value={detail.notes?.trim() || '—'}
                style={{
                  width: '100%',
                  minHeight: 88,
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: '9px 12px',
                  fontSize: 13.5,
                  background: '#f8fafc',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId == null ? 'Новый актив' : 'Редактировать имущество'}
        width={560}
        footer={
          <>
            <BtnOutline type="button" onClick={closeModal} disabled={saving}>
              Отмена
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        <Field label="Что куплено">
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Например: стол, пенал, монитор…"
            autoFocus
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Дата покупки">
            <DatePicker value={form.purchased_on} onChange={(v) => setForm((f) => ({ ...f, purchased_on: v }))} />
          </Field>
          <Field label="Серийный номер">
            <Input
              value={form.serial_number}
              onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))}
              placeholder="Необязательно"
            />
          </Field>
        </div>
        <Field label="Контакты продавца">
          <Input
            value={form.seller_contacts}
            onChange={(e) => setForm((f) => ({ ...f, seller_contacts: e.target.value }))}
            placeholder="Телефон, Telegram, магазин…"
          />
        </Field>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid #dbeafe', background: '#f8fbff', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#1e3a5f' }}>Выдача сотруднику</div>
            <div style={{ marginTop: 3, fontSize: 11, color: '#64748b' }}>Фиксируйте ответственного, дату выдачи и весь комплект, чтобы быстро найти имущество.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Сотрудник">
              <select
                value={form.assigned_to_user_id}
                onChange={(e) => setForm((f) => ({ ...f, assigned_to_user_id: e.target.value }))}
                style={{ width: '100%', height: 38, border: '1px solid #e8e9ef', borderRadius: 9, padding: '0 10px', background: '#fff', fontSize: 13.5 }}
              >
                <option value="">Не выдано / на складе</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name}{employee.role ? ` · ${employee.role}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Дата выдачи">
              <DatePicker value={form.issued_on} onChange={(v) => setForm((f) => ({ ...f, issued_on: v }))} />
            </Field>
          </div>
          <Field label="Что выдано вместе с имуществом">
            <textarea
              value={form.issued_items}
              onChange={(e) => setForm((f) => ({ ...f, issued_items: e.target.value }))}
              placeholder="Например: MacBook, зарядка 67W, кабель USB‑C, чехол, мышь…"
              style={{ width: '100%', minHeight: 70, border: '1px solid #e8e9ef', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', background: '#fff' }}
            />
          </Field>
          <Field label="Место / хранение">
            <Input
              value={form.storage_location}
              onChange={(e) => setForm((f) => ({ ...f, storage_location: e.target.value }))}
              placeholder="Например: у Жамшида, офис — шкаф 2, склад…"
            />
          </Field>
        </div>
        <div style={{ padding: 14, borderRadius: 10, border: '1px solid #fde68a', background: '#fffbeb', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>iCloud для удалённого отключения</div>
            <div style={{ marginTop: 3, fontSize: 11, color: '#78716c' }}>Данные видны только администраторам. Используйте корпоративный Apple ID, а не личный сотрудника.</div>
          </div>
          <Field label="Apple ID / почта iCloud">
            <Input
              value={form.icloud_login}
              onChange={(e) => setForm((f) => ({ ...f, icloud_login: e.target.value }))}
              placeholder="company-apple@icloud.com"
              autoComplete="off"
            />
          </Field>
          <Field label={editingId == null ? 'Пароль iCloud' : 'Новый пароль iCloud'}>
            <Input
              type="password"
              value={form.icloud_password}
              onChange={(e) => setForm((f) => ({ ...f, icloud_password: e.target.value, clear_icloud_password: false }))}
              placeholder={editingId != null && editingAsset?.has_icloud_password ? 'Оставьте пустым, чтобы не менять' : 'Сохранится в зашифрованном виде'}
              autoComplete="new-password"
            />
          </Field>
          {editingId != null && editingAsset?.has_icloud_password ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#92400e' }}>
              <input type="checkbox" checked={form.clear_icloud_password} onChange={(e) => setForm((f) => ({ ...f, clear_icloud_password: e.target.checked, icloud_password: '' }))} />
              Удалить сохранённый пароль iCloud
            </label>
          ) : null}
        </div>
        <Field label="Доп. комментарий">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Гарантия, состояние, отметка о возврате или другая важная информация…"
            style={{
              width: '100%',
              minHeight: 76,
              border: '1px solid #e8e9ef',
              borderRadius: 9,
              padding: '9px 12px',
              fontSize: 13.5,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </Field>
        <Field label="Фото">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              setForm((f) => ({ ...f, file, remove_photo: false }))
            }}
            style={{ fontSize: 13 }}
          />
          {editingId != null && !form.file ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: '#64748b' }}>
              <input
                type="checkbox"
                checked={form.remove_photo}
                onChange={(e) => setForm((f) => ({ ...f, remove_photo: e.target.checked }))}
              />
              Удалить текущее фото
            </label>
          ) : null}
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteTarget !== null}
        title="Удалить запись?"
        message={deleteTarget ? `«${deleteTarget.name}» будет удалено без восстановления.` : ''}
        confirmLabel="Удалить"
        danger
        onConfirm={() => void remove()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}
