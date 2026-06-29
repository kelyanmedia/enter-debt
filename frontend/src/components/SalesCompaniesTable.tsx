import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import DatePicker from '@/components/DatePicker'
import { Card, Th, Td, Input, Field, BtnOutline, BtnPrimary, Modal } from '@/components/ui'
import api from '@/lib/api'
import * as XLSX from 'xlsx'

interface UserOption {
  id: number
  name: string
  role: string
}

interface SalesCompany {
  id: number
  company_name: string
  brand_name?: string | null
  client_type?: string | null
  group_id?: number | null
  group_name?: string | null
  status?: string | null
  comment?: string | null
  assigned_manager_id?: number | null
  assigned_manager_name?: string | null
  brought_by_manager_id?: number | null
  brought_by_manager_name?: string | null
  brought_by_name?: string | null
  position?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  contact_actuality_date?: string | null
  contact?: string | null
  lpr_name?: string | null
  lpr_role?: string | null
  lvr_name?: string | null
  lvr_role?: string | null
  previous_jobs?: string | null
  interactions?: SalesInteraction[]
}

interface SalesCompanyGroup {
  id: number
  name: string
  note?: string | null
  company_count: number
}

interface SalesInteraction {
  id: number
  interaction_date: string
  project_name?: string | null
  status?: string | null
  note?: string | null
}

interface WishlistItem {
  id: number
  company_name: string
  potential_entry?: string | null
  reason?: string | null
  comment?: string | null
  offer?: string | null
  assigned_manager_id?: number | null
  assigned_manager_name?: string | null
  created_by_user_id?: number | null
  created_by_user_name?: string | null
  activated_company_id?: number | null
  activated_at?: string | null
  created_at?: string | null
}

interface FormState {
  company_name: string
  brand_name: string
  client_type: string
  group_id: string
  status: string
  comment: string
  assigned_manager_id: string
  brought_by_manager_id: string
  brought_by_name: string
  position: string
  contact_name: string
  phone: string
  email: string
  contact_actuality_date: string
  contact: string
  lpr_name: string
  lpr_role: string
  lvr_name: string
  lvr_role: string
  previous_jobs: string
}

interface InteractionFormState {
  interaction_date: string
  project_name: string
  status: string
  note: string
}

interface WishlistFormState {
  company_name: string
  potential_entry: string
  reason: string
  comment: string
  offer: string
  assigned_manager_id: string
}

interface WishlistActivateState {
  status: string
  position: string
  contact_name: string
  phone: string
  email: string
  contact: string
  lpr_name: string
  lpr_role: string
  lvr_name: string
  lvr_role: string
  comment: string
  assigned_manager_id: string
}

interface ImportCompanyDraft {
  company_name: string
  brand_name: string
  client_type: string
  group_name: string
  status: string
  position: string
  contact_name: string
  phone: string
  email: string
  contact_actuality_date: string
  lpr_name: string
  lpr_role: string
  lvr_name: string
  lvr_role: string
  brought_by_name: string
  comment: string
  previous_jobs: string
  manager_name: string
}

const emptyForm = (): FormState => ({
  company_name: '',
  brand_name: '',
  client_type: '',
  group_id: '',
  status: 'Новый',
  comment: '',
  assigned_manager_id: '',
  brought_by_manager_id: '',
  brought_by_name: '',
  position: '',
  contact_name: '',
  phone: '',
  email: '',
  contact_actuality_date: '',
  contact: '',
  lpr_name: '',
  lpr_role: '',
  lvr_name: '',
  lvr_role: '',
  previous_jobs: '',
})

const emptyInteractionForm = (): InteractionFormState => ({
  interaction_date: todayYmd(),
  project_name: '',
  status: '',
  note: '',
})

const emptyWishlistForm = (): WishlistFormState => ({
  company_name: '',
  potential_entry: '',
  reason: '',
  comment: '',
  offer: '',
  assigned_manager_id: '',
})

const emptyWishlistActivateForm = (): WishlistActivateState => ({
  status: 'Новый',
  position: '',
  contact_name: '',
  phone: '',
  email: '',
  contact: '',
  lpr_name: '',
  lpr_role: '',
  lvr_name: '',
  lvr_role: '',
  comment: '',
  assigned_manager_id: '',
})

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 82,
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

const previewTd: CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid #f1f5f9',
  color: '#334155',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const STATUS_OPTIONS = [
  'Новый',
  'Написал',
  'КП',
  'Переговоры',
  'Ждём ответ',
  'Уже сделано',
  'Нет Telegram',
  'Не работает больше',
  'Отказ',
] as const

function formFromRow(r: SalesCompany): FormState {
  return {
    company_name: r.company_name || '',
    brand_name: r.brand_name || '',
    client_type: r.client_type || '',
    group_id: r.group_id != null ? String(r.group_id) : '',
    status: r.status || '',
    comment: r.comment || '',
    assigned_manager_id: r.assigned_manager_id != null ? String(r.assigned_manager_id) : '',
    brought_by_manager_id: r.brought_by_manager_id != null ? String(r.brought_by_manager_id) : '',
    brought_by_name: r.brought_by_name || '',
    position: r.position || '',
    contact_name: r.contact_name || '',
    phone: r.phone || '',
    email: r.email || '',
    contact_actuality_date: r.contact_actuality_date || '',
    contact: r.contact || '',
    lpr_name: r.lpr_name || '',
    lpr_role: r.lpr_role || '',
    lvr_name: r.lvr_name || '',
    lvr_role: r.lvr_role || '',
    previous_jobs: r.previous_jobs || '',
  }
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso || '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatApiError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => String((x as { msg?: unknown }).msg || x)).join('\n')
  return err.message || 'Ошибка'
}

const IMPORT_HEADERS = [
  'Компания*',
  'Бренд',
  'Тип (A/B/C)',
  'Ниша',
  'Статус',
  'Должность',
  'Имя контакта',
  'Телефон',
  'Email',
  'Дата актуальности (YYYY-MM-DD)',
  'ЛПР имя',
  'ЛПР роль',
  'ЛВР имя',
  'ЛВР роль',
  'Кто привёл',
  'Комментарий',
  'Прошлые места',
  'Менеджер (ID или имя)',
]

function importCell(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias] != null && String(row[alias]).trim()) return String(row[alias]).trim()
  }
  return ''
}

function normalizeImportDate(v: string) {
  const raw = v.trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('.')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return raw
}

function parseImportWorkbook(buffer: ArrayBuffer): ImportCompanyDraft[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets['Компании'] || wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return rows
    .map((row) => ({
      company_name: importCell(row, ['Компания*', 'Компания', 'company_name']),
      brand_name: importCell(row, ['Бренд', 'brand_name']),
      client_type: importCell(row, ['Тип (A/B/C)', 'Тип', 'client_type']).toUpperCase(),
      group_name: importCell(row, ['Ниша', 'group_name']),
      status: importCell(row, ['Статус', 'status']),
      position: importCell(row, ['Должность', 'position']),
      contact_name: importCell(row, ['Имя контакта', 'Контакт', 'contact_name']),
      phone: importCell(row, ['Телефон', 'phone']),
      email: importCell(row, ['Email', 'email']),
      contact_actuality_date: normalizeImportDate(importCell(row, ['Дата актуальности (YYYY-MM-DD)', 'Дата актуальности', 'contact_actuality_date'])),
      lpr_name: importCell(row, ['ЛПР имя', 'lpr_name']),
      lpr_role: importCell(row, ['ЛПР роль', 'lpr_role']),
      lvr_name: importCell(row, ['ЛВР имя', 'lvr_name']),
      lvr_role: importCell(row, ['ЛВР роль', 'lvr_role']),
      brought_by_name: importCell(row, ['Кто привёл', 'brought_by_name']),
      comment: importCell(row, ['Комментарий', 'comment']),
      previous_jobs: importCell(row, ['Прошлые места', 'previous_jobs']),
      manager_name: importCell(row, ['Менеджер (ID или имя)', 'Менеджер', 'assigned_manager']),
    }))
    .filter((row) => row.company_name)
}

