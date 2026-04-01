import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import {
  PageHeader, Card, Th, Td, BtnOutline, BtnPrimary, BtnIconEdit, Empty,
  formatDate, formatMoneyNumber, Modal, Field, Input, Select, ConfirmModal, MoneyInput,
  EmployeeTaskStatusSelect,
} from '@/components/ui'
import api from '@/lib/api'
import {
  readTaskSummaryCurrency,
  writeTaskSummaryCurrency,
  type TaskSummaryCurrency,
} from '@/lib/taskSummaryCurrency'

interface StaffEmployee {
  id: number
  name: string
  email: string
  payment_details?: string | null
  task_count: number
}

interface TaskRow {
  id: number
  user_id: number
  work_date: string
  project_name: string
  task_description: string
  task_url?: string | null
  hours?: string | null
  amount?: string | null
  currency: string
  status: string
  created_at: string
}

interface MonthTotals {
  year: number
  month: number
  label: string
  total_usd: string
  total_uzs: string
  total_hours: string
}

const MONTH_OPTIONS = [
  { v: 1, l: 'Январь' }, { v: 2, l: 'Февраль' }, { v: 3, l: 'Март' }, { v: 4, l: 'Апрель' },
  { v: 5, l: 'Май' }, { v: 6, l: 'Июнь' }, { v: 7, l: 'Июль' }, { v: 8, l: 'Август' },
  { v: 9, l: 'Сентябрь' }, { v: 10, l: 'Октябрь' }, { v: 11, l: 'Ноябрь' }, { v: 12, l: 'Декабрь' },
]

