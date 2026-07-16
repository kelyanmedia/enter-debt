import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  meta_json?: {
    from?: string
    to?: string
    due_at?: string
    remind_minutes_before?: number
    task_id?: number
    task_type?: string
    images?: string[]
  } | null
  images?: string[]
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
  contact_position?: string | null
  contact_role?: string | null
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

const SOURCE_OPTIONS = [
  'Холодный звонок',
  'Электронная почта',
  'Веб-сайт',
  'Реклама',
  'Рекомендация',
  'Соцсети',
  'Выставка',
  'Тендер',
  'Лид от партнера',
  'Партнёр',
  'Входящее обращение',
  'Повторные продажи',
  'Другое',
]

const CONTACT_ROLE_PRESETS = ['ЛПР', 'ЛВР', 'Помощник'] as const
const CONTACT_ROLE_CUSTOM = '__custom__'

/** Палитра по имени этапа — если в БД нет своего цвета */
const STAGE_COLOR_BY_NAME: Record<string, string> = {
  'ПЕРВИЧНЫЙ КОНТАКТ': '#94a3b8',
  'В РАБОТЕ': '#3b82f6',
  'ОТПРАВКА КП': '#8b5cf6',
  'ОЖИДАНИЕ': '#f59e0b',
  'НЕДОСТУПЕН': '#ef4444',
  'НЕ ИНТЕРЕСУЕТ': '#f97316',
  'ВЫБРАЛИ ДРУГИХ': '#fb7185',
  'ВЫСОКАЯ ЦЕНА': '#eab308',
  'НЕЦЕЛЕВОЙ': '#a855f7',
  'НЕ НАШ ПРОФИЛЬ РАБОТЫ': '#64748b',
  'НЕ ВЫШЛИ НА ЛПР': '#ec4899',
  'СДЕЛКА ВЫИГРАНА': '#22c55e',
}

function stageColor(s: { name: string; color: string | null; is_closed_won?: boolean; is_closed_lost?: boolean }): string {
  if (s.color) {
    const mapped = STAGE_COLOR_BY_NAME[s.name.toUpperCase()]
    // старые одинаковые коралловые «проигрыши» — подменяем на палитру
    if (s.is_closed_lost && (s.color === '#ff7f6e' || s.color === '#e74c3c') && mapped) return mapped
    if (!s.is_closed_lost && !s.is_closed_won && mapped && (s.color === '#b8c0cc' || s.color === '#6ba3d6' || s.color === '#4a90d9' || s.color === '#3a7bc8')) {
      return mapped
    }
    return s.color
  }
  const byName = STAGE_COLOR_BY_NAME[s.name.toUpperCase()]
  if (byName) return byName
  if (s.is_closed_won) return '#22c55e'
  if (s.is_closed_lost) return '#ef4444'
  return '#64748b'
}

function contrastText(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return '#fff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#0f172a' : '#fff'
}

function roleSelectValue(role: string): string {
  if (!role) return ''
  return (CONTACT_ROLE_PRESETS as readonly string[]).includes(role) ? role : CONTACT_ROLE_CUSTOM
}

function budgetToInput(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  return String(Math.round(v))
}

const BACKDROP_VISIBLE = '8%'
const LEFT_COL_FLEX = '0 0 48%'
const LEFT_COL_MIN = 340
const LEFT_COL_MAX = 480

const FS = {
  label: 11,
  section: 11,
  input: 13,
  body: 13,
  meta: 12,
  hint: 11,
  title: 18,
  icon: 15,
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

const UZ_PHONE_PREFIX = '+998'

/** Оставляет локальную часть без кода страны 998 */
function phoneLocalPart(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('998')) digits = digits.slice(3)
  // форматируем группами: 99 999 99 99
  const a = digits.slice(0, 2)
  const b = digits.slice(2, 5)
  const c = digits.slice(5, 7)
  const d = digits.slice(7, 9)
  return [a, b, c, d].filter(Boolean).join(' ')
}

