import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, PartnerAvatar, statusBadge, formatAmount, formatMoneyNumber, formatDate, daysLeft, daysLeftSortKey, BtnPrimary, BtnOutline, BtnIconEdit, BtnIconDelete, Modal, ConfirmModal, Field, Input, Select, Empty, MoneyInput } from '@/components/ui'
import api from '@/lib/api'

interface Partner { id: number; name: string }
interface User { id: number; name: string }
interface PaymentMonth {
  id: number; payment_id: number; month: string; amount?: number
  due_date?: string | null
  status: 'pending' | 'paid'; description?: string; note?: string; paid_at?: string; created_at: string
  act_issued?: boolean; act_issued_at?: string
  received_payment_method?: string | null
}
interface Payment {
  id: number; partner_id: number; description: string; amount: number
  payment_type: string; status: string; deadline_date?: string; day_of_month?: number
  contract_months?: number; remind_days_before: number; created_at: string; postponed_until?: string
  notify_accounting: boolean; contract_url?: string; service_period?: string
  project_category?: string | null
  /** Ближайший срок для дебиторки: по графику (мин. due среди неоплаченных) или по договору */
  next_payment_due_date?: string | null
  next_payment_month?: string | null
  days_until_due?: number | null
  partner: { id: number; name: string; manager?: { id: number; name: string } }
  months?: PaymentMonth[]
}

/** Для списка: дедлайн по графику или по договору (редактирование всегда по deadline_date из API). */
function listDueDateStr(p: Payment): string | null | undefined {
  return p.next_payment_due_date || p.deadline_date || undefined
}
function listDueDayOfMonth(p: Payment): number | null | undefined {
  return p.next_payment_due_date ? undefined : p.day_of_month
}

function dueSourceHint(p: Payment): string {
  if (p.next_payment_month) {
    return `По графику: ближайший срок среди неоплаченных строк (${monthLabel(p.next_payment_month)})`
  }
  if (p.deadline_date) {
    return 'По договору: фиксированная дата (меняется в «Редактировать проект»)'
  }
  if (p.day_of_month) {
    return `По договору: ${p.day_of_month}-е число месяца (ближайший расчётный срок)`
  }
  return 'Срок не задан — укажите в редактировании проекта или добавьте месяц в график с датой оплаты.'
}

const EMPTY_FORM = {
  partner_id: '', payment_type: 'recurring', description: '', amount: '',
  day_of_month: '', deadline_date: '', remind_days_before: '3', contract_months: '',
  notify_accounting: true, contract_url: '', service_period: 'yearly', project_category: '' as string,
}

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return `${MONTHS_RU[parseInt(m) - 1]} ${y}`
}

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** День оплаты в календаре: число из договора или последний день месяца услуги */
function defaultDueDateForMonth(ym: string, dayOfMonth?: number | null): string {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const d = dayOfMonth ? Math.min(Math.max(1, dayOfMonth), last) : last
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Равномерное разбиение суммы договора по N месяцам (сумма в тийинах → без float-ошибок) */
function splitContractAmountCents(total: number, n: number): number[] {
  const cents = Math.round(Number(total) * 100)
  if (n <= 0) return []
  const base = Math.floor(cents / n)
  const out: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    if (i === n - 1) out.push((cents - acc) / 100)
    else {
      out.push(base / 100)
      acc += base
    }
  }
  return out
}

function formatApiError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((x: { msg?: string }) => x.msg || JSON.stringify(x)).filter(Boolean).join(', ')
  }
  if (d != null && typeof d === 'object') return JSON.stringify(d)
  const st = err.response?.status
  if (st) return `Ошибка сервера (${st}). Проверьте связь с сервером или обратитесь к администратору.`
  return err.message || 'Ошибка сохранения'
}

function generateMonths(startYM: string, count: number): string[] {
  const [y, m] = startYM.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const total = m - 1 + i
    const yr = y + Math.floor(total / 12)
    const mo = (total % 12) + 1
    return `${yr}-${String(mo).padStart(2, '0')}`
  })
}

/** Следующий календарный месяц после YYYY-MM */
function nextMonthYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  let mo = m + 1
  let yr = y
  if (mo > 12) {
    mo = 1
    yr += 1
  }
  return `${yr}-${String(mo).padStart(2, '0')}`
}

function lineBadge(cat?: string | null) {
  if (cat === 'web') return <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff4ff', padding: '3px 8px', borderRadius: 6 }}>Web</span>
  if (cat === 'seo') return <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fff8ee', padding: '3px 8px', borderRadius: 6 }}>SEO</span>
  if (cat === 'ppc') return <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', padding: '3px 8px', borderRadius: 6 }}>PPC</span>
  if (cat === 'mobile_app')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', padding: '3px 8px', borderRadius: 6 }}>
        Моб. прил.
      </span>
    )
  if (cat === 'tech_support')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#0d9488', background: '#ccfbf1', padding: '3px 8px', borderRadius: 6 }}>
        Тех. сопр.
      </span>
    )
  if (cat === 'hosting_domain')
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', background: '#eef2ff', padding: '3px 8px', borderRadius: 6 }}>
        Хостинг
      </span>
    )
  return <span style={{ color: '#c5c8d4', fontSize: 12 }}>—</span>
}

