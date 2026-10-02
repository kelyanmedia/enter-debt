import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/router'
import DatePicker from '@/components/DatePicker'
import Layout from '@/components/Layout'
import MonthPicker from '@/components/MonthPicker'
import {
  PageHeader,
  Card,
  Th,
  Td,
  Empty,
  Input,
  Field,
  MoneyInput,
  Select,
  BtnOutline,
  BtnPrimary,
  Modal,
  ConfirmModal,
  formatMoneyNumber,
} from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { canAccessFinanceSection } from '@/lib/roles'

type Currency = 'UZS' | 'USD'
type PayMethod = 'cash' | 'card' | 'transfer'
type PaidFilter = 'all' | 'unpaid' | 'paid'
type EmploymentType = 'inhouse' | 'outsource'
type TypeFilter = 'all' | EmploymentType

interface PayrollEmployee {
  id: number
  full_name: string
  position?: string | null
  department?: string | null
  employment_type: EmploymentType
  base_salary: string
  currency: Currency
  payment_method: PayMethod
  card_number?: string | null
  card_holder_first_name?: string | null
  card_holder_last_name?: string | null
  bank_name?: string | null
  phone?: string | null
  pay_day?: number | null
  hired_on?: string | null
  note?: string | null
  is_active: boolean
}

interface PayrollEntry {
  id: number
  period_month: string
  employee_id: number
  employee_name: string
  employee_active: boolean
  position?: string | null
  department?: string | null
  employment_type: EmploymentType
  currency: Currency
  base_amount: string
  bonus_amount: string
  bonus_note?: string | null
  deduction_amount: string
  deduction_note?: string | null
  total_amount: string
  payment_method: PayMethod
  card_number?: string | null
  card_holder_first_name?: string | null
  card_holder_last_name?: string | null
  bank_name?: string | null
  phone?: string | null
  pay_day?: number | null
  paid: boolean
  paid_on?: string | null
  cash_flow_entry_id?: number | null
  note?: string | null
}

interface EmployeeForm {
  full_name: string
  position: string
  department: string
  employment_type: EmploymentType
  base_salary: string
  currency: Currency
  payment_method: PayMethod
  card_number: string
  card_holder_first_name: string
  card_holder_last_name: string
  bank_name: string
  phone: string
  pay_day: string
  hired_on: string
  note: string
}

interface EntryForm {
  position: string
  currency: Currency
  base_amount: string
  bonus_amount: string
  bonus_note: string
  deduction_amount: string
  deduction_note: string
  payment_method: PayMethod
  paid: boolean
  paid_on: string
  note: string
}

const CARD_DIGITS = 16

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  inhouse: 'Инхаус',
  outsource: 'Аутсорс',
}

const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  card: 'Карта',
  transfer: 'Перечисление',
  cash: 'Наличные',
}

const emptyEmployeeForm = (): EmployeeForm => ({
  full_name: '',
  position: '',
  department: '',
  employment_type: 'inhouse',
  base_salary: '',
  currency: 'UZS',
  payment_method: 'card',
  card_number: '',
  card_holder_first_name: '',
  card_holder_last_name: '',
  bank_name: '',
  phone: '',
  pay_day: '',
  hired_on: '',
  note: '',
})

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 64,
  border: '1px solid #e8e9ef',
  borderRadius: 9,
  padding: '9px 12px',
  fontSize: 13.5,
  outline: 'none',
  color: '#1a1d23',
  fontFamily: 'inherit',
  background: '#fff',
  resize: 'vertical',
}

const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }
const span2: CSSProperties = { gridColumn: '1 / -1' }
const cellPad = '11px 12px'
const num: CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const subText: CSSProperties = { fontSize: 11.5, color: '#64748b', marginTop: 3, lineHeight: 1.35 }

function currentYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ymTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const names = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ]
  return `${names[m - 1] ?? ym} ${y}`
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function cardDigits(raw?: string | null) {
  return (raw || '').replace(/\D/g, '').slice(0, CARD_DIGITS)
}

/** «8600123456789012» → «8600 1234 5678 9012» */
function formatCard(raw?: string | null) {
  return cardDigits(raw).replace(/(.{4})(?=.)/g, '$1 ')
}

/** Сумма в таблице: сумы без подписи, доллары со знаком $ */
function amount(n: number | string, currency: Currency) {
  const v = formatMoneyNumber(Number(n) || 0)
  return currency === 'USD' ? `$${v}` : v
}

function money(n: number | string, currency: Currency) {
  const v = formatMoneyNumber(Number(n) || 0)
  return currency === 'USD' ? `$${v}` : `${v} сум`
}

function formatApiError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => String((x as { msg?: unknown }).msg || x)).join('\n')
  return err.message || 'Ошибка'
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

function employeeFormFrom(e: PayrollEmployee): EmployeeForm {
  return {
    full_name: e.full_name || '',
    position: e.position || '',
    department: e.department || '',
    employment_type: e.employment_type || 'inhouse',
    base_salary: String(Number(e.base_salary) || ''),
    currency: e.currency || 'UZS',
    payment_method: e.payment_method || 'card',
    card_number: (e.card_number || '').replace(/\D/g, '').replace(/(.{4})(?=.)/g, '$1 '),
    card_holder_first_name: e.card_holder_first_name || '',
    card_holder_last_name: e.card_holder_last_name || '',
    bank_name: e.bank_name || '',
    phone: e.phone || '',
    pay_day: e.pay_day != null ? String(e.pay_day) : '',
    hired_on: e.hired_on || '',
    note: e.note || '',
  }
}

