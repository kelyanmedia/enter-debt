import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Card, Th, Td, Empty, Input, Field, BtnOutline, BtnPrimary, Modal } from '@/components/ui'
import api from '@/lib/api'

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

function statusStyle(status: string | null | undefined): CSSProperties {
  const s = (status || '').toLowerCase()
  if (s.includes('кп') || s.includes('переговор')) return { background: '#dcfce7', color: '#166534' }
  if (s.includes('уже') || s.includes('готов') || s.includes('сделано')) return { background: '#fef3c7', color: '#92400e' }
  if (s.includes('нет') || s.includes('отказ') || s.includes('не работает')) return { background: '#fee2e2', color: '#991b1b' }
  return { background: '#eef2ff', color: '#3730a3' }
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
  const visibleColumnCount = selectionMode ? 15 : 14
  const toggleGroupFilter = (value: string) => {
    setGroupFilters((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  }

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <BtnPrimary type="button" onClick={openCreate}>
          Добавить компанию
        </BtnPrimary>
        <BtnOutline
          type="button"
          onClick={() => {
            setSelectionMode((v) => !v)
            if (selectionMode) setSelectedIds([])
          }}
          style={{ fontSize: 12, padding: '6px 12px', color: selectionMode ? '#1a6b3c' : undefined }}
        >
          {selectionMode ? 'Готово' : 'Отметить'}
        </BtnOutline>
        <BtnOutline type="button" onClick={openWishlist} style={{ fontSize: 12, padding: '6px 12px' }}>
          Wishlist
        </BtnOutline>
        <BtnOutline type="button" onClick={() => void load()} disabled={fetching} style={{ fontSize: 12, padding: '6px 12px' }}>
          {fetching ? 'Загрузка…' : 'Обновить'}
        </BtnOutline>
        {selectedIds.length > 0 ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1a6b3c' }}>
            Отмечено: {selectedIds.length}
          </span>
        ) : null}
      </div>

      {(selectionMode || isAdmin) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: '#f0fdf4',
            borderRadius: 10,
            border: '1px solid #bbf7d0',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: '#166534' }}>МАССОВЫЕ ДЕЙСТВИЯ</span>
          {isAdmin ? (
            <>
              <select
                value={bulkTargetManagerId}
                onChange={(e) => setBulkTargetManagerId(e.target.value)}
                style={{ minWidth: 190, border: '1px solid #bbf7d0', borderRadius: 9, padding: '7px 10px', fontSize: 13, background: '#fff' }}
              >
                <option value="">Кому передать</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <BtnOutline type="button" onClick={() => void assignSelectedManager()} disabled={bulkSaving || selectedIds.length === 0} style={{ fontSize: 12, padding: '6px 10px' }}>
                Передать отмеченные
              </BtnOutline>
              <span style={{ width: 1, height: 20, background: '#bbf7d0' }} aria-hidden />
              <select
                value={bulkSourceManagerId}
                onChange={(e) => setBulkSourceManagerId(e.target.value)}
                style={{ minWidth: 190, border: '1px solid #bbf7d0', borderRadius: 9, padding: '7px 10px', fontSize: 13, background: '#fff' }}
              >
                <option value="">Все компании менеджера</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <BtnOutline type="button" onClick={() => void assignManagerPortfolio()} disabled={bulkSaving || !bulkSourceManagerId || !bulkTargetManagerId} style={{ fontSize: 12, padding: '6px 10px' }}>
                Передать весь список
              </BtnOutline>
            </>
          ) : null}
          <span style={{ width: 1, height: 20, background: '#bbf7d0' }} aria-hidden />
          <select
            value={bulkGroupId}
            onChange={(e) => setBulkGroupId(e.target.value)}
            style={{ minWidth: 180, border: '1px solid #bbf7d0', borderRadius: 9, padding: '7px 10px', fontSize: 13, background: '#fff' }}
          >
            <option value="">Без ниши</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <BtnOutline type="button" onClick={() => void assignSelectedGroup()} disabled={bulkSaving || selectedIds.length === 0} style={{ fontSize: 12, padding: '6px 10px' }}>
            В нишу отмеченные
          </BtnOutline>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 12,
          padding: '10px 12px',
          background: '#f8fafc',
          borderRadius: 10,
          border: '1px solid #e8e9ef',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 280 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ПОИСК</span>
          <Input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Компания, статус, менеджер, контакт…"
            autoComplete="off"
            style={{ width: 300, maxWidth: '100%' }}
          />
          {tableSearch.trim() !== '' && (
            <BtnOutline type="button" onClick={() => setTableSearch('')} style={{ fontSize: 12, padding: '6px 10px' }}>
              Сбросить
            </BtnOutline>
          )}
        </div>

        <span style={{ width: 1, alignSelf: 'stretch', background: '#e2e8f0' }} aria-hidden />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 280, position: 'relative' }} ref={groupsPopupRef}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>НИШИ / ПАПКИ</span>
          <button
            type="button"
            onClick={() => setGroupsPopupOpen((v) => !v)}
            style={{
              border: '1px solid #e2e8f0',
              background: '#fff',
              borderRadius: 10,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 700,
              color: '#334155',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {groupFilters.length === 0 ? 'Выбрать ниши' : `Выбрано: ${groupFilters.length}`} +
          </button>
          {groupFilters.map((key) => {
            const label = key === 'none' ? 'Без ниши' : groups.find((g) => String(g.id) === key)?.name || key
            return (
              <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 999, background: '#f1f5f9', color: '#334155', fontSize: 12, fontWeight: 700 }}>
                {label}
                <button type="button" onClick={() => toggleGroupFilter(key)} style={{ border: 0, background: 'transparent', color: '#b91c1c', cursor: 'pointer', fontWeight: 800, padding: 0 }}>×</button>
              </span>
            )
          })}
          {groupsPopupOpen ? (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: 0,
                zIndex: 20,
                width: 360,
                maxWidth: 'min(92vw, 420px)',
                maxHeight: 420,
                overflow: 'auto',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                boxShadow: '0 12px 28px rgba(15,23,42,.15)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Новая ниша..."
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createGroup()
                  }}
                  style={{ flex: 1 }}
                />
                <BtnOutline type="button" onClick={() => void createGroup()} disabled={groupSaving} style={{ color: '#1a6b3c', padding: '6px 10px' }}>
                  +
                </BtnOutline>
              </div>
              <button type="button" onClick={() => setGroupFilters([])} style={{ textAlign: 'left', border: 0, background: '#f8fafc', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', fontWeight: 700, color: '#334155' }}>
                {groupFilters.length === 0 ? '✓ ' : ''}Все ниши
              </button>
              <button type="button" onClick={() => toggleGroupFilter('none')} style={{ textAlign: 'left', border: 0, background: groupFilters.includes('none') ? '#e8f5ee' : '#fff', borderRadius: 9, padding: '8px 10px', cursor: 'pointer' }}>
                {groupFilters.includes('none') ? '✓ ' : ''}Без ниши
              </button>
              {groups.map((g) => (
                <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => toggleGroupFilter(String(g.id))}
                    style={{ flex: 1, textAlign: 'left', border: 0, background: groupFilters.includes(String(g.id)) ? '#e8f5ee' : '#fff', borderRadius: 9, padding: '8px 10px', cursor: 'pointer' }}
                  >
                    {groupFilters.includes(String(g.id)) ? '✓ ' : ''}{g.name}
                  </button>
                  <button type="button" onClick={() => void deleteGroup(g)} disabled={groupSaving} title="Удалить нишу" style={{ border: '1px solid #fee2e2', background: '#fff', color: '#b91c1c', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <span style={{ width: 1, alignSelf: 'stretch', background: '#e2e8f0' }} aria-hidden />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 280 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ФИЛЬТР</span>
        {(['', 'A', 'B', 'C'] as const).map((key) => {
          const active = clientTypeFilter === key
          return (
            <button
              key={key || 'all'}
              type="button"
              onClick={() => setClientTypeFilter(key)}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: active ? '#fff' : '#334155',
                background: active ? '#1a6b3c' : '#fff',
                border: active ? '1px solid #1a6b3c' : '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '6px 11px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {key || 'Все типы'}
            </button>
          )
        })}
        <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} aria-hidden />
        <select
          value={managerFilter}
          onChange={(e) => setManagerFilter(e.target.value)}
          style={{
            minWidth: 190,
            border: '1px solid #e8e9ef',
            borderRadius: 9,
            padding: '7px 10px',
            fontSize: 13,
            color: '#1a1d23',
            background: '#fff',
            fontFamily: 'inherit',
          }}
        >
          <option value="">Все менеджеры</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {(clientTypeFilter || managerFilter || groupFilters.length > 0) && (
          <BtnOutline
            type="button"
            onClick={() => {
              setClientTypeFilter('')
              setManagerFilter('')
              setGroupFilters([])
            }}
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            Сбросить фильтр
          </BtnOutline>
        )}
        </div>
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          role="region"
          aria-label="Таблица продаж"
          style={{
            maxHeight: 'min(72vh, calc(100vh - 200px))',
            overflow: 'auto',
            overflowX: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: selectionMode ? 1660 : 1580 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, boxShadow: '0 1px 0 #e2e8f0' }}>
              <tr style={{ background: '#f8fafc' }}>
                {selectionMode ? (
                  <Th style={{ width: 42 }}>
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} aria-label="Отметить все видимые компании" />
                  </Th>
                ) : null}
                <Th style={{ width: 40 }}>№</Th>
                <Th style={{ minWidth: 260 }}>Компания</Th>
                <Th>Тип</Th>
                <Th>Ниша</Th>
                <Th>Статус</Th>
                <Th>Должность</Th>
                <Th style={{ minWidth: 180 }}>ЛПР</Th>
                <Th style={{ minWidth: 180 }}>ЛВР</Th>
                <Th style={{ minWidth: 180 }}>Прошлые места работы</Th>
                <Th>Кто прорабатывает</Th>
                <Th>Кто привёл</Th>
                <Th style={{ minWidth: 130 }}>Актуальность</Th>
                <Th style={{ width: 130 }}>Действия</Th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !fetching ? (
                <tr>
                  <Td colSpan={visibleColumnCount} style={{ padding: 0, border: 'none', verticalAlign: 'top' }}>
                    <Empty text="Компаний пока нет. Нажмите «Добавить компанию» и заполните карточку." />
                  </Td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr
                    key={row.id}
                    style={{ borderBottom: '1px solid #eef2f7', cursor: 'pointer' }}
                    onClick={() => openViewer(row)}
                    title="Открыть карточку компании"
                  >
                    {selectionMode ? (
                      <Td>
                        <input
                          type="checkbox"
                          checked={selectedSet.has(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Отметить ${row.company_name}`}
                        />
                      </Td>
                    ) : null}
                    <Td style={{ fontWeight: 600 }}>{idx + 1}</Td>
                    <Td style={{ fontWeight: 700, minWidth: 260, maxWidth: 360, color: '#1a6b3c', whiteSpace: 'normal', lineHeight: 1.35 }}>
                      {row.company_name}
                      {row.brand_name?.trim() ? <span style={{ color: '#475569', fontWeight: 600 }}> ({row.brand_name.trim()})</span> : null}
                    </Td>
                    <Td style={{ fontSize: 13, fontWeight: 800, color: '#1e3a5f', textAlign: 'center' }}>{row.client_type || '—'}</Td>
                    <Td style={{ fontSize: 13, fontWeight: 700, color: row.group_name ? '#1a6b3c' : '#94a3b8' }}>{row.group_name || '—'}</Td>
                    <Td>
                      {row.status?.trim() ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            padding: '4px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 700,
                            ...statusStyle(row.status),
                          }}
                        >
                          {row.status}
                        </span>
                      ) : '—'}
                    </Td>
                    <Td style={{ fontSize: 13, color: '#475569', maxWidth: 180 }}>{row.position?.trim() || '—'}</Td>
                    <Td style={{ fontSize: 13, color: '#475569', maxWidth: 200, whiteSpace: 'pre-wrap' }}>
                      {compactLines([row.lpr_name, row.lpr_role]).join('\n') || '—'}
                    </Td>
                    <Td style={{ fontSize: 13, color: '#475569', maxWidth: 200, whiteSpace: 'pre-wrap' }}>
                      {compactLines([row.lvr_name, row.lvr_role]).join('\n') || '—'}
                    </Td>
                    <Td style={{ fontSize: 13, color: '#475569', maxWidth: 220, whiteSpace: 'pre-wrap' }}>{row.previous_jobs?.trim() || '—'}</Td>
                    <Td style={{ fontSize: 13, fontWeight: 700 }}>{row.assigned_manager_name || '—'}</Td>
                    <Td style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f' }}>{row.brought_by_manager_name || row.brought_by_name || '—'}</Td>
                    <Td style={{ fontSize: 13, fontWeight: 700, color: row.contact_actuality_date ? '#1a6b3c' : '#94a3b8' }}>
                      {row.contact_actuality_date ? formatDate(row.contact_actuality_date) : '—'}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                        <BtnOutline
                          type="button"
                          onClick={() => openEdit(row)}
                          title="Редактировать"
                          aria-label="Редактировать компанию"
                          style={{ fontSize: 15, padding: '5px 10px', minWidth: 36, lineHeight: 1 }}
                        >
                          ✎
                        </BtnOutline>
                        <BtnOutline
                          type="button"
                          onClick={() => void remove(row)}
                          title="Удалить"
                          aria-label="Удалить компанию"
                          style={{ fontSize: 15, padding: '5px 10px', minWidth: 36, color: '#b91c1c', lineHeight: 1 }}
                        >
                          🗑
                        </BtnOutline>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
                        <Input
                          type="date"
                          value={viewerInteractionForm.interaction_date}
                          onChange={(e) => setViewerInteractionForm((f) => ({ ...f, interaction_date: e.target.value }))}
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
            <Input
              type="date"
              value={form.contact_actuality_date}
              onChange={(e) => setForm((f) => ({ ...f, contact_actuality_date: e.target.value }))}
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
                  <Input
                    type="date"
                    value={interactionForm.interaction_date}
                    onChange={(e) => setInteractionForm((f) => ({ ...f, interaction_date: e.target.value }))}
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