export default function PaymentsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [partners, setPartners] = useState<Partner[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterManager, setFilterManager] = useState('')
  /** default — порядок с API; urgency — сначала просрочка (красные), затем ближайшие выплаты, в конце без даты и с большим запасом */
  const [sortByRemaining, setSortByRemaining] = useState<'default' | 'urgency'>('default')
  const [users, setUsers] = useState<User[]>([])
  const [modal, setModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Drawer state
  const [drawer, setDrawer] = useState<Payment | null>(null)
  const [drawerMonths, setDrawerMonths] = useState<PaymentMonth[]>([])
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [addMonthForm, setAddMonthForm] = useState({
    month: currentYM(),
    due_date: '',
    amount: '',
    description: '',
    note: '',
  })
  const [addMonthOpen, setAddMonthOpen] = useState(false)
  const [confirmingMonth, setConfirmingMonth] = useState<number | null>(null)
  const [confirmingAct, setConfirmingAct] = useState<number | null>(null)
  const [duplicatingMonth, setDuplicatingMonth] = useState<number | null>(null)
  const [monthSaved, setMonthSaved] = useState<number | null>(null)
  const [monthPayMethods, setMonthPayMethods] = useState<Record<number, string>>({})
  /** Модалка «Оплата прошла»: выбор сегодня / дата задним числом */
  const [payConfirmModalMonthId, setPayConfirmModalMonthId] = useState<number | null>(null)
  const [payConfirmBackdateYmd, setPayConfirmBackdateYmd] = useState('')
  const [deletePaymentId, setDeletePaymentId] = useState<number | null>(null)
  const [deleteMonthId, setDeleteMonthId] = useState<number | null>(null)

  const syncDrawerPayment = useCallback(async (paymentId: number) => {
    try {
      const pr = await api.get<Payment>(`payments/${paymentId}`)
      setDrawer((d) => (d && d.id === paymentId ? pr.data : d))
    } catch {
      /* ignore */
    }
  }, [])

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterStatus) params.append('status', filterStatus)
    if (filterType) params.append('payment_type', filterType)
    if (filterCategory) params.append('project_category', filterCategory)
    try {
      const r = await api.get<Payment[]>(`payments?${params}`)
      let data = r.data
      if (filterManager) data = data.filter((p: Payment) => String(p.partner?.manager?.id) === filterManager)
      setPayments(data)
    } catch {
      setPayments([])
    }
  }, [filterStatus, filterType, filterCategory, filterManager])

  useEffect(() => {
    if (!router.isReady) return
    const raw = router.query.category
    const c = Array.isArray(raw) ? raw[0] : raw
    if (typeof c === 'string' && ['web', 'seo', 'ppc'].includes(c)) setFilterCategory(c)
    else if (!c) setFilterCategory('')
  }, [router.isReady, router.query.category])

  const setCategoryFilter = (v: string) => {
    setFilterCategory(v)
    const q: Record<string, string | string[] | undefined> = { ...router.query }
    if (v) q.category = v
    else delete q.category
    router.replace({ pathname: '/payments', query: q }, undefined, { shallow: true })
  }

  useEffect(() => {
    load()
  }, [load])

  const displayedPayments = useMemo(() => {
    if (sortByRemaining !== 'urgency') return payments

    const tier = (k: number | null) => {
      if (k === null) return 2
      if (k < 0) return 0
      return 1
    }

    return [...payments].sort((a, b) => {
      const ka = daysLeftSortKey(listDueDateStr(a), listDueDayOfMonth(a))
      const kb = daysLeftSortKey(listDueDateStr(b), listDueDayOfMonth(b))
      const ta = tier(ka)
      const tb = tier(kb)
      if (ta !== tb) return ta - tb
      if (ka === null && kb === null) return 0
      if (ka === null) return 1
      if (kb === null) return -1
      return ka - kb
    })
  }, [payments, sortByRemaining])

  useEffect(() => {
    api.get('partners').then(r => setPartners(r.data)).catch(() => setPartners([]))
    api.get('users/managers-for-select').then(r => setUsers(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (user?.role === 'manager') setFilterManager(String(user.id))
  }, [user])

  const openAdd = () => {
    setForm({ ...EMPTY_FORM })
    setEditingId(null)
    setError('')
    api.get('partners').then(r => setPartners(r.data)).catch(() => {})
    setModal(true)
  }

  const openEdit = (p: Payment) => {
    api.get('partners').then(r => setPartners(r.data)).catch(() => {})
    setForm({
      partner_id: String(p.partner_id),
      payment_type: p.payment_type,
      description: p.description,
      amount: String(p.amount),
      day_of_month: p.day_of_month ? String(p.day_of_month) : '',
      deadline_date: p.deadline_date || '',
      remind_days_before: String(p.remind_days_before),
      contract_months: p.contract_months ? String(p.contract_months) : '',
      notify_accounting: p.notify_accounting ?? true,
      contract_url: p.contract_url || '',
      service_period: p.service_period || 'yearly',
      project_category: p.project_category || '',
    })
    setEditingId(p.id)
    setError('')
    setModal(true)
  }

  const save = async () => {
    if (!form.partner_id || !form.description || !form.amount) { setError('Заполните все обязательные поля'); return }
    setSaving(true)
    try {
      const payload = {
        partner_id: Number(form.partner_id),
        payment_type: form.payment_type,
        description: form.description,
        amount: Number(form.amount),
        contract_months: form.contract_months ? Number(form.contract_months) : null,
        day_of_month: form.day_of_month ? Number(form.day_of_month) : null,
        deadline_date: form.deadline_date || null,
        remind_days_before: Number(form.remind_days_before),
        notify_accounting: form.notify_accounting,
        contract_url: form.contract_url || null,
        service_period: form.payment_type === 'service_expiry' ? form.service_period : null,
        project_category: form.project_category || null,
      }
      if (editingId) {
        await api.put(`payments/${editingId}`, payload)
        if (drawer?.id === editingId) await syncDrawerPayment(editingId)
      } else {
        await api.post('payments', payload)
      }
      setModal(false)
      load()
    } catch (e: unknown) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  const runDeletePayment = async () => {
    if (deletePaymentId === null) return
    const id = deletePaymentId
    try {
      await api.delete(`payments/${id}`)
      if (drawer?.id === id) setDrawer(null)
      await load()
    } catch (e: unknown) {
      alert(formatApiError(e))
      throw e
    }
  }

  // Drawer actions
  const openDrawer = async (p: Payment) => {
    setMonthPayMethods({})
    setPayConfirmModalMonthId(null)
    setPayConfirmBackdateYmd('')
    setDrawer(p)
    setDrawerLoading(true)
    setAddMonthOpen(false)
    const ym0 = currentYM()
    const autoDesc = `${p.description} ${MONTHS_RU[parseInt(ym0.split('-')[1]) - 1]} ${ym0.split('-')[0]} Акт/СФ`
    setAddMonthForm({
      month: ym0,
      due_date: defaultDueDateForMonth(ym0, p.day_of_month ?? null),
      amount: '',
      description: autoDesc,
      note: '',
    })
    setMonthSaved(null)
    try {
      const [monthsRes, payRes] = await Promise.all([
        api.get<PaymentMonth[]>(`payments/${p.id}/months`),
        api.get<Payment>(`payments/${p.id}`),
      ])
      setDrawerMonths(monthsRes.data)
      const pmInit: Record<number, string> = {}
      for (const row of monthsRes.data) {
        if (row.status !== 'paid') {
          pmInit[row.id] = (row.received_payment_method || 'transfer').toLowerCase()
        }
      }
      setMonthPayMethods(pmInit)
      setDrawer(payRes.data)
    } finally {
      setDrawerLoading(false)
    }
  }

  const addMonth = async () => {
    if (!drawer) return
    if (!addMonthForm.due_date) {
      alert('Укажите срок оплаты (дату), чтобы строка корректно отображалась в дебиторке.')
      return
    }
    try {
      const r = await api.post(`payments/${drawer.id}/months`, {
        month: addMonthForm.month,
        due_date: addMonthForm.due_date || null,
        amount: addMonthForm.amount ? Number(addMonthForm.amount) : null,
        description: addMonthForm.description || null,
        note: addMonthForm.note || null,
      })
      setDrawerMonths(prev => [...prev, r.data].sort((a, b) => a.month.localeCompare(b.month)))
      setAddMonthOpen(false)
      await syncDrawerPayment(drawer.id)
      const nextMonth = addMonthForm.month
      const autoDesc = `${drawer.description} ${MONTHS_RU[parseInt(nextMonth.split('-')[1]) - 1]} ${nextMonth.split('-')[0]} Акт/СФ`
      const ymNext = currentYM()
      setAddMonthForm({
        month: ymNext,
        due_date: defaultDueDateForMonth(ymNext, drawer.day_of_month ?? null),
        amount: '',
        description: autoDesc,
        note: '',
      })
    } catch (e: any) {
      const detail = e.response?.data?.detail
      const msg = typeof detail === 'string' ? detail
        : typeof detail === 'object' ? JSON.stringify(detail)
        : e.message || 'Ошибка добавления месяца'
      alert(msg)
    }
  }

  /** when: `now` — сервер ставит текущее время; `backdate` — полдень по локальному календарю для ymd */
  const confirmMonth = async (
    monthId: number,
    when: 'now' | { backdateYmd: string },
  ) => {
    if (!drawer) return
    let paidAtIso: string | undefined
    if (when !== 'now') {
      const [y, mo, d] = when.backdateYmd.split('-').map(Number)
      if (!y || !mo || !d) {
        alert('Укажите дату зачисления')
        return
      }
      const localNoon = new Date(y, mo - 1, d, 12, 0, 0, 0)
      if (Number.isNaN(localNoon.getTime())) {
        alert('Некорректная дата')
        return
      }
      paidAtIso = localNoon.toISOString()
    }
    setConfirmingMonth(monthId)
    try {
      const method = (monthPayMethods[monthId] || 'transfer').toLowerCase()
      const payload: { received_payment_method: string; paid_at?: string } = {
        received_payment_method: ['transfer', 'card', 'cash'].includes(method) ? method : 'transfer',
      }
      if (paidAtIso) payload.paid_at = paidAtIso
      const r = await api.post(`payments/${drawer.id}/months/${monthId}/confirm`, payload)
      setDrawerMonths(prev => prev.map(m => m.id === monthId ? r.data : m))
      setMonthSaved(monthId)
      setTimeout(() => setMonthSaved(null), 3000)
      await syncDrawerPayment(drawer.id)
      setPayConfirmModalMonthId(null)
      setPayConfirmBackdateYmd('')
    } catch (e: unknown) {
      alert(formatApiError(e))
    } finally {
      setConfirmingMonth(null)
    }
  }

  const markActMonth = async (monthId: number) => {
    if (!drawer) return
    setConfirmingAct(monthId)
    try {
      const r = await api.post(`payments/${drawer.id}/months/${monthId}/mark-act`, {})
      setDrawerMonths(prev => prev.map(m => m.id === monthId ? r.data : m))
      setMonthSaved(monthId)
      setTimeout(() => setMonthSaved(null), 3000)
    } finally {
      setConfirmingAct(null)
    }
  }

  const duplicateMonthToNext = async (monthId: number) => {
    if (!drawer) return
    setDuplicatingMonth(monthId)
    try {
      const r = await api.post<PaymentMonth>(`payments/${drawer.id}/months/${monthId}/duplicate-next`, {})
      setDrawerMonths(prev => [...prev, r.data].sort((a, b) => a.month.localeCompare(b.month)))
      await syncDrawerPayment(drawer.id)
    } catch (e: unknown) {
      alert(formatApiError(e))
    } finally {
      setDuplicatingMonth(null)
    }
  }

  const runDeleteMonth = async () => {
    if (!drawer || deleteMonthId === null) return
    const mid = deleteMonthId
    const pid = drawer.id
    try {
      await api.delete(`payments/${pid}/months/${mid}`)
      setDrawerMonths(prev => prev.filter(m => m.id !== mid))
      await syncDrawerPayment(pid)
    } catch (e: unknown) {
      alert(formatApiError(e))
      throw e
    }
  }

  const bulkAddMonths = async () => {
    if (!drawer || !drawer.contract_months) return
    const months = generateMonths(addMonthForm.month, drawer.contract_months)
    const parts = splitContractAmountCents(Number(drawer.amount), months.length)
    for (let i = 0; i < months.length; i++) {
      const m = months[i]
      try {
        const due = defaultDueDateForMonth(m, drawer.day_of_month ?? null)
        const r = await api.post(`payments/${drawer.id}/months`, {
          month: m,
          due_date: due,
          amount: parts[i],
          note: null,
        })
        setDrawerMonths(prev => {
          const exists = prev.find(x => x.month === m)
          if (exists) return prev
          return [...prev, r.data].sort((a, b) => a.month.localeCompare(b.month))
        })
      } catch { /* skip duplicate month or validation */ }
    }
    setAddMonthOpen(false)
    await syncDrawerPayment(drawer.id)
  }

  const paidMonths = drawerMonths.filter(m => m.status === 'paid').length
  const actMonths = drawerMonths.filter(m => m.act_issued).length
  const totalMonths = drawerMonths.length
  const payModalMonth =
    payConfirmModalMonthId != null
      ? drawerMonths.find((x) => x.id === payConfirmModalMonthId) ?? null
      : null

  return (
    <Layout>
      <PageHeader
        title="Проекты"
        subtitle="Все проекты по партнёрам"
        action={<BtnPrimary onClick={openAdd}>+ Новый проект</BtnPrimary>}
      />

      <div
        style={{
          padding: '22px 24px',
          overflowY: 'auto',
          overflowX: 'hidden',
          flex: 1,
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {(user?.role === 'admin' || user?.role === 'administration') && (
            <Select value={filterManager} onChange={e => setFilterManager(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Все менеджеры</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все статусы</option>
            <option value="pending">Ожидается</option>
            <option value="overdue">Просрочено</option>
            <option value="paid">Оплачено</option>
            <option value="postponed">Отложено</option>
          </Select>
          <Select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Все типы</option>
            <option value="recurring">Рекуррентный</option>
            <option value="one_time">Разовый</option>
            <option value="service_expiry">Сервисный</option>
          </Select>
          <Select value={filterCategory} onChange={e => setCategoryFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Все линии</option>
            <option value="web">Web</option>
            <option value="seo">SEO</option>
            <option value="ppc">PPC</option>
            <option value="mobile_app">Мобильное приложение</option>
            <option value="tech_support">Тех сопровождение</option>
            <option value="hosting_domain">Хостинг/домен</option>
          </Select>
          <Select
            value={sortByRemaining}
            onChange={e => setSortByRemaining(e.target.value as 'default' | 'urgency')}
            style={{ maxWidth: 320 }}
          >
            <option value="default">Осталось: как в системе</option>
            <option value="urgency">Осталось: просрочка → ближайшие → дальше</option>
          </Select>
        </div>

        <Card style={{ width: '100%', minWidth: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: 112, minWidth: 112 }} />
            </colgroup>
            <thead>
              <tr>
                <Th>Партнёр</Th>
                <Th>Услуга</Th>
                <Th>Линия</Th>
                <Th>Тип</Th>
                <Th>Сумма</Th>
                <Th title="Дата ближайшего платежа по графику; если неоплаченных месяцев нет — окончание договора или день месяца">
                  Ближайший срок
                </Th>
                <Th
                  title="Нажмите, чтобы переключить сортировку по срочности (просрочка и ближайшие сверху)"
                  onClick={() => setSortByRemaining(s => (s === 'default' ? 'urgency' : 'default'))}
                  style={{
                    cursor: 'pointer',
                    color: sortByRemaining === 'urgency' ? '#1a6b3c' : undefined,
                    textDecoration: sortByRemaining === 'urgency' ? 'underline' : undefined,
                    textUnderlineOffset: 3,
                  }}
                >
                  Осталось{sortByRemaining === 'urgency' ? ' ↓' : ''}
                </Th>
                <Th>Статус</Th>
                <Th style={{ whiteSpace: 'nowrap' }} />
              </tr>
            </thead>
            <tbody>
              {displayedPayments.map(p => {
                const dl = daysLeft(listDueDateStr(p), listDueDayOfMonth(p))
                const isActive = drawer?.id === p.id
                return (
                  <tr
                    key={p.id}
                    onClick={() => openDrawer(p)}
                    style={{
                      borderBottom: '1px solid #e8e9ef',
                      cursor: 'pointer',
                      background: isActive ? '#f0f7f3' : undefined,
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLTableRowElement).style.background = '#fafbfc' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isActive ? '#f0f7f3' : '' }}
                  >
                    <Td style={{ verticalAlign: 'middle', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <PartnerAvatar name={p.partner.name} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                          <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.partner.manager?.name}</div>
                        </div>
                      </div>
                    </Td>
                    <Td style={{ color: '#8a8fa8', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'middle' }}>
                      {p.description}
                    </Td>
                    <Td>{lineBadge(p.project_category)}</Td>
                    <Td>{statusBadge(p.payment_type)}</Td>
                    <Td><span style={{ fontWeight: 700 }}>{formatMoneyNumber(p.amount)}</span></Td>
                    <Td>
                      {p.next_payment_due_date ? (
                        <div>
                          <div>{formatDate(p.next_payment_due_date)}</div>
                          {p.next_payment_month && (
                            <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 2 }}>{monthLabel(p.next_payment_month)}</div>
                          )}
                        </div>
                      ) : p.deadline_date ? (
                        formatDate(p.deadline_date)
                      ) : p.day_of_month ? (
                        `${p.day_of_month}-е число`
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td><span style={{ fontWeight: 600, color: dl.color }}>{dl.label}</span></Td>
                    <Td>{statusBadge(p.status)}</Td>
                    <Td style={{ verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      <div
                        style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}
                        onClick={e => e.stopPropagation()}
                      >
                        {['admin', 'manager', 'administration', 'accountant'].includes(user?.role || '') && (
                          <>
                            <BtnIconEdit onClick={() => openEdit(p)} />
                            <BtnIconDelete onClick={() => setDeletePaymentId(p.id)} title="Удалить в корзину" />
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {displayedPayments.length === 0 && <Empty text="Проектов не найдено" />}
        </Card>
      </div>

      {/* ───── DRAWER ───── */}
      {drawer && (
        <>
          {/* backdrop */}
          <div
            onClick={() => setDrawer(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.18)', zIndex: 200 }}
          />
          {/* panel */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 'min(100vw, 520px)',
            maxWidth: '100vw',
            boxSizing: 'border-box',
            background: '#fff', boxShadow: '-4px 0 32px rgba(0,0,0,.12)',
            zIndex: 201, display: 'flex', flexDirection: 'column', overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            {/* header */}
            <div style={{
              padding: '16px 16px 14px',
              borderBottom: '1px solid #e8e9ef',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              flexShrink: 0,
            }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <PartnerAvatar name={drawer.partner.name} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{drawer.partner.name}</div>
                    <div style={{ fontSize: 12, color: '#8a8fa8' }}>{drawer.partner.manager?.name}</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#444', marginTop: 8 }}>{drawer.description}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {lineBadge(drawer.project_category)}
                  {statusBadge(drawer.payment_type)}
                  {statusBadge(drawer.status)}
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#1a6b3c' }}>
                    {formatAmount(drawer.amount)}
                  </span>
                  {drawer.contract_months && (
                    <span style={{ fontSize: 12, background: '#eef2ff', color: '#4361ee', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                      {drawer.contract_months} мес.
                    </span>
                  )}
                  <span style={{
                    fontSize: 11, borderRadius: 6, padding: '2px 8px', fontWeight: 600,
                    background: drawer.notify_accounting ? '#f0faf4' : '#f5f6fa',
                    color: drawer.notify_accounting ? '#1a6b3c' : '#8a8fa8',
                    border: `1px solid ${drawer.notify_accounting ? '#c3e6d0' : '#e8e9ef'}`,
                  }}>
                    {drawer.notify_accounting ? '📊 Бухгалтерия уведомляется' : '📊 Без бухгалтерии'}
                  </span>
                  {drawer.payment_type === 'service_expiry' && drawer.service_period && (
                    <span style={{ fontSize: 11, borderRadius: 6, padding: '2px 8px', fontWeight: 600, background: '#eef2ff', color: '#4361ee', border: '1px solid #c7d2fe' }}>
                      {drawer.service_period === 'yearly' ? '📅 Ежегодно' : '🗓 Ежемесячно'}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    padding: '12px 14px',
                    background: '#f8fafc',
                    borderRadius: 10,
                    border: '1px solid #e8e9ef',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#64748b',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Срок оплаты (как в таблице «Проекты»)
                  </div>
                  {listDueDateStr(drawer) ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1d23', marginTop: 4 }}>
                        {formatDate(listDueDateStr(drawer)!)}
                      </div>
                      {(() => {
                        const dl = daysLeft(listDueDateStr(drawer), listDueDayOfMonth(drawer))
                        if (dl.label === '—') return null
                        return (
                          <div style={{ fontSize: 13, fontWeight: 600, color: dl.color, marginTop: 2 }}>
                            Осталось: {dl.label}
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 4 }}>Не задан</div>
                  )}
                  <div style={{ fontSize: 11, color: '#8a8fa8', lineHeight: 1.45, marginTop: 8 }}>
                    {dueSourceHint(drawer)}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4, marginTop: 6 }}>
                    Дату договора меняйте в «Редактировать проект» (✎). Срок по строке графика — в самой строке месяца (поле «Срок оплаты»).
                  </div>
                </div>
                {drawer.contract_url && (
                  <a
                    href={drawer.contract_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12, color: '#4361ee', textDecoration: 'none', fontWeight: 600 }}
                  >
                    📄 Контракт →
                  </a>
                )}
              </div>
              <button onClick={() => setDrawer(null)} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
                color: '#8a8fa8', lineHeight: 1, padding: 4, marginTop: -2,
              }}>✕</button>
            </div>

            {/* progress bar */}
            {totalMonths > 0 && (
              <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a8fa8', marginBottom: 4 }}>
                  <span>Акт выставлен</span>
                  <span style={{ fontWeight: 600, color: actMonths === totalMonths ? '#1a6b3c' : '#1a1d23' }}>
                    {actMonths} / {totalMonths}
                  </span>
                </div>
                <div style={{ height: 5, background: '#e8e9ef', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.round((actMonths / totalMonths) * 100)}%`,
                    background: actMonths === totalMonths ? '#2d6a4f' : '#52b788',
                    transition: 'width .3s',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a8fa8', marginBottom: 5 }}>
                  <span>Оплата прошла</span>
                  <span style={{ fontWeight: 600, color: paidMonths === totalMonths ? '#1a6b3c' : '#1a1d23' }}>
                    {paidMonths} / {totalMonths}
                  </span>
                </div>
                <div style={{ height: 6, background: '#e8e9ef', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.round((paidMonths / totalMonths) * 100)}%`,
                    background: paidMonths === totalMonths ? '#1a6b3c' : '#4361ee',
                    transition: 'width .3s',
                  }} />
                </div>
              </div>
            )}

            {/* months list */}
            <div style={{ padding: '14px 16px 20px', flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                marginBottom: 14,
              }}
              >
                <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>Разбивка по месяцам</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
                  {drawer.contract_months && drawerMonths.length === 0 && (
                    <BtnOutline onClick={bulkAddMonths} style={{ fontSize: 12, padding: '5px 10px' }}>
                      ⚡ Авто ({drawer.contract_months} мес.)
                    </BtnOutline>
                  )}
                  <BtnPrimary onClick={() => setAddMonthOpen(v => !v)} style={{ fontSize: 12, padding: '5px 12px' }}>
                    + Месяц
                  </BtnPrimary>
                </div>
              </div>

              {/* add month form */}
              {addMonthOpen && (
                <div style={{ background: '#f5f6fa', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                  {/* Auto info row */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {drawer.partner?.manager && (
                      <span style={{ fontSize: 11, background: '#eef2ff', color: '#4361ee', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>
                        👤 {drawer.partner.manager.name}
                      </span>
                    )}
                    {drawer.contract_url && (
                      <a href={drawer.contract_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, background: '#f0faf4', color: '#1a6b3c', borderRadius: 6, padding: '3px 8px', fontWeight: 600, textDecoration: 'none' }}>
                        📄 Договор →
                      </a>
                    )}
                    {drawer.notify_accounting && (
                      <span style={{ fontSize: 11, background: '#fff7ed', color: '#c2410c', borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>
                        📊 Бухгалтерия получит уведомление
                      </span>
                    )}
                  </div>
                  <Field label="Описание (Акт/СФ)">
                    <Input value={addMonthForm.description}
                      placeholder={`${drawer.description} Март 2026 Акт/СФ`}
                      onChange={e => setAddMonthForm(f => ({ ...f, description: e.target.value }))} />
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, marginTop: 10 }}>
                    <Field label="Месяц услуги (период акта)">
                      <Input type="month" value={addMonthForm.month}
                        onChange={e => {
                          const v = e.target.value
                          const [y, m] = v.split('-')
                          const autoDesc = `${drawer.description} ${MONTHS_RU[parseInt(m) - 1]} ${y} Акт/СФ`
                          setAddMonthForm(f => ({
                            ...f,
                            month: v,
                            description: autoDesc,
                            due_date: defaultDueDateForMonth(v, drawer.day_of_month ?? null),
                          }))
                        }} />
                    </Field>
                    <Field label="Срок оплаты (день)">
                      <Input type="date" value={addMonthForm.due_date}
                        onChange={e => setAddMonthForm(f => ({ ...f, due_date: e.target.value }))} />
                      <div style={{ fontSize: 10, color: '#8a8fa8', marginTop: 4 }}>
                        По этой дате строка попадёт в дебиторку (просрочка / ожидание).
                        {drawer.day_of_month ? ` По умолчанию — ${drawer.day_of_month}-е число месяца услуги.` : ' По умолчанию — последний день месяца.'}
                      </div>
                    </Field>
                  </div>
                  <Field label="Сумма (если другая, иначе — полная сумма договора)">
                    <MoneyInput
                      value={addMonthForm.amount}
                      placeholder={formatMoneyNumber(drawer.amount)}
                      onChange={(v) => setAddMonthForm(f => ({ ...f, amount: v }))}
                    />
                  </Field>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <BtnPrimary onClick={addMonth} style={{ fontSize: 12, padding: '6px 14px' }}>Добавить</BtnPrimary>
                    <BtnOutline onClick={() => setAddMonthOpen(false)} style={{ fontSize: 12, padding: '6px 14px' }}>Отмена</BtnOutline>
                  </div>
                </div>
              )}

              {drawerLoading && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#8a8fa8', fontSize: 13 }}>Загрузка...</div>
              )}

              {!drawerLoading && drawerMonths.length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#b0b4c8', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
                  Месяцы ещё не добавлены.<br />Нажмите «+ Месяц» или «Авто», чтобы создать график.
                </div>
              )}

              {drawerMonths.map(m => {
                const isPaid = m.status === 'paid'
                const actOk = !!m.act_issued
                const bothDone = actOk && isPaid
                const effAmount = m.amount ?? drawer.amount
                const nextYm = nextMonthYm(m.month)
                const nextMonthTaken = drawerMonths.some(x => x.month === nextYm)
                const btnStyle = (primary: boolean, disabled: boolean) => ({
                  background: primary ? '#1a6b3c' : '#fff',
                  color: primary ? '#fff' : '#4361ee',
                  border: primary ? 'none' : '1px solid #c8d4f0',
                  borderRadius: 8,
                  padding: '7px 11px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: disabled ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: disabled ? 0.55 : 1,
                  minHeight: 34,
                  boxSizing: 'border-box' as const,
                } as const)
                return (
                  <div
                    key={m.id}
                    style={{
                      borderRadius: 12,
                      marginBottom: 10,
                      background: '#fff',
                      border: '1px solid #e8e9ef',
                      overflow: 'hidden',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '11px 14px',
                        borderBottom: '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 10, minWidth: 0, flex: '1 1 180px' }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 14,
                            flexShrink: 0,
                            background: bothDone ? '#d1f0de' : '#e8e9ef',
                          }}
                        >
                          {bothDone ? '✅' : '⏳'}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{monthLabel(m.month)}</div>
                          {m.due_date && (
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                              Срок оплаты: {formatDate(m.due_date)}
                            </div>
                          )}
                          {m.description && (
                            <div
                              style={{
                                fontSize: 11,
                                color: '#64748b',
                                marginTop: 4,
                                lineHeight: 1.4,
                                wordBreak: 'break-word',
                              }}
                            >
                              {m.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexShrink: 0,
                          marginLeft: 'auto',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 14, color: isPaid ? '#1a6b3c' : '#0f172a', whiteSpace: 'nowrap' }}>
                          {formatMoneyNumber(effAmount)}
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginLeft: 4 }}>UZS</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeleteMonthId(m.id)}
                          title="Удалить строку месяца"
                          style={{
                            background: '#fff',
                            border: '1px solid #e8e9ef',
                            borderRadius: 8,
                            color: '#94a3b8',
                            fontSize: 15,
                            cursor: 'pointer',
                            lineHeight: 1,
                            padding: '5px 9px',
                            flexShrink: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.35 }}>
                        <b style={{ color: actOk ? '#166534' : '#94a3b8' }}>Акт</b>
                        {actOk
                          ? ` ✓ ${m.act_issued_at ? new Date(m.act_issued_at).toLocaleDateString('ru-RU') : ''}`
                          : ' — не отмечен'}
                      </div>
                      <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.35 }}>
                        <b style={{ color: isPaid ? '#166534' : '#94a3b8' }}>Оплата</b>
                        {isPaid
                          ? ` ✓ ${m.paid_at ? new Date(m.paid_at).toLocaleDateString('ru-RU') : ''}`
                          : ' — ожидается'}
                      </div>
                      {m.note && <div style={{ fontSize: 11, color: '#8a8fa8', lineHeight: 1.35 }}>{m.note}</div>}
                    </div>

                    <div
                      style={{
                        padding: '9px 14px 11px',
                        borderTop: '1px solid #f1f5f9',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        alignItems: 'center',
                        minWidth: 0,
                      }}
                    >
                      {['admin', 'manager', 'administration', 'financier'].includes(user?.role || '') && (
                        <button
                          type="button"
                          title={nextMonthTaken ? `Месяц ${monthLabel(nextYm)} уже в графике` : `Создать строку на ${monthLabel(nextYm)}`}
                          onClick={() => duplicateMonthToNext(m.id)}
                          disabled={nextMonthTaken || duplicatingMonth === m.id}
                          style={btnStyle(false, nextMonthTaken || duplicatingMonth === m.id)}
                        >
                          {duplicatingMonth === m.id ? '…' : '→ След. месяц'}
                        </button>
                      )}
                      {!actOk && (
                        <button
                          type="button"
                          title="Отметить акт / счёт-фактуру"
                          onClick={() => markActMonth(m.id)}
                          disabled={confirmingAct === m.id}
                          style={btnStyle(false, confirmingAct === m.id)}
                        >
                          {confirmingAct === m.id ? '…' : 'АКТ/СФ'}
                        </button>
                      )}
                      {!isPaid && (
                        <button
                          type="button"
                          title="Зафиксировать поступление денег"
                          onClick={() => {
                            setPayConfirmBackdateYmd('')
                            setPayConfirmModalMonthId(m.id)
                          }}
                          disabled={confirmingMonth === m.id}
                          style={btnStyle(true, confirmingMonth === m.id)}
                        >
                          Оплата прошла
                        </button>
                      )}
                      {monthSaved === m.id && (
                        <span style={{ fontSize: 11, color: '#1a6b3c', fontWeight: 600, width: '100%' }}>✓ Уведомление в Telegram</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* footer */}
            {totalMonths > 0 && (
              <div style={{
                padding: '14px 16px',
                borderTop: '1px solid #e8e9ef',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                flexShrink: 0,
              }}
              >
                <span style={{ color: '#8a8fa8' }}>Итого оплачено</span>
                <span style={{ fontWeight: 700, color: '#1a6b3c' }}>
                  {formatAmount(drawerMonths.filter(m => m.status === 'paid').reduce((s, m) => s + Number(m.amount ?? drawer.amount), 0))}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add / Edit project Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editingId ? 'Редактировать проект' : 'Новый проект'}
        footer={<><BtnOutline onClick={() => setModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={save} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить'}</BtnPrimary></>}
      >
        {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <Field label="Партнёр *">
          <Select value={form.partner_id} onChange={e => setForm(f => ({ ...f, partner_id: e.target.value }))}>
            <option value="">Выберите партнёра</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Линия (CEO)">
          <Select value={form.project_category} onChange={e => setForm(f => ({ ...f, project_category: e.target.value }))}>
            <option value="">Не указано</option>
            <option value="web">Web — сайты и веб</option>
            <option value="seo">SEO</option>
            <option value="ppc">PPC</option>
            <option value="mobile_app">Мобильное приложение</option>
            <option value="tech_support">Тех сопровождение</option>
            <option value="hosting_domain">Хостинг/домен</option>
          </Select>
        </Field>
        <Field label="Услуга *">
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Абон. SEO, март 2026" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Тип платежа">
            <Select value={form.payment_type} onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}>
              <option value="recurring">Рекуррентный</option>
              <option value="one_time">Разовый</option>
              <option value="service_expiry">Сервисный</option>
            </Select>
          </Field>
          <Field label="Сумма (Uzs) *">
            <MoneyInput value={form.amount} onChange={(v) => setForm(f => ({ ...f, amount: v }))} placeholder="0" />
          </Field>
        </div>
        {form.payment_type === 'recurring' && (
          <Field label="Период контракта (месяцев)">
            <Input
              type="number"
              min="1"
              max="120"
              value={form.contract_months}
              onChange={e => setForm(f => ({ ...f, contract_months: e.target.value }))}
              placeholder="Например: 6, 12, 24..."
            />
          </Field>
        )}
        {form.payment_type === 'service_expiry' && (
          <Field label="Периодичность напоминания">
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { value: 'yearly', label: '📅 Ежегодно', hint: 'домен, хостинг' },
                { value: 'monthly', label: '🗓 Ежемесячно', hint: 'подписка, сервис' },
              ].map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setForm(f => ({ ...f, service_period: opt.value }))}
                  style={{
                    flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    border: `2px solid ${form.service_period === opt.value ? '#1a6b3c' : '#e8e9ef'}`,
                    background: form.service_period === opt.value ? '#f0faf4' : '#fafbfc',
                    transition: 'all .15s',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 2 }}>{opt.hint}</div>
                </div>
              ))}
            </div>
          </Field>
        )}
        {form.payment_type === 'regular' ? (
          <Field label="День месяца (например 5 или 10)">
            <Input type="number" min="1" max="31" value={form.day_of_month} onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))} placeholder="10" />
          </Field>
        ) : (
          <Field label="Дата окончания договора">
            <Input type="date" value={form.deadline_date} onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
          </Field>
        )}
        <Field label="Напомнить за (дней)">
          <Select value={form.remind_days_before} onChange={e => setForm(f => ({ ...f, remind_days_before: e.target.value }))}>
            <option value="1">1 день</option>
            <option value="2">2 дня</option>
            <option value="3">3 дня</option>
            <option value="5">5 дней</option>
            <option value="7">7 дней</option>
          </Select>
        </Field>
        <Field label="Ссылка на контракт">
          <Input
            value={form.contract_url}
            onChange={e => setForm(f => ({ ...f, contract_url: e.target.value }))}
            placeholder="https://docs.google.com/..."
          />
        </Field>
        <div
          onClick={() => setForm(f => ({ ...f, notify_accounting: !f.notify_accounting }))}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f5f6fa', borderRadius: 10, cursor: 'pointer', marginTop: 4 }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Оповещать бухгалтерию</div>
            <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 2 }}>
              {form.notify_accounting ? 'Бухгалтерия получит уведомление о платеже' : 'Бухгалтерия не будет уведомлена'}
            </div>
          </div>
          <div style={{
            width: 42, height: 24, borderRadius: 12, position: 'relative', flexShrink: 0,
            background: form.notify_accounting ? '#1a6b3c' : '#d0d3de',
            transition: 'background .2s',
          }}>
            <div style={{
              position: 'absolute', top: 3, left: form.notify_accounting ? 21 : 3,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,.2)', transition: 'left .2s',
            }} />
          </div>
        </div>
      </Modal>

      <Modal
        open={payConfirmModalMonthId !== null && !!payModalMonth}
        onClose={() => {
          setPayConfirmModalMonthId(null)
          setPayConfirmBackdateYmd('')
        }}
        title={payModalMonth ? `Оплата прошла — ${monthLabel(payModalMonth.month)}` : 'Оплата прошла'}
        footer={(
          <>
            <BtnOutline
              onClick={() => {
                setPayConfirmModalMonthId(null)
                setPayConfirmBackdateYmd('')
              }}
              disabled={payConfirmModalMonthId !== null && confirmingMonth === payConfirmModalMonthId}
            >
              Отмена
            </BtnOutline>
            <BtnPrimary
              disabled={payConfirmModalMonthId === null || confirmingMonth === payConfirmModalMonthId}
              onClick={() => {
                if (payConfirmModalMonthId === null) return
                const d = payConfirmBackdateYmd.trim()
                if (d) void confirmMonth(payConfirmModalMonthId, { backdateYmd: d })
                else void confirmMonth(payConfirmModalMonthId, 'now')
              }}
            >
              {confirmingMonth === payConfirmModalMonthId ? 'Сохраняем…' : 'Подтвердить оплату'}
            </BtnPrimary>
          </>
        )}
      >
        {payModalMonth && payConfirmModalMonthId !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Способ поступления">
              <Select
                value={monthPayMethods[payConfirmModalMonthId] ?? 'transfer'}
                onChange={(e) =>
                  setMonthPayMethods((prev) => ({ ...prev, [payConfirmModalMonthId]: e.target.value }))
                }
              >
                <option value="transfer">Перечисление (счёт)</option>
                <option value="card">Карта</option>
                <option value="cash">Наличные</option>
              </Select>
            </Field>
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>Оплата пришла сегодня?</span>{' '}
              Оставьте дату пустой и нажмите <b>Подтвердить оплату</b> внизу — зачисление зафиксируется на текущий момент.
            </div>
            <Field label="Дата фактического зачисления (необязательно)">
              <Input
                type="date"
                value={payConfirmBackdateYmd}
                onChange={(e) => setPayConfirmBackdateYmd(e.target.value)}
                disabled={confirmingMonth === payConfirmModalMonthId}
              />
            </Field>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
              Если деньги пришли раньше — выберите дату (задним числом для ДДС и «Доступные средства»), затем снова{' '}
              <b>Подтвердить оплату</b>.
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={deletePaymentId !== null}
        onClose={() => setDeletePaymentId(null)}
        title="Удалить проект?"
        message="Проект уйдёт в корзину на 30 суток (только админ может восстановить или удалить навсегда). Раздел «Архив» для архивной базы не меняется."
        confirmLabel="Удалить"
        onConfirm={runDeletePayment}
      />
      <ConfirmModal
        open={deleteMonthId !== null}
        onClose={() => setDeleteMonthId(null)}
        title="Удалить месяц?"
        message="Запись месяца будет удалена из проекта."
        confirmLabel="Удалить"
        onConfirm={runDeleteMonth}
      />
    </Layout>
  )
}