function downloadImportTemplate() {
  const instruction = [
    ['Инструкция'],
    ['1. Заполняй лист "Компании" в таком же формате.'],
    ['2. Обязательная колонка только "Компания*". Остальные можно оставить пустыми.'],
    ['3. Тип клиента заполняй A, B или C.'],
    ['4. Дата актуальности: формат YYYY-MM-DD, например 2026-06-29.'],
    ['5. Ниша должна совпадать с существующей нишей в клиентской базе, иначе импортируется без ниши.'],
    ['6. Менеджер: можно указать ID менеджера или его имя как в системе.'],
    ['7. Сохрани файл и загрузи его через кнопку "Импорт". Всё будет работать.'],
  ]
  const sample = [
    IMPORT_HEADERS,
    [
      'Example Company LLC',
      'Example Brand',
      'A',
      'Маркетинг',
      'Новый',
      'CEO',
      'Иван Иванов',
      '+998 99 999 9999',
      'ivan@example.com',
      '2026-06-29',
      'Иван Иванов',
      'CEO',
      'Мария Петрова',
      'Маркетолог',
      'Рекомендация',
      'Первичный импорт из Excel',
      'Agency, Startup',
      '',
    ],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instruction), 'Инструкция')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample), 'Компании')
  XLSX.writeFile(wb, 'sales-companies-import-template.xlsx')
}

function statusStyle(status: string | null | undefined): CSSProperties {
  const s = (status || '').toLowerCase()
  if (s.includes('кп') || s.includes('переговор')) return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }
  if (s.includes('уже') || s.includes('готов') || s.includes('сделано')) return { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }
  if (s.includes('нет') || s.includes('отказ') || s.includes('не работает')) return { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }
  return { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }
}

const CHEVRON_SVG =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 d=%27M3 4.5L6 7.5L9 4.5%27/%3E%3C/svg%3E")'

const selectChevronStyle: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage: CHEVRON_SVG,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  backgroundSize: '12px 12px',
  paddingRight: 34,
}

const filterSelectStyle: CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '7px 34px 7px 12px',
  fontSize: 13,
  fontWeight: 500,
  color: '#334155',
  backgroundColor: '#fff',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  ...selectChevronStyle,
}

function personHue(name: string) {
  const hues = ['#3b82f6', '#8b5cf6', '#ec4899', '#0ea5e9', '#22c55e', '#f59e0b', '#6366f1']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 13) % hues.length
  return hues[h]
}

function personInitials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function CompanyAvatar({ name }: { name: string }) {
  const hue = personHue(name)
  return (
    <div style={{
      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
      background: `${hue}14`, border: `1.5px solid ${hue}33`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700, color: hue,
    }}>
      {personInitials(name)}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const st = statusStyle(status)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px 4px 8px', borderRadius: 999,
      fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
      ...st,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color as string, flexShrink: 0 }} />
      {status}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const t = type.toUpperCase()
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    A: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    B: { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
    C: { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' },
  }
  const c = colors[t] || colors.C
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 28, padding: '3px 8px', borderRadius: 6,
      fontSize: 12, fontWeight: 700, background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {t}
    </span>
  )
}

function ColHeader({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: '#64748b', letterSpacing: '.01em', textTransform: 'none' }}>
      {children}
    </span>
  )
}

function compactLines(parts: Array<string | null | undefined>) {
  return parts.map((x) => String(x || '').trim()).filter(Boolean)
}