function entryFormFrom(r: PayrollEntry): EntryForm {
  const n = (s: string) => (Number(s) ? String(Number(s)) : '')
  return {
    position: r.position || '',
    currency: r.currency,
    base_amount: n(r.base_amount),
    bonus_amount: n(r.bonus_amount),
    bonus_note: r.bonus_note || '',
    deduction_amount: n(r.deduction_amount),
    deduction_note: r.deduction_note || '',
    payment_method: r.payment_method,
    paid: r.paid,
    paid_on: r.paid_on || '',
    note: r.note || '',
  }
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** Значение, которое копируется по клику целиком (номер карты, имя, фамилия). */
function CopyChip({
  value,
  label,
  mono,
  onCopied,
  children,
}: {
  value: string
  label: string
  mono?: boolean
  onCopied: (label: string, ok: boolean) => void
  children: ReactNode
}) {
  const [done, setDone] = useState(false)
  const [hover, setHover] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      title={`Скопировать: ${label.toLowerCase()}`}
      onClick={async (e) => {
        e.stopPropagation()
        const ok = await copyToClipboard(value)
        onCopied(label, ok)
        if (!ok) return
        setDone(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setDone(false), 1300)
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: mono ? '4px 8px' : '3px 7px',
        borderRadius: 7,
        border: `1px solid ${done ? '#bbe5cb' : hover ? '#cfe3d7' : '#e8edf3'}`,
        background: done ? '#effaf3' : hover ? '#f4faf6' : '#f8fafc',
        color: '#1a1d23',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
        fontSize: mono ? 12.5 : 11.5,
        fontWeight: mono ? 600 : 700,
        letterSpacing: mono ? '.02em' : '.03em',
        whiteSpace: 'nowrap',
        cursor: 'copy',
        transition: 'background .12s, border-color .12s',
      }}
    >
      {children}
      <span style={{ display: 'inline-flex', color: done ? '#1f7a46' : hover ? '#1f7a46' : '#a3adbd' }}>
        <CopyIcon done={done} />
      </span>
    </button>
  )
}