function num(v: string | null | undefined) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function StaffPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const now = new Date()
  const [employees, setEmployees] = useState<StaffEmployee[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [totals, setTotals] = useState<MonthTotals | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [editTask, setEditTask] = useState<TaskRow | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [taskFormError, setTaskFormError] = useState('')
  const [statusSavingId, setStatusSavingId] = useState<number | null>(null)
  const [summaryCurrency, setSummaryCurrency] = useState<TaskSummaryCurrency>(() => readTaskSummaryCurrency())
  const [form, setForm] = useState({
    work_date: '',
    project_name: '',
    task_description: '',
    task_url: '',
    hours: '',
    amount: '',
    currency: 'USD',
    status: 'in_progress',
  })

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') router.replace('/')
  }, [loading, user, router])

  const loadEmployees = useCallback(() => {
    api.get<StaffEmployee[]>('employee-tasks/staff/employees')
      .then(r => {
        setEmployees(r.data)
        setSelectedId(prev => (prev === null && r.data.length ? r.data[0].id : prev))
      })
      .catch(() => setEmployees([]))
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') loadEmployees()
  }, [user?.role, loadEmployees])

  const loadDetail = useCallback(() => {
    if (!selectedId) return
    setLoadingData(true)
    Promise.all([
      api.get<TaskRow[]>('employee-tasks', { params: { user_id: selectedId, year, month } }),
      api.get<MonthTotals>('employee-tasks/staff/month-totals', { params: { user_id: selectedId, year, month } }),
    ])
      .then(([tr, tt]) => {
        setTasks(tr.data)
        setTotals(tt.data)
      })
      .catch(() => {
        setTasks([])
        setTotals(null)
      })
      .finally(() => setLoadingData(false))
  }, [selectedId, year, month])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const selected = useMemo(() => employees.find(e => e.id === selectedId) || null, [employees, selectedId])

  const taskRowTotals = useMemo(
    () =>
      tasks.reduce(
        (acc, t) => {
          const h = num(t.hours)
          const a = num(t.amount)
          if (h != null) acc.h += h
          if (a != null) {
            if (t.currency === 'UZS') acc.uzs += a
            else acc.usd += a
          }
          return acc
        },
        { usd: 0, uzs: 0, h: 0 },
      ),
    [tasks],
  )

  const parseNum = (s: string) => {
    const t = String(s).replace(/\s/g, '').replace(',', '.')
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  const openNewTask = () => {
    if (!selectedId) return
    setTaskFormError('')
    setCreateModalOpen(true)
    setEditTask(null)
    setForm({
      work_date: `${year}-${String(month).padStart(2, '0')}-01`,
      project_name: '',
      task_description: '',
      task_url: '',
      hours: '',
      amount: '',
      currency: 'UZS',
      status: 'in_progress',
    })
  }

  const openEdit = (t: TaskRow) => {
    setTaskFormError('')
    setCreateModalOpen(false)
    setEditTask(t)
    setForm({
      work_date: t.work_date.slice(0, 10),
      project_name: t.project_name,
      task_description: t.task_description,
      task_url: t.task_url || '',
      hours: t.hours != null ? String(t.hours) : '',
      amount: t.amount != null ? String(t.amount) : '',
      currency: t.currency || 'USD',
      status: t.status,
    })
  }

  const saveEdit = async () => {
    if (!editTask) return
    setSaving(true)
    setTaskFormError('')
    try {
      await api.patch(`employee-tasks/${editTask.id}`, {
        work_date: form.work_date,
        project_name: form.project_name,
        task_description: form.task_description,
        task_url: form.task_url.trim() || null,
        hours: parseNum(form.hours),
        amount: parseNum(form.amount),
        currency: form.currency,
        status: form.status,
      })
      setEditTask(null)
      loadDetail()
      loadEmployees()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setTaskFormError(typeof d === 'string' ? d : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const saveCreate = async () => {
    if (!selectedId) return
    setTaskFormError('')
    if (!form.project_name.trim() || !form.task_description.trim()) {
      setTaskFormError('Укажите проект и описание задачи')
      return
    }
    setSaving(true)
    try {
      await api.post('employee-tasks', {
        user_id: selectedId,
        work_date: form.work_date,
        project_name: form.project_name.trim(),
        task_description: form.task_description.trim(),
        task_url: form.task_url.trim() || null,
        hours: parseNum(form.hours),
        amount: parseNum(form.amount),
        currency: form.currency,
        status: form.status,
      })
      setCreateModalOpen(false)
      loadDetail()
      loadEmployees()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setTaskFormError(typeof d === 'string' ? d : 'Не удалось создать задачу')
    } finally {
      setSaving(false)
    }
  }

  const closeTaskModal = () => {
    setEditTask(null)
    setCreateModalOpen(false)
    setTaskFormError('')
  }

  const patchTaskStatus = async (taskId: number, status: string) => {
    setStatusSavingId(taskId)
    try {
      await api.patch(`employee-tasks/${taskId}`, { status })
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status } : t)))
    } catch {
      loadDetail()
    } finally {
      setStatusSavingId(null)
    }
  }

  const runDelete = async () => {
    if (deleteId == null) return
    try {
      await api.delete(`employee-tasks/${deleteId}`)
      setDeleteId(null)
      loadDetail()
      loadEmployees()
    } catch {
      /* */
    }
  }

  if (loading || !user || user.role !== 'admin') return null

  return (
    <Layout>
      <PageHeader title="Команда" subtitle="Сотрудники, задачи по месяцам и суммы к выплате" />
      <div style={{ padding: '22px 24px', overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 0, minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'nowrap',
            gap: 10,
            overflowX: 'auto',
            overflowY: 'hidden',
            paddingBottom: 16,
            marginBottom: 4,
            borderBottom: '1px solid #e8e9ef',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {employees.map(e => {
            const on = e.id === selectedId
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id)}
                style={{
                  flex: '0 0 auto',
                  minWidth: 200,
                  maxWidth: 280,
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: on ? '2px solid #1a6b3c' : '1px solid #e8e9ef',
                  background: on ? '#f0faf4' : '#fff',
                  cursor: 'pointer',
                  boxShadow: on ? '0 2px 12px rgba(26,107,60,.12)' : '0 1px 3px rgba(0,0,0,.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: on ? '#1a6b3c' : '#e8f5ee',
                    color: on ? '#fff' : '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 13,
                  }}
                  >
                    {e.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1d23', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{e.name}</div>
                    <div style={{ fontSize: 11, color: '#8a8fa8' }}>{e.task_count} задач всего</div>
                  </div>
                </div>
              </button>
            )
          })}
          {employees.length === 0 && (
            <div style={{ padding: '8px 0', width: '100%' }}>
              <Empty text="Нет сотрудников с ролью «Сотрудник»" />
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
          {!selected ? (
            <Card style={{ padding: 40 }}><Empty text={employees.length ? 'Выберите сотрудника выше' : 'Добавьте пользователей с ролью «Сотрудник»'} /></Card>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
                <Select value={String(year)} onChange={e => setYear(Number(e.target.value))} style={{ maxWidth: 100 }}>
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
                <Select value={String(month)} onChange={e => setMonth(Number(e.target.value))} style={{ maxWidth: 160 }}>
                  {MONTH_OPTIONS.map(m => (
                    <option key={m.v} value={m.v}>{m.l}</option>
                  ))}
                </Select>
                <BtnPrimary onClick={openNewTask} style={{ fontSize: 12, padding: '6px 14px' }}>
                  + Задача
                </BtnPrimary>
                <span style={{ fontSize: 12, color: '#8a8fa8', marginLeft: 4 }}>Итог в</span>
                <Select
                  value={summaryCurrency}
                  onChange={(e) => {
                    const c = e.target.value as TaskSummaryCurrency
                    setSummaryCurrency(c)
                    writeTaskSummaryCurrency(c)
                  }}
                  style={{ maxWidth: 100, fontSize: 12 }}
                >
                  <option value="UZS">UZS</option>
                  <option value="USD">USD</option>
                </Select>
                {loadingData && <span style={{ fontSize: 12, color: '#8a8fa8' }}>Загрузка…</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 18 }}>
                <Card
                  style={{
                    padding: '16px 18px',
                    background: summaryCurrency === 'USD'
                      ? 'linear-gradient(135deg, #f8fafc 0%, #fff 100%)'
                      : 'linear-gradient(135deg, #f0fdf4 0%, #fff 100%)',
                    border: summaryCurrency === 'USD' ? '1px solid #e8e9ef' : '1px solid #c3e6d0',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Итого · {summaryCurrency}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      marginTop: 6,
                      color: summaryCurrency === 'USD' ? '#1e3a5f' : '#166534',
                    }}
                  >
                    {summaryCurrency === 'USD'
                      ? `$${totals ? formatMoneyNumber(Number(totals.total_usd)) : '0'}`
                      : `${totals ? formatMoneyNumber(Number(totals.total_uzs)) : '0'} сум`}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{totals?.label || '—'}</div>
                  {totals && summaryCurrency === 'UZS' && Number(totals.total_usd) > 0 && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                      Также в USD: ${formatMoneyNumber(Number(totals.total_usd))}
                    </div>
                  )}
                  {totals && summaryCurrency === 'USD' && Number(totals.total_uzs) > 0 && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                      Также в UZS: {formatMoneyNumber(Number(totals.total_uzs))} сум
                    </div>
                  )}
                </Card>
                <Card style={{ padding: '16px 18px', background: 'linear-gradient(135deg, #fffbeb 0%, #fff 100%)', border: '1px solid #fde68a' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em' }}>Часы</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#b45309', marginTop: 6 }}>
                    {totals ? Number(totals.total_hours).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '0'}
                  </div>
                </Card>
              </div>

              <Card style={{ padding: '16px 18px', marginBottom: 18, border: '1px dashed #c5c8d4' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', marginBottom: 8 }}>Реквизиты для выплаты</div>
                <pre style={{
                  margin: 0, fontSize: 13, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap',
                  color: '#334155', lineHeight: 1.5,
                }}
                >
                  {selected.payment_details?.trim() || '— не заполнено в карточке пользователя'}
                </pre>
              </Card>

              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e8e9ef', fontWeight: 700, fontSize: 15 }}>
                  Задачи за {MONTH_OPTIONS.find(m => m.v === month)?.l} {year}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <Th>Дата</Th>
                      <Th>Проект</Th>
                      <Th>Задача</Th>
                      <Th>Часы</Th>
                      <Th>Сумма</Th>
                      <Th>Статус</Th>
                      <Th style={{ width: 72 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <Td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{formatDate(t.work_date)}</Td>
                        <Td style={{ fontWeight: 600, fontSize: 13 }}>{t.project_name}</Td>
                        <Td style={{ fontSize: 13, color: '#64748b', maxWidth: 280 }}>
                          {t.task_url ? (
                            <a href={t.task_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{t.task_description}</a>
                          ) : (
                            t.task_description
                          )}
                        </Td>
                        <Td style={{ fontSize: 13 }}>{num(t.hours) != null ? num(t.hours) : '—'}</Td>
                        <Td style={{ fontSize: 13, fontWeight: 600 }}>
                          {num(t.amount) != null
                            ? t.currency === 'UZS'
                              ? `${formatMoneyNumber(Number(t.amount))} сум`
                              : `$${formatMoneyNumber(Number(t.amount))}`
                            : '—'}
                        </Td>
                        <Td>
                          <EmployeeTaskStatusSelect
                            value={t.status}
                            disabled={statusSavingId === t.id}
                            onChange={next => {
                              if (next === t.status) return
                              void patchTaskStatus(t.id, next)
                            }}
                          />
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <BtnIconEdit onClick={() => openEdit(t)} />
                            <BtnOutline onClick={() => setDeleteId(t.id)} style={{ padding: '4px 8px', fontSize: 11, color: '#e84040' }}>✕</BtnOutline>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  {tasks.length > 0 && (
                    <tfoot>
                      <tr style={{ background: '#f1f5f9' }}>
                        <Td colSpan={3} style={{ fontWeight: 700, fontSize: 13, color: '#475569', borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                          Итого по строкам
                        </Td>
                        <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                          {taskRowTotals.h > 0
                            ? taskRowTotals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
                            : '—'}
                        </Td>
                        <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                          {taskRowTotals.uzs > 0 || taskRowTotals.usd > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.35 }}>
                              {taskRowTotals.uzs > 0 && (
                                <span>{formatMoneyNumber(taskRowTotals.uzs)} сум</span>
                              )}
                              {taskRowTotals.usd > 0 && (
                                <span>${formatMoneyNumber(taskRowTotals.usd)}</span>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td style={{ borderBottom: 'none', borderTop: '2px solid #e2e8f0' }} />
                        <Td style={{ borderBottom: 'none', borderTop: '2px solid #e2e8f0' }} />
                      </tr>
                    </tfoot>
                  )}
                </table>
                {tasks.length === 0 && !loadingData && (
                  <div style={{ padding: 32, textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>Нет строк за этот месяц</div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <Modal
        open={!!editTask || createModalOpen}
        onClose={closeTaskModal}
        title={createModalOpen ? `Новая задача · ${selected?.name ?? ''}` : 'Правка задачи (админ)'}
        footer={(
          <>
            <BtnOutline onClick={closeTaskModal}>Отмена</BtnOutline>
            <BtnPrimary
              onClick={createModalOpen ? saveCreate : saveEdit}
              disabled={saving}
            >
              {saving ? 'Сохранение…' : createModalOpen ? 'Добавить' : 'Сохранить'}
            </BtnPrimary>
          </>
        )}
      >
        {taskFormError && (
          <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
            {taskFormError}
          </div>
        )}
        <Field label="Дата">
          <Input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} />
        </Field>
        <Field label="Проект">
          <Input value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} />
        </Field>
        <Field label="Тип задачи / описание">
          <Input value={form.task_description} onChange={e => setForm(f => ({ ...f, task_description: e.target.value }))} />
        </Field>
        <Field label="Ссылка (Figma, GitHub…)">
          <Input value={form.task_url} onChange={e => setForm(f => ({ ...f, task_url: e.target.value }))} placeholder="https://…" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Часы">
            <MoneyInput value={form.hours} onChange={v => setForm(f => ({ ...f, hours: v }))} placeholder="—" />
          </Field>
          <Field label="Сумма">
            <MoneyInput value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="—" />
          </Field>
          <Field label="Валюта">
            <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </Select>
          </Field>
        </div>
        <Field label="Статус">
          <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="not_started">Не начато</option>
            <option value="in_progress">В процессе</option>
            <option value="pending_approval">На утверждении</option>
            <option value="done">Готово</option>
          </Select>
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Удалить задачу?"
        message="Строка будет удалена без восстановления."
        confirmLabel="Удалить"
        onConfirm={runDelete}
      />
    </Layout>
  )
}
