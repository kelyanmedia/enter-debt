import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '@/lib/api'
import { SaleDealComposer, type DealTask } from '@/components/SaleDealTaskComposer'
import { DealCloseWonModal } from '@/components/DealCloseWonModal'
import { IntegerGroupedInput } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { isSalesRop } from '@/lib/salesAccess'
import { DEAL_SERVICES } from '@/lib/dealCatalog'
import { CLIENT_GEO_OPTIONS, DEFAULT_CLIENT_GEO } from '@/lib/clientGeo'

export interface DealComment {
  id: number
  body: string
  kind: string
  meta_json?: { from?: string; to?: string; due_at?: string; remind_minutes_before?: number; task_id?: number; task_type?: string } | null
  created_by_user_id?: number | null
  created_by_user_name?: string | null
  created_at: string
}

export interface DealData {
  id: number
  pipeline_id: number
  stage_id: number | null
  stage_name?: string | null
  title: string
  contact_name: string | null
  company_name: string | null
  phone?: string | null
  email?: string | null
  source?: string | null
  client_geo?: string | null
  service_type?: string | null
  service_label?: string | null
  short_note?: string | null
  budget: number | null
  currency: string
  notes: string | null
  tags: string[]
  assigned_user_id: number | null
  assigned_user_name: string | null
  sort_order: number
  created_at: string
  closed_at?: string | null
  payment_id?: number | null
  commission_id?: number | null
  comments?: DealComment[]
  tasks?: DealTask[]
}

interface Stage {
  id: number
  name: string
  color: string | null
  is_closed_lost?: boolean
  is_closed_won?: boolean
}

interface SalesUser {
  id: number
  name: string
  role?: string
}

const SOURCE_OPTIONS = ['Веб-сайт', 'Рекомендация', 'Холодный звонок', 'Соцсети', 'Выставка', 'Партнёр', 'Другое']

function budgetToInput(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  return String(Math.round(v))
}

const BACKDROP_VISIBLE = '8%'
const LEFT_COL_FLEX = '0 0 52%'
const LEFT_COL_MIN = 380
const LEFT_COL_MAX = 560

const FS = {
  label: 11,
  section: 11,
  input: 13,
  body: 13,
  meta: 12,
  hint: 11,
  title: 18,
  icon: 16,
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtMonthLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { month: 'long' }).replace(/^./, c => c.toUpperCase())
}

function daysSince(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

function normalizePhoneForLinks(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  return {
    telegram: `https://t.me/+${digits}`,
    whatsapp: `https://wa.me/${digits}`,
  }
}

const CHEVRON_SVG_GRAY =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 d=%27M3 4.5L6 7.5L9 4.5%27/%3E%3C/svg%3E")'

const selectChevronStyle = (chevron: string): React.CSSProperties => ({
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage: chevron,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  backgroundSize: '10px 10px',
  paddingRight: 28,
})

const fieldLabel: React.CSSProperties = {
  fontSize: FS.label,
  fontWeight: 600,
  color: '#64748b',
  marginBottom: 4,
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #d1d9e6',
  borderRadius: 8,
  padding: '7px 10px',
  fontSize: FS.input,
  outline: 'none',
  fontFamily: 'inherit',
  color: '#0f172a',
  background: '#fff',
}

const sectionBox: React.CSSProperties = {
  border: '1px solid #d8dee9',
  borderRadius: 10,
  padding: 12,
  background: '#fff',
  boxShadow: '0 1px 2px rgba(15,23,42,.03)',
}

const sectionTitle: React.CSSProperties = {
  fontSize: FS.section,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  marginBottom: 10,
}

const inlineFieldInput: React.CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: FS.body,
  color: '#0f172a',
  fontFamily: 'inherit',
  padding: 0,
  lineHeight: 1.35,
}

