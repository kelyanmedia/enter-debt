import { useMemo, useState } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import api from '@/lib/api'

export type DealTask = {
  id: number
  task_type: string
  task_type_label: string
  notes: string | null
  due_at: string
  remind_minutes_before: number
  status: string
  assigned_user_name: string | null
}

const TASK_TYPES = [
  { key: 'call', label: 'Связаться' },
  { key: 'meeting', label: 'Встреча' },
  { key: 'email', label: 'Email' },
  { key: 'other', label: 'Другое' },
]

const REMIND_OPTIONS = [15, 30, 60, 120]

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

export function SaleDealComposer({
  dealId,
  dealTitle,
  tasks: _tasks,
  onNoteAdded,
  onTaskCreated,
}: {
  dealId: number
  dealTitle: string
  tasks: DealTask[]
  onNoteAdded: (comment: { id: number; body: string; kind: string; created_by_user_name?: string | null; created_at: string }) => void
  onTaskCreated: (task: DealTask) => void
}) {
  const [mode, setMode] = useState<ComposeMode>('note')
  const [modeOpen, setModeOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [taskError, setTaskError] = useState('')

  const [taskType, setTaskType] = useState('call')
  const [dueAt, setDueAt] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60_000)))
  const [remindMin, setRemindMin] = useState(15)
  const [taskExpanded, setTaskExpanded] = useState(false)

  const dueDate = useMemo(() => new Date(dueAt), [dueAt])
  const modeLabel = mode === 'note' ? 'Примечание' : 'Задача'

  async function submitNote() {
    if (!text.trim()) return
    setSaving(true)
    try {
      const r = await api.post(`sales/deals/${dealId}/comments`, { body: text.trim() })
      onNoteAdded(r.data)
      setText('')
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
    if (m === 'task') setTaskExpanded(true)
    else setTaskExpanded(false)
  }

  return (
    <div style={{ background: '#fff', borderTop: '1px solid #dfe3ea', flexShrink: 0 }}>
      {mode === 'task' && taskExpanded && (
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid #eef1f5',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: '#475569',
        }}>
          <select
            value={taskType}
            onChange={e => setTaskType(e.target.value)}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '5px 8px',
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
              padding: '5px 8px',
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

      <div style={{ padding: '10px 14px 12px' }}>
        <div style={{ position: 'relative', marginBottom: 8 }}>
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
              minWidth: 140,
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

        <div style={{
          border: '1px solid #dfe3ea',
          borderRadius: 6,
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
              padding: '10px 12px',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'none',
              color: '#0f172a',
              background: 'transparent',
              lineHeight: 1.5,
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>

        {taskError && (
          <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{taskError}</div>
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          fontSize: 11,
          color: '#94a3b8',
        }}>
          <span>{mode === 'note' ? 'Ctrl+Enter — отправить' : `${fmtDateShort(dueDate)} · Ctrl+Enter`}</span>
          <button
            type="button"
            onClick={submit}
            disabled={saving || (mode === 'note' && !text.trim())}
            style={{
              border: 'none',
              background: 'none',
              color: saving || (mode === 'note' && !text.trim()) ? '#cbd5e1' : '#2563eb',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving || (mode === 'note' && !text.trim()) ? 'default' : 'pointer',
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
