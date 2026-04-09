import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import {
  PageHeader, Card, Th, Td, BtnPrimary, BtnOutline, BtnIconEdit, Modal,
  ConfirmModal, Field, Input, Select, Empty, formatMoneyNumber, MoneyInput,
} from '@/components/ui'
import api from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Manager { id: number; name: string }

interface LinkablePayment {
  id: number
  description: string
  partner_name: string
  partner_manager_name?: string | null
}

interface Commission {
  id: number
  project_name: string
  project_type: string
  project_cost: number
  production_cost: number
  manager_percent: number
  actual_payment: number | null
  received_amount_1: number | null
  received_amount_2: number | null
  received_amount_1_on?: string | null
  received_amount_2_on?: string | null
  commission_paid_full: boolean
  project_date: string
  note: string | null
  manager_id: number
  payment_id?: number | null
  linked_payment_description?: string | null
  linked_partner_name?: string | null
  manager?: Manager
  // computed
  profit: number
  total_manager_income: number
  manager_income_from_actual: number
  total_received: number
}

interface Stats {
  total_projects: number
  total_cost: number
  total_profit: number
  total_manager_income: number
  total_received: number
  total_pending: number
}

const PROJECT_TYPES = [
  { value: 'site', label: 'Сайт' },
  { value: 'seo',  label: 'SEO' },
  { value: 'ppc',  label: 'PPC' },
]

const MONTHS_RU = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
]

const EMPTY_FORM = {
  project_name: '',
  project_type: 'site',
  project_cost: '',
  production_cost: '',
  manager_percent: '',
  actual_payment: '',
  received_amount_1: '',
  received_amount_2: '',
  commission_paid_full: false,
  project_date: new Date().toISOString().slice(0, 10),
  note: '',
  manager_id: '',
  payment_id: '',
  duplicate_months: '0',
  received_amount_1_on: '',
  received_amount_2_on: '',
}

function typeBadge(t: string) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    site: { label: 'Сайт', color: '#2563eb', bg: '#dbeafe' },
    seo:  { label: 'SEO',  color: '#059669', bg: '#d1fae5' },
    ppc:  { label: 'PPC',  color: '#9333ea', bg: '#f3e8ff' },
  }
  const s = map[t] || { label: t.toUpperCase(), color: '#64748b', bg: '#f1f5f9' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      color: s.color, background: s.bg,
    }}>
      {s.label}
    </span>
  )
}

function pctBadge(paid: boolean) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700,
      color: paid ? '#059669' : '#b45309',
      background: paid ? '#d1fae5' : '#fef3c7',
    }}>
      {paid ? '✓ Получен' : '⏳ Ожидает'}
    </span>
  )
}

function fmtNum(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return formatMoneyNumber(n)
}

function debt(c: Commission) {
  const d = c.total_manager_income - c.total_received
  return d > 0 ? d : 0
}

/** Минимальные ширины колонок — таблица шире экрана, удобно листать вправо. */
const COM_COL = {
  project: 228,
  linkPay: 200,
  manager: 132,
  num: 124,
  numMd: 118,
  pct: 92,
  status: 120,
  actions: 252,
} as const

function formatApiError(e: unknown): string {
  const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: { msg?: string }) => x.msg || JSON.stringify(x)).join(', ')
  const st = err.response?.status
  if (st) return `Ошибка сервера (${st})`
  return (err as Error).message || 'Ошибка сохранения'
}

