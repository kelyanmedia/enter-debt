import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import {
  PageHeader, Card, Th, Td, BtnPrimary, BtnOutline, BtnIconEdit, Empty,
  EmployeeTaskStatusSelect,
  formatDate, formatMoneyNumber, Modal, Field, Input, Select, ConfirmModal, MoneyInput,
} from '@/components/ui'
import api from '@/lib/api'
import {
  readTaskSummaryCurrency,
  writeTaskSummaryCurrency,
  type TaskSummaryCurrency,
} from '@/lib/taskSummaryCurrency'
import {
  exportStaffTasksPdf,
  exportStaffTasksPng,
  taskStatusRu,
  type StaffExportOptions,
} from '@/lib/staffTasksExport'
interface TaskRow {
  id: number
  work_date: string
  project_name: string
  task_description: string
  task_url?: string | null
  hours?: string | null
  amount?: string | null
  budget_amount?: string | null
  currency: string
  status: string
  paid?: boolean
  paid_at?: string | null
  done_at?: string | null
}

const MONTH_OPTIONS = [
  { v: 1, l: 'Январь' }, { v: 2, l: 'Февраль' }, { v: 3, l: 'Март' }, { v: 4, l: 'Апрель' },
  { v: 5, l: 'Май' }, { v: 6, l: 'Июнь' }, { v: 7, l: 'Июль' }, { v: 8, l: 'Август' },
  { v: 9, l: 'Сентябрь' }, { v: 10, l: 'Октябрь' }, { v: 11, l: 'Ноябрь' }, { v: 12, l: 'Декабрь' },
]

const EMPTY_FORM = {
  work_date: new Date().toISOString().slice(0, 10),
  project_name: '',
  task_description: '',
  task_url: '',
  hours: '',
  amount: '',
  budget_amount: '',
  include_budget: false,
  currency: 'USD',
  status: 'in_progress',
}

function num(v: string | null | undefined) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const ACTION_HINTS = {
  move:
    'Перенос в следующий месяц: дата задачи сдвигается на следующий календарный месяц, строка пропадает из текущего месяца. Подходит, если работа переносится.',
  paid:
    'Оплачено по учёту задачи: строка считается закрытой, сумма не входит в итог «к выплате» за месяц. Факт перевода деньгами фиксируйте в «История выплат». Снять отметку может только администратор.',
  duplicate:
    'Дубль: новая строка в следующем месяце с тем же проектом и суммой; текущая не меняется.',
  edit: 'Редактировать дату, проект, сумму, статус и др.',
  delete: 'Удалить строку без восстановления.',
} as const

