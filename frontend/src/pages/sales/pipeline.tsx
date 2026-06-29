import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { canManageCrmStructure, canBrowseTeamManagers, hasCrmPipelineAccess, isSalesRop } from '@/lib/salesAccess'
import { SaleDealCard } from '@/components/SaleDealCard'
import { EntityCarousel } from '@/components/EntityCarousel'
import { DateRangePicker, isDateInRange, previousMonthRange, thisMonthRange } from '@/components/DateRangePicker'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pipeline {
  id: number
  name: string
  sort_order: number
  stage_count: number
  deal_count: number
}

interface Stage {
  id: number
  name: string
  color: string | null
  sort_order: number
  is_closed_won: boolean
  is_closed_lost: boolean
  deals: Deal[]
}

interface DealNextTask {
  id: number
  task_type: string
  task_type_label: string
  due_at: string
  notes?: string | null
}

interface Deal {
  id: number
  pipeline_id: number
  stage_id: number | null
  title: string
  contact_name: string | null
  company_name: string | null
  budget: number | null
  currency: string
  service_type?: string | null
  service_label?: string | null
  notes: string | null
  tags: string[]
  assigned_user_id: number | null
  assigned_user_name: string | null
  sort_order: number
  created_at: string
  updated_at: string | null
  closed_at: string | null
  next_task?: DealNextTask | null
}

interface PipelineDetail extends Pipeline {
  stages: Stage[]
}

interface SalesUser {
  id: number
  name: string
  role: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtTaskDue(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
  if (diffDays === 0) return `Сегодня ${time}`
  if (diffDays === 1) return `Завтра ${time}`
  if (diffDays === -1) return `Вчера ${time}`
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  return `${date} ${time}`
}

function isTaskOverdue(iso: string) {
  return new Date(iso).getTime() < Date.now()
}

function fmtBudget(amount: number | null, currency: string) {
  const n = dealBudgetNum(amount)
  if (n <= 0) return null
  const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
  return `${currency === 'USD' ? '$' : currency + ' '}${fmt.format(n)}`
}

function dealBudgetNum(budget: number | null | undefined | string): number {
  const n = Number(budget)
  return Number.isFinite(n) ? n : 0
}

function dealWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return 'сделок'
  if (mod10 === 1) return 'сделка'
  if (mod10 >= 2 && mod10 <= 4) return 'сделки'
  return 'сделок'
}

const ROLE_LABELS: Record<string, string> = {
  mop: 'МОП',
  admin: 'Администратор',
  manager: 'Менеджер',
}

const pipelineQuickBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const pipelineIconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  padding: 0,
  borderRadius: 10,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
  transition: 'background .15s, border-color .15s, box-shadow .15s, opacity .15s',
}

function PipelineSettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function PipelinePlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function fmtBudgetTotal(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return '$0'
  return `$${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(amount)}`
}

function stageAccent(s: Stage) {
  if (s.color) return s.color
  if (s.is_closed_lost) return '#ff7f6e'
  return '#6ba3d6'
}


// ---------------------------------------------------------------------------
// DealCard
// ---------------------------------------------------------------------------