function DealSection({ title, children, muted }: { title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div style={{
      ...sectionBox,
      ...(muted ? { background: '#f8fafc', borderColor: '#d1d9e6' } : {}),
    }}>
      <div style={sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function DealFieldBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid #d1d9e6',
      borderRadius: 8,
      padding: '8px 10px',
      background: '#fff',
    }}>
      <div style={{ fontSize: FS.label, color: '#64748b', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  )
}

function fmtChatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function fmtChatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function MonthPill({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', margin: '14px 0 10px' }}>
      <span style={{
        display: 'inline-block',
        padding: '4px 14px',
        borderRadius: 999,
        border: '1px solid #e2e8f0',
        background: '#fff',
        fontSize: FS.hint,
        color: '#64748b',
        fontWeight: 600,
      }}>
        {label}
      </span>
    </div>
  )
}

function ChatFeedLine({ comment }: { comment: DealComment }) {
  const author = comment.created_by_user_name
    || (comment.kind === 'system' || comment.kind === 'stage_change' ? 'Система' : 'Пользователь')
  const time = fmtChatTime(comment.created_at)
  const date = fmtChatDate(comment.created_at)

  let body = comment.body
  let tag: string | null = null

  if (comment.kind === 'stage_change') {
    tag = comment.meta_json?.to || comment.body.replace('Новый этап: ', '').replace('Этап: ', '')
    body = `Новый этап: ${tag}`
    tag = null
  } else if (comment.kind === 'task') {
    tag = 'задача'
    const dueAt = comment.meta_json?.due_at
    if (dueAt) body = `${body} · до ${fmtDateTime(dueAt)}`
  } else if (comment.kind === 'system') {
    tag = null
  }

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid #eef1f5' }}>
      <div style={{ fontSize: FS.meta, color: '#475569', lineHeight: 1.45 }}>
        <span style={{ color: '#94a3b8' }}>{time}</span>
        <span style={{ margin: '0 8px', color: '#cbd5e1' }}>{date}</span>
        <span style={{ fontWeight: 700, color: '#1e293b' }}>{author}</span>
        {tag && (
          <span style={{ marginLeft: 8, fontSize: FS.hint, color: '#2563eb', fontWeight: 600 }}>{tag}</span>
        )}
        <span style={{ marginLeft: 8 }}>{body}</span>
      </div>
    </div>
  )
}

function ContactMessengerButton({
  href,
  label,
  children,
  color,
}: {
  href?: string
  label: string
  children: React.ReactNode
  color: string
}) {
  const disabled = !href
  return (
    <a
      href={href || undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onClick={e => { if (disabled) e.preventDefault() }}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        background: disabled ? '#f1f5f9' : color,
        color: '#fff',
        fontWeight: 800,
        fontSize: FS.icon,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        flexShrink: 0,
      }}
    >
      {children}
    </a>
  )
}