function phoneFullFromLocal(local: string): string {
  const digits = local.replace(/\D/g, '').slice(0, 9)
  return digits ? `${UZ_PHONE_PREFIX}${digits}` : ''
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
  marginBottom: 8,
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
  lineHeight: 1.3,
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

function FloatingTip({
  anchor,
  text,
  maxWidth = 260,
}: {
  anchor: HTMLElement | null
  text: string
  maxWidth?: number
}) {
  const [pos, setPos] = useState<{ top: number; left: number; place: 'above' | 'below' } | null>(null)

  useEffect(() => {
    if (!anchor) {
      setPos(null)
      return
    }
    function update() {
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const gap = 8
      const preferAbove = r.top > 72
      const top = preferAbove ? r.top - gap : r.bottom + gap
      let left = r.left + r.width / 2
      const pad = 12
      const half = Math.min(maxWidth, 260) / 2
      left = Math.max(pad + half, Math.min(left, window.innerWidth - pad - half))
      setPos({
        top,
        left,
        place: preferAbove ? 'above' : 'below',
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor, maxWidth, text])

  if (!pos || typeof document === 'undefined') return null

  return createPortal(
    <span
      role="tooltip"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: pos.place === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 10000,
        width: 'max-content',
        maxWidth,
        padding: '8px 10px',
        borderRadius: 8,
        background: '#0f172a',
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        boxShadow: '0 10px 28px rgba(15,23,42,.35)',
        pointerEvents: 'none',
        whiteSpace: 'normal',
        textAlign: 'left',
      }}
    >
      {text}
    </span>,
    document.body,
  )
}

function CompactSelect({
  value,
  onChange,
  options,
  placeholder = '— не указан —',
  error,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  error?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null)

  const current = options.find(o => o.value === value)
  const label = current?.label || placeholder

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !btnRef.current) {
      setMenuPos(null)
      return
    }
    function place() {
      if (!btnRef.current) return
      const r = btnRef.current.getBoundingClientRect()
      // Compact menu: match trigger when narrow, never stretch full card width
      const width = Math.min(Math.max(r.width, 168), 220)
      let left = r.left
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12
      if (left < 12) left = 12
      const below = r.bottom + 6
      const spaceBelow = window.innerHeight - below
      const openUp = spaceBelow < 220 && r.top > 220
      setMenuPos({
        top: openUp ? r.top - 6 : below,
        left,
        width,
        openUp,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const menu = open && menuPos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        role="listbox"
        style={{
          position: 'fixed',
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
          maxHeight: 260,
          overflowY: 'auto',
          zIndex: 10001,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          boxShadow: '0 14px 36px rgba(15,23,42,.18)',
          padding: 6,
          transform: menuPos.openUp ? 'translateY(-100%)' : undefined,
        }}
      >
        {options.map(o => {
          const selected = o.value === value
          return (
            <button
              key={o.value || '__empty'}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderRadius: 8,
                padding: '9px 10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: FS.input,
                fontWeight: selected ? 700 : 500,
                color: '#0f172a',
                background: selected ? '#f1f5f9' : 'transparent',
              }}
            >
              <span>{o.label}</span>
              {selected ? <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> : null}
            </button>
          )
        })}
      </div>,
      document.body,
    )
    : null

  return (
    <div ref={rootRef} style={{ position: 'relative', width: '100%' }}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          ...fieldInput,
          ...selectChevronStyle(CHEVRON_SVG_GRAY),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
          cursor: 'pointer',
          color: current ? '#0f172a' : '#94a3b8',
          ...(error ? { borderColor: '#ef4444', background: '#fef2f2' } : {}),
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
          {label}
        </span>
      </button>
      {menu}
    </div>
  )
}

function HintIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 5, verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <span
        tabIndex={0}
        role="img"
        aria-label={text}
        style={{
          width: 15,
          height: 15,
          borderRadius: 99,
          border: '1px solid #94a3b8',
          color: '#64748b',
          fontSize: 10,
          fontWeight: 800,
          lineHeight: '13px',
          textAlign: 'center',
          cursor: 'help',
          background: '#f8fafc',
          fontFamily: 'inherit',
          userSelect: 'none',
        }}
      >
        i
      </span>
      {show ? <FloatingTip anchor={ref.current} text={text} /> : null}
    </span>
  )
}

function TipButton({
  tip,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tip: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  const { style, ...rest } = props
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        {...rest}
        title={tip}
        aria-label={tip}
        style={style}
      >
        {children}
      </button>
      {show ? <FloatingTip anchor={ref.current} text={tip} maxWidth={220} /> : null}
    </span>
  )
}

function DealFieldBox({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{
      border: `1px solid ${error ? '#ef4444' : '#d1d9e6'}`,
      borderRadius: 7,
      padding: '6px 8px',
      background: error ? '#fef2f2' : '#fff',
      boxShadow: error ? '0 0 0 1px rgba(239,68,68,.25)' : undefined,
    }}>
      <div style={{
        fontSize: FS.label,
        color: error ? '#b91c1c' : '#64748b',
        marginBottom: 4,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
      }}>
        <span>{label}</span>
        {hint ? <HintIcon text={hint} /> : null}
      </div>
      {children}
      {error ? (
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>
          заполните данные
        </div>
      ) : null}
    </div>
  )
}

function FieldLabel({ children, hint, error }: { children: React.ReactNode; hint?: string; error?: boolean }) {
  return (
    <div style={{ ...fieldLabel, display: 'flex', alignItems: 'center', color: error ? '#b91c1c' : fieldLabel.color }}>
      <span>{children}</span>
      {hint ? <HintIcon text={hint} /> : null}
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

function feedGroupLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Сегодня'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { month: 'long' }).replace(/^./, c => c.toUpperCase())
}

function stagePillColor(name: string | null | undefined): string {
  if (!name) return '#64748b'
  const key = name.trim().toUpperCase()
  return STAGE_COLOR_BY_NAME[key] || '#64748b'
}

function MonthPill({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      margin: '12px 0 10px',
    }}>
      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      <span style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        border: '1px solid #e5e7eb',
        background: '#fff',
        fontSize: 11,
        color: '#6b7280',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
    </div>
  )
}

