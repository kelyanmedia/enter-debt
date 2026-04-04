import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
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
import {
  exportStaffTasksPdf,
  exportStaffTasksPng,
  taskStatusRu,
  type StaffExportOptions,
} from '@/lib/staffTasksExport'
import { EmployeePaymentHistory } from '@/components/EmployeePaymentHistory'

interface StaffEmployee {
  id: number
  name: string
  email: string
  payment_details?: string | null
  payment_details_updated_at?: string | null
  task_count: number
  is_ad_budget_employee?: boolean
}

function requisitesRecentlyUpdated(iso?: string | null) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t < 30 * 86400000
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
  budget_amount?: string | null
  currency: string
  status: string
  paid?: boolean
  created_at: string
  allocated_payment_id?: number | null
  cost_category?: string | null
  allocated_payment_label?: string | null
}

interface AllocatablePayment {
  id: number
  description: string
  partner_name: string
  partner_manager_name?: string | null
}

interface MonthTotals {
  year: number
  month: number
  label: string
  total_usd: string
  total_uzs: string
  total_hours: string
  total_budget_usd?: string
  total_budget_uzs?: string
}

interface PendingPaymentMonth {
  year: number
  month: number
  label: string
  total_usd: string
  total_uzs: string
  total_hours: string
  task_count: number
  total_budget_usd?: string
  total_budget_uzs?: string
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

function projectsCostAllocationPayload(form: { allocated_payment_id: string; cost_category: string }):
  | { ok: true; allocated_payment_id: number | null; cost_category: string | null }
  | { ok: false; message: string } {
  const payIdStr = form.allocated_payment_id.trim()
  const cat = form.cost_category.trim().toLowerCase()
  if (!payIdStr && !cat) return { ok: true as const, allocated_payment_id: null, cost_category: null }
  if (!payIdStr || !cat) {
    return {
      ok: false as const,
      message:
        'Для учёта в Projects Cost выберите проект из «Проекты» и статью (дизайн / разработка / прочее / SEO), либо очистите оба поля.',
    }
  }
  return { ok: true as const, allocated_payment_id: Number(payIdStr), cost_category: cat }
}

const STAFF_TASK_HINTS = {
  move:
    'Перенос в следующий месяц: дата задачи сдвигается на следующий календарный месяц, строка пропадает из текущего месяца. Подходит, если работа ещё не закрыта и переносится.',
  paid:
    'Оплачено: отмечает строку как закрытую по выплате — текст зачёркивается, сумма не входит в итоги «к выплате». Повторный клик снимает отметку.',
  duplicate:
    'Дубль: создаётся новая строка в следующем месяце с тем же проектом и суммой; текущая строка не меняется. Удобно для повторяющихся оплат каждый месяц.',
  edit: 'Редактирование: открыть форму и изменить дату, проект, сумму, статус и другие поля.',
  delete: 'Удаление: строка удаляется без восстановления.',
  linkPc:
    'Проекты (Projects Cost): попап со списком проектов из «Проекты» и поиском по названию, партнёру и id. Выберите проект, статью себестоимости (дизайн / разработка / прочее / SEO) и сохраните — без открытия полной формы задачи.',
} as const

/** Тултип только при наведении на строку и на конкретную кнопку (состояние staffTipRow / staffTipKey на tr). */
function StaffActionWithTip({
  hint,
  tipKey,
  rowId,
  tipRowId,
  tipKeyActive,
  onTipKey,
  children,
}: {
  hint: string
  tipKey: string
  rowId: number
  tipRowId: number | null
  tipKeyActive: string | null
  onTipKey: (key: string | null) => void
  children: ReactNode
}) {
  const open = tipRowId === rowId && tipKeyActive === tipKey
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: open ? 30 : 1,
      }}
      onMouseEnter={() => onTipKey(tipKey)}
      onMouseLeave={() => onTipKey(null)}
    >
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translate(-50%, -10px)',
            padding: '10px 12px',
            background: '#0f172a',
            color: '#f1f5f9',
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.45,
            borderRadius: 10,
            width: 248,
            maxWidth: 'min(268px, 90vw)',
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.38)',
            pointerEvents: 'none',
            textAlign: 'left',
          }}
        >
          {hint}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              marginLeft: -8,
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '9px solid #0f172a',
            }}
          />
        </div>
      )}
      {children}
    </div>
  )
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
  const [actionBusyId, setActionBusyId] = useState<number | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [staffTipRow, setStaffTipRow] = useState<number | null>(null)
  const [staffTipKey, setStaffTipKey] = useState<string | null>(null)
  const [summaryCurrency, setSummaryCurrency] = useState<TaskSummaryCurrency>(() => readTaskSummaryCurrency())
  const [form, setForm] = useState({
    work_date: '',
    project_name: '',
    task_description: '',
    task_url: '',
    hours: '',
    amount: '',
    budget_amount: '',
    include_budget: false,
    currency: 'USD',
    status: 'in_progress',
    allocated_payment_id: '',
    cost_category: '',
  })
  const [staffSection, setStaffSection] = useState<'tasks' | 'payments' | 'pending'>('tasks')
  const [pendingMonths, setPendingMonths] = useState<PendingPaymentMonth[]>([])
  const [allocatablePayments, setAllocatablePayments] = useState<AllocatablePayment[]>([])
  const [allocateModalTask, setAllocateModalTask] = useState<TaskRow | null>(null)
  const [allocateSearch, setAllocateSearch] = useState('')
  const [allocateSelectedId, setAllocateSelectedId] = useState<number | null>(null)
  const [allocateCategory, setAllocateCategory] = useState('')
  const [allocateSaving, setAllocateSaving] = useState(false)
  const [allocateError, setAllocateError] = useState('')

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') router.replace('/')
  }, [loading, user, router])

  useEffect(() => {
    setStaffSection('tasks')
  }, [selectedId])

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
      api.get<PendingPaymentMonth[]>('employee-tasks/staff/pending-payments-summary', { params: { user_id: selectedId } }),
    ])
      .then(([tr, tt, pp]) => {
        setTasks(tr.data)
        setTotals(tt.data)
        setPendingMonths(pp.data)
      })
      .catch(() => {
        setTasks([])
        setTotals(null)
        setPendingMonths([])
      })
      .finally(() => setLoadingData(false))
  }, [selectedId, year, month])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const loadAllocatablePayments = useCallback(() => {
    api
      .get<AllocatablePayment[]>('commissions/linkable-payments')
      .then(r => setAllocatablePayments(r.data || []))
      .catch(() => setAllocatablePayments([]))
  }, [])

  useEffect(() => {
    if (!createModalOpen && !editTask) return
    loadAllocatablePayments()
  }, [createModalOpen, editTask, loadAllocatablePayments])

  const filteredAllocatablePayments = useMemo(() => {
    const q = allocateSearch.trim().toLowerCase()
    if (!q) return allocatablePayments
    return allocatablePayments.filter(p => {
      const desc = (p.description || '').toLowerCase()
      const pn = (p.partner_name || '').toLowerCase()
      const pm = (p.partner_manager_name || '').toLowerCase()
      const idStr = String(p.id)
      return desc.includes(q) || pn.includes(q) || pm.includes(q) || idStr.includes(q)
    })
  }, [allocatablePayments, allocateSearch])

  const openAllocateModal = (t: TaskRow) => {
    setAllocateError('')
    setAllocateSearch('')
    setAllocateSelectedId(t.allocated_payment_id ?? null)
    setAllocateCategory((t.cost_category || '').trim().toLowerCase())
    setAllocateModalTask(t)
    loadAllocatablePayments()
  }

  const closeAllocateModal = () => {
    setAllocateModalTask(null)
    setAllocateError('')
    setAllocateSearch('')
  }

  const saveAllocate = async () => {
    if (!allocateModalTask) return
    if (allocateSelectedId == null || !allocateCategory.trim()) {
      setAllocateError('Выберите проект в списке и статью себестоимости (или нажмите «Снять привязку»).')
      return
    }
    const cat = allocateCategory.trim().toLowerCase()
    if (!['design', 'dev', 'other', 'seo'].includes(cat)) {
      setAllocateError('Статья: дизайн, разработка, прочее или SEO.')
      return
    }
    setAllocateSaving(true)
    setAllocateError('')
    try {
      await api.patch(`employee-tasks/${allocateModalTask.id}`, {
        allocated_payment_id: allocateSelectedId,
        cost_category: cat,
      })
      closeAllocateModal()
      loadDetail()
      loadEmployees()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setAllocateError(typeof d === 'string' ? d : 'Не удалось сохранить')
    } finally {
      setAllocateSaving(false)
    }
  }

  const clearAllocate = async () => {
    if (!allocateModalTask) return
    setAllocateSaving(true)
    setAllocateError('')
    try {
      await api.patch(`employee-tasks/${allocateModalTask.id}`, {
        allocated_payment_id: null,
        cost_category: null,
      })
      closeAllocateModal()
      loadDetail()
      loadEmployees()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setAllocateError(typeof d === 'string' ? d : 'Не удалось снять привязку')
    } finally {
      setAllocateSaving(false)
    }
  }

  const selected = useMemo(() => employees.find(e => e.id === selectedId) || null, [employees, selectedId])

  const requisitesHighlight = useMemo(
    () => requisitesRecentlyUpdated(selected?.payment_details_updated_at),
    [selected?.payment_details_updated_at],
  )

  const taskRowTotals = useMemo(
    () =>
      tasks.reduce(
        (acc, t) => {
          if (t.paid) return acc
          const h = num(t.hours)
          const a = num(t.amount)
          const b = num(t.budget_amount)
          if (h != null) acc.h += h
          if (a != null) {
            if (t.currency === 'UZS') acc.uzs += a
            else acc.usd += a
          }
          if (b != null && b > 0) {
            if (t.currency === 'UZS') acc.uzs += b
            else acc.usd += b
          }
          return acc
        },
        { usd: 0, uzs: 0, h: 0 },
      ),
    [tasks],
  )

  const pendingMonthsTotals = useMemo(
    () =>
      pendingMonths.reduce(
        (acc, row) => {
          acc.tasks += row.task_count || 0
          acc.uzs += Number(row.total_uzs) || 0
          acc.usd += Number(row.total_usd) || 0
          acc.h += Number(row.total_hours) || 0
          return acc
        },
        { tasks: 0, uzs: 0, usd: 0, h: 0 },
      ),
    [pendingMonths],
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
      budget_amount: '',
      include_budget: false,
      currency: 'UZS',
      status: 'in_progress',
      allocated_payment_id: '',
      cost_category: '',
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
      budget_amount: t.budget_amount != null ? String(t.budget_amount) : '',
      include_budget: num(t.budget_amount) != null && (num(t.budget_amount) as number) > 0,
      currency: t.currency || 'USD',
      status: t.status,
      allocated_payment_id: t.allocated_payment_id != null && t.allocated_payment_id !== undefined ? String(t.allocated_payment_id) : '',
      cost_category: t.cost_category?.trim() ? t.cost_category.trim().toLowerCase() : '',
    })
  }

  const saveEdit = async () => {
    if (!editTask) return
    setTaskFormError('')
    const b = form.include_budget ? parseNum(form.budget_amount) : null
    if (form.include_budget && (b == null || b <= 0)) {
      setTaskFormError('Укажите сумму бюджета больше нуля или снимите галочку «Бюджет»')
      return
    }
    const alloc = projectsCostAllocationPayload(form)
    if (alloc.ok === false) {
      setTaskFormError(alloc.message)
      return
    }
    setSaving(true)
    try {
      await api.patch(`employee-tasks/${editTask.id}`, {
        work_date: form.work_date,
        project_name: form.project_name,
        task_description: form.task_description,
        task_url: form.task_url.trim() || null,
        hours: parseNum(form.hours),
        amount: parseNum(form.amount),
        budget_amount: form.include_budget ? b : null,
        currency: form.currency,
        status: form.status,
        allocated_payment_id: alloc.allocated_payment_id,
        cost_category: alloc.cost_category,
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
    const b = form.include_budget ? parseNum(form.budget_amount) : null
    if (form.include_budget && (b == null || b <= 0)) {
      setTaskFormError('Укажите сумму бюджета больше нуля или снимите галочку «Бюджет»')
      return
    }
    const alloc = projectsCostAllocationPayload(form)
    if (alloc.ok === false) {
      setTaskFormError(alloc.message)
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
        budget_amount: form.include_budget ? b : null,
        currency: form.currency,
        status: form.status,
        allocated_payment_id: alloc.allocated_payment_id,
        cost_category: alloc.cost_category,
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

  const postMoveNextMonth = async (taskId: number) => {
    setActionBusyId(taskId)
    try {
      await api.post(`employee-tasks/${taskId}/move-next-month`)
      loadDetail()
      loadEmployees()
    } catch {
      loadDetail()
    } finally {
      setActionBusyId(null)
    }
  }

  const postDuplicateNextMonth = async (taskId: number) => {
    setActionBusyId(taskId)
    try {
      await api.post(`employee-tasks/${taskId}/duplicate-next-month`)
      loadDetail()
      loadEmployees()
    } catch {
      loadDetail()
    } finally {
      setActionBusyId(null)
    }
  }

  const toggleTaskPaid = async (t: TaskRow) => {
    setActionBusyId(t.id)
    try {
      await api.patch(`employee-tasks/${t.id}`, { paid: !t.paid })
      loadDetail()
    } catch {
      loadDetail()
    } finally {
      setActionBusyId(null)
    }
  }

  const buildStaffExportOptions = useCallback((): StaffExportOptions | null => {
    if (!selected) return null
    const monthLabel = MONTH_OPTIONS.find(m => m.v === month)?.l ?? String(month)
    const summaryLines: string[] = []
    if (totals) {
      summaryLines.push(
        summaryCurrency === 'USD'
          ? `Итого · USD: $${formatMoneyNumber(Number(totals.total_usd))}`
          : `Итого · UZS: ${formatMoneyNumber(Number(totals.total_uzs))} сум`,
      )
      summaryLines.push(
        `Часы (период): ${Number(totals.total_hours).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}`,
      )
      if (summaryCurrency === 'UZS' && Number(totals.total_usd) > 0) {
        summaryLines.push(`Также в USD: $${formatMoneyNumber(Number(totals.total_usd))}`)
      }
      if (summaryCurrency === 'USD' && Number(totals.total_uzs) > 0) {
        summaryLines.push(`Также в UZS: ${formatMoneyNumber(Number(totals.total_uzs))} сум`)
      }
    }
    const footerParts: string[] = []
    if (taskRowTotals.uzs > 0) footerParts.push(`${formatMoneyNumber(taskRowTotals.uzs)} сум`)
    if (taskRowTotals.usd > 0) footerParts.push(`$${formatMoneyNumber(taskRowTotals.usd)}`)
    return {
      periodTitle: `Задачи за ${monthLabel} ${year}`,
      employeeName: selected.name,
      summaryLines,
      paymentDetails:
        selected.payment_details?.trim() || '— не заполнено в карточке пользователя',
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
        taskRowTotals.h > 0
          ? taskRowTotals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
          : '—',
      footerAmounts: footerParts.length ? footerParts.join(' · ') : '—',
    }
  }, [selected, month, year, totals, summaryCurrency, tasks, taskRowTotals])

  const runExportPng = async () => {
    const opts = buildStaffExportOptions()
    if (!opts) return
    setExportBusy(true)
    try {
      const base = `zadachi_${selected?.name ?? 'sotrudnik'}_${year}-${String(month).padStart(2, '0')}`
      await exportStaffTasksPng(opts, base)
    } catch {
      /* */
    } finally {
      setExportBusy(false)
    }
  }

  const runExportPdf = async () => {
    const opts = buildStaffExportOptions()
    if (!opts) return
    setExportBusy(true)
    try {
      const base = `zadachi_${selected?.name ?? 'sotrudnik'}_${year}-${String(month).padStart(2, '0')}`
      await exportStaffTasksPdf(opts, base)
    } catch {
      /* */
    } finally {
      setExportBusy(false)
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
      <PageHeader
        title="Команда"
        subtitle="Задачи и выплаты. Привязка к Projects Cost — в форме задачи или кнопкой 🔗 в строке (поиск по проектам). Поле «бюджет» — проходные средства клиента (укажите ту же долю при записи выплаты в истории)."
      />
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
            flexShrink: 0,
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
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1d23', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                      {e.is_ad_budget_employee && (
                        <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#b45309', background: '#fef3c7', padding: '2px 6px', borderRadius: 6 }}>Бюджет</span>
                      )}
                    </div>
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

        <div style={{ flex: 1, minWidth: 0, minHeight: 0, paddingTop: 12 }}>
          {!selected ? (
            <Card style={{ padding: 40 }}><Empty text={employees.length ? 'Выберите сотрудника выше' : 'Добавьте пользователей с ролью «Сотрудник»'} /></Card>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                  borderBottom: '1px solid #e8e9ef',
                  paddingBottom: 12,
                }}
              >
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setStaffSection('tasks')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9,
                      border: staffSection === 'tasks' ? '2px solid #1a6b3c' : '1px solid #e8e9ef',
                      background: staffSection === 'tasks' ? '#f0faf4' : '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      color: staffSection === 'tasks' ? '#1a6b3c' : '#64748b',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Задачи
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffSection('payments')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9,
                      border: staffSection === 'payments' ? '2px solid #1a6b3c' : '1px solid #e8e9ef',
                      background: staffSection === 'payments' ? '#f0faf4' : '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      color: staffSection === 'payments' ? '#1a6b3c' : '#64748b',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    История выплат
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffSection('pending')}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 9,
                      border: staffSection === 'pending' ? '2px solid #1a6b3c' : '1px solid #e8e9ef',
                      background: staffSection === 'pending' ? '#f0faf4' : '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      color: staffSection === 'pending' ? '#1a6b3c' : '#64748b',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Ожидают оплаты
                  </button>
                </div>

                <div
                  style={{
                    flex: '1 1 360px',
                    minWidth: 260,
                    maxWidth: 560,
                    padding: '8px 12px',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    justifyContent: 'flex-start',
                    alignSelf: 'flex-start',
                    minHeight: 62,
                    boxSizing: 'border-box',
                    ...(requisitesHighlight
                      ? {
                          border: '2px solid #eab308',
                          background: 'linear-gradient(135deg, #fefce8 0%, #fffbeb 100%)',
                          boxShadow: '0 1px 8px rgba(234,179,8,.12)',
                        }
                      : { border: '1px dashed #c5c8d4', background: '#fafbfc' }),
                  }}
                  title={
                    selected.payment_details?.trim()
                      ? selected.payment_details.trim()
                      : 'Не заполнено в карточке пользователя'
                  }
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      Реквизиты для выплаты
                    </span>
                    {requisitesHighlight && (
                      <span
                        title="Реквизиты недавно менялись"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#854d0e',
                          background: '#fde047',
                          padding: '2px 6px',
                          borderRadius: 5,
                        }}
                      >
                        Обновлены
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      margin: 0,
                      fontSize: 12,
                      fontFamily: 'ui-monospace, monospace',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      color: '#334155',
                      lineHeight: 1.4,
                      overflow: 'hidden',
                    }}
                  >
                    {selected.payment_details?.trim() || '— не заполнено в карточке пользователя'}
                  </div>
                </div>

                {staffSection === 'tasks' && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
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
                )}
              </div>

              {staffSection === 'tasks' && (
                <>
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
                  {totals &&
                    summaryCurrency === 'UZS' &&
                    Number(totals.total_budget_uzs ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.4 }}>
                        В т.ч. бюджет клиента (не в P&L): {formatMoneyNumber(Number(totals.total_budget_uzs))} сум
                      </div>
                    )}
                  {totals &&
                    summaryCurrency === 'USD' &&
                    Number(totals.total_budget_usd ?? 0) > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.4 }}>
                        В т.ч. бюджет клиента (не в P&L): ${formatMoneyNumber(Number(totals.total_budget_usd))}
                      </div>
                    )}
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

              <Card style={{ padding: 0, overflow: 'visible' }}>
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
                      disabled={exportBusy || !selected}
                      onClick={() => void runExportPng()}
                      style={{ fontSize: 12, padding: '6px 12px', fontWeight: 600 }}
                      title="Скачать сводку за месяц как PNG — удобно отправить в чат"
                    >
                      {exportBusy ? '…' : '🖼 Картинка'}
                    </BtnOutline>
                    <BtnOutline
                      type="button"
                      disabled={exportBusy || !selected}
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
                      <Th>Задача</Th>
                      <Th>Часы</Th>
                      <Th>Сумма</Th>
                      <Th
                        title="Распределение в Projects Cost: проект из «Проекты» и статья (видно только администратору)."
                        style={{ maxWidth: 168 }}
                      >
                        Учёт ПС
                      </Th>
                      <Th style={{ minWidth: 380 }}>Статус и действия</Th>
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
                        <tr
                          key={t.id}
                          style={{ borderBottom: '1px solid #f1f5f9', opacity: strike ? 0.88 : 1 }}
                          onMouseEnter={() => setStaffTipRow(t.id)}
                          onMouseLeave={() => {
                            setStaffTipRow(null)
                            setStaffTipKey(null)
                          }}
                        >
                          <Td style={{ whiteSpace: 'nowrap', fontSize: 13, ...cellStrike }}>{formatDate(t.work_date)}</Td>
                          <Td style={{ fontWeight: 600, fontSize: 13, ...cellStrike }}>{t.project_name}</Td>
                          <Td style={{ fontSize: 13, color: strike ? '#94a3b8' : '#64748b', maxWidth: 280, ...cellStrike }}>
                            {t.task_url ? (
                              <a href={t.task_url} target="_blank" rel="noreferrer" style={{ color: strike ? '#94a3b8' : '#2563eb' }}>{t.task_description}</a>
                            ) : (
                              t.task_description
                            )}
                          </Td>
                          <Td style={{ fontSize: 13, ...cellStrike }}>{num(t.hours) != null ? num(t.hours) : '—'}</Td>
                          <Td style={{ fontSize: 13, fontWeight: 600, ...cellStrike, whiteSpace: 'pre-line', lineHeight: 1.35 }}>
                            {(() => {
                              const a = num(t.amount)
                              const bud = num(t.budget_amount)
                              if (a == null && !(bud != null && bud > 0)) return '—'
                              const lines: ReactNode[] = []
                              if (a != null) {
                                lines.push(
                                  <span key="w">
                                    {t.currency === 'UZS'
                                      ? `${formatMoneyNumber(a)} сум`
                                      : `$${formatMoneyNumber(a)}`}
                                  </span>,
                                )
                              }
                              if (bud != null && bud > 0) {
                                lines.push(
                                  <span key="b" style={{ fontSize: 12, fontWeight: 600, color: strike ? '#94a3b8' : '#64748b' }}>
                                    {t.currency === 'UZS'
                                      ? `+ ${formatMoneyNumber(bud)} сум бюджет`
                                      : `+ $${formatMoneyNumber(bud)} бюджет`}
                                  </span>,
                                )
                              }
                              return (
                                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {lines}
                                </span>
                              )
                            })()}
                          </Td>
                          <Td
                            style={{
                              fontSize: 11,
                              color: '#64748b',
                              maxWidth: 180,
                              lineHeight: 1.35,
                              verticalAlign: 'middle',
                              wordBreak: 'break-word',
                              ...cellStrike,
                            }}
                          >
                            {t.allocated_payment_label?.trim() ? t.allocated_payment_label : '—'}
                          </Td>
                          <Td style={{ verticalAlign: 'middle' }}>
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '10px 14px',
                              }}
                            >
                              <EmployeeTaskStatusSelect
                                value={t.status}
                                disabled={statusSavingId === t.id || busy}
                                onChange={next => {
                                  if (next === t.status) return
                                  void patchTaskStatus(t.id, next)
                                }}
                              />
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.move}
                                  tipKey="move"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <button
                                    type="button"
                                    aria-label={STAFF_TASK_HINTS.move}
                                    style={iconBtn}
                                    disabled={busy}
                                    onClick={() => void postMoveNextMonth(t.id)}
                                  >
                                    →
                                  </button>
                                </StaffActionWithTip>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.paid}
                                  tipKey="paid"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <button
                                    type="button"
                                    aria-label={STAFF_TASK_HINTS.paid}
                                    style={{
                                      ...iconBtn,
                                      fontWeight: 700,
                                      fontSize: 15,
                                      borderColor: t.paid ? '#86efac' : '#e8e9ef',
                                      background: t.paid ? '#dcfce7' : '#fff',
                                      color: t.paid ? '#166534' : '#475569',
                                    }}
                                    disabled={busy}
                                    onClick={() => void toggleTaskPaid(t)}
                                  >
                                    $
                                  </button>
                                </StaffActionWithTip>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.duplicate}
                                  tipKey="dup"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <button
                                    type="button"
                                    aria-label={STAFF_TASK_HINTS.duplicate}
                                    style={iconBtn}
                                    disabled={busy}
                                    onClick={() => void postDuplicateNextMonth(t.id)}
                                  >
                                    ⧉
                                  </button>
                                </StaffActionWithTip>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.linkPc}
                                  tipKey="link"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <button
                                    type="button"
                                    aria-label={STAFF_TASK_HINTS.linkPc}
                                    style={{
                                      ...iconBtn,
                                      border: t.allocated_payment_id ? '1px solid #86efac' : '1px solid #e8e9ef',
                                      background: t.allocated_payment_id ? '#f0fdf4' : '#fff',
                                    }}
                                    disabled={busy}
                                    onClick={() => openAllocateModal(t)}
                                  >
                                    🔗
                                  </button>
                                </StaffActionWithTip>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.edit}
                                  tipKey="edit"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <BtnIconEdit
                                    title={STAFF_TASK_HINTS.edit}
                                    disabled={busy}
                                    style={{ width: 36, height: 36 }}
                                    onClick={() => openEdit(t)}
                                  />
                                </StaffActionWithTip>
                                <StaffActionWithTip
                                  hint={STAFF_TASK_HINTS.delete}
                                  tipKey="del"
                                  rowId={t.id}
                                  tipRowId={staffTipRow}
                                  tipKeyActive={staffTipKey}
                                  onTipKey={setStaffTipKey}
                                >
                                  <BtnOutline
                                    type="button"
                                    aria-label={STAFF_TASK_HINTS.delete}
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
                                </StaffActionWithTip>
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

              {staffSection === 'payments' && selected && (
                <Card style={{ padding: '18px 20px' }}>
                  <EmployeePaymentHistory mode="admin" userId={selected.id} key={selected.id} />
                </Card>
              )}

              {staffSection === 'pending' && (
                <Card style={{ padding: '14px 18px' }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                    Все месяцы, где есть неоплаченные задачи сотрудника. Нажмите строку, чтобы открыть этот месяц в разделе «Задачи».
                  </div>
                  {pendingMonths.length === 0 ? (
                    <Empty text="По сотруднику нет ожидающих оплат" />
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <Th>Период</Th>
                          <Th>Задач</Th>
                          <Th>К выплате</Th>
                          <Th>Часы</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {pendingMonths.map((row) => (
                          <tr key={`${row.year}-${row.month}`} style={{ borderBottom: '1px solid #eef2f7' }}>
                            <Td style={{ fontWeight: 600 }}>{row.label}</Td>
                            <Td>{row.task_count}</Td>
                            <Td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {Number(row.total_uzs) > 0 && (
                                  <span>{formatMoneyNumber(Number(row.total_uzs))} сум</span>
                                )}
                                {Number(row.total_usd) > 0 && (
                                  <span>${formatMoneyNumber(Number(row.total_usd))}</span>
                                )}
                                {Number(row.total_uzs) <= 0 && Number(row.total_usd) <= 0 && <span>—</span>}
                              </div>
                            </Td>
                            <Td>
                              {Number(row.total_hours) > 0
                                ? Number(row.total_hours).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
                                : '—'}
                            </Td>
                            <Td style={{ textAlign: 'right' }}>
                              <BtnOutline
                                type="button"
                                onClick={() => {
                                  setYear(row.year)
                                  setMonth(row.month)
                                  setStaffSection('tasks')
                                }}
                                style={{ padding: '6px 10px', fontSize: 12 }}
                              >
                                Открыть месяц
                              </BtnOutline>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <Td style={{ fontWeight: 700, fontSize: 13, color: '#475569', borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                            Итого
                          </Td>
                          <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                            {pendingMonthsTotals.tasks}
                          </Td>
                          <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                            {pendingMonthsTotals.uzs > 0 || pendingMonthsTotals.usd > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.35 }}>
                                {pendingMonthsTotals.uzs > 0 && (
                                  <span>{formatMoneyNumber(pendingMonthsTotals.uzs)} сум</span>
                                )}
                                {pendingMonthsTotals.usd > 0 && (
                                  <span>${formatMoneyNumber(pendingMonthsTotals.usd)}</span>
                                )}
                              </div>
                            ) : (
                              '—'
                            )}
                          </Td>
                          <Td style={{ fontWeight: 700, fontSize: 13, borderBottom: 'none', borderTop: '2px solid #e2e8f0' }}>
                            {pendingMonthsTotals.h > 0
                              ? pendingMonthsTotals.h.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
                              : '—'}
                          </Td>
                          <Td style={{ borderBottom: 'none', borderTop: '2px solid #e2e8f0' }} />
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </Card>
              )}
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
        {selected?.is_ad_budget_employee && (
          <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', borderRadius: 8, padding: '10px 12px', marginBottom: 12, lineHeight: 1.45 }}>
            Режим <strong>«Бюджет»</strong>: без галочки ниже вся сумма строки считается рекламным бюджетом клиента и не попадает в P&L. Отметьте галочку и введите сумму бюджета, если часть — ваша услуга.
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
          <span>Бюджет клиента (проходные средства, не расход компании в P&L)</span>
        </label>
        {form.include_budget && (
          <Field label="Сумма бюджета (та же валюта)">
            <MoneyInput
              value={form.budget_amount}
              onChange={v => setForm(f => ({ ...f, budget_amount: v }))}
              placeholder="0"
            />
          </Field>
        )}
        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            background: '#f1f5f9',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
            Учёт в Projects Cost
          </div>
          <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px', lineHeight: 1.45 }}>
            В отчёт попадает сумма работы минус «бюджет клиента». UZS — как есть; USD — по курсу месяца даты задачи из «Доступные средства» (без курса строка в Projects Cost не учитывается).
          </p>
          <Field label="Проект («Проекты»)">
            <Select
              value={form.allocated_payment_id}
              onChange={e => setForm(f => ({ ...f, allocated_payment_id: e.target.value }))}
            >
              <option value="">— не распределять —</option>
              {allocatablePayments.map(p => (
                <option key={p.id} value={String(p.id)}>
                  {(p.description || '').trim() || `Проект #${p.id}`} · {p.partner_name || '—'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Статья себестоимости">
            <Select
              value={form.cost_category}
              onChange={e => setForm(f => ({ ...f, cost_category: e.target.value }))}
            >
              <option value="">—</option>
              <option value="design">Дизайн</option>
              <option value="dev">Разработка</option>
              <option value="other">Прочее</option>
              <option value="seo">SEO</option>
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

      <Modal
        open={allocateModalTask !== null}
        onClose={closeAllocateModal}
        title="Привязка к проекту (Projects Cost)"
        footer={(
          <>
            <BtnOutline type="button" onClick={closeAllocateModal} disabled={allocateSaving}>
              Отмена
            </BtnOutline>
            <BtnOutline
              type="button"
              onClick={() => void clearAllocate()}
              disabled={
                allocateSaving ||
                !allocateModalTask ||
                (allocateModalTask.allocated_payment_id == null &&
                  !(allocateModalTask.cost_category && allocateModalTask.cost_category.trim()))
              }
            >
              Снять привязку
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void saveAllocate()} disabled={allocateSaving}>
              {allocateSaving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        )}
      >
        {allocateModalTask && (
          <>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: '#1a1d23' }}>{allocateModalTask.project_name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {allocateModalTask.task_description.length > 120
                  ? `${allocateModalTask.task_description.slice(0, 120)}…`
                  : allocateModalTask.task_description}
              </div>
            </div>
            <Field label="Поиск (название проекта, партнёр, id)">
              <Input
                value={allocateSearch}
                onChange={e => setAllocateSearch(e.target.value)}
                placeholder="Начните вводить — список отфильтруется"
                autoComplete="off"
              />
            </Field>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, marginTop: 4 }}>
              Проекты ({filteredAllocatablePayments.length}{allocatablePayments.length ? ` из ${allocatablePayments.length}` : ''})
            </div>
            <div
              style={{
                maxHeight: 280,
                overflowY: 'auto',
                border: '1px solid #e8e9ef',
                borderRadius: 10,
                background: '#fff',
              }}
            >
              {filteredAllocatablePayments.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  {allocatablePayments.length === 0
                    ? 'Список проектов не загрузился или пуст. Проверьте раздел «Проекты» и доступ к API.'
                    : 'Ничего не найдено — измените поиск.'}
                </div>
              ) : (
                filteredAllocatablePayments.map(p => {
                  const active = allocateSelectedId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setAllocateSelectedId(p.id)
                        setAllocateError('')
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '11px 14px',
                        border: 'none',
                        borderBottom: '1px solid #f1f5f9',
                        background: active ? '#e8f5ee' : '#fff',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'block',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, color: active ? '#14532d' : '#1a1d23' }}>
                        {(p.description || '').trim() || `Проект #${p.id}`}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                        {p.partner_name || '—'}
                        {p.partner_manager_name ? ` · ПМ: ${p.partner_manager_name}` : ''}
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>id {p.id}</div>
                    </button>
                  )
                })
              )}
            </div>
            <Field label="Статья себестоимости">
              <Select
                value={allocateCategory}
                onChange={e => {
                  setAllocateCategory(e.target.value)
                  setAllocateError('')
                }}
              >
                <option value="">— выберите статью —</option>
                <option value="design">Дизайн</option>
                <option value="dev">Разработка</option>
                <option value="other">Прочее</option>
                <option value="seo">SEO</option>
              </Select>
            </Field>
            <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.45 }}>
              Нужны и проект, и статья — иначе сохранение не пройдёт. То же правило, что в полной форме задачи.
            </p>
          </>
        )}
        {allocateError && (
          <div
            style={{
              marginTop: 12,
              background: '#fef0f0',
              color: '#e84040',
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 13,
            }}
          >
            {allocateError}
          </div>
        )}
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
