import { useMemo, useRef, useState } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import { SaleDealTaskList } from '@/components/SaleDealTaskList'
import api from '@/lib/api'
import { compressImageFile } from '@/lib/compressImage'

export type DealTask = {
  id: number
  task_type: string
  task_type_label: string
  notes: string | null
  result?: string | null
  due_at: string
  remind_minutes_before: number
  status: string
  assigned_user_name: string | null
  created_by_user_name?: string | null
  created_at?: string
  completed_at?: string | null
}

const TASK_TYPES = [
  { key: 'call', label: 'Связаться' },
  { key: 'meeting', label: 'Встреча' },
  { key: 'email', label: 'Email' },
  { key: 'other', label: 'Другое' },
]

const REMIND_OPTIONS = [15, 30, 60, 120]
const MAX_IMAGES = 6

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toLocalInputValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDateShort(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

type ComposeMode = 'note' | 'task'

type PendingImage = {
  id: string
  file: File
  previewUrl: string
}

export function SaleDealComposer({
  dealId,
  dealTitle,
  tasks,
  onNoteAdded,
  onTaskCreated,
  onTaskChanged,
}: {
  dealId: number
  dealTitle: string
  tasks: DealTask[]
  onNoteAdded: (comment: {
    id: number
    body: string
    kind: string
    images?: string[]
    meta_json?: { images?: string[] } | null
    created_by_user_name?: string | null
    created_at: string
  }) => void
  onTaskCreated: (task: DealTask) => void
  onTaskChanged: (task: DealTask | null, taskId: number) => void
}) {
  const [mode, setMode] = useState<ComposeMode>('note')
  const [modeOpen, setModeOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [taskError, setTaskError] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const [taskType, setTaskType] = useState('call')
  const [dueAt, setDueAt] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60_000)))
  const [remindMin, setRemindMin] = useState(15)
  const [taskExpanded, setTaskExpanded] = useState(false)

  const dueDate = useMemo(() => new Date(dueAt), [dueAt])
  const modeLabel = mode === 'note' ? 'Примечание' : 'Задача'
  const canSendNote = Boolean(text.trim() || images.length)

  function clearImages() {
    setImages(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.previewUrl))
      return []
    })
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return
    setTaskError('')
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      setTaskError(`Не больше ${MAX_IMAGES} изображений`)
      return
    }
    const picked = Array.from(fileList).slice(0, remaining)
    const next: PendingImage[] = []
    try {
      for (const raw of picked) {
        if (!raw.type.startsWith('image/')) {
          setTaskError('Можно прикреплять только изображения')
          continue
        }
        const compressed = await compressImageFile(raw)
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file: compressed,
          previewUrl: URL.createObjectURL(compressed),
        })
      }
      if (next.length) setImages(prev => [...prev, ...next])
    } catch {
      setTaskError('Не удалось обработать изображение')
      next.forEach(p => URL.revokeObjectURL(p.previewUrl))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeImage(id: string) {
    setImages(prev => {
      const target = prev.find(p => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(p => p.id !== id)
    })
  }

  async function submitNote() {
    if (!canSendNote) return
    setSaving(true)
    setTaskError('')
    try {
      const fd = new FormData()
      fd.append('body', text.trim())
      for (const img of images) {
        fd.append('images', img.file, img.file.name)
      }
      const r = await api.post(`sales/deals/${dealId}/comments`, fd)
      onNoteAdded(r.data)
      setText('')
      clearImages()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setTaskError(typeof msg === 'string' ? msg : 'Не удалось отправить')
    } finally {
      setSaving(false)
    }
  }

  async function submitTask() {
    setSaving(true)
    setTaskError('')
    try {
      const r = await api.post<DealTask>(`sales/deals/${dealId}/tasks`, {
        task_type: taskType,
        due_at: new Date(dueAt).toISOString(),
        remind_minutes_before: remindMin,
        notes: text.trim() || null,
      })
      onTaskCreated(r.data)
      setText('')
      clearImages()
      setMode('note')
      setTaskExpanded(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setTaskError(typeof msg === 'string' ? msg : 'Не удалось создать задачу')
    } finally {
      setSaving(false)
    }
  }

  function submit() {
    if (mode === 'note') void submitNote()
    else void submitTask()
  }

  function switchMode(m: ComposeMode) {
    setMode(m)
    setModeOpen(false)
    setTaskError('')
    if (m === 'task') {
      setTaskExpanded(true)
      clearImages()
    } else {
      setTaskExpanded(false)
    }
  }

  return (
    <div style={{ background: '#fff', borderTop: '1px solid #dfe3ea', flexShrink: 0 }}>
      <SaleDealTaskList
        dealId={dealId}
        dealTitle={dealTitle}
        tasks={tasks}
        onTaskChanged={onTaskChanged}
      />
      {mode === 'task' && taskExpanded && (
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #eef1f5',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: '#475569',
        }}>
          <select
            value={taskType}
            onChange={e => setTaskType(e.target.value)}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 13,
              fontFamily: 'inherit',
              background: '#fff',
            }}
          >
            {TASK_TYPES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <DateTimePicker
            value={dueAt}
            onChange={v => setDueAt(v)}
            style={{ fontSize: 13 }}
          />
          <select
            value={remindMin}
            onChange={e => setRemindMin(Number(e.target.value))}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 13,
              fontFamily: 'inherit',
              background: '#fff',
            }}
          >
            {REMIND_OPTIONS.map(m => (
              <option key={m} value={m}>🔔 за {m} мин</option>
            ))}
          </select>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{dealTitle}</span>
        </div>
      )}

      <div style={{ padding: '8px 12px 10px' }}>
        <div style={{ position: 'relative', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => setModeOpen(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              color: '#2563eb',
              fontFamily: 'inherit',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {modeLabel} ▾
          </button>
          {mode === 'note' && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                hidden
                onChange={e => void addFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={saving || images.length >= MAX_IMAGES}
                title="Добавить изображение"
                style={{
                  border: '1px solid #dbe3ef',
                  background: '#fff',
                  borderRadius: 8,
                  padding: '4px 10px',
                  cursor: images.length >= MAX_IMAGES ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  color: images.length >= MAX_IMAGES ? '#94a3b8' : '#475569',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                  <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
                  <path d="M21 16l-5-5-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Медиа
              </button>
            </>
          )}
          {modeOpen && (
            <div style={{
              position: 'absolute',
              left: 0,
              bottom: '100%',
              marginBottom: 4,
              zIndex: 20,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,.1)',
              minWidth: 150,
              overflow: 'hidden',
            }}>
              {(['note', 'task'] as ComposeMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    border: 'none',
                    background: mode === m ? '#f1f5f9' : '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    fontWeight: mode === m ? 700 : 400,
                  }}
                >
                  {m === 'note' ? 'Примечание' : 'Задача'}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'note' && images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {images.map(img => (
              <div
                key={img.id}
                style={{
                  position: 'relative',
                  width: 72,
                  height: 72,
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  aria-label="Удалить"
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 20,
                    height: 20,
                    borderRadius: 99,
                    border: 'none',
                    background: 'rgba(15,23,42,.72)',
                    color: '#fff',
                    fontSize: 12,
                    lineHeight: '20px',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{
          border: '1px solid #dfe3ea',
          borderRadius: 8,
          background: '#fafbfc',
          overflow: 'hidden',
        }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="введите текст"
            rows={3}
            disabled={saving}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              padding: '8px 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              color: '#0f172a',
              background: 'transparent',
              lineHeight: 1.4,
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={e => {
              if (mode !== 'note') return
              const items = Array.from(e.clipboardData?.items || [])
              const imageItems = items.filter(i => i.type.startsWith('image/'))
              if (!imageItems.length) return
              e.preventDefault()
              const dt = new DataTransfer()
              for (const item of imageItems) {
                const f = item.getAsFile()
                if (f) dt.items.add(f)
              }
              void addFiles(dt.files)
            }}
          />
        </div>

        {taskError && (
          <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{taskError}</div>
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          fontSize: 11,
          color: '#94a3b8',
        }}>
          <span>
            {mode === 'note'
              ? 'Enter — отправить · Shift+Enter — строка'
              : `${fmtDateShort(dueDate)} · Enter — отправить`}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={saving || (mode === 'note' && !canSendNote)}
            style={{
              border: 'none',
              background: 'none',
              color: saving || (mode === 'note' && !canSendNote) ? '#cbd5e1' : '#2563eb',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving || (mode === 'note' && !canSendNote) ? 'default' : 'pointer',
              fontFamily: 'inherit',
              padding: '2px 4px',
            }}
          >
            {saving ? '…' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  )
}
