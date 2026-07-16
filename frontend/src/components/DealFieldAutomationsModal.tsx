import { useEffect, useState } from 'react'
import api from '@/lib/api'

export type DealFieldKey =
  | 'contact_name'
  | 'phone'
  | 'contact_position'
  | 'company_name'
  | 'source'
  | 'client_geo'
  | 'service_type'

type FieldMeta = { key: DealFieldKey; label: string }

type ManagerRule = {
  manager_user_id: number
  manager_name: string
  required_fields: DealFieldKey[]
}

type Catalog = {
  fields: FieldMeta[]
  managers: ManagerRule[]
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,.45)',
  zIndex: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const card: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflow: 'auto',
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 20px 50px rgba(15,23,42,.25)',
  border: '1px solid #e2e8f0',
}

export function DealFieldAutomationsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<FieldMeta[]>([])
  const [managers, setManagers] = useState<ManagerRule[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DealFieldKey[]>([])
  const [error, setError] = useState('')
  const [savedOk, setSavedOk] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setSavedOk(false)
    void (async () => {
      try {
        const r = await api.get<Catalog>('sales/deal-field-requirements')
        setFields(r.data.fields as FieldMeta[])
        setManagers(r.data.managers)
        const first = r.data.managers[0]
        if (first) {
          setSelectedId(first.manager_user_id)
          setDraft([...(first.required_fields as DealFieldKey[])])
        }
      } catch {
        setError('Не удалось загрузить настройки')
      } finally {
        setLoading(false)
      }
    })()
  }, [open])

  // Только при смене менеджера — иначе после «Сохранить» draft сбрасывался
  useEffect(() => {
    if (selectedId == null) return
    const m = managers.find((x) => x.manager_user_id === selectedId)
    if (!m) return
    setDraft([...(m.required_fields as DealFieldKey[])])
    setSavedOk(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- managers sync only on selectedId change
  }, [selectedId])

  function toggle(key: DealFieldKey) {
    setDraft((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    setSavedOk(false)
  }

  async function save() {
    if (selectedId == null) return
    setSaving(true)
    setError('')
    try {
      const r = await api.put<ManagerRule>(`sales/deal-field-requirements/${selectedId}`, {
        required_fields: draft,
      })
      setManagers((prev) =>
        prev.map((m) =>
          m.manager_user_id === selectedId
            ? { ...m, required_fields: r.data.required_fields as DealFieldKey[] }
            : m,
        ),
      )
      setSavedOk(true)
    } catch {
      setError('Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  function selectAll() {
    setDraft(fields.map((f) => f.key))
    setSavedOk(false)
  }

  function clearAll() {
    setDraft([])
    setSavedOk(false)
  }

  if (!open) return null

  const current = managers.find((m) => m.manager_user_id === selectedId)

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid #eef2f7',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
              Автоматизации · обязательные поля
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#64748b', lineHeight: 1.45, maxWidth: 380 }}>
              Доступно админу и РОП. Выберите МОПа и отметьте поля, без которых он не сможет сохранить сделку.
              Пустые обязательные поля подсветятся красным. Обычные МОПы эти настройки не меняют.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: '1px solid #e2e8f0',
              background: '#fff',
              borderRadius: 8,
              width: 32,
              height: 32,
              cursor: 'pointer',
              color: '#64748b',
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ color: '#64748b', fontSize: 14 }}>Загрузка…</div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Менеджер
                </div>
                <select
                  value={selectedId ?? ''}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #d1d9e6',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 15,
                    fontFamily: 'inherit',
                    background: '#fff',
                  }}
                >
                  {managers.map((m) => (
                    <option key={m.manager_user_id} value={m.manager_user_id}>
                      {m.manager_name}
                      {m.required_fields.length ? ` · ${m.required_fields.length} обяз.` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    Обязательные поля {current ? `· ${current.manager_name}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={selectAll} style={linkBtn}>Все</button>
                    <button type="button" onClick={clearAll} style={linkBtn}>Сбросить</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {fields.map((f) => {
                    const on = draft.includes(f.key)
                    return (
                      <label
                        key={f.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: `1px solid ${on ? '#86efac' : '#e2e8f0'}`,
                          background: on ? '#f0fdf4' : '#fff',
                          cursor: 'pointer',
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#0f172a',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(f.key)}
                          style={{ width: 16, height: 16 }}
                        />
                        {f.label}
                      </label>
                    )
                  })}
                </div>
              </div>

              {error && <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 600 }}>{error}</div>}
              {savedOk && <div style={{ color: '#15803d', fontSize: 13, fontWeight: 600 }}>Сохранено</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    borderRadius: 10,
                    padding: '10px 16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || selectedId == null}
                  style={{
                    border: 'none',
                    background: '#1a6b3c',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '10px 16px',
                    fontWeight: 700,
                    cursor: saving ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? '…' : 'Сохранить'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'none',
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
}