function StageNamePill({ name }: { name: string }) {
  const bg = stagePillColor(name)
  const color = contrastText(bg)
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      background: bg,
      color,
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.3,
      verticalAlign: 'middle',
    }}>
      {name}
    </span>
  )
}

function AuthorChip({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 4,
      background: '#eef1f4',
      color: '#374151',
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1.3,
      verticalAlign: 'middle',
    }}>
      {name}
    </span>
  )
}

interface PipelineOption {
  id: number
  name: string
}

function groupStagesForPicker(stages: Stage[]) {
  const open = stages.filter(s => !s.is_closed_won && !s.is_closed_lost)
  const lost = stages.filter(s => s.is_closed_lost)
  const won = stages.filter(s => s.is_closed_won)
  const first = open[0] ? [open[0]] : []
  const mid = open.slice(1)
  return { first, mid, lost, won }
}

function StagePicker({
  stages,
  value,
  pipelineId,
  pipelines,
  onChange,
  onSelectPipelineStage,
}: {
  stages: Stage[]
  value: number
  pipelineId: number
  pipelines: PipelineOption[]
  onChange: (id: number) => void
  onSelectPipelineStage: (pipelineId: number, stageId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [previewPipelineId, setPreviewPipelineId] = useState(pipelineId)
  const [previewStages, setPreviewStages] = useState<Stage[]>(stages)
  const [loadingStages, setLoadingStages] = useState(false)

  const current = stages.find(s => s.id === value) ?? stages[0]
  const accent = current ? stageColor(current) : '#64748b'
  const text = contrastText(accent)
  const currentPipelineName = pipelines.find(p => p.id === pipelineId)?.name || 'Воронка'
  const otherPipelines = pipelines.filter(p => p.id !== previewPipelineId)
  const groups = groupStagesForPicker(previewStages)
  const previewName = pipelines.find(p => p.id === previewPipelineId)?.name || currentPipelineName

  useEffect(() => {
    setPreviewPipelineId(pipelineId)
    setPreviewStages(stages)
  }, [pipelineId, stages])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !btnRef.current) {
      setMenuPos(null)
      return
    }
    function place() {
      if (!btnRef.current) return
      const r = btnRef.current.getBoundingClientRect()
      const width = Math.min(Math.max(r.width, 280), 360)
      let left = r.left
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12
      if (left < 12) left = 12
      setMenuPos({ top: r.bottom + 8, left, width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  async function openPipeline(id: number) {
    if (id === previewPipelineId) return
    setPreviewPipelineId(id)
    if (id === pipelineId) {
      setPreviewStages(stages)
      return
    }
    setLoadingStages(true)
    try {
      const r = await api.get<{ stages: Stage[] }>(`sales/pipelines/${id}`)
      setPreviewStages((r.data.stages || []).map(s => ({
        id: s.id,
        name: s.name,
        color: s.color,
        is_closed_lost: s.is_closed_lost,
        is_closed_won: s.is_closed_won,
      })))
    } catch {
      setPreviewStages([])
    } finally {
      setLoadingStages(false)
    }
  }

  function pickStage(stageId: number) {
    if (previewPipelineId === pipelineId) onChange(stageId)
    else onSelectPipelineStage(previewPipelineId, stageId)
    setOpen(false)
  }

  function renderStageBtn(s: Stage, blockBg?: string) {
    const c = stageColor(s)
    const selected = previewPipelineId === pipelineId && s.id === value
    return (
      <button
        key={s.id}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => pickStage(s.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          border: 'none',
          borderRadius: 0,
          padding: '7px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: selected ? 700 : 500,
          color: '#1f2937',
          background: selected ? 'rgba(255,255,255,.55)' : (blockBg || 'transparent'),
        }}
        onMouseEnter={e => {
          if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,.72)'
        }}
        onMouseLeave={e => {
          if (!selected) e.currentTarget.style.background = selected ? 'rgba(255,255,255,.55)' : (blockBg || 'transparent')
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: c,
            flexShrink: 0,
          }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
        </span>
        {selected ? <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> : null}
      </button>
    )
  }

  const menu = open && menuPos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        role="listbox"
        style={{
          position: 'fixed',
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
          maxHeight: 'min(70vh, 520px)',
          overflowY: 'auto',
          zIndex: 10020,
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 18px 40px rgba(15,23,42,.2)',
          padding: 8,
        }}
      >
        {otherPipelines.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {otherPipelines.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => void openPipeline(p.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '11px 12px',
                  marginBottom: 6,
                  background: '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div style={{
          fontSize: 13,
          fontWeight: 800,
          color: '#111827',
          padding: '6px 4px 8px',
        }}>
          {previewName}
          {previewPipelineId !== pipelineId ? (
            <span style={{ marginLeft: 8, fontWeight: 600, color: '#6b7280' }}>· другая воронка</span>
          ) : null}
        </div>

        {loadingStages ? (
          <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Загрузка этапов…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.first.length > 0 && (
              <div style={{ borderRadius: 8, overflow: 'hidden', background: '#e5e7eb' }}>
                {groups.first.map(s => renderStageBtn(s))}
              </div>
            )}
            {groups.mid.length > 0 && (
              <div style={{ borderRadius: 8, overflow: 'hidden', background: '#bfdbfe' }}>
                {groups.mid.map(s => renderStageBtn(s))}
              </div>
            )}
            {groups.lost.length > 0 && (
              <div style={{ borderRadius: 8, overflow: 'hidden', background: '#fecaca' }}>
                {groups.lost.map(s => renderStageBtn(s))}
              </div>
            )}
            {groups.won.length > 0 && (
              <div style={{ borderRadius: 8, overflow: 'hidden', background: '#bbf7d0' }}>
                {groups.won.map(s => renderStageBtn(s))}
              </div>
            )}
            {previewStages.length === 0 && (
              <div style={{ padding: 12, color: '#6b7280', fontSize: 13 }}>В этой воронке нет этапов</div>
            )}
          </div>
        )}

        {previewPipelineId !== pipelineId && (
          <button
            type="button"
            onClick={() => void openPipeline(pipelineId)}
            style={{
              marginTop: 10,
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: '#2563eb',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '8px 4px',
            }}
          >
            ← Вернуться к «{currentPipelineName}»
          </button>
        )}
      </div>,
      document.body,
    )
    : null

  return (
    <div style={{ position: 'relative', minWidth: 180, maxWidth: '100%' }}>
      <button
        ref={btnRef}
        type="button"
        aria-label="Этап и воронка"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          border: 'none',
          borderRadius: 10,
          padding: '7px 12px',
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: text,
          background: accent,
          fontFamily: 'inherit',
          cursor: 'pointer',
          boxShadow: `0 4px 12px ${accent}38, 0 1px 2px rgba(15,23,42,.06)`,
          transition: 'transform .12s ease, box-shadow .12s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-1px)'
          e.currentTarget.style.boxShadow = `0 8px 16px ${accent}48, 0 2px 4px rgba(15,23,42,.08)`
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = `0 4px 12px ${accent}38, 0 1px 2px rgba(15,23,42,.06)`
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name || 'Этап'}
        </span>
        <span style={{ opacity: 0.85, fontSize: 12 }}>{open ? '▴' : '▾'}</span>
      </button>
      {menu}
    </div>
  )
}

function CommentAuthImage({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    void (async () => {
      try {
        const path = src.replace(/^\/api\//, '')
        const r = await api.get(path, { responseType: 'blob' })
        if (cancelled) return
        revoked = URL.createObjectURL(r.data)
        setUrl(revoked)
      } catch {
        if (!cancelled) setUrl(null)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [src])

  if (!url) {
    return (
      <div style={{
        width: 88,
        height: 88,
        borderRadius: 8,
        background: '#f1f5f9',
        border: '1px solid #e2e8f0',
      }} />
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: 0,
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          overflow: 'hidden',
          cursor: 'zoom-in',
          background: '#fff',
          width: 88,
          height: 88,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10050,
              background: 'rgba(15,23,42,.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              cursor: 'zoom-out',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              onClick={e => e.stopPropagation()}
              style={{
                maxWidth: 'min(920px, 94vw)',
                maxHeight: '90vh',
                borderRadius: 12,
                boxShadow: '0 20px 50px rgba(0,0,0,.35)',
                objectFit: 'contain',
                background: '#0f172a',
              }}
            />
          </div>,
          document.body,
        )
        : null}
    </>
  )
}

function ChatFeedLine({ comment }: { comment: DealComment }) {
  const author = comment.created_by_user_name
    || (comment.kind === 'system' || comment.kind === 'stage_change' ? 'Система' : 'Пользователь')
  const time = fmtChatTime(comment.created_at)
  const date = fmtChatDate(comment.created_at)
  const whenLabel = (() => {
    const d = new Date(comment.created_at)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) return `Сегодня ${time}`
    return `${date} ${time}`
  })()
  const imageUrls = comment.images?.length
    ? comment.images
    : (comment.meta_json?.images || []).map(name =>
      name.startsWith('/api/') ? name : `/api/sales/deal-comment-images/${name}`,
    )

  // ── Смена этапа: как в CRM — автор + цветной статус ──
  if (comment.kind === 'stage_change') {
    const toName = comment.meta_json?.to || comment.body.replace(/^Новый этап:\s*/i, '').replace(/^Этап:\s*/i, '') || '—'
    const fromName = comment.meta_json?.from || null
    return (
      <div style={{
        padding: '5px 2px',
        fontSize: 12,
        color: '#4b5563',
        lineHeight: 1.45,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 5,
      }}>
        <span style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{date}</span>
        <span style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
        <span style={{ color: '#6b7280' }}>Новый этап:</span>
        <AuthorChip name={author} />
        <StageNamePill name={toName} />
        {fromName ? (
          <span style={{ color: '#9ca3af' }}>
            из <span style={{ color: '#6b7280' }}>{fromName}</span>
          </span>
        ) : null}
      </div>
    )
  }

  // ── Задача / система — компактная строка ──
  if (comment.kind === 'task' || comment.kind === 'system') {
    let body = comment.body
    if (comment.kind === 'task' && comment.meta_json?.due_at) {
      body = `${body} · до ${fmtDateTime(comment.meta_json.due_at)}`
    }
    return (
      <div style={{ padding: '5px 2px', fontSize: 12, color: '#4b5563', lineHeight: 1.45 }}>
        <span style={{ color: '#9ca3af' }}>{date}</span>
        <span style={{ margin: '0 5px', color: '#9ca3af' }}>{time}</span>
        <AuthorChip name={author} />
        {comment.kind === 'task' ? (
          <span style={{
            marginLeft: 5,
            display: 'inline-block',
            padding: '1px 6px',
            borderRadius: 4,
            background: '#eff6ff',
            color: '#1d4ed8',
            fontSize: 11,
            fontWeight: 700,
          }}>
            задача
          </span>
        ) : null}
        <span style={{ marginLeft: 6 }}>{body}</span>
      </div>
    )
  }

  // ── Примечание / сообщение — выделенная карточка ──
  const hideBody = comment.body === 'Фото' && imageUrls.length > 0

  return (
    <div style={{
      margin: '5px 0',
      padding: '10px 12px',
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 7,
      boxShadow: '0 1px 2px rgba(15,23,42,.04)',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 99,
        background: '#eef2f7',
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }} aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.7" />
          <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 12,
          color: '#9ca3af',
          fontWeight: 500,
          marginBottom: hideBody && !imageUrls.length ? 0 : 4,
          lineHeight: 1.3,
        }}>
          {whenLabel}
          <span style={{ margin: '0 5px', color: '#d1d5db' }}>·</span>
          <span style={{ color: '#6b7280', fontWeight: 600 }}>{author}</span>
        </div>
        {!hideBody && comment.body ? (
          <div style={{
            fontSize: 13,
            color: '#111827',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {comment.body}
          </div>
        ) : null}
        {imageUrls.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: comment.body && !hideBody ? 8 : 0 }}>
            {imageUrls.map((src) => (
              <CommentAuthImage key={src} src={src} />
            ))}
          </div>
        )}
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
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  const tip = disabled ? 'Сначала укажите телефон' : label
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <a
        href={href || undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
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
        }}
      >
        {children}
      </a>
      {show ? <FloatingTip anchor={ref.current} text={tip} maxWidth={200} /> : null}
    </span>
  )
}