function DealCard({
  deal,
  onDragStart,
  onDragEnd,
  isDragging,
  onClick,
  accent,
}: {
  deal: Deal
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
  onClick: () => void
  accent: string
}) {
  const task = deal.next_task
  const taskOverdue = task ? isTaskOverdue(task.due_at) : false
  const metaParts = [deal.contact_name, deal.company_name].filter(Boolean)
  const metaLine = metaParts.join(', ')
  const dateStr = fmtDate(deal.updated_at || deal.created_at)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{
        background: isDragging ? '#fafbfc' : '#fff',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'grab',
        opacity: isDragging ? 0.75 : 1,
        boxShadow: isDragging ? '0 4px 16px rgba(15,23,42,.1)' : 'none',
        border: `1px solid ${isDragging ? accent + '66' : '#dfe3ea'}`,
        userSelect: 'none',
        transition: 'border-color .15s, box-shadow .15s, opacity .15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{
          fontSize: 12,
          color: '#64748b',
          lineHeight: 1.35,
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {metaLine || '—'}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0, lineHeight: 1.35 }}>
          {dateStr}
        </div>
      </div>

      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: '#2563eb',
        marginTop: 5,
        lineHeight: 1.35,
        letterSpacing: '.015em',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {deal.title}
      </div>

      {deal.notes?.trim() && (
        <div style={{
          fontSize: 12,
          color: '#475569',
          marginTop: 5,
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {deal.notes.trim()}
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        marginTop: 8,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: '#64748b',
          flexShrink: 0,
        }}>
          {deal.budget ? fmtBudget(deal.budget, deal.currency) : '—'}
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#94a3b8', flexShrink: 0 }} />
        </div>
        {task && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            flex: 1,
            justifyContent: 'flex-end',
          }}>
            <span style={{
              fontSize: 11,
              color: taskOverdue ? '#dc2626' : '#a67c00',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {task.task_type_label} · {fmtTaskDue(task.due_at)}
            </span>
            <span style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: taskOverdue ? '#dc2626' : '#a67c00',
              flexShrink: 0,
            }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddDealForm (inline quick add)
// ---------------------------------------------------------------------------

function AddDealForm({ stageId, pipelineId, onAdded, onCancel }: {
  stageId: number
  pipelineId: number
  onAdded: (deal: Deal) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await api.post<Deal>('sales/deals', {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: title.trim(),
      })
      onAdded(res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось добавить сделку')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 6 }}>
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Быстрое добавление"
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1.5px solid #3b82f6', borderRadius: 8,
          padding: '7px 10px', fontSize: 13, outline: 'none', fontFamily: 'inherit',
        }}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      />
      {error && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626', fontWeight: 500 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="submit" disabled={saving || !title.trim()} style={{
          flex: 1, padding: '6px 10px', background: '#1a6b3c', color: '#fff',
          border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}>
          {saving ? 'Добавление...' : 'Добавить'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '6px 10px', background: '#f1f5f9', color: '#475569',
          border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
          Отмена
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Stage column header + edit menu
// ---------------------------------------------------------------------------

const STAGE_COLOR_PRESETS = ['#6ba3d6', '#93c5fd', '#c4b5fd', '#fdba74', '#86efac', '#fca5a5', '#ff7f6e', '#64748b']

function StageColumnHeader({
  stage,
  accent,
  stageTotal,
  canManage,
  onUpdated,
  onDeleted,
}: {
  stage: Stage
  accent: string
  stageTotal: number
  canManage: boolean
  onUpdated: (updated: Stage) => void
  onDeleted: (stageId: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [name, setName] = useState(stage.name)
  const [color, setColor] = useState(stage.color || accent)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setName(stage.name)
    setColor(stage.color || accent)
  }, [stage.name, stage.color, accent])

  useEffect(() => {
    if (!menuOpen) {
      setRevealed(false)
      setConfirmDelete(false)
      setError('')
      return
    }
    const frame = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(frame)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
        setName(stage.name)
        setColor(stage.color || accent)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, stage.name, stage.color, accent])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError('')
    try {
      const res = await api.patch<Stage>(`sales/pipeline-stages/${stage.id}`, {
        name: trimmed,
        color,
        is_closed_won: stage.is_closed_won,
        is_closed_lost: stage.is_closed_lost,
      })
      onUpdated({ ...stage, ...res.data, deals: stage.deals })
      setMenuOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setError('')
    try {
      await api.delete(`sales/pipeline-stages/${stage.id}`)
      onDeleted(stage.id)
      setMenuOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось удалить')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const showPencil = canManage && (hovered || menuOpen)

  return (
    <div
      ref={rootRef}
      style={{ padding: '16px 18px 12px', flexShrink: 0, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{
          fontSize: 13, fontWeight: 800, color: '#0f172a',
          textTransform: 'uppercase', letterSpacing: '.06em',
          flex: 1, minWidth: 0, lineHeight: 1.35,
        }}>
          {stage.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {canManage && (
            <button
              type="button"
              title="Редактировать колонку"
              aria-label="Редактировать колонку"
              onClick={() => setMenuOpen(v => !v)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: 'none',
                background: menuOpen ? '#f1f5f9' : 'transparent',
                color: '#94a3b8',
                fontSize: 14,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: showPencil ? 1 : 0,
                transform: showPencil ? 'scale(1)' : 'scale(.92)',
                transition: 'opacity .15s ease, transform .15s ease, background .15s ease, color .15s ease',
                fontFamily: 'inherit',
                padding: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#64748b' }}
              onMouseLeave={e => { e.currentTarget.style.color = menuOpen ? '#64748b' : '#94a3b8' }}
            >
              ✎
            </button>
          )}
          <div style={{
            background: '#f1f5f9', color: '#64748b',
            fontSize: 12, fontWeight: 700, borderRadius: 20,
            padding: '3px 10px', minWidth: 24, textAlign: 'center',
          }}>
            {stage.deals.length}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
        {fmtBudgetTotal(stageTotal)}
      </div>
      <div style={{
        height: 4, background: accent, borderRadius: 99,
        opacity: 0.85,
      }} />

      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% - 4px)',
            left: 12,
            right: 12,
            zIndex: 40,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            boxShadow: '0 16px 40px rgba(15,23,42,.14), 0 4px 12px rgba(15,23,42,.06)',
            padding: 14,
            transform: revealed ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(.98)',
            opacity: revealed ? 1 : 0,
            transformOrigin: 'top center',
            transition: 'transform .22s cubic-bezier(.22,1,.36,1), opacity .18s ease',
          }}
          onClick={e => e.stopPropagation()}
        >
          <form onSubmit={handleSave}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Колонка
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              placeholder="Название этапа"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 700,
                color: '#0f172a',
                outline: 'none',
                fontFamily: 'inherit',
                textTransform: 'uppercase',
                letterSpacing: '.04em',
              }}
            />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Цвет</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {STAGE_COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => setColor(c)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: color === c ? '2px solid #0f172a' : '2px solid transparent',
                      background: c,
                      cursor: 'pointer',
                      padding: 0,
                      boxShadow: color === c ? `0 0 0 2px ${c}44` : 'none',
                    }}
                  />
                ))}
              </div>
            </div>
            {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: 'none',
                  background: saving ? '#94a3b8' : '#1a6b3c',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {saving ? '…' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  color: '#64748b',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Отмена
              </button>
            </div>
          </form>

          <div style={{ height: 1, background: '#f1f5f9', margin: '12px 0' }} />

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #fecaca',
                background: '#fff',
                color: '#dc2626',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Удалить колонку
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45, marginBottom: 10 }}>
                {stage.deals.length > 0
                  ? `${stage.deals.length} ${dealWord(stage.deals.length)} останутся без этапа.`
                  : 'Колонка будет удалена безвозвратно.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: deleting ? '#fca5a5' : '#dc2626',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: deleting ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {deleting ? '…' : 'Да, удалить'}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    background: '#fff',
                    color: '#64748b',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Нет
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CreatePipelineModal
// ---------------------------------------------------------------------------

function CreatePipelineModal({ onCreated, onClose }: {
  onCreated: (p: PipelineDetail) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await api.post<PipelineDetail>('sales/pipelines', { name: name.trim() })
      onCreated(res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось создать воронку')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,35,45,.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 4, width: 400, padding: '24px 24px 20px', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1d23', marginBottom: 16 }}>Создать воронку</div>
        <form onSubmit={submit}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название воронки" autoFocus
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #c5cad6', borderRadius: 3, padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit' }} />
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: '#f5f6f8', color: '#5c6378', border: '1px solid #dde1e8', borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
            <button type="submit" disabled={saving || !name.trim()} style={{ padding: '8px 20px', background: saving ? '#94a3b8' : '#1a6b3c', color: '#fff', border: 'none', borderRadius: 3, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [activePipeline, setActivePipeline] = useState<PipelineDetail | null>(null)
  const [activePipelineId, setActivePipelineId] = useState<number | null>(null)
  const [salesUsers, setSalesUsers] = useState<SalesUser[]>([])
  const [loadingBoard, setLoadingBoard] = useState(false)
  const [showCreatePipeline, setShowCreatePipeline] = useState(false)
  const [dealModal, setDealModal] = useState<{ deal: Deal | null; stageId?: number } | null>(null)
  const [addingInStage, setAddingInStage] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [dealScope, setDealScope] = useState<'team' | 'mine'>('team')
  const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState(() => thisMonthRange().from)
  const [dateTo, setDateTo] = useState(() => thisMonthRange().to)

  const showRopToggle = isSalesRop(user)
  const showManagerCarousel = canBrowseTeamManagers(user)

  // Drag state
  const dragDealId = useRef<number | null>(null)
  const dragFromStageId = useRef<number | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<number | null>(null)

  const canManage = canManageCrmStructure(user)

  useEffect(() => {
    if (!loading && user) {
      if (!hasCrmPipelineAccess(user)) { router.replace('/'); return }
      void loadPipelines()
      void loadUsers()
    }
  }, [loading, user])

  async function loadPipelines() {
    try {
      const res = await api.get<Pipeline[]>('sales/pipelines')
      setPipelines(res.data)
      if (res.data.length > 0) {
        setActivePipelineId(res.data[0].id)
      }
    } catch {
      // silent
    }
  }

  async function loadUsers() {
    try {
      const res = await api.get<SalesUser[]>('sales/users-list')
      setSalesUsers(res.data)
    } catch {
      // silent
    }
  }

  useEffect(() => {
    if (!activePipelineId) return
    void loadBoard(activePipelineId)
  }, [activePipelineId, dealScope, selectedManagerId])

  async function loadBoard(id: number) {
    setLoadingBoard(true)
    try {
      const params: Record<string, string | number> = {}
      if (showRopToggle) params.scope = dealScope
      if (showManagerCarousel && selectedManagerId != null) {
        params.assigned_user_id = selectedManagerId
      }
      const res = await api.get<PipelineDetail>(`sales/pipelines/${id}`, { params })
      setActivePipeline(res.data)
    } catch {
      // silent
    } finally {
      setLoadingBoard(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & Drop
  // ---------------------------------------------------------------------------

  function handleDragStart(dealId: number, stageId: number) {
    dragDealId.current = dealId
    dragFromStageId.current = stageId
  }

  function handleDragEnd() {
    dragDealId.current = null
    dragFromStageId.current = null
    setDragOverStageId(null)
  }

  function handleDragOver(e: React.DragEvent, stageId: number) {
    e.preventDefault()
    setDragOverStageId(stageId)
  }

  async function handleDrop(targetStageId: number) {
    const dealId = dragDealId.current
    const fromStageId = dragFromStageId.current
    if (!dealId || fromStageId === targetStageId) {
      setDragOverStageId(null)
      return
    }
    setActivePipeline(prev => {
      if (!prev) return prev
      let movedDeal: Deal | undefined
      const stages = prev.stages.map(s => {
        if (s.id === fromStageId) {
          const filtered = s.deals.filter(d => {
            if (d.id === dealId) { movedDeal = d; return false }
            return true
          })
          return { ...s, deals: filtered }
        }
        return s
      })
      if (movedDeal) {
        const updated = { ...movedDeal, stage_id: targetStageId }
        return {
          ...prev,
          stages: stages.map(s => s.id === targetStageId ? { ...s, deals: [...s.deals, updated] } : s)
        }
      }
      return { ...prev, stages }
    })
    setDragOverStageId(null)
    dragDealId.current = null
    dragFromStageId.current = null
    try {
      await api.patch(`sales/deals/${dealId}`, { stage_id: targetStageId })
    } catch {
      // revert on error
      void loadBoard(activePipelineId!)
    }
  }

  // ---------------------------------------------------------------------------
  // Deal CRUD in board state
  // ---------------------------------------------------------------------------

  function handleDealAdded(deal: Deal) {
    setActivePipeline(prev => {
      if (!prev) return prev
      return {
        ...prev,
        stages: prev.stages.map(s =>
          s.id === deal.stage_id ? { ...s, deals: [...s.deals, deal] } : s
        ),
      }
    })
    setAddingInStage(null)
  }

  function handleDealSaved(deal: Deal) {
    setDealModal(null)
    if (activePipelineId) void loadBoard(activePipelineId)
  }

  function handleDealModalClose() {
    setDealModal(null)
    if (activePipelineId) void loadBoard(activePipelineId)
  }

  function handleDealDeleted(id: number) {
    setActivePipeline(prev => {
      if (!prev) return prev
      return { ...prev, stages: prev.stages.map(s => ({ ...s, deals: s.deals.filter(d => d.id !== id) })) }
    })
  }

  function handleStageUpdated(updated: Stage) {
    setActivePipeline(prev => {
      if (!prev) return prev
      return {
        ...prev,
        stages: prev.stages.map(s => (s.id === updated.id ? updated : s)),
      }
    })
  }

  function handleStageDeleted(stageId: number) {
    setActivePipeline(prev => {
      if (!prev) return prev
      return {
        ...prev,
        stages: prev.stages.filter(s => s.id !== stageId),
      }
    })
    setPipelines(prev =>
      prev.map(p =>
        p.id === activePipelineId
          ? { ...p, stage_count: Math.max(0, p.stage_count - 1) }
          : p
      )
    )
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  const managerItems = useMemo(() => {
    if (!showManagerCarousel || !user) return []
    const mops = salesUsers
      .filter(u => u.role === 'mop')
      .map(u => ({ id: u.id, name: u.name, subtitle: ROLE_LABELS[u.role] || u.role }))

    if (user.role === 'admin') {
      return [{ id: null, name: 'Все менеджеры', subtitle: 'Команда продаж' }, ...mops]
    }
    if (isSalesRop(user)) {
      if (dealScope === 'mine') {
        return [{ id: user.id, name: user.name, subtitle: 'Мои сделки' }]
      }
      return mops.filter(u => u.id !== user.id)
    }
    return []
  }, [showManagerCarousel, user, salesUsers, dealScope])

  const pipelineItems = useMemo(
    () => pipelines.map(p => ({
      id: p.id,
      name: p.name,
      subtitle: `${p.deal_count} ${dealWord(p.deal_count)}`,
    })),
    [pipelines]
  )

  useEffect(() => {
    if (!showManagerCarousel || managerItems.length === 0) return
    if (isSalesRop(user) && dealScope === 'mine' && user?.id) {
      setSelectedManagerId(user.id)
      return
    }
    setSelectedManagerId(prev =>
      managerItems.some(i => i.id === prev) ? prev : managerItems[0].id
    )
  }, [showManagerCarousel, managerItems, dealScope, user])

  const currentManager = managerItems.find(m => m.id === selectedManagerId)
  const headerTitle = showManagerCarousel && selectedManagerId != null && currentManager
    ? currentManager.name
    : (activePipeline?.name || 'Воронка продаж')

  const filteredStages = useMemo(() => {
    if (!activePipeline) return []
    const q = search.trim().toLowerCase()
    return activePipeline.stages.map(s => ({
      ...s,
      deals: s.deals.filter(d => {
        if (!isDateInRange(d.created_at, dateFrom, dateTo)) return false
        if (!q) return true
        return (
          d.title.toLowerCase().includes(q) ||
          (d.contact_name ?? '').toLowerCase().includes(q) ||
          (d.company_name ?? '').toLowerCase().includes(q) ||
          (d.notes ?? '').toLowerCase().includes(q)
        )
      }),
    }))
  }, [activePipeline, search, dateFrom, dateTo])

  const totalDeals = useMemo(
    () => filteredStages.reduce((acc, s) => acc + s.deals.length, 0),
    [filteredStages]
  )
  const totalBudget = useMemo(() => {
    return filteredStages.flatMap(s => s.deals).reduce((acc, d) => acc + dealBudgetNum(d.budget), 0)
  }, [filteredStages])

  if (loading || !user) return null

  return (
    <Layout>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f0f2f5' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '14px 72px 14px 24px',
          borderBottom: '1px solid #e8eaef', background: '#fff', flexShrink: 0, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: '-.02em' }}>
                  {headerTitle}
                </div>
                {activePipeline && (
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                    {showManagerCarousel && selectedManagerId != null && currentManager ? (
                      <span>{activePipeline.name} · </span>
                    ) : null}
                    <strong style={{ color: '#0f172a' }}>{totalDeals}</strong> {dealWord(totalDeals)} ·{' '}
                    <strong style={{ color: '#0f172a' }}>{fmtBudgetTotal(totalBudget)}</strong>
                  </div>
                )}
              </div>
              {showManagerCarousel && managerItems.length > 0 && (
                <EntityCarousel
                  items={managerItems}
                  value={selectedManagerId}
                  onChange={setSelectedManagerId}
                  ariaLabel="Менеджер"
                />
              )}
            </div>
          </div>

          {showRopToggle && (
            <div style={{
              display: 'inline-flex', background: '#f1f5f9', borderRadius: 10, padding: 3,
              border: '1px solid #e2e8f0', flexShrink: 0,
            }}>
              {([
                { key: 'team' as const, label: 'Команда МОП' },
                { key: 'mine' as const, label: 'Мои сделки' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDealScope(opt.key)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, border: 'none',
                    background: dealScope === opt.key ? '#fff' : 'transparent',
                    color: dealScope === opt.key ? '#0f172a' : '#64748b',
                    fontSize: 13, fontWeight: dealScope === opt.key ? 700 : 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    boxShadow: dealScope === opt.key ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {canManage && (
              <button
                type="button"
                title="Настроить воронку"
                aria-label="Настроить воронку"
                onClick={() => setShowCreatePipeline(true)}
                style={{
                  ...pipelineIconBtn,
                  background: '#fff',
                  color: '#475569',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                }}
              >
                <PipelineSettingsIcon />
              </button>
            )}
            <button
              type="button"
              title="Новая сделка"
              aria-label="Новая сделка"
              onClick={() => setDealModal({ deal: null })}
              disabled={!activePipeline}
              style={{
                ...pipelineIconBtn,
                background: activePipeline ? '#1a6b3c' : '#94a3b8',
                color: '#fff',
                border: 'none',
                boxShadow: activePipeline ? '0 4px 12px rgba(26,107,60,.28)' : 'none',
                cursor: activePipeline ? 'pointer' : 'not-allowed',
                opacity: activePipeline ? 1 : 0.65,
              }}
            >
              <PipelinePlusIcon />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0, paddingRight: 8 }}>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по сделкам..."
                style={{
                  width: 240, boxSizing: 'border-box',
                  border: '1px solid #e2e8f0', borderRadius: 10,
                  padding: '9px 14px 9px 36px', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  background: '#f8fafc', color: '#0f172a',
                }}
              />
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94a3b8' }}>🔍</span>
            </div>

            {pipelineItems.length > 1 && activePipelineId != null && (
              <EntityCarousel
                items={pipelineItems}
                value={activePipelineId}
                onChange={v => v != null && setActivePipelineId(v)}
                ariaLabel="Воронка"
              />
            )}
          </div>
        </div>

        {/* ── Date filter bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px',
          borderBottom: '1px solid #e8eaef', background: '#fff', flexShrink: 0, flexWrap: 'wrap',
        }}>
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            size="compact"
            align="left"
            onApply={({ from, to }) => {
              setDateFrom(from)
              setDateTo(to)
            }}
          />
          <button type="button" onClick={() => { const r = thisMonthRange(); setDateFrom(r.from); setDateTo(r.to) }} style={pipelineQuickBtn}>
            Этот месяц
          </button>
          <button type="button" onClick={() => { const r = previousMonthRange(); setDateFrom(r.from); setDateTo(r.to) }} style={pipelineQuickBtn}>
            Прошлый месяц
          </button>
        </div>

        {/* ── Board ── */}
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', minHeight: 0 }}>
          {loadingBoard ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#94a3b8', fontSize: 15 }}>
              Загрузка...
            </div>
          ) : pipelines.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16 }}>
              <div style={{ fontSize: 48 }}>📊</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Нет воронок</div>
              <div style={{ fontSize: 14, color: '#64748b', maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
                Создайте воронку — автоматически добавятся этапы для работы с клиентами
              </div>
            {canManage && (
              <button type="button" onClick={() => setShowCreatePipeline(true)} style={{
                padding: '12px 24px', background: 'linear-gradient(135deg,#1a6b3c,#15803d)', color: '#fff',
                border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 4px 14px rgba(26,107,60,.3)',
              }}>
                Создать воронку
              </button>
            )}
            </div>
          ) : activePipeline ? (
            <div style={{
              display: 'flex',
              height: '100%',
              minHeight: 0,
              padding: '20px 12px 20px 24px',
              gap: 0,
              minWidth: 'max-content',
              alignItems: 'stretch',
              boxSizing: 'border-box',
            }}>
              {filteredStages.map((stage, stageIdx) => {
                const accent = stageAccent(stage)
                const isOver = dragOverStageId === stage.id
                const stageTotal = stage.deals.reduce((acc, d) => acc + dealBudgetNum(d.budget), 0)
                const isLast = stageIdx === filteredStages.length - 1

                return (
                  <div key={stage.id} style={{ display: 'flex', alignItems: 'stretch', height: '100%', flexShrink: 0 }}>
                    {/* Stage column card */}
                    <div
                      onDragOver={e => handleDragOver(e, stage.id)}
                      onDrop={() => handleDrop(stage.id)}
                      style={{
                        width: 290,
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                        minHeight: 0,
                        background: isOver ? '#f0f7ff' : '#fff',
                        borderRadius: 20,
                        boxShadow: isOver
                          ? '0 0 0 2px #3b82f6, 0 8px 32px rgba(59,130,246,.12)'
                          : '0 2px 16px rgba(15,23,42,.07)',
                        border: `1px solid ${isOver ? '#93c5fd' : '#eef0f4'}`,
                        transition: 'all .18s',
                        flexShrink: 0,
                        overflow: 'hidden',
                        position: 'relative',
                      }}
                    >
                      {/* Column header */}
                      <StageColumnHeader
                        stage={stage}
                        accent={accent}
                        stageTotal={stageTotal}
                        canManage={canManage}
                        onUpdated={handleStageUpdated}
                        onDeleted={handleStageDeleted}
                      />

                      {/* Deals list */}
                      <div style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: 'auto',
                        padding: '4px 14px 6px',
                        WebkitOverflowScrolling: 'touch',
                      }}>
                        {stage.deals.map(deal => (
                          <DealCard
                            key={deal.id}
                            deal={deal}
                            accent={accent}
                            onDragStart={() => handleDragStart(deal.id, stage.id)}
                            onDragEnd={handleDragEnd}
                            isDragging={dragDealId.current === deal.id}
                            onClick={() => setDealModal({ deal, stageId: stage.id })}
                          />
                        ))}

                        {addingInStage === stage.id && activePipeline && (
                          <AddDealForm
                            stageId={stage.id}
                            pipelineId={activePipeline.id}
                            onAdded={handleDealAdded}
                            onCancel={() => setAddingInStage(null)}
                          />
                        )}
                      </div>

                      {/* Add deal footer */}
                      <div style={{ padding: '8px 14px 12px', flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                        <button
                          type="button"
                          title={addingInStage === stage.id ? 'Скрыть форму' : 'Добавить сделку'}
                          aria-label={addingInStage === stage.id ? 'Скрыть форму' : 'Добавить сделку'}
                          onClick={() => setAddingInStage(addingInStage === stage.id ? null : stage.id)}
                          style={{
                            width: 32,
                            height: 32,
                            padding: 0,
                            background: addingInStage === stage.id ? '#fff' : '#f1f5f9',
                            border: `1.5px dashed ${addingInStage === stage.id ? accent : '#94a3b8'}`,
                            borderRadius: 8,
                            color: addingInStage === stage.id ? accent : '#475569',
                            fontSize: 18,
                            fontWeight: 600,
                            lineHeight: 1,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            transition: 'all .15s',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          onMouseEnter={e => {
                            if (addingInStage !== stage.id) {
                              e.currentTarget.style.borderColor = accent
                              e.currentTarget.style.color = accent
                              e.currentTarget.style.background = '#fff'
                            }
                          }}
                          onMouseLeave={e => {
                            if (addingInStage !== stage.id) {
                              e.currentTarget.style.borderColor = '#94a3b8'
                              e.currentTarget.style.color = '#475569'
                              e.currentTarget.style.background = '#f1f5f9'
                            }
                          }}
                        >
                          {addingInStage === stage.id ? '×' : '+'}
                        </button>
                      </div>
                    </div>

                    {/* Arrow connector between columns */}
                    {!isLast && (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 36, flexShrink: 0, paddingTop: 44,
                        position: 'relative',
                      }}>
                        <svg width="36" height="20" viewBox="0 0 36 20" style={{ display: 'block' }}>
                          <line x1="2" y1="10" x2="26" y2="10" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="4 3" />
                          <polygon points="26,6 34,10 26,14" fill="#cbd5e1" />
                        </svg>
                      </div>
                    )}
                  </div>
                )
              })}

              {canManage && activePipeline.stages.length < 20 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 4, marginLeft: 8 }}>
                  <button type="button" style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: '#fff', border: '1.5px dashed #cbd5e1',
                    color: '#94a3b8', fontSize: 24, fontWeight: 300,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all .15s',
                  }}
                    title="Добавить этап"
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a6b3c'; e.currentTarget.style.color = '#1a6b3c' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.color = '#94a3b8' }}
                    onClick={() => {
                      const name = window.prompt('Название нового этапа:')
                      if (name?.trim()) {
                        api.post<Stage>(`sales/pipelines/${activePipeline.id}/stages`, { name: name.trim().toUpperCase() }).then(r => {
                          setActivePipeline(prev => prev ? { ...prev, stages: [...prev.stages, { ...r.data, deals: [] }] } : prev)
                        })
                      }
                    }}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Modals */}
      {showCreatePipeline && (
        <CreatePipelineModal
          onCreated={p => {
            setPipelines(prev => [...prev, { id: p.id, name: p.name, sort_order: p.sort_order, stage_count: p.stages.length, deal_count: 0 }])
            setActivePipelineId(p.id)
            setActivePipeline(p)
            setShowCreatePipeline(false)
          }}
          onClose={() => setShowCreatePipeline(false)}
        />
      )}

      {dealModal !== null && activePipeline && (
        <SaleDealCard
          deal={dealModal.deal}
          stages={activePipeline.stages}
          pipelineId={activePipeline.id}
          users={salesUsers}
          onSave={handleDealSaved}
          onDelete={handleDealDeleted}
          onClose={handleDealModalClose}
        />
      )}
    </Layout>
  )
}
