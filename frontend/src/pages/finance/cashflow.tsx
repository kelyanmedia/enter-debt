import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import {
  PageHeader,
  Card,
  BtnOutline,
  BtnPrimary,
  Modal,
  Field,
  Input,
  Select,
  MoneyInput,
  formatMoneyNumber,
  ConfirmModal,
  PaymentOptionCombobox,
} from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { isFinanceTeamRole } from '@/lib/roles'

interface Meta {
  payment_methods: { id: string; label: string }[]
  expense_categories: { slug: string; label: string }[]
  income_categories: { slug: string; label: string }[]
  template_groups: { id: string; label: string; description?: string }[]
}

interface CFEntry {
  id: number
  period_month: string
  direction: 'income' | 'expense'
  label: string
  amount_uzs: string
  amount_usd: string
  payment_method: string
  flow_category?: string | null
  recipient?: string | null
  payment_id?: number | null
  notes?: string | null
}

interface PayOpt {
  id: number
  label: string
  partner_name: string
}

interface TemplateLine {
  id: number
  template_group: string
  sort_order: number
  label: string
  default_amount_uzs: string
  default_amount_usd: string
  flow_category: string
  payment_method: string
  direction: 'income' | 'expense'
}

const DEFAULT_GROUP_LABELS: Record<string, string> = {
  monthly_salary: 'Зарплаты (шаблон)',
  monthly_admin: 'Административные',
}

function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

const iconBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  cursor: 'pointer',
}

/** Компактные кнопки в строке записи ДДС */
const entryRowIconBtn = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  cursor: 'pointer' as const,
  flexShrink: 0,
}

const entryRowShell = {
  display: 'flex' as const,
  alignItems: 'center' as const,
  gap: 12,
  padding: '8px 10px',
  borderRadius: 10,
  background: '#fff',
  minHeight: 48,
}

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftYM(ym: string, d: number) {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y, m - 1 + d, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

function ymTitle(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const names = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ]
  return `${names[m - 1] ?? ym} ${y}`
}

function pmLabel(meta: Meta | null, id: string) {
  return meta?.payment_methods.find((x) => x.id === id)?.label ?? id
}

function expCatLabel(meta: Meta | null, slug: string | null | undefined) {
  if (!slug) return '—'
  return meta?.expense_categories.find((x) => x.slug === slug)?.label ?? slug
}

function incCatLabel(meta: Meta | null, slug: string | null | undefined) {
  if (!slug) return '—'
  return meta?.income_categories.find((x) => x.slug === slug)?.label ?? slug
}

