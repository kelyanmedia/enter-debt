import { useEffect, useState } from 'react'
import { Modal, BtnPrimary } from '@/components/ui'
import api from '@/lib/api'

const MONTH_LABELS = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
]

const LTV_BUCKETS: { key: string; label: string }[] = [
  { key: 'lt_3', label: 'Меньше 3 мес.' },
  { key: 'm3_6', label: 'От 3 до 6 мес.' },
  { key: 'm6_9', label: 'От 6 до 9 мес.' },
  { key: 'm9_12', label: 'От 9 до 12 мес.' },
  { key: 'm12_18', label: 'От 12 до 18 мес.' },
  { key: 'gte_18', label: 'Больше 18 мес.' },
]

export function CeoEditPencil({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title || 'Редактировать данные за год'}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 10,
        border: '1px solid #e8e9ef',
        background: '#fff',
        cursor: 'pointer',
        color: '#64748b',
        flexShrink: 0,
        transition: 'background .15s, color .15s, border-color .15s, box-shadow .15s',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      }}
      onMouseEnter={e => {
        const t = e.currentTarget
        t.style.background = '#eff6ff'
        t.style.color = '#2563eb'
        t.style.borderColor = '#93c5fd'
        t.style.boxShadow = '0 2px 8px rgba(37,99,235,.12)'
      }}
      onMouseLeave={e => {
        const t = e.currentTarget
        t.style.background = '#fff'
        t.style.color = '#64748b'
        t.style.borderColor = '#e8e9ef'
        t.style.boxShadow = '0 1px 2px rgba(0,0,0,.04)'
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  )
}

type MetricKind = 'client_history' | 'turnover' | 'ltv'

export function CeoMetricEditModal({
  open,
  onClose,
  metric,
  year,
  initialMonths,
  initialLtv,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  metric: MetricKind
  year: number
  /** Ключи "1".."12" — целые (клиенты) или суммы (оборот) */
  initialMonths: Record<string, string>
  initialLtv: Record<string, string>
  onSaved: () => void
}) {
  const [months, setMonths] = useState<Record<string, string>>({})
  const [ltv, setLtv] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setMonths({ ...initialMonths })
    setLtv({ ...initialLtv })
    setErr('')
  }, [open, initialMonths, initialLtv, year, metric])

  const title =
    metric === 'client_history'
      ? `Клиенты по месяцам · ${year}`
      : metric === 'turnover'
        ? `Оборот по месяцам · ${year}`
        : `LTV · ${year}`

  const sub =
    metric === 'client_history'
      ? 'Целые числа — новые компании за месяц. Сохраняется как ручная правка поверх базы.'
      : metric === 'turnover'
        ? 'Суммы в валюте проектов (как в системе). Линия «год назад» считается из базы.'
        : 'Количество компаний в каждой корзине срока сотрудничества.'

  const save = async () => {
    setErr('')
    setSaving(true)
    try {
      const data: Record<string, string | number> = {}
      if (metric === 'ltv') {
        for (const { key } of LTV_BUCKETS) {
          const v = (ltv[key] ?? '0').trim()
          data[key] = Math.max(0, parseInt(v, 10) || 0)
        }
      } else {
        for (let m = 1; m <= 12; m++) {
          const k = String(m)
          const raw = (months[k] ?? '0').trim().replace(/\s/g, '').replace(',', '.')
          if (metric === 'client_history') {
            data[k] = Math.max(0, parseInt(raw, 10) || 0)
          } else {
            data[k] = Math.max(0, parseFloat(raw) || 0)
          }
        }
      }
      await api.put('dashboard/ceo/overrides', { metric, year, data })
      onSaved()
      onClose()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      setErr(ax?.response?.data?.detail || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const clearOverride = async () => {
    if (!confirm('Сбросить ручные значения за этот год и снова брать данные из базы?')) return
    setSaving(true)
    setErr('')
    try {
      await api.delete(`dashboard/ceo/overrides/${metric}/${year}`)
      onSaved()
      onClose()
    } catch {
      setErr('Не удалось сбросить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={680} footer={
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: '#fff', color: '#1a1d23', border: '1px solid #e8e9ef', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
          }}
        >Отмена</button>
        <button
          type="button"
          onClick={clearOverride}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
            background: '#fff', color: '#b45309', border: '1px solid #fcd34d', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
          }}
        >Сбросить ручные</button>
        <BtnPrimary type="button" onClick={save} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</BtnPrimary>
      </div>
    }>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>{sub}</p>
      {err && (
        <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>{err}</div>
      )}
      {metric === 'ltv' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {LTV_BUCKETS.map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
              <span style={{ flex: 1, color: '#374151' }}>{label}</span>
              <input
                type="number"
                min={0}
                value={ltv[key] ?? '0'}
                onChange={e => setLtv(prev => ({ ...prev, [key]: e.target.value }))}
                style={{
                  width: 100,
                  border: '1px solid #e8e9ef',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {MONTH_LABELS.map((lab, i) => {
            const k = String(i + 1)
            return (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>{lab}</span>
                <input
                  type="text"
                  inputMode={metric === 'turnover' ? 'decimal' : 'numeric'}
                  value={months[k] ?? '0'}
                  onChange={e => setMonths(prev => ({ ...prev, [k]: e.target.value }))}
                  style={{
                    border: '1px solid #e8e9ef',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 14,
                    fontFamily: 'inherit',
                  }}
                />
              </label>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