// ── Live preview for the modal ────────────────────────────────────────────────
function CalcPreview({ form }: { form: typeof EMPTY_FORM }) {
  const cost   = parseFloat(form.project_cost)    || 0
  const prod   = parseFloat(form.production_cost) || 0
  const pct    = parseFloat(form.manager_percent) || 0
  const actual = parseFloat(form.actual_payment)  || 0
  const r1     = parseFloat(form.received_amount_1) || 0
  const r2     = parseFloat(form.received_amount_2) || 0

  const profit   = cost - prod
  const totalMgr = profit * pct / 100
  const incomeFact = actual * pct / 100
  const totalRecv = r1 + r2
  const remaining = totalMgr - totalRecv

  const row = (label: string, val: number, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: '#64748b', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 700, color: color || '#1e293b', fontSize: 14 }}>
        {formatMoneyNumber(val)}
      </span>
    </div>
  )

  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', marginTop: 8,
      border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8,
        textTransform: 'uppercase', letterSpacing: 0.5 }}>Расчёт</div>
      {row('Прибыль (стоимость − себест.)', profit, profit >= 0 ? '#059669' : '#ef4444')}
      {row('Общий доход менеджера', totalMgr, '#2563eb')}
      {row('Доход от фактической оплаты', incomeFact, '#7c3aed')}
      {row('Итого получено', totalRecv)}
      {row('Долг', remaining > 0 ? remaining : 0, remaining > 0 ? '#ef4444' : '#059669')}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CommissionsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'accountant'
  /** Колонка «Менеджер», фильтр и выбор в форме — для админа и бухгалтерии. */
  const showManagerScope = isAdmin

  const curYear  = new Date().getFullYear()
  const curMonth = new Date().getMonth() + 1

  const [year,  setYear]  = useState(curYear)
  const [month, setMonth] = useState(curMonth)   // текущий месяц по умолчанию
  const [filterMgr, setFilterMgr] = useState(0)  // 0 = все

  const [commissions, setCommissions] = useState<Commission[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [managers, setManagers] = useState<Manager[]>([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem]   = useState<Commission | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [linkablePayments, setLinkablePayments] = useState<LinkablePayment[]>([])
  const [paymentLinkSearch, setPaymentLinkSearch] = useState('')

  const filteredLinkablePayments = useMemo(() => {
    const q = paymentLinkSearch.trim().toLowerCase()
    if (!q) return linkablePayments
    return linkablePayments.filter((p) => {
      const desc = (p.description || '').toLowerCase()
      const pn = (p.partner_name || '').toLowerCase()
      const pm = (p.partner_manager_name || '').toLowerCase()
      const idStr = String(p.id)
      return desc.includes(q) || pn.includes(q) || pm.includes(q) || idStr.includes(q)
    })
  }, [linkablePayments, paymentLinkSearch])

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { year }
      if (month)     params.month      = month
      if (filterMgr) params.manager_id = filterMgr

      const [cRes, sRes] = await Promise.all([
        api.get('commissions',       { params }),
        api.get('commissions/stats', { params }),
      ])
      setCommissions(cRes.data)
      setStats(sRes.data)
    } finally {
      setLoading(false)
    }
  }, [year, month, filterMgr])

  useEffect(() => {
    if (!user) return
    if (user.role === 'administration') {
      void router.replace('/')
      return
    }
    load()
  }, [load, user, router])

  useEffect(() => {
    if (!user || user.role === 'administration') return
    if (user.role === 'admin' || user.role === 'accountant') {
      api
        .get('users')
        .then((r) =>
          setManagers(r.data.filter((u: Manager & { role: string }) => u.role === 'manager')),
        )
        .catch(() => setManagers([]))
    } else {
      setManagers([])
    }
  }, [user])

  useEffect(() => {
    if (!modalOpen) return
    api
      .get<LinkablePayment[]>('commissions/linkable-payments', {
        params: { for_commission: true },
      })
      .then((r) => setLinkablePayments(r.data || []))
      .catch(() => setLinkablePayments([]))
  }, [modalOpen])

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openAdd() {
    setEditItem(null)
    const defaultMgr = user?.role === 'manager' ? String(user.id) : ''
    setForm({ ...EMPTY_FORM, manager_id: defaultMgr })
    setFormError('')
    setPaymentLinkSearch('')
    setModalOpen(true)
  }

  function openEdit(c: Commission) {
    setEditItem(c)
    const pf = (v: number | string | null) => v != null ? String(parseFloat(String(v))) : ''
    setForm({
      project_name: c.project_name,
      project_type: c.project_type,
      project_cost: pf(c.project_cost),
      production_cost: pf(c.production_cost),
      manager_percent: pf(c.manager_percent),
      actual_payment: c.actual_payment != null ? pf(c.actual_payment) : '',
      received_amount_1: c.received_amount_1 != null ? pf(c.received_amount_1) : '',
      received_amount_2: c.received_amount_2 != null ? pf(c.received_amount_2) : '',
      received_amount_1_on: c.received_amount_1_on ? String(c.received_amount_1_on).slice(0, 10) : '',
      received_amount_2_on: c.received_amount_2_on ? String(c.received_amount_2_on).slice(0, 10) : '',
      commission_paid_full: c.commission_paid_full,
      project_date: c.project_date,
      note: c.note || '',
      manager_id: String(c.manager_id),
      payment_id: c.payment_id != null && c.payment_id !== undefined ? String(c.payment_id) : '',
      duplicate_months: '0',
    })
    setFormError('')
    setPaymentLinkSearch('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setPaymentLinkSearch('')
  }

  function f(k: keyof typeof EMPTY_FORM, v: string | boolean) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function save() {
    if (!form.project_name.trim()) { setFormError('Введите название проекта'); return }
    if (!form.project_cost)        { setFormError('Введите стоимость проекта'); return }
    if (!form.manager_percent)     { setFormError('Укажите % менеджера'); return }
    const pct = parseFloat(form.manager_percent)
    if (pct < 1 || pct > 20)      { setFormError('Процент должен быть от 1 до 20'); return }
    setSaving(true); setFormError('')
    try {
      const body: Record<string, unknown> = {
        project_name: form.project_name.trim(),
        project_type: form.project_type,
        project_cost: parseFloat(form.project_cost),
        production_cost: parseFloat(form.production_cost) || 0,
        manager_percent: pct,
        actual_payment: form.actual_payment ? parseFloat(form.actual_payment) : null,
        received_amount_1: form.received_amount_1 ? parseFloat(form.received_amount_1) : null,
        received_amount_2: form.received_amount_2 ? parseFloat(form.received_amount_2) : null,
        received_amount_1_on: form.received_amount_1.trim()
          ? (form.received_amount_1_on.trim() ? form.received_amount_1_on : null)
          : null,
        received_amount_2_on: form.received_amount_2.trim()
          ? (form.received_amount_2_on.trim() ? form.received_amount_2_on : null)
          : null,
        commission_paid_full: form.commission_paid_full,
        project_date: form.project_date,
        note: form.note || null,
      }
      if (showManagerScope && form.manager_id) body.manager_id = parseInt(form.manager_id, 10)
      body.payment_id = form.payment_id ? parseInt(form.payment_id, 10) : null

      if (editItem) {
        await api.put(`commissions/${editItem.id}`, body)
      } else {
        const dup = Math.min(36, Math.max(0, parseInt(form.duplicate_months || '0', 10) || 0))
        body.duplicate_months = dup
        await api.post('commissions', body)
      }
      closeModal()
      await load()
    } catch (e) {
      setFormError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!deleteId) return
    await api.delete(`commissions/${deleteId}`)
    setDeleteId(null)
    await load()
  }

  // ── Year options ───────────────────────────────────────────────────────────
  const years = Array.from({ length: 4 }, (_, i) => curYear - 1 + i)

  if (user?.role === 'administration') {
    return (
      <Layout>
        <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
          Раздел недоступен. Перенаправление на главную…
        </div>
      </Layout>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <PageHeader
        title="Комиссия"
        subtitle="Учёт комиссий: привязка к любому проекту из «Проекты» (включая проекты с другим ПМ). В P&L строка «Процент менеджера» заполняется суммами «Получено» в месяц даты получения (или даты проекта, если дату не указали). В Projects Cost из маржи вычитается резерв под %. Рекуррент: «Дублей на месяцы вперёд» при создании или кнопки «+1 мес» у строки."
        action={<BtnPrimary onClick={openAdd}>+ Добавить проект</BtnPrimary>}
      />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', fontSize: 14, cursor: 'pointer' }}
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', fontSize: 14, cursor: 'pointer', minWidth: 130 }}
        >
          <option value={0}>Все месяцы</option>
          {MONTHS_RU.map((m, i) => (
            <option key={i+1} value={i+1}>{m}</option>
          ))}
        </select>

        {showManagerScope && managers.length > 0 && (
          <select
            value={filterMgr}
            onChange={e => setFilterMgr(Number(e.target.value))}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
              background: '#fff', fontSize: 14, cursor: 'pointer', minWidth: 150 }}
          >
            <option value={0}>Все менеджеры</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
        Таблица широкая: при необходимости прокручивайте её вправо — все суммы и кнопки останутся читаемыми.
      </p>

      {/* Table */}
      <Card>
        <div
          style={{
            overflowX: 'auto',
            overflowY: 'visible',
            WebkitOverflowScrolling: 'touch',
            maxWidth: '100%',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: showManagerScope ? 1540 : 1400,
              tableLayout: 'fixed',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                <Th style={{ width: COM_COL.project, minWidth: COM_COL.project }}>Проект (комиссия)</Th>
                <Th style={{ width: COM_COL.linkPay, minWidth: COM_COL.linkPay }}>Проект «Проекты»</Th>
                {showManagerScope && (
                  <Th style={{ width: COM_COL.manager, minWidth: COM_COL.manager }}>Менеджер</Th>
                )}
                <Th style={{ textAlign: 'right', width: COM_COL.num, minWidth: COM_COL.num }}>Стоимость</Th>
                <Th style={{ textAlign: 'right', width: COM_COL.num, minWidth: COM_COL.num }}>Прибыль</Th>
                <Th
                  style={{ textAlign: 'center', width: COM_COL.pct, minWidth: COM_COL.pct }}
                  title="Доля менеджера от прибыли"
                >
                  % менедж.
                </Th>
                <Th style={{ textAlign: 'right', width: COM_COL.numMd, minWidth: COM_COL.numMd }}>Общий доход</Th>
                <Th style={{ textAlign: 'right', width: COM_COL.numMd, minWidth: COM_COL.numMd }}>Доход (факт)</Th>
                <Th style={{ textAlign: 'right', width: COM_COL.numMd, minWidth: COM_COL.numMd }}>Получено</Th>
                <Th style={{ textAlign: 'right', width: COM_COL.numMd, minWidth: COM_COL.numMd }}>Долг</Th>
                <Th style={{ textAlign: 'center', width: COM_COL.status, minWidth: COM_COL.status }}>Статус</Th>
                <Th style={{ width: COM_COL.actions, minWidth: COM_COL.actions, textAlign: 'right' }}>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={showManagerScope ? 12 : 11}
                  style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Загрузка…</td></tr>
              )}
              {!loading && commissions.length === 0 && (
                <tr><td colSpan={showManagerScope ? 12 : 11} style={{ padding: 0 }}>
                  <Empty text="Проектов нет. Добавьте первый проект." />
                </td></tr>
              )}
              {commissions.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background .12s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <Td style={{ verticalAlign: 'top', wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>
                      {c.project_name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {typeBadge(c.project_type)}
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {new Date(c.project_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    {c.note && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{c.note}</div>
                    )}
                  </Td>
                  <Td style={{ fontSize: 12, color: '#475569', verticalAlign: 'top', lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {c.linked_payment_description ? (
                      <>
                        <div style={{ fontWeight: 600 }}>{c.linked_payment_description}</div>
                        {c.linked_partner_name && (
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.linked_partner_name}</div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>—</span>
                    )}
                  </Td>
                  {showManagerScope && (
                    <Td style={{ verticalAlign: 'top' }}>
                      <span style={{ fontSize: 13, lineHeight: 1.35 }}>{c.manager?.name || '—'}</span>
                    </Td>
                  )}
                  <Td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {formatMoneyNumber(c.project_cost)}
                  </Td>
                  <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <span style={{ color: c.profit >= 0 ? '#059669' : '#ef4444', fontWeight: 600 }}>
                      {formatMoneyNumber(c.profit)}
                    </span>
                  </Td>
                  <Td style={{ textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <span style={{ fontWeight: 700, color: '#2563eb' }}>{c.manager_percent}%</span>
                  </Td>
                  <Td style={{ textAlign: 'right', color: '#2563eb', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {formatMoneyNumber(c.total_manager_income)}
                  </Td>
                  <Td style={{ textAlign: 'right', color: '#7c3aed', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {fmtNum(c.manager_income_from_actual)}
                  </Td>
                  <Td style={{ textAlign: 'right', color: '#059669', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {fmtNum(c.total_received)}
                  </Td>
                  <Td style={{ textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    {debt(c) > 0
                      ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{formatMoneyNumber(debt(c))}</span>
                      : <span style={{ color: '#059669' }}>—</span>
                    }
                  </Td>
                  <Td style={{ textAlign: 'center', verticalAlign: 'top' }}>{pctBadge(c.commission_paid_full)}</Td>
                  <Td style={{ verticalAlign: 'top' }}>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 10,
                        minWidth: COM_COL.actions - 24,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <BtnOutline
                          type="button"
                          title="Копия на следующий месяц (без полученных сумм)"
                          onClick={async () => {
                            await api.post(`commissions/${c.id}/duplicate-next-month`)
                            await load()
                          }}
                          style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          +1 мес
                        </BtnOutline>
                        <BtnOutline
                          type="button"
                          title="Перенести дату этой строки на следующий месяц"
                          onClick={async () => {
                            await api.post(`commissions/${c.id}/shift-next-month`)
                            await load()
                          }}
                          style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          дата →
                        </BtnOutline>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <BtnIconEdit title="Редактировать" onClick={() => openEdit(c)} style={{ width: 40, height: 40 }} />
                        <button
                          type="button"
                          title="Удалить"
                          aria-label="Удалить"
                          onClick={() => setDeleteId(c.id)}
                          style={{
                            padding: 0,
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            border: '1px solid #fecaca',
                            background: '#fff5f5',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: 16,
                            lineHeight: 1,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxSizing: 'border-box',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dashboard stats */}
      {stats && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 12,
            textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Итого за период
          </div>
          <div
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 4,
            }}
          >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, minmax(160px, 1fr))',
              gap: 12,
              minWidth: 1020,
            }}
          >
            {([
              { label: 'Проектов',               val: String(stats.total_projects),                   unit: '',     color: '#1e293b',  bg: '#fff',     featured: false },
              { label: 'Общая стоимость',         val: formatMoneyNumber(stats.total_cost),            unit: ' сум', color: '#1e293b',  bg: '#fff',     featured: false },
              { label: 'Общая прибыль',           val: formatMoneyNumber(stats.total_profit),          unit: ' сум', color: '#059669',  bg: '#fff',     featured: false },
              { label: 'Доход менеджеров (план)', val: formatMoneyNumber(stats.total_manager_income),  unit: ' сум', color: '#fff',     bg: '#1a6b3c',  featured: true  },
              { label: 'Выплачено',               val: formatMoneyNumber(stats.total_received),        unit: ' сум', color: '#059669',  bg: '#fff',     featured: false },
              { label: 'Долг менеджерам',         val: formatMoneyNumber(stats.total_pending),         unit: ' сум', color: stats.total_pending > 0 ? '#ef4444' : '#059669', bg: '#fff', featured: false },
            ] as const).map(({ label, val, unit, color, bg, featured }) => (
              <div key={label} style={{
                background: bg, border: `1px solid ${featured ? 'transparent' : '#e2e8f0'}`,
                borderRadius: 12, padding: '16px 18px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: featured ? 'rgba(255,255,255,.7)' : '#94a3b8',
                  marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {val}<span style={{ fontSize: 13, fontWeight: 500, marginLeft: 3,
                    color: featured ? 'rgba(255,255,255,.8)' : color }}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editItem ? 'Редактировать проект' : 'Добавить проект'}
        width={600}
        footer={
          <>
            <BtnOutline onClick={closeModal}>Отмена</BtnOutline>
            <BtnPrimary onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : editItem ? 'Сохранить' : 'Добавить'}
            </BtnPrimary>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {formError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
              padding: '10px 14px', color: '#dc2626', fontSize: 13 }}>
              {formError}
            </div>
          )}

          {/* Админ / бухгалтерия / администрация: выбор менеджера */}
          {showManagerScope && (
            <Field label="Менеджер">
              <Select value={form.manager_id} onChange={e => f('manager_id', e.target.value)}>
                <option value="">— не выбран —</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {!editItem && (
            <Field label="Дублей на месяцы вперёд (та же сумма и % менеджера)">
              <Input
                type="number"
                min={0}
                max={36}
                value={form.duplicate_months}
                onChange={(e) => f('duplicate_months', e.target.value)}
                placeholder="0 = только текущая дата проекта"
              />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
                Для каждого следующего месяца создаётся отдельная строка с датой проекта +1 месяц. Привязка к проекту «Проекты» — только у первой строки.
              </div>
            </Field>
          )}

          <Field label="Привязка к проекту из «Проекты» (необязательно)">
            <Input
              value={paymentLinkSearch}
              onChange={(e) => setPaymentLinkSearch(e.target.value)}
              placeholder="Поиск: партнёр, название, ПМ, id…"
              autoComplete="off"
            />
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', margin: '8px 0 6px' }}>
              Проекты (
              {filteredLinkablePayments.length}
              {linkablePayments.length ? ` из ${linkablePayments.length}` : ''})
            </div>
            <div
              style={{
                maxHeight: 240,
                overflowY: 'auto',
                border: '1px solid #e8e9ef',
                borderRadius: 10,
                background: '#fff',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setForm((p) => ({ ...p, payment_id: '' }))
                  setFormError('')
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '11px 14px',
                  border: 'none',
                  borderBottom: '1px solid #f1f5f9',
                  background: !form.payment_id ? '#e8f5ee' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  color: !form.payment_id ? '#14532d' : '#1a1d23',
                }}
              >
                — не привязано —
              </button>
              {filteredLinkablePayments.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  {linkablePayments.length === 0
                    ? 'Список пуст или ещё загружается.'
                    : 'Ничего не найдено — измените поиск.'}
                </div>
              ) : (
                filteredLinkablePayments.map((p) => {
                  const active = form.payment_id === String(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const id = String(p.id)
                        setForm((prev) => {
                          const next = { ...prev, payment_id: id }
                          const row = linkablePayments.find((x) => x.id === p.id)
                          if (row && !prev.project_name.trim()) next.project_name = row.description
                          return next
                        })
                        setFormError('')
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
                      <div style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: active ? '#14532d' : '#1a1d23',
                      }}>
                        {p.partner_name}
                        {p.partner_manager_name ? ` (ПМ: ${p.partner_manager_name})` : ''}
                        {': '}
                        {p.description}
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>id {p.id}</div>
                    </button>
                  )
                })
              )}
            </div>
            {form.payment_id &&
              !linkablePayments.some((p) => String(p.id) === form.payment_id) && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: '#b45309',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  padding: '10px 12px',
                  lineHeight: 1.45,
                }}
              >
                Текущая привязка не в списке (например, хостинг/домен). Чтобы сохранить без ошибки,
                нажмите «— не привязано —» или выберите другой проект.
                {editItem && (editItem.linked_partner_name || editItem.linked_payment_description) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#92400e' }}>
                    Сейчас: {editItem.linked_partner_name || '—'}
                    {editItem.linked_payment_description ? `: ${editItem.linked_payment_description}` : ''}{' '}
                    (id {form.payment_id})
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>
              Проекты типа «Хостинг/домен» в списке не показываются — по ним комиссия не начисляется.
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Название проекта">
              <Input
                placeholder="Название"
                value={form.project_name}
                onChange={e => f('project_name', e.target.value)}
              />
            </Field>
            <Field label="Тип проекта">
              <Select value={form.project_type} onChange={e => f('project_type', e.target.value)}>
                {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Стоимость проекта">
              <MoneyInput
                placeholder="1 000 000"
                value={form.project_cost}
                onChange={v => f('project_cost', v)}
              />
            </Field>
            <Field label="Себестоимость производства">
              <MoneyInput
                placeholder="0"
                value={form.production_cost}
                onChange={v => f('production_cost', v)}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="% менеджера от прибыли (1–20)">
              <Input
                type="number" placeholder="10" min={1} max={20} step="0.5"
                value={form.manager_percent}
                onChange={e => f('manager_percent', e.target.value)}
              />
            </Field>
            <Field label="Оплата фактическая">
              <MoneyInput
                placeholder="0"
                value={form.actual_payment}
                onChange={v => f('actual_payment', v)}
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Получено (1), сум">
              <MoneyInput
                placeholder="0"
                value={form.received_amount_1}
                onChange={v => f('received_amount_1', v)}
              />
            </Field>
            <Field label="Дата в P&L для (1)">
              <Input
                type="date"
                title="В какой месяц P&L попадает сумма; пусто — месяц «Дата проекта»"
                value={form.received_amount_1_on}
                onChange={e => f('received_amount_1_on', e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Получено (2), сум">
              <MoneyInput
                placeholder="0"
                value={form.received_amount_2}
                onChange={v => f('received_amount_2', v)}
              />
            </Field>
            <Field label="Дата в P&L для (2)">
              <Input
                type="date"
                value={form.received_amount_2_on}
                onChange={e => f('received_amount_2_on', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Дата проекта">
            <Input
              type="date"
              value={form.project_date}
              onChange={e => f('project_date', e.target.value)}
            />
          </Field>

          <Field label="Примечание (необязательно)">
            <Input
              placeholder="Краткая заметка…"
              value={form.note}
              onChange={e => f('note', e.target.value)}
            />
          </Field>

          {/* Fully-paid checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            padding: '12px 16px', borderRadius: 8, background: form.commission_paid_full ? '#d1fae5' : '#f8fafc',
            border: `1px solid ${form.commission_paid_full ? '#6ee7b7' : '#e2e8f0'}`,
            transition: 'all .15s' }}>
            <input
              type="checkbox"
              checked={form.commission_paid_full}
              onChange={e => f('commission_paid_full', e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 600, color: form.commission_paid_full ? '#059669' : '#475569', fontSize: 14 }}>
              ✓ Комиссию получил полностью
            </span>
          </label>

          {/* Live calc preview */}
          <CalcPreview form={form} />
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={deleteId !== null}
        title="Удалить проект?"
        message="Запись о проекте и его комиссии будет удалена безвозвратно."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        onConfirm={doDelete}
        onClose={() => setDeleteId(null)}
      />
    </Layout>
  )
}