export function SaleDealCard({
  deal,
  stages,
  pipelineId,
  pipelines = [],
  users,
  defaultAssignedUserId,
  onSave,
  onDelete,
  onClose,
}: {
  deal: DealData | null
  stages: Stage[]
  pipelineId: number
  pipelines?: PipelineOption[]
  users: SalesUser[]
  /** При создании сделки на доске конкретного МОПа — сразу назначить его */
  defaultAssignedUserId?: number | null
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
  const [activePipelineId, setActivePipelineId] = useState(pipelineId)
  const [localStages, setLocalStages] = useState<Stage[]>(stages)

  const [title, setTitle] = useState(deal?.title ?? '')
  const [contact, setContact] = useState(deal?.contact_name ?? '')
  const [company, setCompany] = useState(deal?.company_name ?? '')
  const [phone, setPhone] = useState(() => phoneLocalPart(deal?.phone ?? ''))
  const [email, setEmail] = useState(deal?.email ?? '')
  const [contactPosition, setContactPosition] = useState(deal?.contact_position ?? '')
  const [contactRole, setContactRole] = useState(deal?.contact_role ?? '')
  const [roleMode, setRoleMode] = useState(() => roleSelectValue(deal?.contact_role ?? ''))
  const [source, setSource] = useState(deal?.source ?? '')
  const [clientGeo, setClientGeo] = useState(deal?.client_geo ?? DEFAULT_CLIENT_GEO)
  const [serviceType, setServiceType] = useState(deal?.service_type ?? 'seo')
  const [shortNote, setShortNote] = useState(deal?.short_note ?? '')
  const [budget, setBudget] = useState(budgetToInput(deal?.budget))
  const [currency, setCurrency] = useState(deal?.currency ?? 'USD')
  const [stageId, setStageId] = useState<number>(deal?.stage_id ?? stages[0]?.id ?? 0)
  const [assignedId, setAssignedId] = useState<string>(
    deal?.assigned_user_id?.toString()
      ?? (defaultAssignedUserId != null ? String(defaultAssignedUserId) : null)
      ?? user?.id?.toString()
      ?? ''
  )
  const [requiredFields, setRequiredFields] = useState<string[]>([])
  const [showReqErrors, setShowReqErrors] = useState(false)
  const [moveError, setMoveError] = useState('')

  useEffect(() => {
    setActivePipelineId(pipelineId)
    setLocalStages(stages)
  }, [pipelineId, stages])

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
      setPhone(phoneLocalPart(res.data.phone ?? ''))
      setEmail(res.data.email ?? '')
      setContactPosition(res.data.contact_position ?? '')
      setContactRole(res.data.contact_role ?? '')
      setRoleMode(roleSelectValue(res.data.contact_role ?? ''))
      setSource(res.data.source ?? '')
      setClientGeo(res.data.client_geo ?? DEFAULT_CLIENT_GEO)
      setServiceType(res.data.service_type ?? 'seo')
      setShortNote(res.data.short_note ?? '')
      setBudget(budgetToInput(res.data.budget))
      setCurrency(res.data.currency ?? 'USD')
      setStageId(res.data.stage_id ?? stages[0]?.id ?? 0)
      if (res.data.pipeline_id) setActivePipelineId(res.data.pipeline_id)
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

  const requirementsOwnerId = useMemo(() => {
    const id = assignedId ? parseInt(assignedId, 10) : user?.id
    return Number.isFinite(id) ? Number(id) : null
  }, [assignedId, user?.id])

  useEffect(() => {
    if (!requirementsOwnerId) {
      setRequiredFields([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await api.get<{ required_fields: string[] }>(
          `sales/deal-field-requirements/${requirementsOwnerId}`,
        )
        if (!cancelled) setRequiredFields(r.data.required_fields || [])
      } catch {
        if (!cancelled) setRequiredFields([])
      }
    })()
    return () => { cancelled = true }
  }, [requirementsOwnerId])

  const fieldValues = useMemo(() => ({
    contact_name: contact.trim(),
    phone: phoneFullFromLocal(phone).replace(/\D/g, '').length >= 12 ? phoneFullFromLocal(phone) : '',
    contact_position: contactPosition.trim(),
    company_name: company.trim(),
    source: source.trim(),
    client_geo: (clientGeo || '').trim(),
    service_type: (serviceType || '').trim(),
  }), [contact, phone, contactPosition, company, source, clientGeo, serviceType])

  const missingRequired = useMemo(() => {
    return requiredFields.filter((key) => {
      const v = fieldValues[key as keyof typeof fieldValues]
      return !v
    })
  }, [requiredFields, fieldValues])

  const isFieldMissing = (key: string) => {
    if (!requiredFields.includes(key)) return false
    const v = fieldValues[key as keyof typeof fieldValues]
    return !v
  }

  const canReassignDeal = user?.role === 'admin' || isSalesRop(user)
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
  const phoneFull = phoneFullFromLocal(phone)
  const phoneLinks = normalizePhoneForLinks(phoneFull)

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

  const canSaveDeal = !saving && hasDealContent && missingRequired.length === 0

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
      const month = feedGroupLabel(c.created_at)
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
    if (missingRequired.length > 0) {
      setShowReqErrors(true)
      return
    }
    setSaving(true)
    const payload: Record<string, unknown> = {
      title: resolveTitle(),
      contact_name: contact.trim() || null,
      company_name: company.trim() || null,
      phone: phoneFull || null,
      email: email.trim() || null,
      contact_position: contactPosition.trim() || null,
      contact_role: contactRole.trim() || null,
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
        const r = await api.post<DealData>('sales/deals', {
          pipeline_id: activePipelineId,
          ...payload,
        })
        setDetail(r.data)
        onSave(r.data)
        void loadDetail(r.data.id)
      } else {
        const id = deal?.id ?? detail?.id
        const r = await api.patch<DealData>(`sales/deals/${id}`, {
          ...payload,
          pipeline_id: activePipelineId,
        })
        onSave(r.data)
        void loadDetail(id!)
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  async function handleSelectPipelineStage(nextPipelineId: number, nextStageId: number) {
    setMoveError('')
    if (isNew) {
      try {
        const r = await api.get<{ stages: Stage[] }>(`sales/pipelines/${nextPipelineId}`)
        const nextStages = (r.data.stages || []).map(s => ({
          id: s.id,
          name: s.name,
          color: s.color,
          is_closed_lost: s.is_closed_lost,
          is_closed_won: s.is_closed_won,
        }))
        setActivePipelineId(nextPipelineId)
        setLocalStages(nextStages)
        setStageId(nextStageId)
      } catch {
        setMoveError('Не удалось открыть воронку')
      }
      return
    }
    const id = deal?.id ?? detail?.id
    if (!id) return
    setSaving(true)
    try {
      const r = await api.patch<DealData>(`sales/deals/${id}`, {
        pipeline_id: nextPipelineId,
        stage_id: nextStageId,
      })
      setActivePipelineId(nextPipelineId)
      setStageId(nextStageId)
      try {
        const pr = await api.get<{ stages: Stage[] }>(`sales/pipelines/${nextPipelineId}`)
        setLocalStages((pr.data.stages || []).map(s => ({
          id: s.id,
          name: s.name,
          color: s.color,
          is_closed_lost: s.is_closed_lost,
          is_closed_won: s.is_closed_won,
        })))
      } catch {
        // keep local stages
      }
      setDetail(prev => ({ ...(prev || r.data), ...r.data }))
      onSave(r.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setMoveError(typeof msg === 'string' ? msg : 'Не удалось перенести в другую воронку')
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
          <div style={{
            padding: '12px 12px 10px',
            borderBottom: '1px solid #e2e8f0',
            flexShrink: 0,
            background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
          }}>
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
                    fontWeight: 800,
                    color: '#0f172a',
                    fontFamily: 'inherit',
                    lineHeight: 1.2,
                    letterSpacing: '-0.015em',
                    padding: 0,
                  }}
                />
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  marginTop: 8,
                  flexWrap: 'wrap',
                }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#1d4ed8',
                    letterSpacing: '0.01em',
                  }}>
                    {serviceMeta?.label || 'Услуга не указана'}
                  </span>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    maxWidth: '100%',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#475569',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {company.trim() || 'Компания не указана'}
                  </span>
                  {detail?.id ? (
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: '#f1f5f9',
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#64748b',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      #{detail.id}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                style={{
                  width: 28,
                  height: 28,
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                  flexShrink: 0,
                  boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                  transition: 'background .15s, color .15s, border-color .15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#f8fafc'
                  e.currentTarget.style.color = '#0f172a'
                  e.currentTarget.style.borderColor = '#cbd5e1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#fff'
                  e.currentTarget.style.color = '#64748b'
                  e.currentTarget.style.borderColor = '#e2e8f0'
                }}
              >
                ×
              </button>
            </div>

            <div style={{
              marginTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <StagePicker
                stages={localStages}
                value={stageId}
                pipelineId={activePipelineId}
                pipelines={pipelines.length ? pipelines : [{ id: activePipelineId, name: 'Воронка' }]}
                onChange={setStageId}
                onSelectPipelineStage={(pid, sid) => { void handleSelectPipelineStage(pid, sid) }}
              />
              {moveError ? (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{moveError}</div>
              ) : null}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                {!isNew && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 7,
                    background: '#fff',
                    border: '1px solid #e8edf3',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#64748b',
                  }}>
                    <span style={{
                      width: 5,
                      height: 5,
                      borderRadius: 99,
                      background: '#94a3b8',
                      flexShrink: 0,
                    }} />
                    {stageDays} дн. на этапе
                  </span>
                )}
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 8px',
                  borderRadius: 7,
                  background: '#fff',
                  border: '1px solid #e8edf3',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#475569',
                }}>
                  <span style={{ color: '#94a3b8', fontWeight: 700 }}>МОП</span>
                  {assignedDisplayName}
                </span>
                {source.trim() ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    borderRadius: 7,
                    background: '#fff',
                    border: '1px solid #e8edf3',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#475569',
                  }}>
                    <span style={{ color: '#94a3b8', fontWeight: 700 }}>Источник</span>
                    {source}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Контент */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DealSection title="Контакты">
              {missingRequired.length > 0 && (
                <div style={{
                  marginBottom: 8,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: 13,
                  fontWeight: 700,
                }}>
                  Заполните данные — без обязательных полей сделку сохранить нельзя
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                <DealFieldBox label="Компания" hint="Название компании клиента или бренда" error={isFieldMissing('company_name')}>
                  <input
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="Название компании"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
                <DealFieldBox label="ФИО" hint="Имя и фамилия контактного лица" error={isFieldMissing('contact_name')}>
                  <input
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                    placeholder="Имя и фамилия"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
                <DealFieldBox label="Должность" hint="Должность контакта в компании (например, маркетинг-директор)" error={isFieldMissing('contact_position')}>
                  <input
                    value={contactPosition}
                    onChange={e => setContactPosition(e.target.value)}
                    placeholder="Например: маркетинг-директор"
                    style={inlineFieldInput}
                  />
                </DealFieldBox>
                <DealFieldBox
                  label="Роль"
                  hint="ЛПР — лицо, принимающее решение; ЛВР — влияет на решение; Помощник — помогает в коммуникации. Можно указать свою роль."
                >
                  {roleMode === CONTACT_ROLE_CUSTOM ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        autoFocus
                        value={contactRole}
                        onChange={e => setContactRole(e.target.value)}
                        placeholder="Введите роль"
                        style={inlineFieldInput}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setRoleMode('')
                          setContactRole('')
                        }}
                        style={{
                          alignSelf: 'flex-start',
                          border: 'none',
                          background: 'transparent',
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#64748b',
                          textDecoration: 'underline',
                          textUnderlineOffset: 2,
                        }}
                      >
                        Выбрать из списка
                      </button>
                    </div>
                  ) : (
                    <select
                      value={roleMode}
                      onChange={e => {
                        const v = e.target.value
                        setRoleMode(v)
                        if (v === '') {
                          setContactRole('')
                        } else if (v === CONTACT_ROLE_CUSTOM) {
                          setContactRole('')
                        } else {
                          setContactRole(v)
                        }
                      }}
                      style={{ ...inlineFieldInput, ...selectChevronStyle(CHEVRON_SVG_GRAY), cursor: 'pointer' }}
                    >
                      <option value="">— не указана —</option>
                      {CONTACT_ROLE_PRESETS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      <option value={CONTACT_ROLE_CUSTOM}>Своя надпись…</option>
                    </select>
                  )}
                </DealFieldBox>
                <DealFieldBox label="Телефон" hint="Номер Узбекистана. Код +998 уже подставлен — введите остальную часть" error={isFieldMissing('phone')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      <span style={{
                        flexShrink: 0,
                        fontSize: FS.body,
                        fontWeight: 700,
                        color: '#334155',
                        letterSpacing: '0.02em',
                        userSelect: 'none',
                      }}>
                        {UZ_PHONE_PREFIX}
                      </span>
                      <input
                        value={phone}
                        onChange={e => setPhone(phoneLocalPart(e.target.value))}
                        placeholder="99 999 99 99"
                        inputMode="tel"
                        autoComplete="tel-national"
                        style={{ ...inlineFieldInput, flex: 1, minWidth: 0 }}
                      />
                    </div>
                    <ContactMessengerButton href={phoneLinks?.telegram} label="Открыть Telegram" color="#229ED9">
                      TG
                    </ContactMessengerButton>
                    <ContactMessengerButton href={phoneLinks?.whatsapp} label="Открыть WhatsApp" color="#22c55e">
                      WA
                    </ContactMessengerButton>
                  </div>
                </DealFieldBox>
                <DealFieldBox label="E-mail" hint="Рабочая почта контакта для переписки">
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
                  <FieldLabel hint="Тип услуги, которую продаём по этой сделке" error={isFieldMissing('service_type')}>Услуга *</FieldLabel>
                  <CompactSelect
                    value={serviceType}
                    onChange={setServiceType}
                    ariaLabel="Услуга"
                    error={isFieldMissing('service_type')}
                    options={DEAL_SERVICES.map(s => ({ value: s.key, label: s.label }))}
                  />
                  {isFieldMissing('service_type') ? (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>заполните данные</div>
                  ) : null}
                </div>
                {canReassignDeal ? (
                  <div>
                    <FieldLabel hint="МОП, ответственный за ведение сделки">Ответственный</FieldLabel>
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
                  <FieldLabel hint="Ориентировочный бюджет клиента по сделке">Бюджет</FieldLabel>
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
                  <FieldLabel hint="Откуда пришёл лид: сайт, рекомендация, холодный звонок и т.д." error={isFieldMissing('source')}>Источник лида</FieldLabel>
                  <CompactSelect
                    value={source}
                    onChange={setSource}
                    ariaLabel="Источник лида"
                    error={isFieldMissing('source')}
                    options={[
                      { value: '', label: '— не указан —' },
                      ...SOURCE_OPTIONS.map(s => ({ value: s, label: s })),
                    ]}
                  />
                  {isFieldMissing('source') ? (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>заполните данные</div>
                  ) : null}
                </div>
                <div>
                  <FieldLabel hint="Страна / регион клиента" error={isFieldMissing('client_geo')}>GEO клиента</FieldLabel>
                  <CompactSelect
                    value={clientGeo}
                    onChange={setClientGeo}
                    ariaLabel="GEO клиента"
                    error={isFieldMissing('client_geo')}
                    options={[
                      { value: '', label: '— не указан —' },
                      ...CLIENT_GEO_OPTIONS.map(g => ({ value: g.code, label: g.name })),
                    ]}
                  />
                  {isFieldMissing('client_geo') ? (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#dc2626' }}>заполните данные</div>
                  ) : null}
                </div>
                <div>
                  <FieldLabel hint="Краткий контекст сделки: договорённости, нюансы, что обсуждали">
                    Комментарий к сделке
                  </FieldLabel>
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
                  <TipButton tip="Подтвердить удаление" type="button" onClick={doDelete} style={{ ...iconBtn, ...iconBtnDanger }}>✓</TipButton>
                  <TipButton tip="Отмена" type="button" onClick={() => setConfirmDelete(false)} style={{ ...iconBtn, ...iconBtnGhost }}>×</TipButton>
                </div>
              ) : (
                <TipButton tip="Удалить сделку" type="button" onClick={() => setConfirmDelete(true)} style={{ ...iconBtn, ...iconBtnGhostDanger }}>🗑</TipButton>
              )
            )}
            {!isNew && !detail?.payment_id && localStages.some(s => s.is_closed_won) && (
              <TipButton
                tip="Закрыть сделку как выигранную ($)"
                type="button"
                onClick={() => setCloseWonOpen(true)}
                style={{ ...iconBtn, ...iconBtnSuccess }}
              >
                $
              </TipButton>
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
              <TipButton
                tip={isNew ? 'Создать сделку' : 'Сохранить изменения'}
                type="button"
                onClick={() => void saveDeal()}
                disabled={!canSaveDeal}
                style={{
                  ...iconBtn,
                  ...(canSaveDeal ? iconBtnPrimary : iconBtnDisabled),
                  cursor: canSaveDeal ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? '…' : '✓'}
              </TipButton>
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
              padding: '12px 16px 10px',
              background: '#f7f8fa',
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
          stages={localStages}
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
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 7,
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
  fontSize: 15,
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
