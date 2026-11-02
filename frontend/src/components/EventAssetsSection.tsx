import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import api from '@/lib/api'
import DatePicker from '@/components/DatePicker'
import { useAuth } from '@/context/AuthContext'
import { BtnOutline, BtnPrimary, Card, ConfirmModal, Empty, Field, Input, Modal, MoneyInput } from '@/components/ui'

interface CheckState { by?: string | null; at?: string | null }
interface EventAsset {
  id: number
  name: string
  description?: string | null
  quantity: number
  category_id?: number | null
  added_on?: string | null
  price?: number | null
  market_rent?: number | null
  has_photo?: boolean
  out_warehouse?: CheckState | null
  out_site?: CheckState | null
  back_warehouse?: CheckState | null
}
interface ArchiveItem {
  usage_id: number
  asset_id: number
  asset_name: string
  description?: string | null
  quantity: number
  rental_cost?: number | null
  market_rent?: number | null
}
interface ArchiveProject {
  key: string
  project_name: string
  date_from?: string | null
  date_to?: string | null
  manager_name?: string | null
  total: number
  items: ArchiveItem[]
}
interface Category { id: number; name: string; color: string }

type CheckKey = 'out_warehouse' | 'out_site' | 'back_warehouse'
const CHECKS: { key: CheckKey; label: string }[] = [
  { key: 'out_warehouse', label: 'Вывез со склада' },
  { key: 'out_site', label: 'Вывез с объекта' },
  { key: 'back_warehouse', label: 'Привез на склад' },
]