function ContactInfoField({
  label,
  value,
}: {
  label: string
  value?: string | null
}) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  return (
    <div style={{ border: '1px solid #e8e9ef', borderRadius: 10, padding: '8px 10px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3, fontWeight: 700 }}>{label}:</div>
      <div style={{ fontSize: 14, color: '#1a1d23', lineHeight: 1.35, wordBreak: 'break-word' }}>{trimmed}</div>
    </div>
  )
}

export function SalesCompaniesTable({ scope, isAdmin }: { scope: 'all' | 'mine'; isAdmin: boolean }) {
  const [rows, setRows] = useState<SalesCompany[]>([])
  const [groups, setGroups] = useState<SalesCompanyGroup[]>([])
  const [managers, setManagers] = useState<UserOption[]>([])
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [clientTypeFilter, setClientTypeFilter] = useState('')
  const [managerFilter, setManagerFilter] = useState('')
  const [groupFilters, setGroupFilters] = useState<string[]>([])
  const [groupsPopupOpen, setGroupsPopupOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkTargetManagerId, setBulkTargetManagerId] = useState('')
  const [bulkSourceManagerId, setBulkSourceManagerId] = useState('')
  const [bulkGroupId, setBulkGroupId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [groupSaving, setGroupSaving] = useState(false)
  const groupsPopupRef = useRef<HTMLDivElement | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [wishlistOpen, setWishlistOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportCompanyDraft[]>([])
  const [importFileName, setImportFileName] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [wishlistRows, setWishlistRows] = useState<WishlistItem[]>([])
  const [wishlistFetching, setWishlistFetching] = useState(false)
  const [wishlistSaving, setWishlistSaving] = useState(false)
  const [wishlistEditingId, setWishlistEditingId] = useState<number | null>(null)
  const [wishlistForm, setWishlistForm] = useState<WishlistFormState>(() => emptyWishlistForm())
  const [wishlistActivatingId, setWishlistActivatingId] = useState<number | null>(null)
  const [wishlistActivateForm, setWishlistActivateForm] = useState<WishlistActivateState>(() => emptyWishlistActivateForm())
  const [viewerId, setViewerId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm())
  const [customStatusMode, setCustomStatusMode] = useState(false)
  const [interactionForm, setInteractionForm] = useState<InteractionFormState>(() => emptyInteractionForm())
  const [interactionSaving, setInteractionSaving] = useState(false)
  const [viewerInteractionOpen, setViewerInteractionOpen] = useState(false)
  const [viewerInteractionForm, setViewerInteractionForm] = useState<InteractionFormState>(() => emptyInteractionForm())
  const [viewerInteractionSaving, setViewerInteractionSaving] = useState(false)
  const [viewerStatusEditing, setViewerStatusEditing] = useState(false)
  const [viewerStatusValue, setViewerStatusValue] = useState('')
  const [viewerStatusCustomMode, setViewerStatusCustomMode] = useState(false)
  const [viewerStatusSaving, setViewerStatusSaving] = useState(false)
  const editingRow = useMemo(
    () => rows.find((r) => r.id === editingId) || null,
    [editingId, rows],
  )
  const viewerRow = useMemo(
    () => rows.find((r) => r.id === viewerId) || null,
    [viewerId, rows],
  )
  const wishlistActivatingRow = useMemo(
    () => wishlistRows.find((r) => r.id === wishlistActivatingId) || null,
    [wishlistActivatingId, wishlistRows],
  )

  const load = useCallback(async () => {
    setFetching(true)
    try {
      const r = await api.get<SalesCompany[]>(`sales/companies?scope=${scope}`)
      setRows(r.data || [])
      setSelectedIds((prev) => prev.filter((id) => (r.data || []).some((x) => x.id === id)))
    } catch {
      setRows([])
    } finally {
      setFetching(false)
    }
  }, [scope])

  const loadGroups = useCallback(async () => {
    try {
      const r = await api.get<SalesCompanyGroup[]>('sales/companies/groups')
      setGroups(r.data || [])
    } catch {
      setGroups([])
    }
  }, [])

  const loadManagers = useCallback(async () => {
    try {
      const r = await api.get<UserOption[]>('users/managers-for-select')
      setManagers(r.data || [])
    } catch {
      setManagers([])
    }
  }, [])

  const loadWishlist = useCallback(async () => {
    setWishlistFetching(true)
    try {
      const r = await api.get<WishlistItem[]>(`sales/companies/wishlist?scope=${scope}`)
      setWishlistRows(r.data || [])
    } catch {
      setWishlistRows([])
    } finally {
      setWishlistFetching(false)
    }
  }, [scope])

  const closeImport = () => {
    if (importBusy) return
    setImportOpen(false)
    setImportRows([])
    setImportFileName('')
    setImportError('')
  }

  const handleImportFile = async (file: File | null) => {
    setImportError('')
    setImportRows([])
    setImportFileName(file?.name || '')
    if (!file) return
    try {
      const rows = parseImportWorkbook(await file.arrayBuffer())
      if (!rows.length) {
        setImportError('В файле не найдено строк с заполненной колонкой «Компания*».')
        return
      }
      setImportRows(rows)
    } catch (e) {
      setImportError(formatApiError(e) || 'Не удалось прочитать Excel-файл')
    }
  }

  const resolveManagerId = (value: string) => {
    const raw = value.trim()
    if (!raw) return null
    const byId = managers.find((m) => String(m.id) === raw)
    if (byId) return byId.id
    const low = raw.toLowerCase()
    return managers.find((m) => m.name.toLowerCase() === low)?.id ?? null
  }

  const resolveGroupId = (value: string) => {
    const raw = value.trim()
    if (!raw) return null
    const low = raw.toLowerCase()
    return groups.find((g) => g.name.toLowerCase() === low)?.id ?? null
  }

  const importCompanies = async () => {
    if (!importRows.length) {
      setImportError('Сначала загрузите Excel-файл.')
      return
    }
    setImportBusy(true)
    setImportError('')
    let created = 0
    try {
      for (const row of importRows) {
        await api.post('sales/companies', {
          company_name: row.company_name,
          brand_name: row.brand_name || null,
          client_type: ['A', 'B', 'C'].includes(row.client_type) ? row.client_type : null,
          group_id: resolveGroupId(row.group_name),
          status: row.status || 'Новый',
          comment: row.comment || null,
          assigned_manager_id: resolveManagerId(row.manager_name),
          brought_by_manager_id: null,
          brought_by_name: row.brought_by_name || null,
          position: row.position || null,
          contact_name: row.contact_name || null,
          phone: row.phone || null,
          email: row.email || null,
          contact_actuality_date: row.contact_actuality_date || null,
          contact: null,
          lpr_name: row.lpr_name || null,
          lpr_role: row.lpr_role || null,
          lvr_name: row.lvr_name || null,
          lvr_role: row.lvr_role || null,
          previous_jobs: row.previous_jobs || null,
        })
        created += 1
      }
      await load()
      await loadGroups()
      alert(`Импортировано компаний: ${created}`)
      closeImport()
    } catch (e) {
      setImportError(`Импорт остановлен. Создано: ${created}. Ошибка: ${formatApiError(e)}`)
    } finally {
      setImportBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadManagers()
  }, [loadManagers])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  useEffect(() => {
    if (!groupsPopupOpen) return
    const onDown = (e: MouseEvent) => {
      if (groupsPopupRef.current && !groupsPopupRef.current.contains(e.target as Node)) {
        setGroupsPopupOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [groupsPopupOpen])

  const filteredRows = useMemo(() => {
    const raw = tableSearch.trim().toLowerCase()
    let base = rows
    if (clientTypeFilter) {
      base = base.filter((r) => (r.client_type || '').toUpperCase() === clientTypeFilter)
    }
    if (managerFilter) {
      base = base.filter((r) => String(r.assigned_manager_id || '') === managerFilter)
    }
    if (groupFilters.length > 0) {
      base = base.filter((r) =>
        groupFilters.some((f) => (f === 'none' ? !r.group_id : String(r.group_id || '') === f)),
      )
    }
    if (!raw) return base
    const tokens = raw.split(/\s+/).filter(Boolean)
    return base.filter((r) => {
      const hay = [
        r.company_name,
        r.brand_name,
        r.client_type,
        r.group_name,
        r.status,
        r.comment,
        r.assigned_manager_name,
        r.brought_by_manager_name,
        r.brought_by_name,
        r.position,
        r.contact_name,
        r.phone,
        r.email,
        r.contact_actuality_date,
        r.contact,
        r.lpr_name,
        r.lpr_role,
        r.lvr_name,
        r.lvr_role,
        r.previous_jobs,
        ...(r.interactions || []).flatMap((i) => [i.project_name, i.status, i.note, i.interaction_date]),
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return tokens.every((t) => hay.includes(t))
    })
  }, [clientTypeFilter, groupFilters, managerFilter, rows, tableSearch])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedFilteredCount = filteredRows.filter((r) => selectedSet.has(r.id)).length
  const allFilteredSelected = filteredRows.length > 0 && selectedFilteredCount === filteredRows.length

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      const visible = new Set(filteredRows.map((r) => r.id))
      setSelectedIds((prev) => prev.filter((id) => !visible.has(id)))
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredRows.map((r) => r.id)])))
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setCustomStatusMode(false)
    setInteractionForm(emptyInteractionForm())
    setModalOpen(true)
  }

  const openEdit = (row: SalesCompany) => {
    setEditingId(row.id)
    setForm(formFromRow(row))
    setCustomStatusMode(Boolean(row.status?.trim() && !(STATUS_OPTIONS as readonly string[]).includes(row.status)))
    setInteractionForm(emptyInteractionForm())
    setModalOpen(true)
  }

  const openViewer = (row: SalesCompany) => {
    setViewerId(row.id)
    setViewerInteractionOpen(false)
    setViewerInteractionForm(emptyInteractionForm())
    const currentStatus = row.status?.trim() || ''
    setViewerStatusValue(currentStatus)
    setViewerStatusCustomMode(Boolean(currentStatus && !(STATUS_OPTIONS as readonly string[]).includes(currentStatus)))
    setViewerStatusEditing(false)
  }

  const closeViewer = () => {
    if (viewerInteractionSaving || viewerStatusSaving) return
    setViewerId(null)
    setViewerInteractionOpen(false)
    setViewerInteractionForm(emptyInteractionForm())
    setViewerStatusEditing(false)
    setViewerStatusValue('')
    setViewerStatusCustomMode(false)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    setCustomStatusMode(false)
    setInteractionForm(emptyInteractionForm())
  }

  const save = async () => {
    const company = form.company_name.trim()
    if (!company) {
      alert('Укажите компанию')
      return
    }
    const payload = {
      company_name: company,
      brand_name: form.brand_name.trim() || null,
      client_type: form.client_type.trim() || null,
      group_id: form.group_id ? Number(form.group_id) : null,
      status: form.status.trim() || null,
      comment: form.comment.trim() || null,
      assigned_manager_id: form.assigned_manager_id ? Number(form.assigned_manager_id) : null,
      brought_by_manager_id: form.brought_by_manager_id ? Number(form.brought_by_manager_id) : null,
      brought_by_name: form.brought_by_name.trim() || null,
      position: form.position.trim() || null,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      contact_actuality_date: form.contact_actuality_date || null,
      contact: form.contact.trim() || null,
      lpr_name: form.lpr_name.trim() || null,
      lpr_role: form.lpr_role.trim() || null,
      lvr_name: form.lvr_name.trim() || null,
      lvr_role: form.lvr_role.trim() || null,
      previous_jobs: form.previous_jobs.trim() || null,
    }
    setSaving(true)
    try {
      if (editingId == null) {
        await api.post('sales/companies', payload)
      } else {
        await api.put(`sales/companies/${editingId}`, payload)
      }
      await load()
      await loadGroups()
      closeModal()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: SalesCompany) => {
    if (!window.confirm(`Удалить компанию «${row.company_name}»?`)) return
    try {
      await api.delete(`sales/companies/${row.id}`)
      await load()
      await loadGroups()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  const createGroup = async () => {
    const name = newGroupName.trim()
    if (!name) {
      alert('Напишите название ниши')
      return
    }
    setGroupSaving(true)
    try {
      await api.post('sales/companies/groups', { name })
      setNewGroupName('')
      await loadGroups()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setGroupSaving(false)
    }
  }

  const deleteGroup = async (group: SalesCompanyGroup) => {
    const msg = group.company_count > 0
      ? `Удалить нишу «${group.name}»? Компании останутся, но будут без ниши.`
      : `Удалить нишу «${group.name}»?`
    if (!window.confirm(msg)) return
    setGroupSaving(true)
    try {
      await api.delete(`sales/companies/groups/${group.id}`)
      setGroupFilters((prev) => prev.filter((x) => x !== String(group.id)))
      if (bulkGroupId === String(group.id)) setBulkGroupId('')
      await loadGroups()
      await load()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setGroupSaving(false)
    }
  }

  const assignSelectedManager = async () => {
    if (!isAdmin) return
    if (selectedIds.length === 0) {
      alert('Сначала отметьте компании')
      return
    }
    if (!bulkTargetManagerId) {
      alert('Выберите менеджера, которому передать компании')
      return
    }
    setBulkSaving(true)
    try {
      await api.post('sales/companies/bulk/assign-manager', {
        company_ids: selectedIds,
        target_manager_id: Number(bulkTargetManagerId),
      })
      setSelectedIds([])
      await load()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setBulkSaving(false)
    }
  }

  const assignManagerPortfolio = async () => {
    if (!isAdmin) return
    if (!bulkSourceManagerId || !bulkTargetManagerId) {
      alert('Выберите от какого менеджера и кому передать')
      return
    }
    if (bulkSourceManagerId === bulkTargetManagerId) {
      alert('Выберите разных менеджеров')
      return
    }
    const from = managers.find((m) => String(m.id) === bulkSourceManagerId)?.name || 'менеджера'
    const to = managers.find((m) => String(m.id) === bulkTargetManagerId)?.name || 'другому менеджеру'
    if (!window.confirm(`Передать все компании ${from} менеджеру ${to}?`)) return
    setBulkSaving(true)
    try {
      await api.post('sales/companies/bulk/assign-manager', {
        source_manager_id: Number(bulkSourceManagerId),
        target_manager_id: Number(bulkTargetManagerId),
      })
      setSelectedIds([])
      setBulkSourceManagerId('')
      await load()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setBulkSaving(false)
    }
  }

  const assignSelectedGroup = async () => {
    if (selectedIds.length === 0) {
      alert('Сначала отметьте компании')
      return
    }
    setBulkSaving(true)
    try {
      await api.post('sales/companies/bulk/assign-group', {
        company_ids: selectedIds,
        group_id: bulkGroupId ? Number(bulkGroupId) : null,
      })
      setSelectedIds([])
      await load()
      await loadGroups()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setBulkSaving(false)
    }
  }

  const openWishlist = () => {
    setWishlistOpen(true)
    setWishlistEditingId(null)
    setWishlistForm(emptyWishlistForm())
    setWishlistActivatingId(null)
    setWishlistActivateForm(emptyWishlistActivateForm())
    void loadWishlist()
  }

  const saveWishlist = async () => {
    const company = wishlistForm.company_name.trim()
    if (!company) {
      alert('Укажите компанию')
      return
    }
    setWishlistSaving(true)
    try {
      const payload = {
        company_name: company,
        potential_entry: wishlistForm.potential_entry.trim() || null,
        reason: wishlistForm.reason.trim() || null,
        comment: wishlistForm.comment.trim() || null,
        offer: wishlistForm.offer.trim() || null,
        assigned_manager_id: wishlistForm.assigned_manager_id ? Number(wishlistForm.assigned_manager_id) : null,
      }
      if (wishlistEditingId == null) {
        await api.post('sales/companies/wishlist', payload)
      } else {
        await api.put(`sales/companies/wishlist/${wishlistEditingId}`, payload)
      }
      await loadWishlist()
      setWishlistEditingId(null)
      setWishlistForm(emptyWishlistForm())
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setWishlistSaving(false)
    }
  }

  const editWishlist = (row: WishlistItem) => {
    setWishlistEditingId(row.id)
    setWishlistForm({
      company_name: row.company_name || '',
      potential_entry: row.potential_entry || '',
      reason: row.reason || '',
      comment: row.comment || '',
      offer: row.offer || '',
      assigned_manager_id: row.assigned_manager_id != null ? String(row.assigned_manager_id) : '',
    })
  }

  const removeWishlist = async (row: WishlistItem) => {
    if (!window.confirm(`Удалить wishlist «${row.company_name}»?`)) return
    setWishlistSaving(true)
    try {
      await api.delete(`sales/companies/wishlist/${row.id}`)
      await loadWishlist()
      if (wishlistEditingId === row.id) {
        setWishlistEditingId(null)
        setWishlistForm(emptyWishlistForm())
      }
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setWishlistSaving(false)
    }
  }

  const activateWishlist = async () => {
    if (wishlistActivatingId == null) return
    setWishlistSaving(true)
    try {
      const payload = {
        assigned_manager_id: wishlistActivateForm.assigned_manager_id ? Number(wishlistActivateForm.assigned_manager_id) : null,
        status: wishlistActivateForm.status.trim() || null,
        position: wishlistActivateForm.position.trim() || null,
        contact_name: wishlistActivateForm.contact_name.trim() || null,
        phone: wishlistActivateForm.phone.trim() || null,
        email: wishlistActivateForm.email.trim() || null,
        contact: wishlistActivateForm.contact.trim() || null,
        lpr_name: wishlistActivateForm.lpr_name.trim() || null,
        lpr_role: wishlistActivateForm.lpr_role.trim() || null,
        lvr_name: wishlistActivateForm.lvr_name.trim() || null,
        lvr_role: wishlistActivateForm.lvr_role.trim() || null,
        comment: wishlistActivateForm.comment.trim() || null,
      }
      await api.post(`sales/companies/wishlist/${wishlistActivatingId}/activate`, payload)
      await loadWishlist()
      await load()
      setWishlistActivatingId(null)
      setWishlistActivateForm(emptyWishlistActivateForm())
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setWishlistSaving(false)
    }
  }

  const addInteraction = async () => {
    if (editingId == null) return
    if (!interactionForm.interaction_date) {
      alert('Укажите дату взаимодействия')
      return
    }
    if (!interactionForm.project_name.trim() && !interactionForm.status.trim() && !interactionForm.note.trim()) {
      alert('Заполните проект/статус или комментарий')
      return
    }
    setInteractionSaving(true)
    try {
      const r = await api.post<SalesCompany>(`sales/companies/${editingId}/interactions`, {
        interaction_date: interactionForm.interaction_date,
        project_name: interactionForm.project_name.trim() || null,
        status: interactionForm.status.trim() || null,
        note: interactionForm.note.trim() || null,
      })
      setRows((prev) => prev.map((x) => (x.id === editingId ? r.data : x)))
      setInteractionForm(emptyInteractionForm())
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setInteractionSaving(false)
    }
  }

  const deleteInteraction = async (interactionId: number) => {
    if (editingId == null) return
    setInteractionSaving(true)
    try {
      const r = await api.delete<SalesCompany>(`sales/companies/${editingId}/interactions/${interactionId}`)
      setRows((prev) => prev.map((x) => (x.id === editingId ? r.data : x)))
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setInteractionSaving(false)
    }
  }

  const addViewerInteraction = async () => {
    if (viewerId == null) return
    if (!viewerInteractionForm.interaction_date) {
      alert('Укажите дату взаимодействия')
      return
    }
    if (
      !viewerInteractionForm.project_name.trim()
      && !viewerInteractionForm.status.trim()
      && !viewerInteractionForm.note.trim()
    ) {
      alert('Заполните проект/статус или комментарий')
      return
    }
    setViewerInteractionSaving(true)
    try {
      const r = await api.post<SalesCompany>(`sales/companies/${viewerId}/interactions`, {
        interaction_date: viewerInteractionForm.interaction_date,
        project_name: viewerInteractionForm.project_name.trim() || null,
        status: viewerInteractionForm.status.trim() || null,
        note: viewerInteractionForm.note.trim() || null,
      })
      setRows((prev) => prev.map((x) => (x.id === viewerId ? r.data : x)))
      setViewerInteractionForm(emptyInteractionForm())
      setViewerInteractionOpen(false)
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setViewerInteractionSaving(false)
    }
  }

  const saveViewerStatus = async () => {
    if (viewerId == null) return
    setViewerStatusSaving(true)
    try {
      const r = await api.put<SalesCompany>(`sales/companies/${viewerId}`, {
        status: viewerStatusValue.trim() || null,
      })
      setRows((prev) => prev.map((x) => (x.id === viewerId ? r.data : x)))
      setViewerStatusValue(r.data.status || '')
      setViewerStatusCustomMode(Boolean(r.data.status?.trim() && !(STATUS_OPTIONS as readonly string[]).includes(r.data.status)))
      setViewerStatusEditing(false)
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setViewerStatusSaving(false)
    }
  }

  const statusSelectValue = customStatusMode
    ? '__custom'
    : (STATUS_OPTIONS as readonly string[]).includes(form.status)
    ? form.status
    : form.status.trim()
      ? '__custom'
      : ''
  const viewerStatusSelectValue = viewerStatusCustomMode
    ? '__custom'
    : (STATUS_OPTIONS as readonly string[]).includes(viewerStatusValue)
    ? viewerStatusValue
    : viewerStatusValue.trim()
      ? '__custom'
      : ''
  const visibleColumnCount = selectionMode ? 13 : 12
  const toggleGroupFilter = (value: string) => {
    setGroupFilters((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  }

  return (
    <>
      <div style={{
        background: '#fff',
        border: '1px solid #e8eaef',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(15,23,42,.04)',
      }}>
        {/* Верхняя панель */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
          padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
        }}>
          <BtnPrimary type="button" onClick={openCreate} style={{ padding: '9px 18px', fontSize: 13, borderRadius: 8 }}>
            + Добавить компанию
          </BtnPrimary>
          <BtnOutline type="button" onClick={() => setImportOpen(true)} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8 }}>
            Импорт
          </BtnOutline>
          <BtnOutline
            type="button"
            onClick={() => {
              setSelectionMode((v) => !v)
              if (selectionMode) setSelectedIds([])
            }}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8, color: selectionMode ? '#1a6b3c' : '#475569', borderColor: selectionMode ? '#bbf7d0' : '#e2e8f0', background: selectionMode ? '#f0fdf4' : '#fff' }}
          >
            {selectionMode ? '✓ Готово' : 'Выбрать'}
          </BtnOutline>
          <BtnOutline type="button" onClick={openWishlist} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8 }}>
            Wishlist
          </BtnOutline>
          <BtnOutline type="button" onClick={() => void load()} disabled={fetching} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 8 }}>
            {fetching ? '…' : 'Обновить'}
          </BtnOutline>
          {selectedIds.length > 0 ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1a6b3c', background: '#f0fdf4', padding: '5px 10px', borderRadius: 6 }}>
              Выбрано: {selectedIds.length}
            </span>
          ) : null}
          <div style={{ flex: 1, minWidth: 120 }} />
          <div style={{ position: 'relative', width: 280, maxWidth: '100%' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14, pointerEvents: 'none' }}>⌕</span>
            <Input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Поиск: компания, статус, менеджер…"
              autoComplete="off"
              style={{ width: '100%', paddingLeft: 34, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
          </div>
        </div>

        {/* Фильтры */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          padding: '12px 20px', background: '#fafbfc', borderBottom: '1px solid #f1f5f9',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginRight: 4 }}>Фильтр</span>
          {(['', 'A', 'B', 'C'] as const).map((key) => {
            const active = clientTypeFilter === key
            return (
              <button
                key={key || 'all'}
                type="button"
                onClick={() => setClientTypeFilter(key)}
                style={{
                  fontSize: 13, fontWeight: 500,
                  color: active ? '#fff' : '#475569',
                  background: active ? '#1a6b3c' : '#fff',
                  border: `1px solid ${active ? '#1a6b3c' : '#e2e8f0'}`,
                  borderRadius: 8, padding: '6px 12px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {key || 'Все типы'}
              </button>
            )
          })}
          <div style={{ position: 'relative' }} ref={groupsPopupRef}>
            <button
              type="button"
              onClick={() => setGroupsPopupOpen((v) => !v)}
              style={{
                ...filterSelectStyle,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontWeight: 500, minWidth: 140,
              }}
            >
              {groupFilters.length === 0 ? 'Ниши / папки' : `Ниши: ${groupFilters.length}`}
            </button>
            {groupFilters.map((key) => {
              const label = key === 'none' ? 'Без ниши' : groups.find((g) => String(g.id) === key)?.name || key
              return (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, padding: '4px 8px', borderRadius: 6, background: '#e8f5ee', color: '#166534', fontSize: 12, fontWeight: 600 }}>
                  {label}
                  <button type="button" onClick={() => toggleGroupFilter(key)} style={{ border: 0, background: 'transparent', color: '#166534', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                </span>
              )
            })}
            {groupsPopupOpen ? (
              <div
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20,
                  width: 320, maxHeight: 360, overflow: 'auto',
                  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                  boxShadow: '0 12px 32px rgba(15,23,42,.12)', padding: 10,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Новая ниша…"
                    autoComplete="off"
                    onKeyDown={(e) => { if (e.key === 'Enter') void createGroup() }}
                    style={{ flex: 1, fontSize: 13, borderRadius: 8 }}
                  />
                  <BtnOutline type="button" onClick={() => void createGroup()} disabled={groupSaving} style={{ padding: '6px 12px' }}>+</BtnOutline>
                </div>
                <button type="button" onClick={() => setGroupFilters([])} style={{ textAlign: 'left', border: 0, background: groupFilters.length === 0 ? '#f0fdf4' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}>
                  {groupFilters.length === 0 ? '✓ ' : ''}Все ниши
                </button>
                <button type="button" onClick={() => toggleGroupFilter('none')} style={{ textAlign: 'left', border: 0, background: groupFilters.includes('none') ? '#f0fdf4' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}>
                  {groupFilters.includes('none') ? '✓ ' : ''}Без ниши
                </button>
                {groups.map((g) => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => toggleGroupFilter(String(g.id))}
                      style={{ flex: 1, textAlign: 'left', border: 0, background: groupFilters.includes(String(g.id)) ? '#f0fdf4' : '#fff', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}
                    >
                      {groupFilters.includes(String(g.id)) ? '✓ ' : ''}{g.name}
                    </button>
                    <button type="button" onClick={() => void deleteGroup(g)} disabled={groupSaving} style={{ border: '1px solid #fee2e2', background: '#fff', color: '#b91c1c', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>×</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <select
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
            style={{ ...filterSelectStyle, minWidth: 170 }}
          >
            <option value="">Все менеджеры</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {(clientTypeFilter || managerFilter || groupFilters.length > 0 || tableSearch.trim()) && (
            <button
              type="button"
              onClick={() => {
                setClientTypeFilter('')
                setManagerFilter('')
                setGroupFilters([])
                setTableSearch('')
              }}
              style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '6px 8px' }}
            >
              Сбросить
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
            {filteredRows.length} из {rows.length}
          </span>
        </div>

        {(selectionMode || isAdmin) && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '.04em' }}>МАССОВЫЕ</span>
            {isAdmin ? (
              <>
                <select value={bulkTargetManagerId} onChange={(e) => setBulkTargetManagerId(e.target.value)} style={{ ...filterSelectStyle, minWidth: 160 }}>
                  <option value="">Кому передать</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <BtnOutline type="button" onClick={() => void assignSelectedManager()} disabled={bulkSaving || selectedIds.length === 0} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8 }}>
                  Передать отмеченные
                </BtnOutline>
                <select value={bulkSourceManagerId} onChange={(e) => setBulkSourceManagerId(e.target.value)} style={{ ...filterSelectStyle, minWidth: 160 }}>
                  <option value="">Все компании менеджера</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <BtnOutline type="button" onClick={() => void assignManagerPortfolio()} disabled={bulkSaving || !bulkSourceManagerId || !bulkTargetManagerId} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8 }}>
                  Передать весь список
                </BtnOutline>
              </>
            ) : null}
            <select value={bulkGroupId} onChange={(e) => setBulkGroupId(e.target.value)} style={{ ...filterSelectStyle, minWidth: 150 }}>
              <option value="">Без ниши</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <BtnOutline type="button" onClick={() => void assignSelectedGroup()} disabled={bulkSaving || selectedIds.length === 0} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8 }}>
              В нишу
            </BtnOutline>
          </div>
        )}

        {/* Таблица */}
        <div
          role="region"
          aria-label="Таблица продаж"
          style={{ overflow: 'auto', maxHeight: 'min(68vh, calc(100vh - 280px))' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: selectionMode ? 1300 : 1220 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff' }}>
              <tr>
                {selectionMode ? (
                  <Th style={{ width: 48, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} aria-label="Отметить все" style={{ width: 16, height: 16, accentColor: '#1a6b3c' }} />
                  </Th>
                ) : null}
                <Th style={{ width: 48, padding: '14px 20px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>№</ColHeader>
                </Th>
                <Th style={{ minWidth: 260, padding: '14px 20px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Компания</ColHeader>
                </Th>
                <Th style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Тип</ColHeader>
                </Th>
                <Th style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Ниша</ColHeader>
                </Th>
                <Th style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Статус</ColHeader>
                </Th>
                <Th style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Должность</ColHeader>
                </Th>
                <Th style={{ minWidth: 160, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>ЛПР</ColHeader>
                </Th>
                <Th style={{ minWidth: 160, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>ЛВР</ColHeader>
                </Th>
                <Th style={{ minWidth: 160, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Прошлые места</ColHeader>
                </Th>
                <Th style={{ minWidth: 120, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }}>
                  <ColHeader>Актуальность</ColHeader>
                </Th>
                <Th style={{ width: 100, padding: '14px 16px', background: '#fff', borderBottom: '1px solid #eef2f7', textTransform: 'none' }} />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !fetching ? (
                <tr>
                  <Td colSpan={visibleColumnCount} style={{ padding: 48, border: 'none', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                    Компаний пока нет. Нажмите «Добавить компанию».
                  </Td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: '#fff', transition: 'background .12s' }}
                    onClick={() => openViewer(row)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
                    title="Открыть карточку"
                  >
                    {selectionMode ? (
                      <Td style={{ padding: '14px 16px', borderBottom: 'none' }}>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Отметить ${row.company_name}`}
                          style={{ width: 16, height: 16, accentColor: '#1a6b3c' }}
                        />
                      </Td>
                    ) : null}
                    <Td style={{ padding: '14px 20px', color: '#94a3b8', fontSize: 13, fontWeight: 500, borderBottom: 'none' }}>{idx + 1}</Td>
                    <Td style={{ padding: '12px 20px', borderBottom: 'none', minWidth: 260 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CompanyAvatar name={row.company_name} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', lineHeight: 1.3 }}>{row.company_name}</div>
                          {row.brand_name?.trim() ? (
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{row.brand_name.trim()}</div>
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td style={{ padding: '14px 16px', borderBottom: 'none' }}>
                      {row.client_type ? <TypeBadge type={row.client_type} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: row.group_name ? '#334155' : '#cbd5e1', fontWeight: 500, borderBottom: 'none' }}>
                      {row.group_name || '—'}
                    </Td>
                    <Td style={{ padding: '14px 16px', borderBottom: 'none' }}>
                      {row.status?.trim() ? <StatusBadge status={row.status} /> : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: '#64748b', maxWidth: 160, borderBottom: 'none' }}>{row.position?.trim() || '—'}</Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: '#475569', maxWidth: 180, whiteSpace: 'pre-wrap', borderBottom: 'none' }}>
                      {compactLines([row.lpr_name, row.lpr_role]).join(' · ') || '—'}
                    </Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: '#475569', maxWidth: 180, whiteSpace: 'pre-wrap', borderBottom: 'none' }}>
                      {compactLines([row.lvr_name, row.lvr_role]).join(' · ') || '—'}
                    </Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: '#64748b', maxWidth: 200, borderBottom: 'none' }}>{row.previous_jobs?.trim() || '—'}</Td>
                    <Td style={{ padding: '14px 16px', fontSize: 13, color: row.contact_actuality_date ? '#334155' : '#cbd5e1', fontWeight: 500, borderBottom: 'none' }}>
                      {row.contact_actuality_date ? formatDate(row.contact_actuality_date) : '—'}
                    </Td>
                    <Td style={{ padding: '14px 16px', borderBottom: 'none' }}>
                      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          title="Редактировать"
                          style={{
                            width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0',
                            background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: 14,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(row)}
                          title="Удалить"
                          style={{
                            width: 32, height: 32, borderRadius: 8, border: '1px solid #fee2e2',
                            background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: 14,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewerRow ? (
        <div
          onClick={closeViewer}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, .24)',
            zIndex: 11800,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100vw)',
              height: '100%',
              background: '#fff',
              borderLeft: '1px solid #e8e9ef',
              boxShadow: '-12px 0 34px rgba(2, 6, 23, .16)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid #e8e9ef' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1d23', lineHeight: 1.15 }}>
                    {viewerRow.company_name}
                    {viewerRow.brand_name?.trim() ? <span style={{ color: '#475569', fontWeight: 700 }}> ({viewerRow.brand_name.trim()})</span> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#1e3a5f' }}>Тип: {viewerRow.client_type || '—'}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>·</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>Ниша: {viewerRow.group_name || '—'}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>·</span>
                    <span style={{ fontSize: 12, color: '#475569' }}>
                      Актуальность: {viewerRow.contact_actuality_date ? formatDate(viewerRow.contact_actuality_date) : '—'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeViewer}
                  style={{
                    width: 30,
                    height: 30,
                    border: '1px solid #e8e9ef',
                    borderRadius: 9,
                    background: '#fff',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {viewerStatusEditing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <select
                      value={viewerStatusSelectValue}
                      onChange={(e) => {
                        const next = e.target.value
                        setViewerStatusCustomMode(next === '__custom')
                        setViewerStatusValue(next === '__custom' ? '' : next)
                      }}
                      disabled={viewerStatusSaving}
                      style={{
                        minWidth: 180,
                        border: '1px solid #e8e9ef',
                        borderRadius: 9,
                        padding: '7px 10px',
                        fontSize: 13,
                        color: '#1a1d23',
                        background: '#fff',
                        fontFamily: 'inherit',
                      }}
                    >
                      <option value="">Без статуса</option>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                      <option value="__custom">Свой статус</option>
                    </select>
                    {viewerStatusSelectValue === '__custom' ? (
                      <Input
                        value={viewerStatusValue}
                        onChange={(e) => setViewerStatusValue(e.target.value)}
                        placeholder="Напишите свой статус"
                        disabled={viewerStatusSaving}
                        style={{ minWidth: 210 }}
                      />
                    ) : null}
                    <BtnPrimary
                      type="button"
                      onClick={() => void saveViewerStatus()}
                      disabled={viewerStatusSaving}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      {viewerStatusSaving ? 'Сохр…' : 'Сохранить'}
                    </BtnPrimary>
                    <BtnOutline
                      type="button"
                      onClick={() => {
                        setViewerStatusEditing(false)
                        const current = viewerRow.status?.trim() || ''
                        setViewerStatusValue(current)
                        setViewerStatusCustomMode(Boolean(current && !(STATUS_OPTIONS as readonly string[]).includes(current)))
                      }}
                      disabled={viewerStatusSaving}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      Отмена
                    </BtnOutline>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setViewerStatusEditing(true)}
                    title="Редактировать статус"
                    style={{
                      display: 'inline-flex',
                      padding: '5px 9px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 800,
                      border: 0,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      ...statusStyle(viewerRow.status),
                    }}
                  >
                    {viewerRow.status || 'Без статуса'}
                  </button>
                )}
                <span style={{ fontSize: 12, color: '#64748b' }}>Кто прорабатывает: {viewerRow.assigned_manager_name || '—'}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>Кто привёл: {viewerRow.brought_by_manager_name || viewerRow.brought_by_name || '—'}</span>
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: '14px 18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: 12, background: '#f8fafc' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Контакты
                </div>
                {compactLines([viewerRow.contact_name, viewerRow.phone, viewerRow.email, viewerRow.contact]).length === 0 ? (
                  <div style={{ fontSize: 14, color: '#94a3b8' }}>Нет данных</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                    <ContactInfoField label="ФИО" value={viewerRow.contact_name} />
                    <ContactInfoField label="Телефон" value={viewerRow.phone} />
                    <ContactInfoField label="E-mail" value={viewerRow.email} />
                    <ContactInfoField label="Доп. контакт / Telegram" value={viewerRow.contact} />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                    ЛПР
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23' }}>{viewerRow.lpr_name || '—'}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{viewerRow.lpr_role || '—'}</div>
                </div>
                <div style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                    ЛВР
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23' }}>{viewerRow.lvr_name || '—'}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{viewerRow.lvr_role || '—'}</div>
                </div>
              </div>

              <div style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Комментарий
                </div>
                <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {viewerRow.comment?.trim() || '—'}
                </div>
              </div>

              <div style={{ border: '1px solid #e8e9ef', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    История взаимодействий
                  </div>
                  <BtnOutline
                    type="button"
                    onClick={() => {
                      setViewerInteractionOpen((v) => !v)
                      if (!viewerInteractionOpen) setViewerInteractionForm(emptyInteractionForm())
                    }}
                    disabled={viewerInteractionSaving}
                    style={{ padding: '4px 10px', fontSize: 12, color: '#1a6b3c', lineHeight: 1.2 }}
                    title="Добавить запись в историю"
                  >
                    + Добавить
                  </BtnOutline>
                </div>
                {viewerInteractionOpen ? (
                  <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: 10, marginBottom: 10, background: '#f8fafc' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr) 140px', gap: 8 }}>
                      <Field label="Дата">
                        <DatePicker
                          value={viewerInteractionForm.interaction_date}
                          onChange={v => setViewerInteractionForm(f => ({ ...f, interaction_date: v }))}
                        />
                      </Field>
                      <Field label="Проект / тема">
                        <Input
                          value={viewerInteractionForm.project_name}
                          onChange={(e) => setViewerInteractionForm((f) => ({ ...f, project_name: e.target.value }))}
                          placeholder="Web, SMM, тендер..."
                        />
                      </Field>
                      <Field label="Статус">
                        <Input
                          value={viewerInteractionForm.status}
                          onChange={(e) => setViewerInteractionForm((f) => ({ ...f, status: e.target.value }))}
                          placeholder="КП, звонок..."
                        />
                      </Field>
                    </div>
                    <Field label="Комментарий">
                      <textarea
                        value={viewerInteractionForm.note}
                        onChange={(e) => setViewerInteractionForm((f) => ({ ...f, note: e.target.value }))}
                        placeholder="Что обсудили и какой следующий шаг..."
                        style={{ ...textareaStyle, minHeight: 56 }}
                      />
                    </Field>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <BtnOutline
                        type="button"
                        onClick={() => setViewerInteractionOpen(false)}
                        disabled={viewerInteractionSaving}
                        style={{ fontSize: 12, padding: '5px 10px' }}
                      >
                        Отмена
                      </BtnOutline>
                      <BtnPrimary
                        type="button"
                        onClick={() => void addViewerInteraction()}
                        disabled={viewerInteractionSaving}
                        style={{ fontSize: 12, padding: '5px 10px' }}
                      >
                        {viewerInteractionSaving ? 'Сохр…' : 'Сохранить'}
                      </BtnPrimary>
                    </div>
                  </div>
                ) : null}
                {(viewerRow.interactions || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>История пока пустая</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(viewerRow.interactions || []).map((it) => (
                      <div key={it.id} style={{ border: '1px solid #eef2f7', borderRadius: 10, padding: '9px 10px', background: '#fff' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{formatDate(it.interaction_date)}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23', marginTop: 2 }}>
                          {it.project_name?.trim() || 'Без темы'}
                          {it.status?.trim() ? <span style={{ marginLeft: 8, fontSize: 11, color: '#1a6b3c' }}>· {it.status}</span> : null}
                        </div>
                        {it.note?.trim() ? (
                          <div style={{ fontSize: 12, color: '#475569', marginTop: 3, whiteSpace: 'pre-wrap' }}>{it.note}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e8e9ef', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <BtnOutline
                type="button"
                onClick={() => {
                  closeViewer()
                  openEdit(viewerRow)
                }}
              >
                Редактировать
              </BtnOutline>
              <BtnOutline
                type="button"
                onClick={() => {
                  closeViewer()
                  void remove(viewerRow)
                }}
                style={{ color: '#b91c1c' }}
              >
                Удалить
              </BtnOutline>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={wishlistOpen}
        onClose={() => {
          if (wishlistSaving || wishlistFetching) return
          setWishlistOpen(false)
          setWishlistEditingId(null)
          setWishlistForm(emptyWishlistForm())
          setWishlistActivatingId(null)
          setWishlistActivateForm(emptyWishlistActivateForm())
        }}
        title="Wishlist компаний"
        width={940}
        footer={
          <>
            <BtnOutline type="button" onClick={() => void loadWishlist()} disabled={wishlistFetching || wishlistSaving}>
              {wishlistFetching ? 'Загрузка…' : 'Обновить список'}
            </BtnOutline>
            <BtnOutline
              type="button"
              onClick={() => {
                setWishlistEditingId(null)
                setWishlistForm(emptyWishlistForm())
              }}
              disabled={wishlistSaving}
            >
              Очистить форму
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void saveWishlist()} disabled={wishlistSaving}>
              {wishlistSaving ? 'Сохранение…' : (wishlistEditingId == null ? 'Добавить в wishlist' : 'Сохранить wishlist')}
            </BtnPrimary>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'minmax(0,1fr) 190px' : '1fr', gap: 10 }}>
          <Field label="Компания">
            <Input value={wishlistForm.company_name} onChange={(e) => setWishlistForm((f) => ({ ...f, company_name: e.target.value }))} placeholder="Название компании" />
          </Field>
          {isAdmin ? (
            <Field label="Менеджер">
              <select
                value={wishlistForm.assigned_manager_id}
                onChange={(e) => setWishlistForm((f) => ({ ...f, assigned_manager_id: e.target.value }))}
                style={{ width: '100%', border: '1px solid #e8e9ef', borderRadius: 9, padding: '9px 10px', fontSize: 13, background: '#fff', fontFamily: 'inherit' }}
              >
                <option value="">Не назначен</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Возможный выход">
            <Input value={wishlistForm.potential_entry} onChange={(e) => setWishlistForm((f) => ({ ...f, potential_entry: e.target.value }))} placeholder="Через кого/как выйти" />
          </Field>
          <Field label="Что можно предложить">
            <Input value={wishlistForm.offer} onChange={(e) => setWishlistForm((f) => ({ ...f, offer: e.target.value }))} placeholder="SMM, Web, Performance..." />
          </Field>
        </div>
        <Field label="Причина">
          <textarea value={wishlistForm.reason} onChange={(e) => setWishlistForm((f) => ({ ...f, reason: e.target.value }))} style={{ ...textareaStyle, minHeight: 58 }} />
        </Field>
        <Field label="Комментарий">
          <textarea value={wishlistForm.comment} onChange={(e) => setWishlistForm((f) => ({ ...f, comment: e.target.value }))} style={{ ...textareaStyle, minHeight: 58 }} />
        </Field>

        {wishlistActivatingRow ? (
          <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginBottom: 8 }}>
              Перевод в активные: {wishlistActivatingRow.company_name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr', gap: 8 }}>
              <Field label="Статус">
                <Input value={wishlistActivateForm.status} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, status: e.target.value }))} />
              </Field>
              <Field label="ФИО контакта">
                <Input value={wishlistActivateForm.contact_name} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, contact_name: e.target.value }))} />
              </Field>
              <Field label="Телефон">
                <Input value={wishlistActivateForm.phone} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, phone: e.target.value }))} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="E-mail">
                <Input value={wishlistActivateForm.email} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="ЛПР">
                <Input value={wishlistActivateForm.lpr_name} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, lpr_name: e.target.value }))} />
              </Field>
              <Field label="Роль ЛПР">
                <Input value={wishlistActivateForm.lpr_role} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, lpr_role: e.target.value }))} />
              </Field>
            </div>
            <Field label="Комментарий при переносе">
              <Input value={wishlistActivateForm.comment} onChange={(e) => setWishlistActivateForm((f) => ({ ...f, comment: e.target.value }))} placeholder="Доп. комментарий в карточку" />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <BtnOutline type="button" onClick={() => setWishlistActivatingId(null)} disabled={wishlistSaving}>Отмена</BtnOutline>
              <BtnPrimary type="button" onClick={() => void activateWishlist()} disabled={wishlistSaving}>
                {wishlistSaving ? 'Перенос…' : 'Перевести в активные'}
              </BtnPrimary>
            </div>
          </div>
        ) : null}

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <Th style={{ width: 36 }}>№</Th>
                  <Th>Компания</Th>
                  <Th>Возможный выход</Th>
                  <Th>Причина</Th>
                  <Th>Что предложить</Th>
                  <Th>Менеджер</Th>
                  <Th style={{ width: 220 }}>Действия</Th>
                </tr>
              </thead>
              <tbody>
                {wishlistRows.length === 0 ? (
                  <tr>
                    <Td colSpan={7} style={{ color: '#94a3b8' }}>Список wishlist пока пуст</Td>
                  </tr>
                ) : wishlistRows.map((row, idx) => (
                  <tr key={row.id} style={{ borderTop: '1px solid #eef2f7' }}>
                    <Td>{idx + 1}</Td>
                    <Td style={{ fontWeight: 700 }}>{row.company_name}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{row.potential_entry || '—'}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{row.reason || '—'}</Td>
                    <Td style={{ whiteSpace: 'pre-wrap' }}>{row.offer || '—'}</Td>
                    <Td>{row.assigned_manager_name || '—'}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <BtnOutline type="button" onClick={() => editWishlist(row)} style={{ fontSize: 12, padding: '4px 8px' }}>Изм.</BtnOutline>
                        <BtnOutline type="button" onClick={() => void removeWishlist(row)} style={{ fontSize: 12, padding: '4px 8px', color: '#b91c1c' }}>Удалить</BtnOutline>
                        <BtnOutline
                          type="button"
                          onClick={() => {
                            setWishlistActivatingId(row.id)
                            setWishlistActivateForm(emptyWishlistActivateForm())
                          }}
                          style={{ fontSize: 12, padding: '4px 8px', color: '#166534' }}
                        >
                          В активные
                        </BtnOutline>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Modal>

      <Modal
        open={importOpen}
        onClose={closeImport}
        title="Импорт клиентской базы из Excel"
        width={860}
        footer={
          <>
            <BtnOutline type="button" onClick={closeImport} disabled={importBusy}>
              Отмена
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void importCompanies()} disabled={importBusy || importRows.length === 0}>
              {importBusy ? 'Импортируем…' : `Импортировать (${importRows.length})`}
            </BtnPrimary>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{
            padding: 16,
            borderRadius: 14,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            color: '#475569',
            fontSize: 14,
            lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Как импортировать</div>
            Скачайте шаблон, заполните лист <b>Компании</b> в таком же формате и загрузите файл сюда.
            Обязательная колонка только <b>Компания*</b>. Ниша и менеджер сопоставляются с уже существующими значениями.
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <BtnOutline type="button" onClick={downloadImportTemplate}>
              Скачать шаблон Excel
            </BtnOutline>
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px dashed #94a3b8',
              background: '#fff',
              color: '#334155',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}>
              Загрузить Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={(e) => void handleImportFile(e.target.files?.[0] || null)}
              />
            </label>
            {importFileName && (
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                {importFileName}
              </span>
            )}
          </div>

          {importError && (
            <div style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
            }}>
              {importError}
            </div>
          )}

          {importRows.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', background: '#f8fafc', fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                Предпросмотр: {importRows.length} строк
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fff' }}>
                      {['Компания', 'Тип', 'Ниша', 'Статус', 'Контакт', 'Телефон', 'Email', 'Менеджер'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '9px 10px', color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 30).map((row, i) => (
                      <tr key={`${row.company_name}-${i}`}>
                        <td style={previewTd}>{row.company_name}</td>
                        <td style={previewTd}>{row.client_type || '—'}</td>
                        <td style={previewTd}>{row.group_name || '—'}</td>
                        <td style={previewTd}>{row.status || 'Новый'}</td>
                        <td style={previewTd}>{row.contact_name || '—'}</td>
                        <td style={previewTd}>{row.phone || '—'}</td>
                        <td style={previewTd}>{row.email || '—'}</td>
                        <td style={previewTd}>{row.manager_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importRows.length > 30 && (
                <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8', background: '#fafafa' }}>
                  Показаны первые 30 строк.
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId == null ? 'Новая компания' : 'Редактировать компанию'}
        width={720}
        footer={
          <>
            <BtnOutline type="button" onClick={closeModal} disabled={saving}>
              Отмена
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr) 120px minmax(0, 0.75fr)', gap: 12 }}>
          <Field label="Компания">
            <Input
              value={form.company_name}
              onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
              placeholder="Например: Uzum Bank"
              autoFocus
            />
          </Field>
          <Field label="Брендовое название">
            <Input
              value={form.brand_name}
              onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
              placeholder="Например: Pepsi, Lipton"
            />
          </Field>
          <Field label="Тип клиента">
            <select
              value={form.client_type}
              onChange={(e) => setForm((f) => ({ ...f, client_type: e.target.value }))}
              style={{
                width: '100%',
                border: '1px solid #e8e9ef',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: 13.5,
                color: '#1a1d23',
                background: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <option value="">Выбрать</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </Field>
          <Field label="Статус">
            <select
              value={statusSelectValue}
              onChange={(e) => {
                const next = e.target.value
                setCustomStatusMode(next === '__custom')
                setForm((f) => ({ ...f, status: next === '__custom' ? '' : next }))
              }}
              style={{
                width: '100%',
                border: '1px solid #e8e9ef',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: 13.5,
                color: '#1a1d23',
                background: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <option value="">Без статуса</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
              <option value="__custom">Свой статус</option>
            </select>
            {statusSelectValue === '__custom' ? (
              <Input
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                placeholder="Напишите свой статус"
                style={{ marginTop: 8 }}
              />
            ) : null}
          </Field>
        </div>

        <Field label="Ниша / папка">
          <select
            value={form.group_id}
            onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}
            style={{
              width: '100%',
              border: '1px solid #e8e9ef',
              borderRadius: 9,
              padding: '9px 12px',
              fontSize: 13.5,
              color: '#1a1d23',
              background: '#fff',
              fontFamily: 'inherit',
            }}
          >
            <option value="">Без ниши</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 12 }}>
          {isAdmin ? (
            <Field label="Кто прорабатывает">
              <select
                value={form.assigned_manager_id}
                onChange={(e) => setForm((f) => ({ ...f, assigned_manager_id: e.target.value }))}
                style={{
                  width: '100%',
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: '9px 12px',
                  fontSize: 13.5,
                  color: '#1a1d23',
                  background: '#fff',
                  fontFamily: 'inherit',
                }}
              >
                <option value="">Не назначен</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Кто привёл">
            <div style={{ display: 'grid', gap: 8 }}>
              <select
                value={form.brought_by_manager_id}
                onChange={(e) => setForm((f) => ({ ...f, brought_by_manager_id: e.target.value }))}
                style={{
                  width: '100%',
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: '9px 12px',
                  fontSize: 13.5,
                  color: '#1a1d23',
                  background: '#fff',
                  fontFamily: 'inherit',
                }}
              >
                <option value="">Не менеджер / не указан</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Input
                value={form.brought_by_name}
                onChange={(e) => setForm((f) => ({ ...f, brought_by_name: e.target.value }))}
                placeholder="Или впишите имя любого человека"
              />
            </div>
          </Field>
        </div>

        <Field label="Комментарий">
          <textarea
            value={form.comment}
            onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
            placeholder="Что написали, следующий шаг, важный контекст..."
            style={textareaStyle}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 12 }}>
          <Field label="Должность">
            <Input
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              placeholder="Маркетолог, бренд-менеджер..."
            />
          </Field>
          <Field label="ФИО контакта">
            <Input
              value={form.contact_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
              placeholder="Имя и фамилия контакта"
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          <Field label="Телефон">
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+998 ..."
              inputMode="tel"
            />
          </Field>
          <Field label="E-mail">
            <Input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="name@company.uz"
              inputMode="email"
            />
          </Field>
          <Field label="Актуальность контакта">
            <DatePicker
              value={form.contact_actuality_date}
              onChange={v => setForm(f => ({ ...f, contact_actuality_date: v }))}
            />
          </Field>
        </div>

        <Field label="Доп. контакт / Telegram">
          <Input
            value={form.contact}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
            placeholder="@username, второй номер..."
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.75fr)', gap: 12 }}>
          <Field label="ЛПР">
            <Input
              value={form.lpr_name}
              onChange={(e) => setForm((f) => ({ ...f, lpr_name: e.target.value }))}
              placeholder="Кто принимает решение"
            />
          </Field>
          <Field label="Роль ЛПР">
            <Input
              value={form.lpr_role}
              onChange={(e) => setForm((f) => ({ ...f, lpr_role: e.target.value }))}
              placeholder="CEO, CMO, основатель..."
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.75fr)', gap: 12 }}>
          <Field label="ЛВР">
            <Input
              value={form.lvr_name}
              onChange={(e) => setForm((f) => ({ ...f, lvr_name: e.target.value }))}
              placeholder="Кто влияет на решение"
            />
          </Field>
          <Field label="Роль ЛВР">
            <Input
              value={form.lvr_role}
              onChange={(e) => setForm((f) => ({ ...f, lvr_role: e.target.value }))}
              placeholder="Маркетолог, ассистент..."
            />
          </Field>
        </div>
        <Field label="Прошлые места работы">
          <textarea
            value={form.previous_jobs}
            onChange={(e) => setForm((f) => ({ ...f, previous_jobs: e.target.value }))}
            placeholder="Например: бывший CMO, бренд-менеджер, агентство..."
            style={textareaStyle}
          />
        </Field>

        <div style={{ borderTop: '1px solid #e8e9ef', paddingTop: 16, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1d23', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                История взаимодействий
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Проекты, касания, КП, звонки и следующие шаги по этой компании.
              </div>
            </div>
          </div>

          {editingId == null ? (
            <div style={{ fontSize: 12, color: '#94a3b8', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, padding: 12 }}>
              Сначала сохраните компанию, потом можно будет добавлять историю взаимодействий.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr) 160px', gap: 10 }}>
                <Field label="Дата">
                  <DatePicker
                    value={interactionForm.interaction_date}
                    onChange={v => setInteractionForm(f => ({ ...f, interaction_date: v }))}
                  />
                </Field>
                <Field label="Проект / тема">
                  <Input
                    value={interactionForm.project_name}
                    onChange={(e) => setInteractionForm((f) => ({ ...f, project_name: e.target.value }))}
                    placeholder="Например: Web, SMM, тендер..."
                  />
                </Field>
                <Field label="Статус">
                  <Input
                    value={interactionForm.status}
                    onChange={(e) => setInteractionForm((f) => ({ ...f, status: e.target.value }))}
                    placeholder="КП, звонок, ждём..."
                  />
                </Field>
              </div>
              <Field label="Комментарий взаимодействия">
                <textarea
                  value={interactionForm.note}
                  onChange={(e) => setInteractionForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Что обсудили, что отправили, следующий шаг..."
                  style={{ ...textareaStyle, minHeight: 64 }}
                />
              </Field>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -4, marginBottom: 12 }}>
                <BtnOutline type="button" onClick={() => void addInteraction()} disabled={interactionSaving} style={{ color: '#1a6b3c' }}>
                  + Добавить в историю
                </BtnOutline>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(editingRow?.interactions || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', background: '#f8fafc', border: '1px solid #e8e9ef', borderRadius: 10, padding: 12 }}>
                    История пока пустая.
                  </div>
                ) : (
                  (editingRow?.interactions || []).map((it) => (
                    <div
                      key={it.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '110px minmax(0, 1fr) auto',
                        gap: 10,
                        alignItems: 'start',
                        padding: '10px 12px',
                        border: '1px solid #e8e9ef',
                        borderRadius: 10,
                        background: '#fff',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{formatDate(it.interaction_date)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23' }}>
                          {it.project_name?.trim() || 'Без темы'}
                          {it.status?.trim() ? (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#1a6b3c' }}>· {it.status}</span>
                          ) : null}
                        </div>
                        {it.note?.trim() ? (
                          <div style={{ fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap', marginTop: 4 }}>{it.note}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteInteraction(it.id)}
                        disabled={interactionSaving}
                        title="Удалить запись истории"
                        style={{
                          border: '1px solid #fee2e2',
                          background: '#fff',
                          color: '#b91c1c',
                          borderRadius: 8,
                          padding: '4px 8px',
                          cursor: interactionSaving ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                          fontSize: 12,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  )
}