function EmploymentBadge({ type }: { type: EmploymentType }) {
  const out = type === 'outsource'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 7px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.02em',
        color: out ? '#7c3aed' : '#0369a1',
        background: out ? '#f3e8ff' : '#e0f2fe',
        whiteSpace: 'nowrap',
      }}
    >
      {EMPLOYMENT_LABELS[type]}
    </span>
  )
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32,
        fontSize: 12.5,
        fontWeight: 700,
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${active ? '#1f7a46' : '#e2e8f0'}`,
        background: active ? '#e8f5ee' : '#fff',
        color: active ? '#1f7a46' : '#475569',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone: string }) {
  return (
    <div style={{ padding: '0 16px', borderLeft: '1px solid #eef0f4', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: 14.5, fontWeight: 800, color: tone, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {children}
      </div>
    </div>
  )
}

function FormSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div style={{ borderTop: first ? 'none' : '1px solid #eef0f4', paddingTop: first ? 0 : 14, marginTop: first ? 0 : 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1a1d23', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

export default function FinancePayrollPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const allowed = !!user && canAccessFinanceSection(user, 'cashflow')

  const [ym, setYm] = useState(currentYm)
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [employees, setEmployees] = useState<PayrollEmployee[]>([])
  const [fetching, setFetching] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  const [empModalOpen, setEmpModalOpen] = useState(false)
  const [empEditingId, setEmpEditingId] = useState<number | null>(null)
  const [empForm, setEmpForm] = useState<EmployeeForm>(emptyEmployeeForm)
  const [empSaving, setEmpSaving] = useState(false)

  const [entryEditing, setEntryEditing] = useState<PayrollEntry | null>(null)
  const [entryForm, setEntryForm] = useState<EntryForm | null>(null)
  const [entrySaving, setEntrySaving] = useState(false)

  const [staffOpen, setStaffOpen] = useState(false)
  const [fireTarget, setFireTarget] = useState<PayrollEmployee | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PayrollEntry | null>(null)

  useEffect(() => {
    if (!loading && user && !allowed) router.replace('/')
  }, [loading, user, allowed, router])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const flash = useCallback((text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }, [])

  const onCopied = useCallback(
    (label: string, ok: boolean) => flash(ok ? `${label} — скопировано` : 'Не удалось скопировать'),
    [flash],
  )

  const loadEntries = useCallback(async () => {
    if (!allowed) return
    setFetching(true)
    try {
      const r = await api.get<PayrollEntry[]>(`finance/payroll/entries?period_month=${ym}`)
      setEntries(r.data || [])
    } catch {
      setEntries([])
    } finally {
      setFetching(false)
    }
  }, [allowed, ym])

  const loadEmployees = useCallback(async () => {
    if (!allowed) return
    try {
      const r = await api.get<PayrollEmployee[]>('finance/payroll/employees?include_inactive=1')
      setEmployees(r.data || [])
    } catch {
      setEmployees([])
    }
  }, [allowed])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  useEffect(() => {
    void loadEmployees()
  }, [loadEmployees])

  const activeEmployees = useMemo(() => employees.filter((e) => e.is_active), [employees])
  const missingInMonth = useMemo(() => {
    const inMonth = new Set(entries.map((e) => e.employee_id))
    return activeEmployees.filter((e) => !inMonth.has(e.id))
  }, [entries, activeEmployees])

  const filtered = useMemo(() => {
    let list = entries
    if (paidFilter === 'paid') list = list.filter((r) => r.paid)
    if (paidFilter === 'unpaid') list = list.filter((r) => !r.paid)
    if (typeFilter !== 'all') list = list.filter((r) => (r.employment_type || 'inhouse') === typeFilter)
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return list
    return list.filter((r) => {
      const hay = [
        r.employee_name,
        r.position,
        r.department,
        r.bonus_note,
        r.note,
        r.card_number,
        r.card_holder_first_name,
        r.card_holder_last_name,
        r.bank_name,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return tokens.every((t) => hay.includes(t))
    })
  }, [entries, paidFilter, typeFilter, search])

  const outsourceCount = useMemo(() => entries.filter((r) => r.employment_type === 'outsource').length, [entries])

  const totals = useMemo(() => {
    const t = { allUzs: 0, allUsd: 0, paidUzs: 0, paidUsd: 0, paidCount: 0 }
    for (const r of entries) {
      const v = Number(r.total_amount) || 0
      const usd = r.currency === 'USD'
      if (usd) t.allUsd += v
      else t.allUzs += v
      if (r.paid) {
        t.paidCount += 1
        if (usd) t.paidUsd += v
        else t.paidUzs += v
      }
    }
    return t
  }, [entries])

  const tileValue = (uzs: number, usd: number) => (
    <>
      {formatMoneyNumber(uzs)} сум
      {usd > 0 ? <span style={{ fontSize: 12.5, marginLeft: 6, opacity: 0.85 }}>+ ${formatMoneyNumber(usd)}</span> : null}
    </>
  )

  const generateMonth = async () => {
    setFetching(true)
    try {
      const r = await api.post<PayrollEntry[]>('finance/payroll/generate', { period_month: ym, copy_from_previous: true })
      setEntries(r.data || [])
      flash('Ведомость сформирована')
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setFetching(false)
    }
  }

  const togglePaid = async (r: PayrollEntry) => {
    setBusyId(r.id)
    try {
      const res = await api.patch<PayrollEntry>(`finance/payroll/entries/${r.id}`, {
        paid: !r.paid,
        paid_on: !r.paid ? todayYmd() : null,
      })
      setEntries((list) => list.map((x) => (x.id === r.id ? res.data : x)))
      flash(res.data.paid ? 'Оплачено — расход добавлен в ДДС' : 'Оплата снята — строка убрана из ДДС')
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setBusyId(null)
    }
  }

  const copyUnpaidList = async () => {
    const lines = entries
      .filter((r) => !r.paid)
      .map((r) => [r.employee_name, formatCard(r.card_number) || '—', money(r.total_amount, r.currency)].join(' — '))
    if (!lines.length) {
      flash('Все выплаты уже отмечены')
      return
    }
    const ok = await copyToClipboard(lines.join('\n'))
    flash(ok ? `Скопировано строк: ${lines.length}` : 'Не удалось скопировать')
  }

  // ── Сотрудник ──
  const openEmployeeCreate = () => {
    setEmpEditingId(null)
    setEmpForm(emptyEmployeeForm())
    setEmpModalOpen(true)
  }

  const openEmployeeEdit = (employeeId: number) => {
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return
    setEmpEditingId(emp.id)
    setEmpForm(employeeFormFrom(emp))
    setEmpModalOpen(true)
  }

  const saveEmployee = async () => {
    if (!empForm.full_name.trim()) {
      alert('Укажите имя сотрудника')
      return
    }
    const digits = empForm.card_number.replace(/\D/g, '')
    if (digits && digits.length !== CARD_DIGITS) {
      alert(`Номер карты должен содержать ровно ${CARD_DIGITS} цифр (сейчас ${digits.length})`)
      return
    }
    const payDay = empForm.pay_day.trim() ? Number(empForm.pay_day) : null
    if (payDay != null && (!Number.isInteger(payDay) || payDay < 1 || payDay > 31)) {
      alert('День выплаты — число от 1 до 31')
      return
    }
    const payload = {
      full_name: empForm.full_name.trim(),
      position: empForm.position.trim() || null,
      department: empForm.department.trim() || null,
      employment_type: empForm.employment_type,
      base_salary: empForm.base_salary || '0',
      currency: empForm.currency,
      payment_method: empForm.payment_method,
      card_number: digits || null,
      card_holder_first_name: empForm.card_holder_first_name.trim() || null,
      card_holder_last_name: empForm.card_holder_last_name.trim() || null,
      bank_name: empForm.bank_name.trim() || null,
      phone: empForm.phone.trim() || null,
      pay_day: payDay,
      hired_on: empForm.hired_on || null,
      note: empForm.note.trim() || null,
    }
    setEmpSaving(true)
    try {
      if (empEditingId == null) {
        await api.post(`finance/payroll/employees?period_month=${ym}`, payload)
      } else {
        await api.patch(`finance/payroll/employees/${empEditingId}`, payload)
      }
      await Promise.all([loadEmployees(), loadEntries()])
      setEmpModalOpen(false)
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setEmpSaving(false)
    }
  }

  const fireEmployee = async (emp: PayrollEmployee) => {
    try {
      await api.delete(`finance/payroll/employees/${emp.id}`)
      await loadEmployees()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  const restoreEmployee = async (emp: PayrollEmployee) => {
    try {
      await api.patch(`finance/payroll/employees/${emp.id}`, { is_active: true })
      await loadEmployees()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  const addToMonth = async (emp: PayrollEmployee) => {
    try {
      await api.post('finance/payroll/entries', { period_month: ym, employee_id: emp.id })
      await loadEntries()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  // ── Строка ведомости ──
  const openEntryEdit = (r: PayrollEntry) => {
    setEntryEditing(r)
    setEntryForm(entryFormFrom(r))
  }

  const closeEntryEdit = () => {
    if (entrySaving) return
    setEntryEditing(null)
    setEntryForm(null)
  }

  const saveEntry = async () => {
    if (!entryEditing || !entryForm) return
    setEntrySaving(true)
    try {
      const res = await api.patch<PayrollEntry>(`finance/payroll/entries/${entryEditing.id}`, {
        position: entryForm.position.trim() || null,
        currency: entryForm.currency,
        base_amount: entryForm.base_amount || '0',
        bonus_amount: entryForm.bonus_amount || '0',
        bonus_note: entryForm.bonus_note.trim() || null,
        deduction_amount: entryForm.deduction_amount || '0',
        deduction_note: entryForm.deduction_note.trim() || null,
        payment_method: entryForm.payment_method,
        paid: entryForm.paid,
        paid_on: entryForm.paid ? entryForm.paid_on || todayYmd() : null,
        note: entryForm.note.trim() || null,
      })
      setEntries((list) => list.map((x) => (x.id === entryEditing.id ? res.data : x)))
      setEntryEditing(null)
      setEntryForm(null)
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setEntrySaving(false)
    }
  }

  const removeEntry = async (r: PayrollEntry) => {
    try {
      await api.delete(`finance/payroll/entries/${r.id}`)
      await loadEntries()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  const entryPreviewTotal = entryForm
    ? Math.max(0, (Number(entryForm.base_amount) || 0) + (Number(entryForm.bonus_amount) || 0) - (Number(entryForm.deduction_amount) || 0))
    : 0

  const empCardDigits = empForm.card_number.replace(/\D/g, '').length
  const cardCounterColor = empCardDigits === 0 ? '#a3adbd' : empCardDigits === CARD_DIGITS ? '#1f7a46' : '#b91c1c'

  if (loading || !user || !allowed) return null

  const dash = <span style={{ color: '#cbd5e1' }}>—</span>

  return (
    <Layout>
      <style jsx>{`
        .prow {
          cursor: pointer;
          transition: background-color 0.12s;
        }
        .prow:hover {
          background-color: #f8fafc !important;
        }
        .prow.paid:hover {
          background-color: #e6f6ec !important;
        }
      `}</style>
      <PageHeader
        title="Зарплатный фонд"
        subtitle="Галочка «Оплачено» создаёт расход в ДДС (категория «Зарплата»), снятие — убирает. К выплате = оклад + бонусы − удержания."
      />
      <div style={{ padding: '14px 24px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <Card style={{ padding: 0, overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px' }}>
            <MonthPicker value={ym} onChange={setYm} disabled={fetching} />
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
              <Stat label="Фонд за месяц" tone="#1a1d23">
                {tileValue(totals.allUzs, totals.allUsd)}
              </Stat>
              <Stat label="Оплачено" tone="#166534">
                {tileValue(totals.paidUzs, totals.paidUsd)}
              </Stat>
              <Stat label="Осталось" tone="#b45309">
                {tileValue(totals.allUzs - totals.paidUzs, totals.allUsd - totals.paidUsd)}
              </Stat>
              <Stat label="Выплачено" tone="#1a1d23">
                {totals.paidCount} / {entries.length}
              </Stat>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {missingInMonth.length > 0 ? (
                <BtnPrimary type="button" onClick={() => void generateMonth()} disabled={fetching} style={{ height: 36 }}>
                  Сформировать месяц ({missingInMonth.length})
                </BtnPrimary>
              ) : null}
              <BtnOutline type="button" onClick={openEmployeeCreate} style={{ height: 36 }}>
                + Сотрудник
              </BtnOutline>
              <BtnOutline type="button" onClick={() => setStaffOpen(true)} style={{ height: 36 }}>
                Все ({activeEmployees.length})
              </BtnOutline>
              <BtnOutline
                type="button"
                onClick={() => void copyUnpaidList()}
                disabled={!entries.length}
                title="Скопировать список «имя — карта — сумма» по неоплаченным"
                style={{ height: 36 }}
              >
                Копировать неоплаченные
              </BtnOutline>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: '8px 14px',
              borderTop: '1px solid #eef0f4',
              background: '#fafbfc',
              borderRadius: '0 0 14px 14px',
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: имя, позиция, отдел, карта…"
              autoComplete="off"
              style={{ flex: '1 1 200px', maxWidth: 320, minWidth: 160, height: 32, padding: '0 12px', fontSize: 13 }}
            />
            <SegButton active={paidFilter === 'all'} onClick={() => setPaidFilter('all')}>
              Все · {entries.length}
            </SegButton>
            <SegButton active={paidFilter === 'unpaid'} onClick={() => setPaidFilter('unpaid')}>
              Не оплачено · {entries.length - totals.paidCount}
            </SegButton>
            <SegButton active={paidFilter === 'paid'} onClick={() => setPaidFilter('paid')}>
              Оплачено · {totals.paidCount}
            </SegButton>
            <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} aria-hidden />
            <SegButton active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
              Все типы
            </SegButton>
            <SegButton active={typeFilter === 'inhouse'} onClick={() => setTypeFilter('inhouse')}>
              Инхаус · {entries.length - outsourceCount}
            </SegButton>
            <SegButton active={typeFilter === 'outsource'} onClick={() => setTypeFilter('outsource')}>
              Аутсорс · {outsourceCount}
            </SegButton>
          </div>
        </Card>

        <Card style={{ padding: 0, flex: 1, minHeight: 0 }}>
          <div style={{ maxHeight: 'calc(100vh - 230px)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                <tr>
                  <Th style={{ width: 40, padding: cellPad, textAlign: 'center' }}>№</Th>
                  <Th style={{ padding: cellPad }}>Сотрудник</Th>
                  <Th style={{ padding: cellPad, textAlign: 'right' }}>Оклад</Th>
                  <Th style={{ padding: cellPad, textAlign: 'right' }}>Бонусы / %</Th>
                  <Th style={{ padding: cellPad, textAlign: 'right' }}>Удержания</Th>
                  <Th style={{ padding: cellPad, textAlign: 'right' }}>К выплате</Th>
                  <Th style={{ width: 96, padding: cellPad, textAlign: 'center' }}>Оплачено</Th>
                  <Th style={{ width: 250, padding: cellPad }}>Реквизиты</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && !fetching ? (
                  <tr>
                    <Td colSpan={8} style={{ padding: 0, border: 'none' }}>
                      <Empty
                        text={
                          entries.length
                            ? 'Нет строк по фильтру.'
                            : activeEmployees.length
                              ? 'Ведомость за этот месяц пуста. Нажмите «Сформировать месяц» — сотрудники подтянутся с окладами (и бонусами прошлого месяца).'
                              : 'Сотрудников пока нет. Нажмите «+ Сотрудник», чтобы добавить имя, позицию, оклад и реквизиты карты.'
                        }
                      />
                    </Td>
                  </tr>
                ) : (
                  filtered.map((r, idx) => {
                    const cur = r.currency
                    const card = formatCard(r.card_number)
                    // Номер, сохранённый до проверки «16 цифр», не обрезаем молча — показываем как есть с пометкой
                    const rawCard = (r.card_number || '').replace(/\D/g, '')
                    const cardInvalid = rawCard.length > 0 && rawCard.length !== CARD_DIGITS
                    const first = (r.card_holder_first_name || '').trim()
                    const last = (r.card_holder_last_name || '').trim()
                    const subtitle = [r.position, r.department].filter(Boolean).join(' · ')
                    return (
                      <tr
                        key={r.id}
                        className={r.paid ? 'prow paid' : 'prow'}
                        onClick={() => openEntryEdit(r)}
                        title="Открыть строку: суммы, бонусы, удержания"
                        style={{ background: r.paid ? '#f0fbf4' : '#fff' }}
                      >
                        <Td style={{ padding: cellPad, textAlign: 'center', fontWeight: 600, color: '#a3adbd' }}>{idx + 1}</Td>
                        <Td style={{ padding: cellPad, minWidth: 180 }}>
                          <div style={{ fontWeight: 700, color: '#1a1d23', lineHeight: 1.3 }}>
                            {r.employee_name}
                            {!r.employee_active ? (
                              <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', padding: '1px 6px', borderRadius: 999 }}>
                                уволен
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                            <EmploymentBadge type={r.employment_type || 'inhouse'} />
                            {subtitle ? <span style={{ fontSize: 11.5, color: '#64748b' }}>{subtitle}</span> : null}
                          </div>
                        </Td>
                        <Td style={{ padding: cellPad, ...num, fontWeight: 600 }}>{amount(r.base_amount, cur)}</Td>
                        <Td style={{ padding: cellPad, textAlign: 'right', maxWidth: 170 }}>
                          {Number(r.bonus_amount) > 0 ? (
                            <>
                              <div style={{ ...num, fontWeight: 700, color: '#2563eb' }}>+{amount(r.bonus_amount, cur)}</div>
                              {r.bonus_note ? <div style={subText}>{r.bonus_note}</div> : null}
                            </>
                          ) : (
                            dash
                          )}
                        </Td>
                        <Td style={{ padding: cellPad, textAlign: 'right', maxWidth: 150 }}>
                          {Number(r.deduction_amount) > 0 ? (
                            <>
                              <div style={{ ...num, fontWeight: 700, color: '#b91c1c' }}>−{amount(r.deduction_amount, cur)}</div>
                              {r.deduction_note ? <div style={subText}>{r.deduction_note}</div> : null}
                            </>
                          ) : (
                            dash
                          )}
                        </Td>
                        <Td style={{ padding: cellPad, textAlign: 'right' }}>
                          <div style={{ ...num, fontWeight: 800, fontSize: 13.5, color: '#166534' }}>{amount(r.total_amount, cur)}</div>
                          <div style={{ ...subText, color: '#94a3b8' }}>{PAY_METHOD_LABELS[r.payment_method]}</div>
                        </Td>
                        <Td style={{ padding: cellPad, textAlign: 'center' }}>
                          <div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <input
                              type="checkbox"
                              checked={r.paid}
                              disabled={busyId === r.id}
                              onChange={() => void togglePaid(r)}
                              title={r.paid ? 'Снять оплату (строка уйдёт из ДДС)' : 'Отметить оплату (строка попадёт в ДДС)'}
                              style={{ width: 20, height: 20, margin: 0, cursor: 'pointer', accentColor: '#1f7a46' }}
                            />
                            <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: r.paid ? '#166534' : '#a3adbd' }}>
                              {r.paid ? formatDate(r.paid_on) : r.pay_day ? `до ${r.pay_day}-го` : ' '}
                            </span>
                          </div>
                        </Td>
                        <Td style={{ padding: cellPad }}>
                          {card ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                              {cardInvalid ? (
                                <span
                                  title="Номер карты не из 16 цифр — откройте карточку сотрудника и исправьте"
                                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, fontWeight: 600, color: '#b91c1c' }}
                                >
                                  {rawCard.replace(/(.{4})(?=.)/g, '$1 ')} · проверьте номер
                                </span>
                              ) : (
                                <CopyChip value={rawCard} label="Номер карты" mono onCopied={onCopied}>
                                  {card}
                                </CopyChip>
                              )}
                              {first || last ? (
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                  {first ? (
                                    <CopyChip value={first} label="Имя" onCopied={onCopied}>
                                      {first}
                                    </CopyChip>
                                  ) : null}
                                  {last ? (
                                    <CopyChip value={last} label="Фамилия" onCopied={onCopied}>
                                      {last}
                                    </CopyChip>
                                  ) : null}
                                </div>
                              ) : null}
                              {r.bank_name ? <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{r.bank_name}</div> : null}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#a3adbd', fontWeight: 600 }}>
                              Без карты · {PAY_METHOD_LABELS[r.payment_method].toLowerCase()}
                            </span>
                          )}
                        </Td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {toast ? (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 13000,
            padding: '9px 16px',
            borderRadius: 999,
            background: '#1a1d23',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 6px 24px rgba(0,0,0,.18)',
          }}
        >
          {toast}
        </div>
      ) : null}

      {/* Карточка сотрудника */}
      <Modal
        open={empModalOpen}
        onClose={() => !empSaving && setEmpModalOpen(false)}
        title={empEditingId == null ? 'Новый сотрудник' : 'Карточка сотрудника'}
        width={600}
        zIndex={12050}
        footer={
          <>
            <BtnOutline onClick={() => setEmpModalOpen(false)} disabled={empSaving}>
              Отмена
            </BtnOutline>
            <BtnPrimary onClick={() => void saveEmployee()} disabled={empSaving}>
              {empSaving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        <FormSection title="Сотрудник" first>
          <div style={grid2}>
            <div style={span2}>
              <Field label="ФИО">
                <Input value={empForm.full_name} onChange={(e) => setEmpForm({ ...empForm, full_name: e.target.value })} autoFocus />
              </Field>
            </div>
            <div style={span2}>
              <Field label="Тип">
                <div style={{ display: 'flex', gap: 6 }}>
                  {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map((t) => (
                    <SegButton key={t} active={empForm.employment_type === t} onClick={() => setEmpForm({ ...empForm, employment_type: t })}>
                      {EMPLOYMENT_LABELS[t]}
                    </SegButton>
                  ))}
                </div>
              </Field>
            </div>
            <Field label="Позиция">
              <Input value={empForm.position} onChange={(e) => setEmpForm({ ...empForm, position: e.target.value })} placeholder="Дизайнер, SMM…" />
            </Field>
            <Field label="Отдел">
              <Input value={empForm.department} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })} />
            </Field>
            <Field label="Оклад в месяц">
              <div style={{ display: 'flex', gap: 6 }}>
                <MoneyInput value={empForm.base_salary} onChange={(v) => setEmpForm({ ...empForm, base_salary: v })} />
                <Select
                  value={empForm.currency}
                  onChange={(e) => setEmpForm({ ...empForm, currency: e.target.value as Currency })}
                  style={{ width: 84, flexShrink: 0 }}
                >
                  <option value="UZS">UZS</option>
                  <option value="USD">USD</option>
                </Select>
              </div>
            </Field>
            <Field label="Способ выплаты">
              <Select value={empForm.payment_method} onChange={(e) => setEmpForm({ ...empForm, payment_method: e.target.value as PayMethod })}>
                {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((k) => (
                  <option key={k} value={k}>
                    {PAY_METHOD_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </FormSection>

        <FormSection title="Реквизиты карты">
          <div style={grid2}>
            <div style={span2}>
              <Field label="Номер карты · 16 цифр">
                <div style={{ position: 'relative' }}>
                  <Input
                    value={empForm.card_number}
                    onChange={(e) => setEmpForm({ ...empForm, card_number: formatCard(e.target.value) })}
                    placeholder="8600 0000 0000 0000"
                    inputMode="numeric"
                    autoComplete="off"
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      letterSpacing: '.04em',
                      paddingRight: 64,
                      borderColor: empCardDigits > 0 && empCardDigits !== CARD_DIGITS ? '#fca5a5' : undefined,
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 12,
                      fontWeight: 700,
                      color: cardCounterColor,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {empCardDigits}/{CARD_DIGITS}
                  </span>
                </div>
              </Field>
            </div>
            <Field label="Имя (как на карте)">
              <Input
                value={empForm.card_holder_first_name}
                onChange={(e) => setEmpForm({ ...empForm, card_holder_first_name: e.target.value.toUpperCase() })}
                placeholder="AZIZ"
                autoComplete="off"
              />
            </Field>
            <Field label="Фамилия (как на карте)">
              <Input
                value={empForm.card_holder_last_name}
                onChange={(e) => setEmpForm({ ...empForm, card_holder_last_name: e.target.value.toUpperCase() })}
                placeholder="KARIMOV"
                autoComplete="off"
              />
            </Field>
            <Field label="Банк">
              <Input value={empForm.bank_name} onChange={(e) => setEmpForm({ ...empForm, bank_name: e.target.value })} placeholder="Kapitalbank, Uzum…" />
            </Field>
            <Field label="Телефон">
              <Input value={empForm.phone} onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })} placeholder="+998…" />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Дополнительно">
          <div style={grid2}>
            <Field label="День выплаты (1–31)">
              <Input
                value={empForm.pay_day}
                onChange={(e) => setEmpForm({ ...empForm, pay_day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                inputMode="numeric"
                placeholder="например, 5"
              />
            </Field>
            <Field label="Дата найма">
              <DatePicker value={empForm.hired_on} onChange={(v: string) => setEmpForm({ ...empForm, hired_on: v })} />
            </Field>
            <div style={span2}>
              <Field label="Комментарий">
                <textarea value={empForm.note} onChange={(e) => setEmpForm({ ...empForm, note: e.target.value })} style={textareaStyle} />
              </Field>
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {empEditingId == null
              ? `Сотрудник сразу попадёт в ведомость за ${ymTitle(ym)}.`
              : 'Оклад из карточки применяется к новым месяцам. Сумму текущего месяца меняйте в строке ведомости.'}
          </div>
        </FormSection>
      </Modal>

      {/* Строка ведомости */}
      <Modal
        open={!!entryEditing && !!entryForm}
        onClose={closeEntryEdit}
        title={entryEditing ? `${entryEditing.employee_name} · ${ymTitle(ym)}` : ''}
        width={580}
        footer={
          <>
            <div style={{ marginRight: 'auto', display: 'flex', gap: 8 }}>
              {entryEditing ? (
                <BtnOutline
                  onClick={() => {
                    const id = entryEditing.employee_id
                    closeEntryEdit()
                    openEmployeeEdit(id)
                  }}
                  disabled={entrySaving}
                >
                  Карточка сотрудника
                </BtnOutline>
              ) : null}
              {entryEditing && !entryEditing.paid ? (
                <BtnOutline
                  onClick={() => {
                    const t = entryEditing
                    closeEntryEdit()
                    setRemoveTarget(t)
                  }}
                  disabled={entrySaving}
                  style={{ color: '#b91c1c', borderColor: '#fecaca' }}
                >
                  Убрать из месяца
                </BtnOutline>
              ) : null}
            </div>
            <BtnOutline onClick={closeEntryEdit} disabled={entrySaving}>
              Отмена
            </BtnOutline>
            <BtnPrimary onClick={() => void saveEntry()} disabled={entrySaving}>
              {entrySaving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        {entryForm ? (
          <>
            <div style={grid2}>
              <Field label="Позиция в этом месяце">
                <Input value={entryForm.position} onChange={(e) => setEntryForm({ ...entryForm, position: e.target.value })} />
              </Field>
              <Field label="Валюта · способ">
                <div style={{ display: 'flex', gap: 6 }}>
                  <Select
                    value={entryForm.currency}
                    onChange={(e) => setEntryForm({ ...entryForm, currency: e.target.value as Currency })}
                    style={{ width: 84, flexShrink: 0 }}
                  >
                    <option value="UZS">UZS</option>
                    <option value="USD">USD</option>
                  </Select>
                  <Select
                    value={entryForm.payment_method}
                    onChange={(e) => setEntryForm({ ...entryForm, payment_method: e.target.value as PayMethod })}
                  >
                    {(Object.keys(PAY_METHOD_LABELS) as PayMethod[]).map((k) => (
                      <option key={k} value={k}>
                        {PAY_METHOD_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
              </Field>
              <div style={span2}>
                <Field label="Оклад">
                  <MoneyInput value={entryForm.base_amount} onChange={(v) => setEntryForm({ ...entryForm, base_amount: v })} />
                </Field>
              </div>
              <Field label="Бонус / процент (сумма)">
                <MoneyInput value={entryForm.bonus_amount} onChange={(v) => setEntryForm({ ...entryForm, bonus_amount: v })} />
              </Field>
              <Field label="За что бонус">
                <Input
                  value={entryForm.bonus_note}
                  onChange={(e) => setEntryForm({ ...entryForm, bonus_note: e.target.value })}
                  placeholder="5% от продаж, KPI…"
                />
              </Field>
              <Field label="Удержания (аванс, штраф)">
                <MoneyInput value={entryForm.deduction_amount} onChange={(v) => setEntryForm({ ...entryForm, deduction_amount: v })} />
              </Field>
              <Field label="Причина удержания">
                <Input value={entryForm.deduction_note} onChange={(e) => setEntryForm({ ...entryForm, deduction_note: e.target.value })} />
              </Field>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                margin: '2px 0 16px',
                padding: '12px 14px',
                borderRadius: 10,
                background: '#f0fbf4',
                border: '1px solid #bbe5cb',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.05em' }}>К выплате</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: '#166534', fontVariantNumeric: 'tabular-nums' }}>
                {money(entryPreviewTotal, entryForm.currency)}
              </span>
            </div>
            <div style={{ ...grid2, alignItems: 'end' }}>
              <Field label="Оплата">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer', height: 38 }}>
                  <input
                    type="checkbox"
                    checked={entryForm.paid}
                    onChange={(e) =>
                      setEntryForm({ ...entryForm, paid: e.target.checked, paid_on: e.target.checked ? entryForm.paid_on || todayYmd() : '' })
                    }
                    style={{ width: 18, height: 18, margin: 0, accentColor: '#1f7a46' }}
                  />
                  Выплачено (попадёт в ДДС)
                </label>
              </Field>
              {entryForm.paid ? (
                <Field label="Дата оплаты">
                  <DatePicker value={entryForm.paid_on} onChange={(v: string) => setEntryForm({ ...entryForm, paid_on: v })} />
                </Field>
              ) : (
                <div />
              )}
              <div style={span2}>
                <Field label="Комментарий">
                  <textarea value={entryForm.note} onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })} style={textareaStyle} />
                </Field>
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      {/* Все сотрудники */}
      <Modal
        open={staffOpen}
        onClose={() => setStaffOpen(false)}
        title="Сотрудники зарплатного фонда"
        width={720}
        footer={<BtnPrimary onClick={openEmployeeCreate}>+ Сотрудник</BtnPrimary>}
      >
        {employees.length === 0 ? (
          <Empty text="Сотрудников пока нет." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th style={{ padding: cellPad }}>Сотрудник</Th>
                <Th style={{ padding: cellPad, textAlign: 'right' }}>Оклад</Th>
                <Th style={{ padding: cellPad }} />
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const inMonth = entries.some((x) => x.employee_id === e.id)
                return (
                  <tr key={e.id} style={{ opacity: e.is_active ? 1 : 0.55 }}>
                    <Td style={{ padding: cellPad }}>
                      <div style={{ fontWeight: 700 }}>
                        {e.full_name}
                        {!e.is_active ? <span style={{ marginLeft: 6, fontSize: 11, color: '#b91c1c' }}>уволен</span> : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <EmploymentBadge type={e.employment_type || 'inhouse'} />
                        {e.position ? <span style={{ fontSize: 11.5, color: '#64748b' }}>{e.position}</span> : null}
                      </div>
                    </Td>
                    <Td style={{ padding: cellPad, ...num }}>{money(e.base_salary, e.currency)}</Td>
                    <Td style={{ padding: cellPad }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <BtnOutline style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => openEmployeeEdit(e.id)}>
                          Изменить
                        </BtnOutline>
                        {e.is_active && !inMonth ? (
                          <BtnOutline style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => void addToMonth(e)}>
                            В {ymTitle(ym)}
                          </BtnOutline>
                        ) : null}
                        {e.is_active ? (
                          <BtnOutline style={{ fontSize: 12, padding: '5px 10px', color: '#b91c1c' }} onClick={() => setFireTarget(e)}>
                            Уволить
                          </BtnOutline>
                        ) : (
                          <BtnOutline style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => void restoreEmployee(e)}>
                            Вернуть
                          </BtnOutline>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Modal>

      <ConfirmModal
        open={!!fireTarget}
        title="Уволить сотрудника?"
        message={`${fireTarget?.full_name || ''} не будет попадать в новые месяцы. История выплат и строки ДДС сохранятся.`}
        confirmLabel="Уволить"
        danger
        onClose={() => setFireTarget(null)}
        onConfirm={async () => {
          if (fireTarget) await fireEmployee(fireTarget)
          setFireTarget(null)
        }}
      />
      <ConfirmModal
        open={!!removeTarget}
        title="Убрать из ведомости?"
        message={`${removeTarget?.employee_name || ''} будет убран из ведомости за ${ymTitle(ym)}. Сотрудник останется в справочнике.`}
        confirmLabel="Убрать"
        danger
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (removeTarget) await removeEntry(removeTarget)
          setRemoveTarget(null)
        }}
      />
    </Layout>
  )
}