export default function FinanceCashflowPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [ym, setYm] = useState(currentYM)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [entries, setEntries] = useState<CFEntry[]>([])
  const [payOpts, setPayOpts] = useState<PayOpt[]>([])
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [editRow, setEditRow] = useState<CFEntry | null>(null)

  const [addOpen, setAddOpen] = useState<'income' | 'expense' | null>(null)
  const [form, setForm] = useState({
    label: '',
    amount_uzs: '',
    amount_usd: '',
    payment_method: 'transfer',
    flow_category: '',
    recipient: '',
    payment_id: '' as string,
    notes: '',
  })

  const [tplLines, setTplLines] = useState<TemplateLine[]>([])
  const [tplViewGroup, setTplViewGroup] = useState<string | null>(null)
  const [tplModalOpen, setTplModalOpen] = useState(false)
  const [tplEditingId, setTplEditingId] = useState<number | null>(null)
  const [tplForm, setTplForm] = useState({
    template_group: '',
    label: '',
    default_amount_uzs: '',
    default_amount_usd: '',
    payment_method: 'transfer',
    flow_category: 'salary',
    direction: 'expense' as 'income' | 'expense',
  })
  const [deleteTplId, setDeleteTplId] = useState<number | null>(null)
  const [deleteTplGroup, setDeleteTplGroup] = useState<string | null>(null)

  const [bulkIncome, setBulkIncome] = useState(false)
  const [bulkExpense, setBulkExpense] = useState(false)
  const [selIncome, setSelIncome] = useState<number[]>([])
  const [selExpense, setSelExpense] = useState<number[]>([])
  const [bulkDeleteIds, setBulkDeleteIds] = useState<number[] | null>(null)

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [loading, user, router])

  const loadMeta = useCallback(() => {
    api.get<Meta>('finance/cash-flow/meta').then((r) => setMeta(r.data))
  }, [])

  const loadTemplates = useCallback(() => {
    if (!user || !isFinanceTeamRole(user.role)) return
    api
      .get<TemplateLine[]>('finance/cash-flow/templates')
      .then((r) => setTplLines(r.data || []))
      .catch(() => setTplLines([]))
  }, [user])

  const loadEntries = useCallback(() => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setBusy(true)
    api
      .get<CFEntry[]>(`finance/cash-flow/entries?period_month=${encodeURIComponent(ym)}`)
      .then((r) => setEntries(r.data || []))
      .catch(() => setEntries([]))
      .finally(() => setBusy(false))
  }, [user, ym])

  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  useEffect(() => {
    setBulkIncome(false)
    setBulkExpense(false)
    setSelIncome([])
    setSelExpense([])
    setBulkDeleteIds(null)
  }, [ym])

  const loadPayOpts = useCallback(() => {
    api.get<PayOpt[]>('finance/cash-flow/payment-options').then((r) => setPayOpts(r.data || []))
  }, [])

  useEffect(() => {
    if (addOpen === 'income' || editRow?.direction === 'income') loadPayOpts()
  }, [addOpen, editRow?.direction, loadPayOpts])

  const incomeRows = useMemo(() => entries.filter((e) => e.direction === 'income'), [entries])
  const expenseRows = useMemo(() => entries.filter((e) => e.direction === 'expense'), [entries])

  const sumCol = (rows: CFEntry[], cur: 'uzs' | 'usd') =>
    rows.reduce((a, r) => a + (Number(cur === 'uzs' ? r.amount_uzs : r.amount_usd) || 0), 0)

  const applyTemplate = async (groups: string[]) => {
    setBusy(true)
    try {
      await api.post('finance/cash-flow/apply-template', { period_month: ym, template_groups: groups })
      loadEntries()
    } catch {
      /* toast */
    } finally {
      setBusy(false)
    }
  }

  const templateGroupsOrdered = useMemo(() => {
    const set = new Set(tplLines.map((t) => t.template_group))
    return Array.from(set).sort()
  }, [tplLines])

  const groupDisplayName = useCallback(
    (gid: string) => {
      const fromMeta = meta?.template_groups.find((x) => x.id === gid)?.label
      return fromMeta || DEFAULT_GROUP_LABELS[gid] || gid
    },
    [meta],
  )

  const openNewTemplateLine = (presetGroup: string | null) => {
    setTplEditingId(null)
    setTplForm({
      template_group: presetGroup ?? '',
      label: '',
      default_amount_uzs: '',
      default_amount_usd: '',
      payment_method: 'transfer',
      flow_category: 'salary',
      direction: 'expense',
    })
    setTplModalOpen(true)
  }

  const openEditTemplateLine = (line: TemplateLine) => {
    setTplEditingId(line.id)
    setTplForm({
      template_group: line.template_group,
      label: line.label,
      default_amount_uzs: String(line.default_amount_uzs ?? ''),
      default_amount_usd: String(line.default_amount_usd ?? ''),
      payment_method: line.payment_method,
      flow_category: line.flow_category || 'other',
      direction: line.direction,
    })
    setTplModalOpen(true)
  }

  const saveTemplateLine = async () => {
    const g = tplForm.template_group.trim()
    if (!g || !tplForm.label.trim()) return
    const uzs = Number(String(tplForm.default_amount_uzs).replace(/\s/g, '').replace(',', '.')) || 0
    const usd = Number(String(tplForm.default_amount_usd).replace(/\s/g, '').replace(',', '.')) || 0
    if (tplForm.direction === 'expense' && !tplForm.flow_category) return
    setBusy(true)
    try {
      if (tplEditingId != null) {
        await api.patch(`finance/cash-flow/templates/${tplEditingId}`, {
          template_group: g,
          label: tplForm.label.trim(),
          default_amount_uzs: uzs,
          default_amount_usd: usd,
          payment_method: tplForm.payment_method,
          flow_category: tplForm.flow_category,
          direction: tplForm.direction,
        })
      } else {
        await api.post('finance/cash-flow/templates', {
          template_group: g,
          label: tplForm.label.trim(),
          default_amount_uzs: uzs,
          default_amount_usd: usd,
          payment_method: tplForm.payment_method,
          flow_category: tplForm.flow_category,
          direction: tplForm.direction,
        })
      }
      setTplModalOpen(false)
      setTplEditingId(null)
      loadTemplates()
      loadMeta()
    } finally {
      setBusy(false)
    }
  }

  const runDeleteTemplateLine = async () => {
    if (deleteTplId == null) return
    setBusy(true)
    try {
      await api.delete(`finance/cash-flow/templates/${deleteTplId}`)
      setDeleteTplId(null)
      loadTemplates()
      loadMeta()
    } finally {
      setBusy(false)
    }
  }

  const runDeleteTemplateGroup = async () => {
    if (!deleteTplGroup) return
    setBusy(true)
    try {
      await api.delete(
        `finance/cash-flow/template-group?template_group=${encodeURIComponent(deleteTplGroup)}`,
      )
      setDeleteTplGroup(null)
      setTplViewGroup(null)
      loadTemplates()
      loadMeta()
    } finally {
      setBusy(false)
    }
  }

  const linesInViewGroup = useMemo(() => {
    if (!tplViewGroup) return []
    return tplLines.filter((t) => t.template_group === tplViewGroup).sort((a, b) => a.sort_order - b.sort_order)
  }, [tplLines, tplViewGroup])

  const openAdd = (dir: 'income' | 'expense') => {
    setForm({
      label: '',
      amount_uzs: '',
      amount_usd: '',
      payment_method: 'transfer',
      flow_category: 'other',
      recipient: '',
      payment_id: '',
      notes: '',
    })
    setAddOpen(dir)
  }

  const saveNew = async () => {
    if (!addOpen) return
    const uzs = Number(String(form.amount_uzs).replace(/\s/g, '').replace(',', '.')) || 0
    const usd = Number(String(form.amount_usd).replace(/\s/g, '').replace(',', '.')) || 0
    if (!form.label.trim()) return
    if (addOpen === 'expense' && !form.flow_category) return
    setBusy(true)
    try {
      await api.post('finance/cash-flow/entries', {
        period_month: ym,
        direction: addOpen,
        label: form.label.trim(),
        amount_uzs: uzs,
        amount_usd: usd,
        payment_method: form.payment_method,
        flow_category: addOpen === 'expense' ? form.flow_category || null : null,
        recipient: form.recipient.trim() || null,
        payment_id: form.payment_id ? Number(form.payment_id) : null,
        notes: form.notes.trim() || null,
      })
      setAddOpen(null)
      loadEntries()
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    if (!editRow) return
    const uzs = Number(String(form.amount_uzs).replace(/\s/g, '').replace(',', '.')) || 0
    const usd = Number(String(form.amount_usd).replace(/\s/g, '').replace(',', '.')) || 0
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        label: form.label.trim(),
        amount_uzs: uzs,
        amount_usd: usd,
        payment_method: form.payment_method,
        notes: form.notes.trim() || null,
      }
      if (editRow.direction === 'expense') {
        payload.flow_category = form.flow_category || null
      } else {
        payload.flow_category = null
        payload.recipient = form.recipient.trim() || null
        payload.payment_id = form.payment_id ? Number(form.payment_id) : null
      }
      await api.patch(`finance/cash-flow/entries/${editRow.id}`, payload)
      setEditRow(null)
      loadEntries()
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (r: CFEntry) => {
    setForm({
      label: r.label,
      amount_uzs: String(r.amount_uzs ?? ''),
      amount_usd: String(r.amount_usd ?? ''),
      payment_method: r.payment_method,
      flow_category: r.flow_category || 'other',
      recipient: r.recipient || '',
      payment_id: r.payment_id ? String(r.payment_id) : '',
      notes: r.notes || '',
    })
    setEditRow(r)
  }

  const runDelete = async () => {
    if (deleteId == null) return
    setBusy(true)
    try {
      await api.delete(`finance/cash-flow/entries/${deleteId}`)
      setDeleteId(null)
      loadEntries()
    } finally {
      setBusy(false)
    }
  }

  const toggleIncomeSel = (id: number) => {
    setSelIncome((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleExpenseSel = (id: number) => {
    setSelExpense((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const runBulkDelete = async () => {
    const ids = bulkDeleteIds
    if (!ids?.length) return
    setBusy(true)
    try {
      for (const id of ids) {
        await api.delete(`finance/cash-flow/entries/${id}`)
      }
      setBulkDeleteIds(null)
      setSelIncome([])
      setSelExpense([])
      setBulkIncome(false)
      setBulkExpense(false)
      loadEntries()
    } finally {
      setBusy(false)
    }
  }

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  return (
    <Layout>
      <PageHeader
        title="ДДС"
        subtitle="Движение денежных средств по месяцам: приход и расход. Шаблоны добавляют повторяющиеся строки в выбранный месяц; их можно смотреть, править и удалять. Данные учитываются в P&L."
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          padding: '22px 24px',
          paddingBottom: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <BtnOutline type="button" onClick={() => setYm((x) => shiftYM(x, -1))} disabled={busy}>
            ←
          </BtnOutline>
          <span style={{ fontWeight: 800, fontSize: 16, minWidth: 160, textAlign: 'center' }}>{ymTitle(ym)}</span>
          <BtnOutline type="button" onClick={() => setYm((x) => shiftYM(x, 1))} disabled={busy}>
            →
          </BtnOutline>
          <input
            type="month"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            style={{ marginLeft: 8, padding: 6, borderRadius: 8, border: '1px solid #e2e8f0', fontFamily: 'inherit' }}
          />
          <BtnOutline type="button" onClick={() => loadEntries()} style={{ marginLeft: 8 }}>
            Обновить
          </BtnOutline>
          <Link href="/finance/pl" style={{ marginLeft: 12, fontSize: 13, fontWeight: 600, color: '#1a6b3c' }}>
            Открыть P&L →
          </Link>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#334155' }}>Шаблоны</div>
          {templateGroupsOrdered.length === 0 && (
            <div style={{ fontSize: 13, color: '#64748b' }}>Пока нет строк шаблонов. Нажмите «Новая группа / строка».</div>
          )}
          {templateGroupsOrdered.map((g) => (
            <div key={g} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <BtnPrimary
                type="button"
                disabled={busy}
                onClick={() => void applyTemplate([g])}
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  padding: '10px 18px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                {groupDisplayName(g)}
              </BtnPrimary>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <button type="button" title="Смотреть строки" onClick={() => setTplViewGroup(g)} style={iconBtnStyle}>
                  <IconEye />
                </button>
                <button type="button" title="Добавить строку" onClick={() => openNewTemplateLine(g)} style={iconBtnStyle}>
                  <IconPlus />
                </button>
                <button
                  type="button"
                  title="Удалить всю группу"
                  onClick={() => setDeleteTplGroup(g)}
                  style={{ ...iconBtnStyle, color: '#b91c1c', borderColor: '#fecaca' }}
                >
                  <IconTrash />
                </button>
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {templateGroupsOrdered.length > 1 && (
              <BtnOutline type="button" disabled={busy} onClick={() => void applyTemplate(templateGroupsOrdered)} style={{ fontSize: 13 }}>
                + Все шаблоны в месяц
              </BtnOutline>
            )}
            <BtnOutline type="button" disabled={busy} onClick={() => openNewTemplateLine(null)} style={{ fontSize: 13 }}>
              + Новая группа / строка
            </BtnOutline>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <Card style={{ padding: 14, background: 'linear-gradient(180deg, #ecfdf5 0%, #fff 48px)', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: '#166534' }}>ПРИХОД</span>
              <div style={{ flex: 1, minWidth: 8 }} />
              {bulkIncome && selIncome.length > 0 && (
                <BtnOutline
                  type="button"
                  disabled={busy}
                  onClick={() => setBulkDeleteIds([...selIncome])}
                  style={{ fontSize: 12, padding: '5px 10px', color: '#b91c1c', borderColor: '#fecaca' }}
                >
                  Удалить ({selIncome.length})
                </BtnOutline>
              )}
              <button
                type="button"
                title={bulkIncome ? 'Выйти из режима выбора' : 'Выбрать несколько строк для удаления'}
                aria-pressed={bulkIncome}
                onClick={() => {
                  if (bulkIncome) {
                    setSelIncome([])
                    setBulkIncome(false)
                  } else {
                    setBulkIncome(true)
                  }
                }}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: bulkIncome ? '2px solid #166534' : '2px solid #cbd5e1',
                  background: bulkIncome ? '#dcfce7' : '#fff',
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: bulkIncome ? '#166534' : '#e2e8f0',
                  }}
                />
              </button>
              <BtnOutline type="button" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => openAdd('income')}>
                + Строка
              </BtnOutline>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {incomeRows.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Нет строк</div>}
              {incomeRows.map((r) => {
                const metaLine = [
                  pmLabel(meta, r.payment_method),
                  r.recipient || '',
                  r.payment_id ? `проект #${r.payment_id}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <div
                    key={r.id}
                    style={{
                      ...entryRowShell,
                      border: '1px solid #d1fae5',
                    }}
                  >
                    {bulkIncome && (
                      <label
                        style={{
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selIncome.includes(r.id)}
                          onChange={() => toggleIncomeSel(r.id)}
                          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#166534' }}
                        />
                      </label>
                    )}
                    <div
                      style={{
                        flex: '2 1 96px',
                        minWidth: 0,
                        fontSize: 16,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#14532d',
                      }}
                      title={r.label}
                    >
                      {r.label}
                    </div>
                    <div
                      style={{
                        flex: '0 0 auto',
                        fontSize: 15,
                        fontWeight: 700,
                        color: '#166534',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatMoneyNumber(Number(r.amount_uzs))} сум
                      {Number(r.amount_usd) > 0 && ` · $${formatMoneyNumber(Number(r.amount_usd))}`}
                    </div>
                    <div
                      style={{
                        flex: '1 1 100px',
                        minWidth: 0,
                        fontSize: 12,
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={metaLine || undefined}
                    >
                      {metaLine || '—'}
                    </div>
                    {!bulkIncome && (
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
                        <button type="button" title="Изменить" onClick={() => openEdit(r)} style={entryRowIconBtn}>
                          <IconPencil />
                        </button>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => setDeleteId(r.id)}
                          style={{ ...entryRowIconBtn, color: '#b91c1c', borderColor: '#fecaca' }}
                        >
                          <IconTrash />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #bbf7d0', fontWeight: 800, color: '#14532d' }}>
              Итого: {formatMoneyNumber(sumCol(incomeRows, 'uzs'))} сум
              {sumCol(incomeRows, 'usd') > 0 && ` · $${formatMoneyNumber(sumCol(incomeRows, 'usd'))}`}
            </div>
          </Card>

          <Card style={{ padding: 14, background: 'linear-gradient(180deg, #fffbeb 0%, #fff 48px)', border: '1px solid #fde68a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: '#b45309' }}>РАСХОД</span>
              <div style={{ flex: 1, minWidth: 8 }} />
              {bulkExpense && selExpense.length > 0 && (
                <BtnOutline
                  type="button"
                  disabled={busy}
                  onClick={() => setBulkDeleteIds([...selExpense])}
                  style={{ fontSize: 12, padding: '5px 10px', color: '#b91c1c', borderColor: '#fecaca' }}
                >
                  Удалить ({selExpense.length})
                </BtnOutline>
              )}
              <button
                type="button"
                title={bulkExpense ? 'Выйти из режима выбора' : 'Выбрать несколько строк для удаления'}
                aria-pressed={bulkExpense}
                onClick={() => {
                  if (bulkExpense) {
                    setSelExpense([])
                    setBulkExpense(false)
                  } else {
                    setBulkExpense(true)
                  }
                }}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: bulkExpense ? '2px solid #b45309' : '2px solid #cbd5e1',
                  background: bulkExpense ? '#fef3c7' : '#fff',
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: bulkExpense ? '#b45309' : '#e2e8f0',
                  }}
                />
              </button>
              <BtnOutline type="button" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => openAdd('expense')}>
                + Строка
              </BtnOutline>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {expenseRows.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Нет строк</div>}
              {expenseRows.map((r) => {
                const metaLine = `${expCatLabel(meta, r.flow_category)} · ${pmLabel(meta, r.payment_method)}`
                return (
                  <div
                    key={r.id}
                    style={{
                      ...entryRowShell,
                      border: '1px solid #fde68a',
                    }}
                  >
                    {bulkExpense && (
                      <label
                        style={{
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selExpense.includes(r.id)}
                          onChange={() => toggleExpenseSel(r.id)}
                          style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#b45309' }}
                        />
                      </label>
                    )}
                    <div
                      style={{
                        flex: '2 1 96px',
                        minWidth: 0,
                        fontSize: 16,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#78350f',
                      }}
                      title={r.label}
                    >
                      {r.label}
                    </div>
                    <div
                      style={{
                        flex: '0 0 auto',
                        fontSize: 15,
                        fontWeight: 700,
                        color: '#b45309',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatMoneyNumber(Number(r.amount_uzs))} сум
                      {Number(r.amount_usd) > 0 && ` · $${formatMoneyNumber(Number(r.amount_usd))}`}
                    </div>
                    <div
                      style={{
                        flex: '1 1 100px',
                        minWidth: 0,
                        fontSize: 12,
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={metaLine}
                    >
                      {metaLine}
                    </div>
                    {!bulkExpense && (
                      <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
                        <button type="button" title="Изменить" onClick={() => openEdit(r)} style={entryRowIconBtn}>
                          <IconPencil />
                        </button>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => setDeleteId(r.id)}
                          style={{ ...entryRowIconBtn, color: '#b91c1c', borderColor: '#fecaca' }}
                        >
                          <IconTrash />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #fde68a', fontWeight: 800, color: '#92400e' }}>
              Итого: {formatMoneyNumber(sumCol(expenseRows, 'uzs'))} сум
              {sumCol(expenseRows, 'usd') > 0 && ` · $${formatMoneyNumber(sumCol(expenseRows, 'usd'))}`}
            </div>
          </Card>
        </div>

        <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, margin: 0 }}>
          Формы оплаты: наличные, карта, перечисление. Категории расходов совпадают со справочником для P&L. При приходе можно
          указать «Кто принял» и привязать проект из списка.
        </p>
      </div>

      <Modal
        open={addOpen != null}
        onClose={() => setAddOpen(null)}
        title={addOpen === 'income' ? 'Приход' : 'Расход'}
        footer={(
          <>
            <BtnOutline onClick={() => setAddOpen(null)}>Отмена</BtnOutline>
            <BtnPrimary onClick={() => void saveNew()} disabled={busy}>
              Добавить
            </BtnPrimary>
          </>
        )}
      >
        <Field label="Название / источник *">
          <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Напр. ABS, офис" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Сумма, сум">
            <MoneyInput value={form.amount_uzs} onChange={(v) => setForm((f) => ({ ...f, amount_uzs: v }))} />
          </Field>
          <Field label="Сумма, USD">
            <MoneyInput value={form.amount_usd} onChange={(v) => setForm((f) => ({ ...f, amount_usd: v }))} />
          </Field>
        </div>
        <Field label="Форма оплаты">
          <Select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
            {(meta?.payment_methods ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {addOpen === 'expense' && (
          <Field label="Категория расхода *">
            <Select value={form.flow_category} onChange={(e) => setForm((f) => ({ ...f, flow_category: e.target.value }))}>
              {(meta?.expense_categories ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {addOpen === 'income' && (
          <>
            <Field label="Кто принял">
              <Input
                value={form.recipient}
                onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))}
                placeholder="ООО, ИП, имя…"
              />
            </Field>
            <Field label="Проект (из базы)">
              <PaymentOptionCombobox
                value={form.payment_id}
                onChange={(id) => setForm((f) => ({ ...f, payment_id: id }))}
                options={payOpts}
                disabled={busy}
                emptyLabel="— не привязывать"
              />
            </Field>
          </>
        )}
        <Field label="Комментарий">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </Modal>

      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title="Изменить строку"
        footer={(
          <>
            <BtnOutline onClick={() => setEditRow(null)}>Отмена</BtnOutline>
            <BtnPrimary onClick={() => void saveEdit()} disabled={busy}>
              Сохранить
            </BtnPrimary>
          </>
        )}
      >
        {editRow && (
          <>
            <Field label="Название *">
              <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Сумма, сум">
                <MoneyInput value={form.amount_uzs} onChange={(v) => setForm((f) => ({ ...f, amount_uzs: v }))} />
              </Field>
              <Field label="Сумма, USD">
                <MoneyInput value={form.amount_usd} onChange={(v) => setForm((f) => ({ ...f, amount_usd: v }))} />
              </Field>
            </div>
            <Field label="Форма оплаты">
              <Select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                {(meta?.payment_methods ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            {editRow.direction === 'expense' && (
              <Field label="Категория">
                <Select value={form.flow_category} onChange={(e) => setForm((f) => ({ ...f, flow_category: e.target.value }))}>
                  {(meta?.expense_categories ?? []).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {editRow.direction === 'income' && (
              <>
                <Field label="Кто принял">
                  <Input value={form.recipient} onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))} />
                </Field>
                <Field label="Проект">
                  <PaymentOptionCombobox
                    value={form.payment_id}
                    onChange={(id) => setForm((f) => ({ ...f, payment_id: id }))}
                    options={payOpts}
                    disabled={busy}
                    emptyLabel="— не привязывать"
                  />
                </Field>
              </>
            )}
            <Field label="Комментарий">
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </>
        )}
      </Modal>

      <ConfirmModal
        open={deleteId != null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void runDelete()}
        title="Удалить строку ДДС?"
        message="Строка будет удалена из этого месяца."
        confirmLabel="Удалить"
      />

      <ConfirmModal
        open={bulkDeleteIds != null && bulkDeleteIds.length > 0}
        onClose={() => setBulkDeleteIds(null)}
        onConfirm={() => void runBulkDelete()}
        title="Удалить выбранные строки ДДС?"
        message={`Выбрано строк: ${bulkDeleteIds?.length ?? 0}. Записи будут удалены из этого месяца.`}
        confirmLabel="Удалить все"
      />

      <Modal
        open={!!tplViewGroup}
        onClose={() => setTplViewGroup(null)}
        title={tplViewGroup ? groupDisplayName(tplViewGroup) : 'Шаблон'}
        footer={(
          <>
            <BtnOutline
              onClick={() => {
                const g = tplViewGroup
                setTplViewGroup(null)
                if (g) openNewTemplateLine(g)
              }}
            >
              Добавить строку
            </BtnOutline>
            <BtnOutline onClick={() => setTplViewGroup(null)}>Закрыть</BtnOutline>
          </>
        )}
      >
        {linesInViewGroup.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>В этой группе пока нет строк.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {linesInViewGroup.map((line) => (
              <div
                key={line.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{line.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {line.direction === 'expense' ? expCatLabel(meta, line.flow_category) : incCatLabel(meta, line.flow_category)} ·{' '}
                    {pmLabel(meta, line.payment_method)}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                    {formatMoneyNumber(Number(line.default_amount_uzs))} сум
                    {Number(line.default_amount_usd) > 0 && ` · $${formatMoneyNumber(Number(line.default_amount_usd))}`}
                  </div>
                </div>
                <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    title="Изменить"
                    onClick={() => {
                      setTplViewGroup(null)
                      openEditTemplateLine(line)
                    }}
                    style={iconBtnStyle}
                  >
                    <IconPencil />
                  </button>
                  <button
                    type="button"
                    title="Удалить строку"
                    onClick={() => setDeleteTplId(line.id)}
                    style={{ ...iconBtnStyle, color: '#b91c1c', borderColor: '#fecaca' }}
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={tplModalOpen}
        onClose={() => {
          setTplModalOpen(false)
          setTplEditingId(null)
        }}
        title={tplEditingId != null ? 'Редактировать строку шаблона' : 'Новая строка шаблона'}
        footer={(
          <>
            <BtnOutline
              onClick={() => {
                setTplModalOpen(false)
                setTplEditingId(null)
              }}
            >
              Отмена
            </BtnOutline>
            <BtnPrimary onClick={() => void saveTemplateLine()} disabled={busy}>
              Сохранить
            </BtnPrimary>
          </>
        )}
      >
        <Field label="Код группы (латиница, без пробелов) *">
          <Input
            value={tplForm.template_group}
            onChange={(e) => setTplForm((f) => ({ ...f, template_group: e.target.value }))}
            placeholder="напр. monthly_salary"
            disabled={busy}
          />
        </Field>
        <Field label="Название строки *">
          <Input
            value={tplForm.label}
            onChange={(e) => setTplForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Как будет в ДДС"
            disabled={busy}
          />
        </Field>
        <Field label="Тип">
          <Select
            value={tplForm.direction}
            onChange={(e) => {
              const d = e.target.value as 'income' | 'expense'
              setTplForm((f) => ({
                ...f,
                direction: d,
                flow_category: d === 'expense' ? 'salary' : 'services',
              }))
            }}
            disabled={busy}
          >
            <option value="expense">Расход</option>
            <option value="income">Приход</option>
          </Select>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Сумма по умолчанию, сум">
            <MoneyInput
              value={tplForm.default_amount_uzs}
              onChange={(v) => setTplForm((f) => ({ ...f, default_amount_uzs: v }))}
            />
          </Field>
          <Field label="Сумма по умолчанию, USD">
            <MoneyInput
              value={tplForm.default_amount_usd}
              onChange={(v) => setTplForm((f) => ({ ...f, default_amount_usd: v }))}
            />
          </Field>
        </div>
        <Field label="Форма оплаты">
          <Select
            value={tplForm.payment_method}
            onChange={(e) => setTplForm((f) => ({ ...f, payment_method: e.target.value }))}
            disabled={busy}
          >
            {(meta?.payment_methods ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {tplForm.direction === 'expense' ? (
          <Field label="Категория расхода *">
            <Select
              value={tplForm.flow_category}
              onChange={(e) => setTplForm((f) => ({ ...f, flow_category: e.target.value }))}
              disabled={busy}
            >
              {(meta?.expense_categories ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Категория прихода *">
            <Select
              value={tplForm.flow_category}
              onChange={(e) => setTplForm((f) => ({ ...f, flow_category: e.target.value }))}
              disabled={busy}
            >
              {(meta?.income_categories ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>

      <ConfirmModal
        open={deleteTplId != null}
        onClose={() => setDeleteTplId(null)}
        onConfirm={() => void runDeleteTemplateLine()}
        title="Удалить строку шаблона?"
        message="Строка исчезнет из списка шаблонов. Уже внесённые в месяц ДДС записи не удалятся."
        confirmLabel="Удалить"
      />

      <ConfirmModal
        open={!!deleteTplGroup}
        onClose={() => setDeleteTplGroup(null)}
        onConfirm={() => void runDeleteTemplateGroup()}
        title="Удалить группу шаблонов?"
        message={
          deleteTplGroup
            ? `Будут удалены все строки группы «${groupDisplayName(deleteTplGroup)}». Записи ДДС за месяцы не затронуты.`
            : ''
        }
        confirmLabel="Удалить группу"
      />
    </Layout>
  )
}