const PALETTE = ['#ffffff', '#fde2e2', '#ffedd5', '#fef9c3', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3']

function fmtAt(v?: string | null) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDay(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function errMsg(e: unknown, fallback: string) {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof d === 'string' ? d : fallback
}

const th: CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '12px', verticalAlign: 'top', fontSize: 14, borderTop: '1px solid #eef0f5' }
const bigBox: CSSProperties = { width: 22, height: 22, cursor: 'pointer', accentColor: '#1a6b3c' }

export function EventAssetsSection() {
  const { user } = useAuth()
  const [items, setItems] = useState<EventAsset[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState<number | 'all'>('all')
  const [picked, setPicked] = useState<Record<number, number>>({})

  const [editor, setEditor] = useState<{ id?: number; name: string; description: string; quantity: string; category_id: string; added_on: string; price: string; photo: File | null; removePhoto: boolean; hadPhoto: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState('')
  const [delItem, setDelItem] = useState<EventAsset | null>(null)

  const [catModal, setCatModal] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', color: '#ffffff' })

  const [pdfModal, setPdfModal] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [staff, setStaff] = useState<{ id: number; name: string; role?: string; email?: string; is_active?: boolean }[]>([])
  const [shared, setShared] = useState<number[]>([])
  const [shareBusy, setShareBusy] = useState(false)
  const [lightbox, setLightbox] = useState<EventAsset | null>(null)
  const [view, setView] = useState<'items' | 'archive'>('items')
  const [archive, setArchive] = useState<ArchiveProject[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [delProject, setDelProject] = useState<ArchiveProject | null>(null)
  const today = () => new Date().toISOString().slice(0, 10)
  const [pdf, setPdf] = useState({ project: '', from: '', to: '', manager: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [a, c] = await Promise.all([api.get<EventAsset[]>('event-assets'), api.get<Category[]>('event-assets/categories')])
      setItems(a.data)
      setCats(c.data)
    } catch (e) {
      setError(errMsg(e, 'Не удалось загрузить активы'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats])

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase()
    return items.filter((i) => {
      if (catFilter !== 'all' && i.category_id !== catFilter) return false
      if (!t) return true
      return `${i.name} ${i.description ?? ''} ${catById.get(i.category_id ?? -1)?.name ?? ''}`.toLowerCase().includes(t)
    })
  }, [items, q, catFilter, catById])

  const pickedIds = Object.keys(picked).map(Number)
  const allVisiblePicked = visible.length > 0 && visible.every((i) => i.id in picked)

  const togglePick = (i: EventAsset) => {
    const on = i.id in picked
    setPicked((p) => {
      const n = { ...p }
      if (on) delete n[i.id]
      else n[i.id] = i.quantity
      return n
    })
  }

  /** Сколько штук берём в проект (0 — снять выбор). Больше остатка поставить нельзя. */
  const setPickQty = (i: EventAsset, raw: number) => {
    const n = Math.min(i.quantity, Math.max(0, Math.floor(raw) || 0))
    if (n === 0) {
      setPicked((p) => { const x = { ...p }; delete x[i.id]; return x })
      return
    }
    setPicked((p) => ({ ...p, [i.id]: n }))
  }

  const saveQuantity = async (i: EventAsset, n: number) => {
    const q = Math.max(1, Math.floor(n) || 1)
    if (q === i.quantity) return
    try {
      const r = await api.patch<EventAsset>(`event-assets/${i.id}`, { quantity: q })
      replaceItem(r.data)
      setPicked((p) => (i.id in p && p[i.id] > q ? { ...p, [i.id]: q } : p))
    } catch (e) {
      setError(errMsg(e, 'Не удалось сохранить количество'))
    }
  }

  const toggleAllVisible = () => {
    setPicked((p) => {
      const n = { ...p }
      if (allVisiblePicked) visible.forEach((i) => delete n[i.id])
      else visible.forEach((i) => { n[i.id] = n[i.id] ?? i.quantity })
      return n
    })
  }

  const saveField = async (i: EventAsset, field: 'price', raw: string) => {
    const t = raw.replace(/\s/g, '').replace(',', '.')
    const val = t === '' ? null : Number(t)
    if (val !== null && Number.isNaN(val)) return
    try {
      const r = await api.patch<EventAsset>(`event-assets/${i.id}`, { price: val, clear_price: val === null })
      replaceItem(r.data)
    } catch (e) {
      setError(errMsg(e, 'Не удалось сохранить цену'))
    }
  }

  const replaceItem = (row: EventAsset) => setItems((l) => l.map((x) => (x.id === row.id ? row : x)))

  const toggleCheck = async (i: EventAsset, key: CheckKey) => {
    try {
      const r = await api.put<EventAsset>(`event-assets/${i.id}/checks/${key}`, { checked: !i[key] })
      replaceItem(r.data)
    } catch (e) {
      setError(errMsg(e, 'Не удалось сохранить отметку'))
    }
  }

  const saveItem = async () => {
    if (!editor) return
    if (!editor.name.trim()) { setFormErr('Укажите название'); return }
    setSaving(true)
    setFormErr('')
    const body = {
      name: editor.name,
      description: editor.description,
      quantity: Math.max(1, parseInt(editor.quantity, 10) || 1),
      added_on: editor.added_on || null,
    }
    const priceNum = editor.price.trim() === '' ? null : Number(editor.price.replace(/\s/g, '').replace(',', '.'))
    if (priceNum !== null && Number.isNaN(priceNum)) { setFormErr('Цена: введите число'); setSaving(false); return }
    try {
      if (editor.id) {
        await api.patch(`event-assets/${editor.id}`, {
          ...body,
          category_id: editor.category_id ? Number(editor.category_id) : null,
          clear_category: !editor.category_id,
          price: priceNum,
          clear_price: priceNum === null,
        })
        if (editor.photo) {
          const fd = new FormData()
          fd.append('photo', editor.photo)
          await api.post(`event-assets/${editor.id}/photo`, fd)
        } else if (editor.removePhoto && editor.hadPhoto) {
          await api.delete(`event-assets/${editor.id}/photo`)
        }
      } else {
        const created = await api.post<EventAsset>('event-assets', { ...body, price: priceNum, category_id: editor.category_id ? Number(editor.category_id) : null })
        if (editor.photo) {
          const fd = new FormData()
          fd.append('photo', editor.photo)
          await api.post(`event-assets/${created.data.id}/photo`, fd)
        }
      }
      setEditor(null)
      await load()
    } catch (e) {
      setFormErr(errMsg(e, 'Не удалось сохранить'))
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async () => {
    if (!delItem) return
    try {
      await api.delete(`event-assets/${delItem.id}`)
      setPicked((p) => { const n = { ...p }; delete n[delItem.id]; return n })
      setDelItem(null)
      await load()
    } catch (e) {
      setError(errMsg(e, 'Не удалось удалить'))
      setDelItem(null)
    }
  }

  const addCategory = async () => {
    if (!newCat.name.trim()) return
    try {
      await api.post('event-assets/categories', newCat)
      setNewCat({ name: '', color: '#ffffff' })
      await load()
    } catch (e) {
      setError(errMsg(e, 'Не удалось добавить категорию'))
    }
  }

  const patchCategory = async (c: Category, patch: Partial<Category>) => {
    const next = { ...c, ...patch }
    setCats((l) => l.map((x) => (x.id === c.id ? next : x)))
    try {
      await api.patch(`event-assets/categories/${c.id}`, { name: next.name, color: next.color })
    } catch (e) {
      setError(errMsg(e, 'Не удалось изменить категорию'))
      await load()
    }
  }

  const removeCategory = async (c: Category) => {
    try {
      await api.delete(`event-assets/categories/${c.id}`)
      if (catFilter === c.id) setCatFilter('all')
      await load()
    } catch (e) {
      setError(errMsg(e, 'Не удалось удалить категорию'))
    }
  }

  const pdfHtml = useMemo(() => {
    const rows = items.filter((i) => i.id in picked)
    const body = rows
      .map((i, n) => {
        const color = catById.get(i.category_id ?? -1)?.color ?? '#ffffff'
        const box = (c?: CheckState | null) =>
          `<td class="chk"><div class="box">${c?.by ? '✓' : ''}</div>${c?.by ? `<div class="who">${esc(c.by)}<br>${esc(fmtAt(c.at))}</div>` : ''}</td>`
        return `<tr style="background:${esc(color)}">
          <td class="num">${n + 1}</td>
          <td><div class="nm">${esc(i.name)}</div>${i.description ? `<div class="ds">${esc(i.description)}</div>` : ''}</td>
          <td class="qty">${picked[i.id] ?? i.quantity}</td>
          ${box(i.out_warehouse)}${box(i.out_site)}${box(i.back_warehouse)}
        </tr>`
      })
      .join('')
    const period = pdf.from || pdf.to ? `${fmtDay(pdf.from) || '…'} — ${fmtDay(pdf.to) || '…'}` : '—'
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(pdf.project || 'Список активов')}</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
html { background: #fff; }
body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 12mm; font-size: 16px; }
@media print { body { padding: 0; } }
h1 { font-size: 30px; margin: 0 0 8px; }
.meta { font-size: 18px; line-height: 1.6; margin-bottom: 16px; }
.meta b { font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 11px; text-transform: uppercase; text-align: center; border: 2px solid #111; padding: 6px 4px; background: #f1f1f1; }
td { border: 2px solid #111; padding: 8px 10px; vertical-align: middle; }
tr { page-break-inside: avoid; }
.num { width: 36px; text-align: center; font-weight: 700; font-size: 18px; }
.nm { font-size: 19px; font-weight: 700; }
.ds { font-size: 14px; margin-top: 3px; color: #333; }
.qty { width: 60px; text-align: center; font-size: 22px; font-weight: 700; }
.chk { width: 82px; text-align: center; }
.box { width: 34px; height: 34px; border: 3px solid #111; border-radius: 6px; margin: 0 auto; font-size: 26px; line-height: 30px; font-weight: 700; background: #fff; }
.who { font-size: 10px; margin-top: 3px; }
.sign { margin-top: 26px; font-size: 17px; }
</style></head><body>
<h1>Список активов</h1>
<div class="meta">Проект: <b>${esc(pdf.project || '—')}</b><br>Сроки: <b>${esc(period)}</b><br>Ответственный менеджер: <b>${esc(pdf.manager || '—')}</b></div>
<table><thead><tr><th>№</th><th style="text-align:left">Позиция</th><th>Кол-во</th>${CHECKS.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
<div class="sign">Принял: ______________________ &nbsp;&nbsp; Дата: ______________</div>
</body></html>`
  }, [items, picked, pdf, catById])

  const openPdfModal = () => {
    setPdf((p) => ({ ...p, manager: p.manager || user?.name || '' }))
    setPdfModal(true)
  }

  const printPdf = async () => {
    if (!pdf.project.trim()) { setError('Укажите название проекта — он попадёт в Архив'); return }
    {
      try {
        await api.post('event-assets/usages', {
          project_name: pdf.project,
          date_from: pdf.from || null,
          date_to: pdf.to || null,
          manager_name: pdf.manager || null,
          items: pickedIds.map((id) => ({ asset_id: id, quantity: picked[id], rental_cost: items.find((x) => x.id === id)?.price ?? null })),
        })
        await load()
      } catch (e) {
        setError(errMsg(e, 'Не удалось записать проект в архив'))
      }
    }
    const frame = document.getElementById('asset-pdf-frame') as HTMLIFrameElement | null
    frame?.contentWindow?.focus()
    frame?.contentWindow?.print()
  }

  const openShare = async () => {
    setShareOpen(true)
    try {
      const [u, a] = await Promise.all([api.get('users'), api.get<{ user_ids: number[] }>('event-assets/access')])
      setStaff((u.data as typeof staff).filter((x) => x.is_active !== false && x.role !== 'admin'))
      setShared(a.data.user_ids)
    } catch (e) {
      setError(errMsg(e, 'Не удалось загрузить пользователей'))
    }
  }

  const saveShare = async () => {
    setShareBusy(true)
    try {
      await api.put('event-assets/access', { user_ids: shared })
      setShareOpen(false)
    } catch (e) {
      setError(errMsg(e, 'Не удалось сохранить доступ'))
    } finally {
      setShareBusy(false)
    }
  }

  const loadArchive = useCallback(async () => {
    try {
      const r = await api.get<ArchiveProject[]>('event-assets/archive')
      setArchive(r.data)
    } catch (e) {
      setError(errMsg(e, 'Не удалось загрузить архив'))
    }
  }, [])

  useEffect(() => { if (view === 'archive') void loadArchive() }, [view, loadArchive])

  const saveCost = async (usageId: number, raw: string) => {
    const t = raw.replace(/\s/g, '').replace(',', '.')
    const val = t === '' ? null : Number(t)
    if (val !== null && Number.isNaN(val)) return
    try {
      await api.patch(`event-assets/usages/${usageId}`, val === null ? { clear_cost: true } : { rental_cost: val })
      await loadArchive()
    } catch (e) {
      setError(errMsg(e, 'Не удалось сохранить стоимость'))
    }
  }

  const removeArchiveProject = async () => {
    if (!delProject) return
    try {
      await api.delete(`event-assets/archive/${delProject.key}`)
      setDelProject(null)
      await loadArchive()
    } catch (e) {
      setError(errMsg(e, 'Не удалось удалить проект'))
      setDelProject(null)
    }
  }

  const colorOf = (i: EventAsset) => catById.get(i.category_id ?? -1)?.color ?? '#ffffff'

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <BtnPrimary onClick={() => { setFormErr(''); setEditor({ name: '', description: '', quantity: '1', category_id: '', added_on: today(), price: '', photo: null, removePhoto: false, hadPhoto: false }) }}>+ Добавить актив</BtnPrimary>
        <BtnOutline onClick={() => setCatModal(true)}>Категории</BtnOutline>
        {user?.role === 'admin' && <BtnOutline onClick={() => void openShare()}>👥 Поделиться</BtnOutline>}
        <BtnOutline
          onClick={() => setView(view === 'archive' ? 'items' : 'archive')}
          style={view === 'archive' ? { borderColor: '#1a6b3c', background: '#e8f5ee', color: '#1a6b3c' } : undefined}
        >
          🗄️ Архив
        </BtnOutline>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию, описанию…" style={{ maxWidth: 320 }} />
        <span style={{ fontSize: 13, color: '#8a8fa8' }}>{visible.length} поз.</span>
        {view === 'items' && pickedIds.length > 0 && (
          <BtnPrimary onClick={openPdfModal} style={{ marginLeft: 'auto', background: '#0f4c81' }}>
            🖨️ Оформить PDF ({pickedIds.length})
          </BtnPrimary>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {([{ id: 'all' as const, name: 'Все', color: '#ffffff' }, ...cats]).map((c) => {
          const on = view === 'items' && catFilter === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => { setView('items'); setCatFilter(c.id) }}
              style={{ padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: c.color, border: on ? '2px solid #1a6b3c' : '1px solid #d6dae5', color: '#1a1d23' }}
            >
              {c.name}
            </button>
          )
        })}
      </div>

      {error && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {view === 'archive' ? (
        <ArchiveView
          projects={archive}
          openKey={openKey}
          onToggle={(k) => setOpenKey((cur) => (cur === k ? null : k))}
          onCost={saveCost}
          onDelete={setDelProject}
        />
      ) : (
      <Card>
        {loading ? (
          <Empty text="Загрузка…" />
        ) : visible.length === 0 ? (
          <Empty text="Пока нет позиций. Добавьте стойку, оборудование — с описанием и количеством." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Позиция</th>
                  <th style={th}>Категория</th>
                  <th style={th}>Кол-во</th>
                  <th style={{ ...th, color: '#1a6b3c' }}>Взять в проект</th>
                  <th style={th}>Добавлено</th>
                  <th style={th}>Цена</th>
                  {CHECKS.map((c) => <th key={c.key} style={{ ...th, textAlign: 'center' }}>{c.label}</th>)}
                  <th style={th} />
                  <th style={{ ...th, textAlign: 'center' }}>
                    <input type="checkbox" style={bigBox} checked={allVisiblePicked} onChange={toggleAllVisible} title="Выбрать все" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id} style={{ background: colorOf(i) }}>
                    <td style={{ ...td, minWidth: 280 }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        {i.has_photo && (
                          <button type="button" onClick={() => setLightbox(i)} style={{ border: 'none', padding: 0, background: 'transparent', cursor: 'zoom-in', flexShrink: 0 }} title="Открыть фото">
                            <AssetThumb assetId={i.id} size={56} />
                          </button>
                        )}
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{i.name}</div>
                          {i.description && <div style={{ color: '#475569', marginTop: 3, whiteSpace: 'pre-wrap' }}>{i.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={td}>{catById.get(i.category_id ?? -1)?.name ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
                    <td style={td}><InlineInt value={i.quantity} onSave={(n) => void saveQuantity(i, n)} /></td>
                    <td style={td}><QtyStepper value={picked[i.id] ?? 0} max={i.quantity} onChange={(n) => setPickQty(i, n)} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#475569' }}>{i.added_on ? fmtDay(i.added_on) : '—'}</td>
                    <td style={td}><InlineMoney value={i.price} onSave={(v) => void saveField(i, 'price', v)} /></td>
                    {CHECKS.map((c) => {
                      const st = i[c.key]
                      return (
                        <td key={c.key} style={{ ...td, textAlign: 'center' }}>
                          <input type="checkbox" style={bigBox} checked={!!st?.by} onChange={() => void toggleCheck(i, c.key)} />
                          {st?.by && <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>{st.by}<br />{fmtAt(st.at)}</div>}
                        </td>
                      )
                    })}
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button type="button" title="Изменить" style={iconBtn} onClick={() => { setFormErr(''); setEditor({ id: i.id, name: i.name, description: i.description ?? '', quantity: String(i.quantity), category_id: i.category_id ? String(i.category_id) : '', added_on: i.added_on ?? today(), price: i.price != null ? String(i.price) : '', photo: null, removePhoto: false, hadPhoto: !!i.has_photo }) }}>✏️</button>
                      <button type="button" title="Удалить" style={iconBtn} onClick={() => setDelItem(i)}>🗑️</button>
                    </td>
                    <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <input type="checkbox" style={bigBox} checked={i.id in picked} onChange={() => togglePick(i)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? 'Изменить актив' : 'Новый актив'}
        footer={<><BtnOutline onClick={() => setEditor(null)}>Отмена</BtnOutline><BtnPrimary onClick={() => void saveItem()} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</BtnPrimary></>}
      >
        {formErr && <div style={{ background: '#fef0f0', color: '#e84040', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>{formErr}</div>}
        {editor && (
          <>
            <Field label="Название *">
              <Input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="Например: Стойка ресепшн" />
            </Field>
            <Field label="Описание">
              <textarea
                value={editor.description}
                onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                rows={4}
                placeholder="Размер, комплектация, состояние…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, border: '1px solid #d6dae5', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
              />
            </Field>
            <Field label="Дата попадания в систему">
              <DatePicker value={editor.added_on} onChange={(v) => setEditor({ ...editor, added_on: v })} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <Field label="Количество">
                <Input type="number" min={1} value={editor.quantity} onChange={(e) => setEditor({ ...editor, quantity: e.target.value })} />
              </Field>
              <Field label="Категория">
                <select
                  value={editor.category_id}
                  onChange={(e) => setEditor({ ...editor, category_id: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #d6dae5', fontSize: 14, fontFamily: 'inherit', background: '#fff' }}
                >
                  <option value="">— без категории (белая) —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Цена">
              <MoneyInput value={editor.price} onChange={(v) => setEditor({ ...editor, price: v })} placeholder="0" />
            </Field>
            <p style={{ fontSize: 11, color: '#64748b', margin: '-6px 0 12px' }}>Цена и фото — только для внутреннего учёта, в PDF не попадают.</p>
            <Field label="Фото">
              {editor.id && editor.hadPhoto && !editor.removePhoto && !editor.photo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 72, height: 72 }}><AssetThumb assetId={editor.id} size={72} /></div>
                  <BtnOutline onClick={() => setEditor({ ...editor, removePhoto: true })}>Удалить фото</BtnOutline>
                </div>
              )}
              {editor.photo && (
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>Выбрано: {editor.photo.name}</div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEditor({ ...editor, photo: e.target.files?.[0] ?? null, removePhoto: false })}
                style={{ fontSize: 13 }}
              />
            </Field>
          </>
        )}
      </Modal>

      <Modal open={catModal} onClose={() => setCatModal(false)} title="Категории активов" footer={<BtnOutline onClick={() => setCatModal(false)}>Закрыть</BtnOutline>}>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>По умолчанию цвет белый. Цвет категории подсвечивает строки в списке и в PDF.</p>
        {cats.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input type="color" value={c.color} onChange={(e) => void patchCategory(c, { color: e.target.value })} style={{ width: 36, height: 36, padding: 0, border: '1px solid #d6dae5', borderRadius: 8, cursor: 'pointer' }} />
            <Input defaultValue={c.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.name) void patchCategory(c, { name: e.target.value.trim() }) }} />
            <button type="button" style={iconBtn} title="Удалить" onClick={() => void removeCategory(c)}>🗑️</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid #eef0f5' }}>
          <input type="color" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} style={{ width: 36, height: 36, padding: 0, border: '1px solid #d6dae5', borderRadius: 8, cursor: 'pointer' }} />
          <Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} placeholder="Новая категория" onKeyDown={(e) => { if (e.key === 'Enter') void addCategory() }} />
          <BtnPrimary onClick={() => void addCategory()}>Добавить</BtnPrimary>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {PALETTE.map((p) => (
            <button key={p} type="button" onClick={() => setNewCat({ ...newCat, color: p })} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #cbd5e1', background: p, cursor: 'pointer' }} title={p} />
          ))}
        </div>
      </Modal>

      <Modal
        open={pdfModal}
        onClose={() => setPdfModal(false)}
        title="Оформить PDF"
        width={960}
        footer={<><BtnOutline onClick={() => setPdfModal(false)}>Отмена</BtnOutline><BtnPrimary onClick={() => void printPdf()}>🖨️ Печать / сохранить PDF</BtnPrimary></>}
      >
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px', minWidth: 260 }}>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>Выбрано позиций: {pickedIds.length}. В окне печати выберите «Сохранить как PDF» или печатайте сразу.</p>
            <Field label="Название проекта">
              <Input value={pdf.project} onChange={(e) => setPdf({ ...pdf, project: e.target.value })} placeholder="Например: Ивент Tashkent Expo" />
            </Field>
            <Field label="Ответственный менеджер">
              <Input value={pdf.manager} onChange={(e) => setPdf({ ...pdf, manager: e.target.value })} placeholder="Имя менеджера" />
            </Field>
            <Field label="Сроки: с"><DatePicker value={pdf.from} onChange={(v) => setPdf({ ...pdf, from: v })} /></Field>
            <Field label="по"><DatePicker value={pdf.to} onChange={(v) => setPdf({ ...pdf, to: v })} /></Field>
            <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>После печати проект попадёт в «Архив», где можно вписать цену аренды по каждой позиции. В PDF цен нет.</p>
          </div>
          <div style={{ flex: '0 0 auto', width: 520 * 0.8, maxWidth: '100%' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', marginBottom: 6 }}>Предпросмотр · A4 вертикально</div>
            <div style={{ width: 794 * 0.52, height: 1123 * 0.52, border: '1px solid #d6dae5', boxShadow: '0 4px 16px rgba(0,0,0,.1)', overflow: 'hidden', background: '#fff' }}>
              <iframe
                id="asset-pdf-frame"
                title="Предпросмотр PDF"
                srcDoc={pdfHtml}
                style={{ width: 794, height: 1123, border: 'none', transform: 'scale(0.52)', transformOrigin: 'top left' }}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Кому открыт раздел «Активы»"
        width={520}
        footer={<><BtnOutline onClick={() => setShareOpen(false)}>Отмена</BtnOutline><BtnPrimary onClick={() => void saveShare()} disabled={shareBusy}>{shareBusy ? 'Сохраняем…' : 'Сохранить'}</BtnPrimary></>}
      >
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>Отмеченные сотрудники увидят «Активы» в меню и смогут добавлять позиции, ставить отметки вывоза и оформлять PDF. Вы (админ) видите раздел всегда.</p>
        {staff.length === 0 && <Empty text="Нет сотрудников" />}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {staff.map((u) => (
            <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderTop: '1px solid #f1f2f6', cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 18, height: 18, accentColor: '#1a6b3c' }}
                checked={shared.includes(u.id)}
                onChange={() => setShared((l) => (l.includes(u.id) ? l.filter((x) => x !== u.id) : [...l, u.id]))}
              />
              <span style={{ fontWeight: 600 }}>{u.name}</span>
              <span style={{ fontSize: 12, color: '#8a8fa8' }}>{u.email}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <BtnOutline onClick={() => setShared(staff.map((x) => x.id))}>Выбрать всех</BtnOutline>
          <BtnOutline onClick={() => setShared([])}>Снять всех</BtnOutline>
        </div>
      </Modal>

      <Modal open={!!lightbox} onClose={() => setLightbox(null)} title={lightbox?.name ?? ''} width={720} footer={<BtnOutline onClick={() => setLightbox(null)}>Закрыть</BtnOutline>}>
        {lightbox && <div style={{ display: 'flex', justifyContent: 'center' }}><AssetThumb assetId={lightbox.id} size={640} contain /></div>}
      </Modal>
      <ConfirmModal
        open={!!delProject}
        onClose={() => setDelProject(null)}
        title="Удалить проект из архива?"
        message={delProject ? `«${delProject.project_name}» и цены аренды по нему будут удалены.` : ''}
        confirmLabel="Удалить"
        onConfirm={() => void removeArchiveProject()}
      />
      <ConfirmModal
        open={!!delItem}
        onClose={() => setDelItem(null)}
        title="Удалить актив?"
        message={delItem ? `«${delItem.name}» будет удалён без возможности восстановления.` : ''}
        confirmLabel="Удалить"
        onConfirm={() => void removeItem()}
      />
    </div>
  )
}

const iconBtn: CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, padding: 4 }

function ArchiveView({
  projects, openKey, onToggle, onCost, onDelete,
}: {
  projects: ArchiveProject[]
  openKey: string | null
  onToggle: (key: string) => void
  onCost: (usageId: number, raw: string) => void
  onDelete: (p: ArchiveProject) => void
}) {
  if (projects.length === 0) {
    return <Card><Empty text="Архив пуст. Проект появится здесь после «Оформить PDF»." /></Card>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {projects.map((p) => {
        const open = openKey === p.key
        return (
          <Card key={p.key}>
            <div
              onClick={() => onToggle(p.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}>▶</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{p.project_name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {p.date_from ? fmtDay(p.date_from) : '…'} — {p.date_to ? fmtDay(p.date_to) : '…'}
                  {p.manager_name ? ` · ${p.manager_name}` : ''} · позиций: {p.items.length}
                </div>
              </div>
              {p.total > 0 && <div style={{ fontWeight: 700 }}>{new Intl.NumberFormat('ru-RU').format(p.total)}</div>}
              <button type="button" title="Удалить проект" style={iconBtn} onClick={(e) => { e.stopPropagation(); onDelete(p) }}>🗑️</button>
            </div>
            {open && (
              <div style={{ borderTop: '1px solid #eef0f5', padding: '4px 18px 14px' }}>
                {p.items.map((it) => (
                  <div key={it.usage_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f4f5f9' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{it.asset_name} <span style={{ color: '#64748b', fontWeight: 500 }}>× {it.quantity}</span></div>
                      {it.description && <div style={{ fontSize: 12, color: '#64748b' }}>{it.description}</div>}
                    </div>
                    <RentInput item={it} onSave={(raw) => onCost(it.usage_id, raw)} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function AssetThumb({ assetId, size, contain }: { assetId: number; size: number; contain?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let dead = false
    api.get(`event-assets/${assetId}/photo`, { responseType: 'blob' })
      .then((r) => { if (!dead) { url = URL.createObjectURL(r.data); setSrc(url) } })
      .catch(() => { if (!dead) setSrc(null) })
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [assetId])
  return (
    <div style={{ width: contain ? '100%' : size, maxWidth: size, height: contain ? 'auto' : size, borderRadius: 10, overflow: 'hidden', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: contain ? 'auto' : '100%', maxHeight: contain ? 520 : undefined, objectFit: contain ? 'contain' : 'cover', display: 'block' }} />}
    </div>
  )
}

/** Цена аренды по факту. При наведении на пустое поле подставляется рыночная цена — её можно заменить своей. */
function RentInput({ item, onSave }: { item: ArchiveItem; onSave: (raw: string) => void }) {
  const saved = item.rental_cost != null ? String(item.rental_cost) : ''
  const [val, setVal] = useState(saved)
  const [suggest, setSuggest] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => { setVal(saved); setSuggest(false) }, [saved])
  const market = item.market_rent != null ? String(item.market_rent) : ''
  return (
    <input
      value={val}
      placeholder="Цена аренды"
      inputMode="decimal"
      title={market ? `Рыночная цена аренды: ${new Intl.NumberFormat('ru-RU').format(item.market_rent as number)}` : undefined}
      onMouseEnter={() => { if (!focused && !val && market) { setVal(market); setSuggest(true) } }}
      onMouseLeave={() => { if (!focused && suggest) { setVal(''); setSuggest(false) } }}
      onFocus={() => { setFocused(true); setSuggest(false) }}
      onChange={(e) => { setVal(e.target.value); setSuggest(false) }}
      onBlur={() => { setFocused(false); if (val !== saved) onSave(val) }}
      style={{ width: 150, padding: '7px 10px', borderRadius: 8, border: '1px solid #d6dae5', fontSize: 14, fontFamily: 'inherit', textAlign: 'right', color: suggest ? '#94a3b8' : '#1a1d23', fontStyle: suggest ? 'italic' : 'normal' }}
    />
  )
}

const moneyFmt = new Intl.NumberFormat('ru-RU')

/** Число в таблице: при наведении превращается в поле, сохраняется при уходе курсора/фокуса. */
function InlineMoney({ value, onSave }: { value?: number | null; onSave: (raw: string) => void }) {
  const saved = value != null ? String(value) : ''
  const [val, setVal] = useState(saved)
  const [focused, setFocused] = useState(false)
  const [hover, setHover] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setVal(saved) }, [saved])
  useEffect(() => { if (focused) ref.current?.select() }, [focused])
  const shown = focused ? val : val !== '' && !Number.isNaN(Number(val)) ? moneyFmt.format(Number(val)) : val
  return (
    <input
      ref={ref}
      value={shown}
      placeholder="—"
      inputMode="decimal"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { setFocused(false); if (val.replace(/\s/g, '') !== saved) onSave(val) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 112, padding: '6px 8px', borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
        border: focused || hover ? '1px solid #cbd5e1' : '1px solid transparent',
        background: focused || hover ? '#fff' : 'transparent',
        color: '#1a1d23', outline: 'none',
      }}
      title="Нажмите, чтобы изменить"
    />
  )
}

/** Остаток на складе: число правится прямо в таблице (по клику), сохраняется при уходе из поля. */
function InlineInt({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [val, setVal] = useState(String(value))
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { setVal(String(value)) }, [value])
  useEffect(() => { if (focused) ref.current?.select() }, [focused])
  return (
    <input
      ref={ref}
      value={val}
      inputMode="numeric"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))}
      onBlur={() => { setFocused(false); const n = parseInt(val, 10); if (!n || n < 1) setVal(String(value)); else onSave(n) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      style={{
        width: 56, padding: '6px 8px', borderRadius: 8, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', textAlign: 'center',
        border: focused || hover ? '1px solid #cbd5e1' : '1px solid transparent',
        background: focused || hover ? '#fff' : 'transparent', color: '#1a1d23', outline: 'none',
      }}
      title="Сколько всего штук (нажмите, чтобы изменить)"
    />
  )
}

/** Сколько взять в проект: − / + и ручной ввод; выше остатка не уходит. */
function QtyStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const btn: CSSProperties = {
    width: 30, height: 30, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer',
    fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: 'inherit', color: '#1a1d23', flexShrink: 0,
  }
  const atMax = value >= max
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button type="button" style={{ ...btn, opacity: value <= 0 ? 0.4 : 1 }} disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label="Меньше">−</button>
      <input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
        onFocus={(e) => e.target.select()}
        style={{
          width: 44, height: 30, textAlign: 'center', borderRadius: 8, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', outline: 'none',
          border: value > 0 ? '1px solid #1a6b3c' : '1px dashed #94a3b8', background: value > 0 ? '#e8f5ee' : 'rgba(255,255,255,.7)',
        }}
      />
      <button type="button" style={{ ...btn, opacity: atMax ? 0.4 : 1, cursor: atMax ? 'not-allowed' : 'pointer' }} disabled={atMax} onClick={() => onChange(value + 1)} aria-label="Больше" title={atMax ? `Максимум ${max} шт.` : undefined}>+</button>
      <span style={{ fontSize: 11, color: atMax ? '#b45309' : '#94a3b8', whiteSpace: 'nowrap' }}>из {max}</span>
    </div>
  )
}