export default function MyWorkPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [summaryCurrency, setSummaryCurrency] = useState<TaskSummaryCurrency>(() => readTaskSummaryCurrency())
  const [statusSavingId, setStatusSavingId] = useState<number | null>(null)
  const [revertAttempts, setRevertAttempts] = useState<Record<number, number>>({})
  const [lockExplainOpen, setLockExplainOpen] = useState(false)
  const [monthsWithTasks, setMonthsWithTasks] = useState<Set<number>>(() => new Set())
  const [monthMenuOpen, setMonthMenuOpen] = useState(false)
  const monthMenuRef = useRef<HTMLDivElement>(null)
  const [actionBusyId, setActionBusyId] = useState<number | null>(null)
  const [exportBusy, setExportBusy] = useState(false)

  const fetchMonthsWithTasks = useCallback(() => {
    return api
      .get<number[]>('employee-tasks/months-with-tasks', { params: { year } })
      .then((r) => setMonthsWithTasks(new Set(r.data)))
      .catch(() => setMonthsWithTasks(new Set()))
  }, [year])

  const load = useCallback(() => {
    setLoadingData(true)
    api
      .get<TaskRow[]>('employee-tasks', { params: { year, month } })
      .then((r) => setTasks(r.data))
      .catch(() => setTasks([]))
      .finally(() => {
        setLoadingData(false)
        void fetchMonthsWithTasks()
      })
  }, [year, month, fetchMonthsWithTasks])

  useEffect(() => {
    if (!loading && user && user.role !== 'employee') router.replace('/')
  }, [loading, user, router])

  useEffect(() => {
    setMonthMenuOpen(false)
  }, [year])

  useEffect(() => {
    if (!monthMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      const el = monthMenuRef.current
      if (el && !el.contains(e.target as Node)) setMonthMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMonthMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [monthMenuOpen])

  useEffect(() => {
    if (user?.role === 'employee') load()
  }, [user?.role, load])

  const openAdd = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, work_date: new Date().toISOString().slice(0, 10) })
    setError('')
    setModal(true)
  }

  const openEdit = (t: TaskRow) => {
    setEditing(t)
    setForm({
      work_date: t.work_date.slice(0, 10),
      project_name: t.project_name,
      task_description: t.task_description,
      task_url: t.task_url || '',
      hours: t.hours != null ? String(t.hours) : '',
      amount: t.amount != null ? String(t.amount) : '',
      budget_amount: t.budget_amount != null ? String(t.budget_amount) : '',
      include_budget: num(t.budget_amount) != null && (num(t.budget_amount) as number) > 0,
      currency: t.currency || 'USD',
      status: t.status,
    })
    setError('')
    setModal(true)
  }

  const save = async () => {
    setError('')
    if (!form.project_name.trim() || !form.task_description.trim()) {
      setError('Укажите проект и описание задачи')
      return
    }
    const b = form.include_budget ? Number(String(form.budget_amount).replace(/\s/g, '').replace(',', '.')) : null
    if (form.include_budget && (b == null || !Number.isFinite(b) || b <= 0)) {
      setError('Укажите сумму бюджета больше нуля или снимите галочку «Бюджет»')
      return
    }
    setSaving(true)
    try {
      const body = {
        work_date: form.work_date,
        project_name: form.project_name.trim(),
        task_description: form.task_description.trim(),
        task_url: form.task_url.trim() || null,
        hours: form.hours ? Number(form.hours.replace(',', '.')) : null,
        amount: form.amount ? Number(form.amount.replace(',', '.')) : null,
        budget_amount: form.include_budget && b != null && Number.isFinite(b) ? b : null,
        currency: form.currency,
        status: editing?.status === 'done' ? 'done' : form.status,
      }
      if (editing) {
        await api.patch(`employee-tasks/${editing.id}`, body)
      } else {
        await api.post('employee-tasks', body)
      }
      setModal(false)
      load()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const runDelete = async () => {
    if (deleteId == null) return
    try {
      await api.delete(`employee-tasks/${deleteId}`)
      setDeleteId(null)
      load()
    } catch {
      /* */
    }
  }

  const patchTaskStatus = async (taskId: number, next: string, row: TaskRow) => {
    if (row.status === 'done' && next !== 'done') {
      setRevertAttempts(prev => {
        const n = (prev[taskId] || 0) + 1
        if (n >= 5) setLockExplainOpen(true)
        return { ...prev, [taskId]: n }
      })
      return
    }
    setStatusSavingId(taskId)
    try {
      await api.patch(`employee-tasks/${taskId}`, { status: next })
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status: next } : t)))
    } catch {
      load()
    } finally {
      setStatusSavingId(null)
    }
  }

  const patchTaskPaid = async (taskId: number) => {
    setActionBusyId(taskId)
    try {
      await api.patch(`employee-tasks/${taskId}`, { paid: true })
      await load()
    } catch {
      load()
    } finally {
      setActionBusyId(null)
    }
  }

  const postMoveNextMonth = async (taskId: number) => {
    setActionBusyId(taskId)
    try {
      await api.post(`employee-tasks/${taskId}/move-next-month`)
      load()
    } catch {
      load()
    } finally {
      setActionBusyId(null)
    }
  }

  const postDuplicateNextMonth = async (taskId: number) => {
    setActionBusyId(taskId)
    try {
      await api.post(`employee-tasks/${taskId}/duplicate-next-month`)
      load()
    } catch {
      load()
    } finally {
      setActionBusyId(null)
    }
  }

  const totals = useMemo(
    () =>
      tasks.reduce(
        (acc, t) => {
          if (t.paid) return acc
          const h = num(t.hours)
          const a = num(t.amount)
          const bud = num(t.budget_amount)
          if (h != null) acc.h += h
          if (a != null) {
            if (t.currency === 'UZS') acc.uzs += a
            else acc.usd += a
          }
          if (bud != null && bud > 0) {
            if (t.currency === 'UZS') acc.uzs += bud
            else acc.usd += bud
          }
          return acc
        },
        { usd: 0, uzs: 0, h: 0 },
      ),
    [tasks],
  )

  const buildMyWorkExportOptions = useCallback((): StaffExportOptions | null => {
    if (!user) return null
    const monthLabel = MONTH_OPTIONS.find(m => m.v === month)?.l ?? String(month)
    const summaryLines: string[] = []
    summaryLines.push(
      summaryCurrency === 'USD'
        ? `Итого · USD: $${formatMoneyNumber(totals.usd)}`
        : `Итого · UZS: ${formatMoneyNumber(totals.uzs)} сум`,
    )
    summaryLines.push(
      `Часы (период): ${totals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}`,
    )
    if (summaryCurrency === 'UZS' && totals.usd > 0) {
      summaryLines.push(`Также в USD: $${formatMoneyNumber(totals.usd)}`)
    }
    if (summaryCurrency === 'USD' && totals.uzs > 0) {
      summaryLines.push(`Также в UZS: ${formatMoneyNumber(totals.uzs)} сум`)
    }
    const footerParts: string[] = []
    if (totals.uzs > 0) footerParts.push(`${formatMoneyNumber(totals.uzs)} сум`)
    if (totals.usd > 0) footerParts.push(`$${formatMoneyNumber(totals.usd)}`)
    return {
      periodTitle: `Задачи за ${monthLabel} ${year}`,
      employeeName: user.name,
      summaryLines,
      paymentDetails: user.payment_details?.trim() || '— не заполнено в профиле',
      rows: tasks.map(t => ({
        date: formatDate(t.work_date),
        project: t.project_name,
        task: t.task_description,
        hours: num(t.hours) != null ? String(num(t.hours)) : '—',
        amount: (() => {
          const a = num(t.amount)
          const bud = num(t.budget_amount)
          if (a == null && !(bud != null && bud > 0)) return '—'
          const bits: string[] = []
          if (a != null) {
            bits.push(t.currency === 'UZS' ? `${formatMoneyNumber(a)} сум` : `$${formatMoneyNumber(a)}`)
          }
          if (bud != null && bud > 0) {
            bits.push(
              t.currency === 'UZS'
                ? `+ ${formatMoneyNumber(bud)} сум бюджет`
                : `+ $${formatMoneyNumber(bud)} бюджет`,
            )
          }
          return bits.join('\n')
        })(),
        status: taskStatusRu(t.status),
        paid: !!t.paid,
      })),
      footerHours:
        totals.h > 0 ? totals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—',
      footerAmounts: footerParts.length ? footerParts.join(' · ') : '—',
    }
  }, [user, month, year, totals, summaryCurrency, tasks])

  const runExportPng = async () => {
    const opts = buildMyWorkExportOptions()
    if (!opts) return
    setExportBusy(true)
    try {
      const base = `zadachi_${user?.name ?? 'sotrudnik'}_${year}-${String(month).padStart(2, '0')}`
      await exportStaffTasksPng(opts, base)
    } catch {
      /* */
    } finally {
      setExportBusy(false)
    }
  }

  const runExportPdf = async () => {
    const opts = buildMyWorkExportOptions()
    if (!opts) return
    setExportBusy(true)
    try {
      const base = `zadachi_${user?.name ?? 'sotrudnik'}_${year}-${String(month).padStart(2, '0')}`
      await exportStaffTasksPdf(opts, base)
    } catch {
      /* */
    } finally {
      setExportBusy(false)
    }
  }

  if (loading || !user || user.role !== 'employee') return null

  return (
    <Layout>
      <PageHeader
        title="Мои задачи"
        subtitle={
          user.is_ad_budget_employee
            ? 'Учёт работ. Режим «Бюджет»: строка без поля «бюджет клиента» целиком не попадает в P&L; отметьте галочку и сумму бюджета, если часть перевода — ваша услуга. Справка — кнопка «Q&A» слева в меню.'
            : 'Учёт работ по проектам. После фактической выплаты внесите запись в «История выплат». Подробная инструкция — кнопка «Q&A» слева в меню.'
        }
        action={<BtnPrimary onClick={openAdd}>+ Добавить задачу</BtnPrimary>}
      />
      <div style={{ padding: '22px 24px', overflow: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18, alignItems: 'center' }}>
          <Select value={String(year)} onChange={e => setYear(Number(e.target.value))} style={{ maxWidth: 100 }}>
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
          <div ref={monthMenuRef} style={{ position: 'relative', width: 188, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setMonthMenuOpen((o) => !o)}
              aria-expanded={monthMenuOpen}
              aria-haspopup="listbox"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                border: '1px solid #e8e9ef',
                borderRadius: 9,
                padding: '10px 13px',
                fontSize: 14,
                background: '#fff',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: '#1a1d23',
                boxSizing: 'border-box',
              }}
            >
              <span>{MONTH_OPTIONS.find((x) => x.v === month)?.l ?? month}</span>
              <span style={{ fontSize: 10, color: '#8a8fa8' }} aria-hidden>▾</span>
            </button>
            {monthMenuOpen && (
              <div
                role="listbox"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 'calc(100% + 4px)',
                  minWidth: '100%',
                  background: '#fff',
                  borderRadius: 10,
                  border: '1px solid #e8e9ef',
                  boxShadow: '0 10px 40px rgba(15,23,42,.12)',
                  zIndex: 50,
                  maxHeight: 320,
                  overflowY: 'auto',
                  padding: '6px 0',
                }}
              >
                {MONTH_OPTIONS.map((opt) => {
                  const hasTasks = monthsWithTasks.has(opt.v)
                  const selected = month === opt.v
                  const baseBg = selected ? '#d1fae5' : hasTasks ? '#ecfdf5' : '#fff'
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setMonth(opt.v)
                        setMonthMenuOpen(false)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: 'none',
                        background: baseBg,
                        cursor: 'pointer',
                        fontSize: 14,
                        fontFamily: 'inherit',
                        color: '#1a1d23',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontWeight: selected ? 600 : hasTasks ? 500 : 400,
                      }}
                      onMouseEnter={(e) => {
                        if (selected) return
                        e.currentTarget.style.background = hasTasks ? '#d1fae5' : '#f1f5f9'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = selected ? '#d1fae5' : hasTasks ? '#ecfdf5' : '#fff'
                      }}
                    >
                      <span style={{ width: 18, flexShrink: 0, textAlign: 'center' }}>{selected ? '✓' : ''}</span>
                      {opt.l}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <span style={{ fontSize: 12, color: '#8a8fa8', flex: '1 1 200px', minWidth: 0 }}>
            Светло-зелёный месяц — есть хотя бы одна задача за {year} г.
          </span>
          <span style={{ fontSize: 12, color: '#8a8fa8' }}>Итог в</span>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
          <Card
            style={{
              padding: '14px 16px',
              background: summaryCurrency === 'USD' ? '#f8fafc' : '#f0fdf4',
              border: summaryCurrency === 'USD' ? '1px solid #e8e9ef' : '1px solid #c3e6d0',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase' }}>
              Итого · {summaryCurrency}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, lineHeight: 1.3 }}>
              только строки без отметки «оплачено» ($)
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                marginTop: 4,
                color: summaryCurrency === 'USD' ? '#1e3a5f' : '#166534',
              }}
            >
              {summaryCurrency === 'USD'
                ? `$${formatMoneyNumber(totals.usd)}`
                : `${formatMoneyNumber(totals.uzs)} сум`}
            </div>
            {summaryCurrency === 'UZS' && totals.usd > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                Также в USD: ${formatMoneyNumber(totals.usd)}
              </div>
            )}
            {summaryCurrency === 'USD' && totals.uzs > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.4 }}>
                Также в UZS: {formatMoneyNumber(totals.uzs)} сум
              </div>
            )}
          </Card>
          <Card style={{ padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase' }}>Часы</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#b45309' }}>{totals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</div>
          </Card>
        </div>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid #e8e9ef',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Задачи за {MONTH_OPTIONS.find(m => m.v === month)?.l} {year}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <BtnOutline
                type="button"
                disabled={exportBusy || loadingData}
                onClick={() => void runExportPng()}
                style={{ fontSize: 12, padding: '6px 12px', fontWeight: 600 }}
                title="Скачать сводку за месяц как PNG — удобно отправить в чат"
              >
                {exportBusy ? '…' : '🖼 Картинка'}
              </BtnOutline>
              <BtnOutline
                type="button"
                disabled={exportBusy || loadingData}
                onClick={() => void runExportPdf()}
                style={{ fontSize: 12, padding: '6px 12px', fontWeight: 600 }}
                title="PDF на всю высоту таблицы — удобно листать с телефона"
              >
                {exportBusy ? '…' : '📄 PDF'}
              </BtnOutline>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <Th>Дата</Th>
                <Th>Проект</Th>
                <Th>Тип задачи</Th>
                <Th>Часы</Th>
                <Th>Сумма</Th>
                <Th style={{ minWidth: 300 }}>Статус и действия</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const strike = t.paid
                const cellStrike = strike ? { textDecoration: 'line-through' as const, color: '#94a3b8' } : {}
                const busy = actionBusyId === t.id
                const iconBtn: CSSProperties = {
                  width: 36,
                  height: 36,
                  padding: 0,
                  borderRadius: 8,
                  border: '1px solid #e8e9ef',
                  background: '#fff',
                  cursor: busy ? 'wait' : 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#475569',
                  flexShrink: 0,
                  opacity: busy ? 0.5 : 1,
                  boxSizing: 'border-box',
                }
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: strike ? 0.88 : 1 }}>
                    <Td style={{ whiteSpace: 'nowrap', ...cellStrike }}>{formatDate(t.work_date)}</Td>
                    <Td style={{ fontWeight: 600, ...cellStrike }}>{t.project_name}</Td>
                    <Td style={{ color: '#64748b', maxWidth: 300, ...cellStrike }}>
                      {t.task_url ? (
                        <a href={t.task_url} target="_blank" rel="noreferrer" style={{ color: strike ? '#94a3b8' : '#2563eb' }}>{t.task_description}</a>
                      ) : (
                        t.task_description
                      )}
                    </Td>
                    <Td style={{ ...cellStrike }}>{num(t.hours) ?? '—'}</Td>
                    <Td style={{ fontWeight: 600, whiteSpace: 'pre-line', lineHeight: 1.35, ...cellStrike }}>
                      {(() => {
                        const a = num(t.amount)
                        const bud = num(t.budget_amount)
                        if (a == null && !(bud != null && bud > 0)) return '—'
                        return (
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {a != null && (
                              <span>
                                {t.currency === 'UZS'
                                  ? `${formatMoneyNumber(a)} сум`
                                  : `$${formatMoneyNumber(a)}`}
                              </span>
                            )}
                            {bud != null && bud > 0 && (
                              <span style={{ fontSize: 12, fontWeight: 600, color: strike ? '#94a3b8' : '#64748b' }}>
                                {t.currency === 'UZS'
                                  ? `+ ${formatMoneyNumber(bud)} сум бюджет`
                                  : `+ $${formatMoneyNumber(bud)} бюджет`}
                              </span>
                            )}
                          </span>
                        )
                      })()}
                    </Td>
                    <Td style={{ verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
                        <EmployeeTaskStatusSelect
                          value={t.status}
                          disabled={statusSavingId === t.id || busy}
                          onChange={(next) => {
                            if (next === t.status) return
                            void patchTaskStatus(t.id, next, t)
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                          <button
                            type="button"
                            title={ACTION_HINTS.move}
                            aria-label={ACTION_HINTS.move}
                            style={iconBtn}
                            disabled={busy}
                            onClick={() => void postMoveNextMonth(t.id)}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            title={ACTION_HINTS.paid}
                            aria-label={ACTION_HINTS.paid}
                            style={{
                              ...iconBtn,
                              fontWeight: 700,
                              fontSize: 15,
                              borderColor: t.paid ? '#86efac' : '#e8e9ef',
                              background: t.paid ? '#dcfce7' : '#fff',
                              color: t.paid ? '#166534' : '#475569',
                              cursor: t.paid || busy ? 'default' : 'pointer',
                            }}
                            disabled={busy || t.paid}
                            onClick={() => !t.paid && void patchTaskPaid(t.id)}
                          >
                            $
                          </button>
                          <button
                            type="button"
                            title={ACTION_HINTS.duplicate}
                            aria-label={ACTION_HINTS.duplicate}
                            style={iconBtn}
                            disabled={busy}
                            onClick={() => void postDuplicateNextMonth(t.id)}
                          >
                            ⧉
                          </button>
                          <BtnIconEdit
                            title={ACTION_HINTS.edit}
                            disabled={busy}
                            style={{ width: 36, height: 36 }}
                            onClick={() => openEdit(t)}
                          />
                          <BtnOutline
                            type="button"
                            title={ACTION_HINTS.delete}
                            aria-label={ACTION_HINTS.delete}
                            onClick={() => setDeleteId(t.id)}
                            disabled={busy}
                            style={{
                              padding: 0,
                              width: 36,
                              height: 36,
                              minHeight: 36,
                              fontSize: 14,
                              color: '#e84040',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxSizing: 'border-box',
                            }}
                          >
                            ✕
                          </BtnOutline>
                        </div>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
            {tasks.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f1f5f9' }}>
                  <Td colSpan={3} style={{ fontWeight: 700, fontSize: 13, color: '#475569', borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                    Итого по строкам (без оплаченных)
                  </Td>
                  <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                    {totals.h > 0 ? totals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—'}
                  </Td>
                  <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                    {totals.uzs > 0 || totals.usd > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.35 }}>
                        {totals.uzs > 0 && <span>{formatMoneyNumber(totals.uzs)} сум</span>}
                        {totals.usd > 0 && <span>${formatMoneyNumber(totals.usd)}</span>}
                      </div>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td style={{ borderBottom: 'none', borderTop: '2px solid #e2e8f0' }} />
                </tr>
              </tfoot>
            )}
          </table>
          {tasks.length === 0 && !loadingData && <Empty text="Нет записей за выбранный месяц" />}
        </Card>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Редактировать задачу' : 'Новая задача'}
        footer={(
          <>
            <BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline>
            <BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</BtnPrimary>
          </>
        )}
      >
        {error && (
          <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}
        <Field label="Дата *">
          <Input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} />
        </Field>
        <Field label="Проект *">
          <Input value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} placeholder="Клиент / название" />
        </Field>
        <Field label="Тип задачи *">
          <Input value={form.task_description} onChange={e => setForm(f => ({ ...f, task_description: e.target.value }))} placeholder="Лендинг, доработки, обучение…" />
        </Field>
        <Field label="Ссылка (по желанию)">
          <Input value={form.task_url} onChange={e => setForm(f => ({ ...f, task_url: e.target.value }))} placeholder="https://…" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Field label="Часы">
            <MoneyInput value={form.hours} onChange={v => setForm(f => ({ ...f, hours: v }))} placeholder="—" />
          </Field>
          <Field label="Сумма (работа)">
            <MoneyInput value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="—" />
          </Field>
          <Field label="Валюта">
            <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
              <option value="USD">USD</option>
              <option value="UZS">UZS</option>
            </Select>
          </Field>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: form.include_budget ? 10 : 14,
            cursor: 'pointer',
            fontSize: 13,
            color: '#334155',
          }}
        >
          <input
            type="checkbox"
            checked={form.include_budget}
            onChange={e =>
              setForm(f => ({
                ...f,
                include_budget: e.target.checked,
                budget_amount: e.target.checked ? f.budget_amount : '',
              }))
            }
          />
          <span>Бюджет клиента (проходные средства)</span>
        </label>
        {form.include_budget && (
          <Field label="Сумма бюджета">
            <MoneyInput
              value={form.budget_amount}
              onChange={v => setForm(f => ({ ...f, budget_amount: v }))}
              placeholder="0"
            />
          </Field>
        )}
        <Field label="Статус">
          {editing?.status === 'done' ? (
            <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0', lineHeight: 1.45 }}>
              Готово — статус нельзя снять самостоятельно. Другие поля можно править; чтобы вернуть статус назад, напишите администратору.
            </div>
          ) : (
            <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="not_started">Не начато</option>
              <option value="in_progress">В процессе</option>
              <option value="pending_approval">На утверждении</option>
              <option value="done">Готово</option>
            </Select>
          )}
        </Field>
      </Modal>

      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Удалить строку?"
        message="Действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={runDelete}
      />

      <Modal
        open={lockExplainOpen}
        onClose={() => setLockExplainOpen(false)}
        title="Статус и оплата зафиксированы"
        footer={<BtnPrimary onClick={() => setLockExplainOpen(false)}>Понятно</BtnPrimary>}
      >
        <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.55 }}>
          После «Готово» нельзя вернуть прежний статус самостоятельно. Отметку «Оплачено» тоже может снять только администратор.
          Если задача закрыта и с момента отметки оплаты прошло больше двух дней, вернуть строку в прежнее состояние может только администратор.
        </p>
      </Modal>
    </Layout>
  )
}