export function SaleDealCard({
  deal,
  stages,
  pipelineId,
  users,
  onSave,
  onDelete,
  onClose,
}: {
  deal: DealData | null
  stages: Stage[]
  pipelineId: number
  users: SalesUser[]
  onSave: (d: DealData) => void
  onDelete?: (id: number) => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const [detail, setDetail] = useState<DealData | null>(deal)
  const isNew = !deal?.id && !detail?.id
  const [comments, setComments] = useState<DealComment[]>(deal?.comments ?? [])
  const [tasks, setTasks] = useState<DealTask[]>(deal?.tasks ?? [])
  const [loadingDetail, setLoadingDetail] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [closeWonOpen, setCloseWonOpen] = useState(false)

  const [title, setTitle] = useState(deal?.title ?? '')
  const [contact, setContact] = useState(deal?.contact_name ?? '')
  const [company, setCompany] = useState(deal?.company_name ?? '')
  const [phone, setPhone] = useState(deal?.phone ?? '')
  const [email, setEmail] = useState(deal?.email ?? '')
  const [source, setSource] = useState(deal?.source ?? '')
  const [clientGeo, setClientGeo] = useState(deal?.client_geo ?? DEFAULT_CLIENT_GEO)
  const [serviceType, setServiceType] = useState(deal?.service_type ?? 'seo')
  const [shortNote, setShortNote] = useState(deal?.short_note ?? '')
  const [budget, setBudget] = useState(budgetToInput(deal?.budget))
  const [currency, setCurrency] = useState(deal?.currency ?? 'USD')
  const [stageId, setStageId] = useState<number>(deal?.stage_id ?? stages[0]?.id ?? 0)
  const [assignedId, setAssignedId] = useState<string>(
    deal?.assigned_user_id?.toString() ?? user?.id?.toString() ?? ''
  )

  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true)
    try {
      const res = await api.get<DealData & { comments: DealComment[]; tasks: DealTask[] }>(`sales/deals/${id}`)
      setDetail(res.data)
      setComments(res.data.comments ?? [])
      setTasks(res.data.tasks ?? [])
      setTitle(res.data.title)
      setContact(res.data.contact_name ?? '')
      setCompany(res.data.company_name ?? '')
      setPhone(res.data.phone ?? '')
      setEmail(res.data.email ?? '')
      setSource(res.data.source ?? '')
      setClientGeo(res.data.client_geo ?? DEFAULT_CLIENT_GEO)
      setServiceType(res.data.service_type ?? 'seo')
      setShortNote(res.data.short_note ?? '')
      setBudget(budgetToInput(res.data.budget))
      setCurrency(res.data.currency ?? 'USD')
      setStageId(res.data.stage_id ?? stages[0]?.id ?? 0)
      setAssignedId(res.data.assigned_user_id?.toString() ?? '')
    } catch {
      // silent
    } finally {
      setLoadingDetail(false)
    }
  }, [stages])

  useEffect(() => {
    if (deal?.id) void loadDetail(deal.id)
  }, [deal?.id, loadDetail])

  useEffect(() => {
    if (isNew && user?.id && !assignedId) {
      setAssignedId(String(user.id))
    }
  }, [isNew, user?.id, assignedId])

  const canReassignDeal = isSalesRop(user)
  const mopUsers = useMemo(() => users.filter(u => u.role === 'mop'), [users])
  const assignedDisplayName = useMemo(() => {
    const id = assignedId ? parseInt(assignedId, 10) : user?.id
    return users.find(u => u.id === id)?.name
      ?? detail?.assigned_user_name
      ?? deal?.assigned_user_name
      ?? user?.name
      ?? 'Менеджер по продажам'
  }, [assignedId, users, detail?.assigned_user_name, deal?.assigned_user_name, user?.name, user?.id])

  const stageDays = deal ? daysSince(deal.created_at) : 0
  const displayName = contact.trim() || company.trim() || title.trim() || 'Новая сделка'
  const serviceMeta = DEAL_SERVICES.find(s => s.key === serviceType)
  const phoneLinks = normalizePhoneForLinks(phone)

  const hasDealContent = Boolean(
    title.trim()
    || contact.trim()
    || company.trim()
    || phone.trim()
    || email.trim()
    || shortNote.trim()
    || budget.trim()
    || source.trim()
  )

  const canSaveDeal = !saving && hasDealContent

  function resolveTitle() {
    return title.trim() || company.trim() || contact.trim() || 'Новая сделка'
  }

  const feedRef = useRef<HTMLDivElement>(null)

  const chatFeedGroups = useMemo(() => {
    const sorted = [...comments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const groups: { month: string; items: DealComment[] }[] = []
    for (const c of sorted) {
      const month = fmtMonthLabel(c.created_at)
      const g = groups.find(x => x.month === month)
      if (g) g.items.push(c)
      else groups.push({ month, items: [c] })
    }
    return groups
  }, [comments])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatFeedGroups.length, comments.length])

  async function saveDeal() {
    if (!hasDealContent) return
    setSaving(true)
    const payload: Record<string, unknown> = {
      title: resolveTitle(),
      contact_name: contact.trim() || null,
      company_name: company.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      client_geo: clientGeo || DEFAULT_CLIENT_GEO,
      service_type: serviceType,
      short_note: shortNote.trim() || null,
      budget: budget ? parseInt(budget, 10) : null,
      currency,
      stage_id: stageId || null,
    }
    if (canReassignDeal) {
      payload.assigned_user_id = assignedId ? parseInt(assignedId, 10) : user?.id ?? null
    }
    try {
      if (isNew) {
        const r = await api.post<DealData>('sales/deals', { pipeline_id: pipelineId, ...payload })
        setDetail(r.data)
        onSave(r.data)
        void loadDetail(r.data.id)
      } else {
        const id = deal?.id ?? detail?.id
        const r = await api.patch<DealData>(`sales/deals/${id}`, payload)
        onSave(r.data)
        void loadDetail(id!)
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  async function handleNoteAdded(comment: DealComment) {
    setComments(prev => [...prev, comment])
  }

  async function handleTaskCreated(task: DealTask) {
    setTasks(prev => [...prev.filter(t => t.id !== task.id), task])
    const dealId = deal?.id ?? detail?.id
    if (dealId) void loadDetail(dealId)
  }

  async function doDelete() {
    if (!deal) return
    try {
      await api.delete(`sales/deals/${deal.id}`)
      onDelete?.(deal.id)
      onClose()
    } catch {
      // silent
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
      {/* Видимый фон воронки слева */}
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        style={{
          width: BACKDROP_VISIBLE,
          flexShrink: 0,
          border: 'none',
          background: 'rgba(30,35,45,.42)',
          cursor: 'pointer',
          padding: 0,
        }}
      />

      {/* Панель справа — на всю оставшуюся ширину */}
      <div style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        background: '#f5f6fa',
        display: 'flex',
        overflow: 'hidden',
        boxShadow: '-12px 0 48px rgba(15,23,42,.18)',
        borderLeft: '1px solid #e2e8f0',
      }}>
        {/* ── Левая колонка: карточка в стиле «Клиентской базы» ── */}
        <div style={{
          flex: LEFT_COL_FLEX,
          minWidth: LEFT_COL_MIN,
          maxWidth: LEFT_COL_MAX,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: '#eef1f6',
          borderRight: '1px solid #c5ced9',
        }}>
          {/* Шапка */}
          <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #d8dee9', flexShrink: 0, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Название сделки"
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: FS.title,
                    fontWeight: 700,
                    color: '#1a1d23',
                    fontFamily: 'inherit',
                    lineHeight: 1.15,
                    padding: 0,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: FS.meta, fontWeight: 800, color: '#1e3a5f' }}>
                    Услуга: {serviceMeta?.label || '—'}
                  </span>
                  <span style={{ fontSize: FS.meta, color: '#94a3b8' }}>·</span>
                  <span style={{ fontSize: FS.meta, color: '#475569' }}>
                    Компания: {company.trim() || '—'}
                  </span>
                  {detail?.id ? (
                    <>
                      <span style={{ fontSize: FS.meta, color: '#94a3b8' }}>·</span>
                      <span style={{ fontSize: FS.meta, color: '#475569' }}>#{detail.id}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: 32,
                  height: 32,
                  border: '1px solid #e8e9ef',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: FS.icon,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select
                value={stageId}
                onChange={e => setStageId(Number(e.target.value))}
                aria-label="Этап сделки"
                style={{
                  minWidth: 160,
                  maxWidth: '100%',
                  border: '1px solid #d1d9e6',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: FS.input,
                  color: '#0f172a',
                  background: '#fff',
                  fontFamily: 'inherit',
                  ...selectChevronStyle(CHEVRON_SVG_GRAY),
                }}
              >
                {stages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {!isNew && (
                <span style={{ fontSize: FS.meta, color: '#64748b' }}>
                  {stageDays} дн. на этапе
                </span>
              )}
              <span style={{ fontSize: FS.meta, color: '#64748b' }}>
                Менеджер: {assignedDisplayName}
              </span>
              {source.trim() ? (
                <span style={{ fontSize: FS.meta, color: '#64748b' }}>Источник: {source}</span>
              ) : null}
            </div>
          </div>

          {/* Контент */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <DealSection title="Контакты">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                <DealFieldBox label="Компания">
                  <input
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="Название компании"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
                <DealFieldBox label="ФИО">
                  <input
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                    placeholder="Имя и фамилия"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
                <DealFieldBox label="Телефон">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="+998 99 999 9999"
                      style={{ ...inlineFieldInput, flex: 1, minWidth: 0 }}
                    />
                    <ContactMessengerButton href={phoneLinks?.telegram} label="Открыть Telegram" color="#229ED9">
                      TG
                    </ContactMessengerButton>
                    <ContactMessengerButton href={phoneLinks?.whatsapp} label="Открыть WhatsApp" color="#22c55e">
                      WA
                    </ContactMessengerButton>
                  </div>
                </DealFieldBox>
                <DealFieldBox label="E-mail">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@company.com"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
              </div>
            </DealSection>

            <DealSection title="Параметры сделки">
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <div style={fieldLabel}>Услуга *</div>
                  <select
                    value={serviceType}
                    onChange={e => setServiceType(e.target.value)}
                    style={{ ...fieldInput, ...selectChevronStyle(CHEVRON_SVG_GRAY) }}
                  >
                    {DEAL_SERVICES.map(s => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>
                {canReassignDeal ? (
                  <div>
                    <div style={fieldLabel}>Ответственный</div>
                    <select
                      value={assignedId}
                      onChange={e => setAssignedId(e.target.value)}
                      style={{ ...fieldInput, ...selectChevronStyle(CHEVRON_SVG_GRAY) }}
                    >
                      {mopUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                ) : null}
                <div>
                  <div style={fieldLabel}>Бюджет</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <IntegerGroupedInput
                      value={budget}
                      onChange={setBudget}
                      placeholder="0"
                      style={{ ...fieldInput, flex: 1 }}
                    />
                    <select
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                      style={{ ...fieldInput, width: 90, ...selectChevronStyle(CHEVRON_SVG_GRAY) }}
                    >
                      <option value="USD">USD</option>
                      <option value="UZS">UZS</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={fieldLabel}>Источник лида</div>
                  <select
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    style={{ ...fieldInput, ...selectChevronStyle(CHEVRON_SVG_GRAY) }}
                  >
                    <option value="">— не указан —</option>
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel}>GEO клиента</div>
                  <select
                    value={clientGeo}
                    onChange={e => setClientGeo(e.target.value)}
                    style={{ ...fieldInput, ...selectChevronStyle(CHEVRON_SVG_GRAY) }}
                  >
                    {CLIENT_GEO_OPTIONS.map(g => <option key={g.code} value={g.code}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={fieldLabel}>Комментарий к сделке</div>
                  <textarea
                    value={shortNote}
                    onChange={e => setShortNote(e.target.value)}
                    placeholder="Краткое описание, контекст, договорённости..."
                    rows={3}
                    style={{
                      ...fieldInput,
                      resize: 'vertical',
                      lineHeight: 1.45,
                      minHeight: 56,
                    }}
                  />
                </div>
              </div>
            </DealSection>
          </div>

          {/* Футер */}
          <div style={{
            padding: '8px 14px', borderTop: '1px solid #d8dee9', display: 'flex', alignItems: 'center', gap: 6,
            flexShrink: 0, background: '#fff',
          }}>
            {!isNew && onDelete && (
              confirmDelete ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: FS.meta, color: '#64748b', fontWeight: 600 }}>Удалить?</span>
                  <button type="button" title="Подтвердить удаление" onClick={doDelete} style={{ ...iconBtn, ...iconBtnDanger }} aria-label="Подтвердить удаление">✓</button>
                  <button type="button" title="Отмена" onClick={() => setConfirmDelete(false)} style={{ ...iconBtn, ...iconBtnGhost }} aria-label="Отмена">×</button>
                </div>
              ) : (
                <button type="button" title="Удалить" onClick={() => setConfirmDelete(true)} style={{ ...iconBtn, ...iconBtnGhostDanger }} aria-label="Удалить">🗑</button>
              )
            )}
            {!isNew && !detail?.payment_id && stages.some(s => s.is_closed_won) && (
              <button
                type="button"
                title="Закрыть сделку"
                aria-label="Закрыть сделку"
                onClick={() => setCloseWonOpen(true)}
                style={{ ...iconBtn, ...iconBtnSuccess }}
              >
                $
              </button>
            )}
            {!isNew && detail?.payment_id && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#f0faf4', border: '1px solid #bbf7d0',
                borderRadius: 8, padding: '6px 12px', fontSize: FS.meta, color: '#15803d',
              }}>
                <span style={{ fontWeight: 700 }}>Закрыта</span>
                <a
                  href={`/payments?highlight=${detail.payment_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#15803d', fontSize: FS.hint, fontWeight: 600 }}
                >
                  #{detail.payment_id}
                </a>
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                title={isNew ? 'Создать сделку' : 'Сохранить'}
                aria-label={isNew ? 'Создать сделку' : 'Сохранить'}
                onClick={() => void saveDeal()}
                disabled={!canSaveDeal}
                style={{
                  ...iconBtn,
                  ...(canSaveDeal ? iconBtnPrimary : iconBtnDisabled),
                  cursor: canSaveDeal ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? '…' : '✓'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Правая колонка: лента + ввод ── */}
        <div style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
        }}>
          <div
            ref={feedRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '10px 14px 6px',
            }}
          >
            {loadingDetail ? (
              <div style={{ color: '#64748b', fontSize: FS.body, padding: '20px 0' }}>Загрузка…</div>
            ) : isNew ? (
              <div style={{ color: '#94a3b8', fontSize: FS.meta, padding: '24px 0', textAlign: 'center' }}>
                Сохраните сделку — затем здесь появится история переписки
              </div>
            ) : chatFeedGroups.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: FS.meta, padding: '24px 0', textAlign: 'center' }}>
                История пустая — напишите примечание ниже
              </div>
            ) : (
              chatFeedGroups.map(group => (
                <div key={group.month}>
                  <MonthPill label={group.month} />
                  {group.items.map(c => (
                    <ChatFeedLine key={c.id} comment={c} />
                  ))}
                </div>
              ))
            )}
          </div>

          {isNew ? (
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid #dfe3ea',
              fontSize: FS.meta,
              color: '#94a3b8',
              flexShrink: 0,
            }}>
              Сначала сохраните сделку (✓)
            </div>
          ) : loadingDetail ? null : (
            <SaleDealComposer
              dealId={(deal?.id ?? detail?.id)!}
              dealTitle={title.trim() || displayName}
              tasks={tasks}
              onNoteAdded={handleNoteAdded}
              onTaskCreated={handleTaskCreated}
            />
          )}
        </div>
      </div>

      {!isNew && (detail?.id || deal?.id) && (
        <DealCloseWonModal
          deal={detail ?? deal!}
          stages={stages}
          open={closeWonOpen}
          onClose={() => setCloseWonOpen(false)}
          mopDefaultPercent={(user as any)?.mop_default_commission_percent ?? null}
          onDone={(updated) => {
            setCloseWonOpen(false)
            setDetail({ ...detail, ...updated })
            onSave(updated)
          }}
        />
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: 8,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: FS.icon,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
  transition: 'opacity .15s ease, background .15s ease',
}

const iconBtnPrimary: React.CSSProperties = {
  background: '#1a6b3c',
  color: '#fff',
  border: 'none',
  fontWeight: 700,
}

const iconBtnDisabled: React.CSSProperties = {
  background: '#e2e8f0',
  color: '#94a3b8',
  border: 'none',
  fontWeight: 700,
}

const iconBtnSuccess: React.CSSProperties = {
  background: '#15803d',
  color: '#fff',
  border: 'none',
  fontSize: 18,
  fontWeight: 700,
}

const iconBtnGhost: React.CSSProperties = {
  background: '#f8fafc',
  color: '#64748b',
  border: '1px solid #e2e8f0',
  fontSize: FS.icon,
  fontWeight: 400,
}

const iconBtnGhostDanger: React.CSSProperties = {
  background: '#fff',
  color: '#94a3b8',
  border: '1px solid #e2e8f0',
  fontSize: 16,
}

const iconBtnDanger: React.CSSProperties = {
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  fontWeight: 700,
  fontSize: FS.body,
}
