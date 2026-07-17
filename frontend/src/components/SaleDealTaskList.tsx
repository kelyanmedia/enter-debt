import { useMemo, useState } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import api from '@/lib/api'
import type { DealTask } from '@/components/SaleDealTaskComposer'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toLocalValue(value: string) {
  const d = new Date(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function relativeDueLabel(value: string) {
  const due = new Date(value)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / 86400000)
  if (diffDays === 0) return 'Сегодня'
  if (diffDays === 1) return 'Завтра'
  if (diffDays === -1) return 'Вчера'
  return due.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function shiftedDate(task: DealTask, days: number) {
  const now = new Date()
  const original = new Date(task.due_at)
  const base = new Date(original.getTime() > now.getTime() ? original : now)
  base.setDate(base.getDate() + days)
  return toLocalValue(base.toISOString())
}

function ClockIcon({ done }: { done?: boolean }) {
  if (done) {
    return (
      <span style={{
        width: 18,
        height: 18,
        borderRadius: 99,
        background: '#22c55e',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}>
        ✓
      </span>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0, color: '#94a3b8' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FollowUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0, color: '#22c55e' }}>
      <path d="M4 12a8 8 0 0 1 13.5-5.8L20 4v6h-6l2.3-2.3A6 6 0 1 0 18 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SaleDealTaskList({
  dealId,
  dealTitle,
  tasks,
  onTaskChanged,
}: {
  dealId: number
  dealTitle: string
  tasks: DealTask[]
  onTaskChanged: (task: DealTask | null, taskId: number) => void
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const sorted = useMemo(() => [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  }), [tasks])

  if (!sorted.length) return null

  async function updateDate(task: DealTask, value: string) {
    if (!value) return
    setBusyId(task.id)
    setError('')
    try {
      const r = await api.patch<DealTask>(`sales/deals/${dealId}/tasks/${task.id}`, {
        due_at: new Date(value).toISOString(),
      })
      onTaskChanged(r.data, task.id)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось изменить дату')
    } finally {
      setBusyId(null)
    }
  }

  async function complete(task: DealTask) {
    setBusyId(task.id)
    setError('')
    try {
      const r = await api.patch<DealTask>(`sales/deals/${dealId}/tasks/${task.id}/complete`, {
        result: (results[task.id] || '').trim() || null,
      })
      onTaskChanged(r.data, task.id)
      setExpandedId(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Не удалось выполнить задачу')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(task: DealTask) {
    setBusyId(task.id)
    setError('')
    try {
      await api.delete(`sales/deals/${dealId}/tasks/${task.id}`)
      onTaskChanged(null, task.id)
      setExpandedId(null)
    } catch {
      setError('Не удалось удалить задачу')
    } finally {
      setBusyId(null)
    }
  }

  const forLabel = (dealTitle || '').trim() || 'сделку'

  return (
    <div style={{
      margin: '0 12px 10px',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      background: '#fff',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.map((task, index) => {
          const done = task.status === 'done'
          const expanded = expandedId === task.id && !done
          const busy = busyId === task.id
          const isLast = index === sorted.length - 1
          return (
            <div key={task.id} style={{ opacity: busy ? 0.65 : 1 }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: expanded ? '10px 12px 6px' : '8px 12px',
                background: expanded ? '#fafbfc' : 'transparent',
              }}>
                <div style={{
                  width: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flexShrink: 0,
                  paddingTop: 1,
                }}>
                  <button
                    type="button"
                    disabled={done || busy}
                    onClick={() => setExpandedId(expanded ? null : task.id)}
                    title={done ? 'Выполнено' : 'Открыть задачу'}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: done ? 'default' : 'pointer',
                      lineHeight: 0,
                    }}
                  >
                    <ClockIcon done={done} />
                  </button>
                  {!isLast ? (
                    <span style={{
                      width: 1,
                      flex: 1,
                      minHeight: 14,
                      marginTop: 4,
                      background: '#e5e7eb',
                    }} />
                  ) : null}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <button
                    type="button"
                    onClick={() => { if (!done) setExpandedId(expanded ? null : task.id) }}
                    style={{
                      width: '100%',
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      textAlign: 'left',
                      cursor: done ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '2px 6px',
                      lineHeight: 1.35,
                    }}
                  >
                    <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 500 }}>
                      {done ? 'Выполнено' : relativeDueLabel(task.due_at)}
                    </span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      для {forLabel}
                    </span>
                    <FollowUpIcon />
                    <span style={{
                      color: done ? '#94a3b8' : '#0f172a',
                      fontSize: 13,
                      fontWeight: 700,
                      textDecoration: done ? 'line-through' : 'none',
                    }}>
                      {task.task_type_label}
                    </span>
                    {task.notes ? (
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>
                        — {task.notes}
                      </span>
                    ) : null}
                  </button>

                  {done && task.result ? (
                    <div style={{ marginTop: 3, color: '#64748b', fontSize: 12 }}>
                      Результат: {task.result}
                    </div>
                  ) : null}

                  {expanded ? (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                        <input
                          value={results[task.id] || ''}
                          onChange={e => setResults(prev => ({ ...prev, [task.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void complete(task)
                            }
                          }}
                          placeholder="Добавить результат"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: '1px solid #d8dee8',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: 13,
                            fontFamily: 'inherit',
                            outline: 'none',
                            background: '#fff',
                          }}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void complete(task)}
                          style={{
                            border: 'none',
                            borderRadius: 6,
                            padding: '8px 14px',
                            background: '#94a3b8',
                            color: '#fff',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Выполнить
                        </button>
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginTop: 8,
                        flexWrap: 'wrap',
                      }}>
                        <label style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}>
                          <input
                            type="checkbox"
                            checked
                            readOnly
                            style={{ width: 14, height: 14, accentColor: '#2563eb' }}
                          />
                          <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                            {task.task_type_label}
                          </span>
                        </label>

                        <DateTimePicker
                          value={toLocalValue(task.due_at)}
                          onChange={value => void updateDate(task, value)}
                          allowClear={false}
                          disabled={busy}
                          style={{ minWidth: 150 }}
                          inputStyle={{ padding: '4px 8px', borderRadius: 6, fontSize: 12 }}
                        />

                        {[{ label: 'завтра', days: 1 }, { label: 'через неделю', days: 7 }, { label: 'через месяц', days: 30 }].map(x => (
                          <button
                            key={x.days}
                            type="button"
                            disabled={busy}
                            onClick={() => void updateDate(task, shiftedDate(task, x.days))}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: '#64748b',
                              padding: '2px 0',
                              fontSize: 12,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {x.label}
                          </button>
                        ))}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(task)}
                          style={{
                            marginLeft: 'auto',
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            padding: '2px 0',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {error ? <div style={{ padding: '6px 12px 8px', color: '#dc2626', fontSize: 12 }}>{error}</div> : null}
    </div>
  )
}
