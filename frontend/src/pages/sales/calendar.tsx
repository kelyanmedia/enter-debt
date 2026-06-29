import { useCallback, useEffect, useMemo, useState } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { hasCrmPipelineAccess } from '@/lib/salesAccess'

type ViewMode = 'day' | 'week' | 'month'

type ServiceType = { key: string; label: string; bg: string; border: string; accent: string }
type SalesUser = { id: number; name: string; role: string }
type SalesCompany = { id: number; company_name: string; contact_name?: string | null }

type Meeting = {
  id: number
  contact_name: string
  company_name: string
  sales_company_id: number | null
  sale_deal_id: number | null
  service_type: string
  service_label: string
  service_bg: string
  service_border: string
  service_accent: string
  starts_at: string
  duration_minutes: number
  notes: string | null
  created_by_user_id: number | null
  created_by_user_name: string | null
  participants: { id: number; name: string }[]
}

const START_HOUR = 8
const END_HOUR = 20
const HOUR_HEIGHT = 64

// ── helpers ─────────────────────────────────────────────────────────────────
function startOfWeek(d: Date) {
  const x = new Date(d)
  const day = x.getDay()
  const diff = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function addDays(d: Date, n: number) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

function fmtDate(d: Date) { return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) }
function fmtMonthYear(d: Date) { return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) }
function fmtTime(d: Date) { return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }
function toIsoLocal(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}
function isSameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString() }
function avatarColor(name: string) {
  const hues = ['#3b82f6','#8b5cf6','#ec4899','#f97316','#22c55e','#06b6d4']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % hues.length
  return hues[h]
}
function initials(name: string) {
  return name.split(/\s+/).slice(0,2).map(p => p[0]?.toUpperCase()||'').join('')
}

// ── Avatar ──────────────────────────────────────────────────────────────────
function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(name),
      color: '#fff', fontSize: size * 0.38, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '2px solid #fff', flexShrink: 0,
    }}>
      {initials(name)}
    </div>
  )
}

// ── MeetingCard (time-grid) ─────────────────────────────────────────────────
function MeetingCard({ meeting, colCount = 1, onClick }: { meeting: Meeting; colCount?: number; onClick: () => void }) {
  const start = new Date(meeting.starts_at)
  const topMin = (start.getHours() - START_HOUR) * 60 + start.getMinutes()
  const top = (topMin / 60) * HOUR_HEIGHT
  const height = Math.max((meeting.duration_minutes / 60) * HOUR_HEIGHT - 4, 48)
  const faces = [
    ...(meeting.created_by_user_name ? [{ id: -1, name: meeting.created_by_user_name }] : []),
    ...meeting.participants.filter(p => p.name !== meeting.created_by_user_name),
  ].slice(0, 3)
  const compact = height < 56 || colCount > 3

  return (
    <button type="button" onClick={onClick} style={{
      position: 'absolute', left: 4, right: 4, top, height,
      border: 'none', borderRadius: 10,
      background: meeting.service_bg, borderLeft: `3px solid ${meeting.service_border}`,
      boxShadow: '0 2px 8px rgba(15,23,42,.08)',
      padding: compact ? '4px 8px' : '7px 10px',
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      overflow: 'hidden', display: 'flex', flexDirection: 'column', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex' }}>
          {faces.map((f, i) => <div key={`${f.id}-${i}`} style={{ marginLeft: i>0 ? -7 : 0 }}><Avatar name={f.name} size={18} /></div>)}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {meeting.contact_name}
        </span>
        <span style={{ fontSize: 10, color: '#64748b', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {fmtTime(start)}
        </span>
      </div>
      {!compact && (
        <div style={{ fontSize: 11, color: '#334155', fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {meeting.company_name}
        </div>
      )}
    </button>
  )
}

// ── TimeGrid (shared by Day + Week views) ───────────────────────────────────
function TimeGrid({
  days, meetings, now, openCreate, openEdit,
}: {
  days: Date[]
  meetings: Meeting[]
  now: Date
  openCreate: (day: Date, hour: number) => void
  openEdit: (m: Meeting) => void
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT
  const meetingsByDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const d of days) map.set(d.toDateString(), [])
    for (const m of meetings) {
      const key = new Date(m.starts_at).toDateString()
      if (map.has(key)) map.get(key)!.push(m)
    }
    return map
  }, [days, meetings])

  const nowInRange = days.some(d => isSameDay(d, now))
  const nowLineTop = (() => {
    const h = now.getHours(), mn = now.getMinutes()
    if (h < START_HOUR || h >= END_HOUR) return null
    return ((h - START_HOUR) * 60 + mn) / 60 * HOUR_HEIGHT
  })()

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8e9ef', boxShadow: '0 2px 12px rgba(15,23,42,.04)', overflow: 'hidden' }}>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, borderBottom: '1px solid #f1f5f9' }}>
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, now)
          return (
            <div key={i} style={{
              padding: '12px 6px', textAlign: 'center',
              borderLeft: '1px solid #f1f5f9',
              background: isToday ? 'rgba(220,38,38,.04)' : undefined,
            }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
              </div>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', margin: '4px auto 0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isToday ? '#dc2626' : 'transparent',
                color: isToday ? '#fff' : '#0f172a',
                fontWeight: 800, fontSize: 16,
              }}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* Grid body */}
      <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, position: 'relative', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
        {nowInRange && nowLineTop !== null && (
          <>
            <div style={{ position: 'absolute', left: 52, right: 0, top: nowLineTop, borderTop: '2px solid #dc2626', zIndex: 6, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 52, top: nowLineTop, transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%', background: '#dc2626', zIndex: 7, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 2, top: nowLineTop, transform: 'translateY(-50%)', background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 8, zIndex: 7, pointerEvents: 'none' }}>
              {fmtTime(now)}
            </div>
          </>
        )}

        {/* Time labels */}
        <div>
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT, fontSize: 10, color: '#94a3b8', fontWeight: 600, paddingRight: 6, textAlign: 'right', paddingTop: 4, boxSizing: 'border-box' }}>
              {String(h).padStart(2,'0')}:00
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day, ci) => {
          const dayMs = meetingsByDay.get(day.toDateString()) || []
          const isToday = isSameDay(day, now)
          return (
            <div key={ci} style={{ position: 'relative', borderLeft: '1px solid #f1f5f9', background: isToday ? 'rgba(220,38,38,.02)' : '#fff', height: gridHeight }}>
              {hours.map(h => (
                <div key={h} role="button" tabIndex={0}
                  onClick={() => openCreate(day, h)}
                  onKeyDown={e => e.key === 'Enter' && openCreate(day, h)}
                  style={{ height: HOUR_HEIGHT, borderBottom: '1px solid #f8fafc', cursor: 'pointer', position: 'relative' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fafbfc' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                />
              ))}
              {dayMs.map(m => <MeetingCard key={m.id} meeting={m} colCount={days.length} onClick={() => openEdit(m)} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── MonthView ───────────────────────────────────────────────────────────────
const WEEK_DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']

function MonthView({
  monthStart, meetings, now, openCreate, openEdit,
}: {
  monthStart: Date
  meetings: Meeting[]
  now: Date
  openCreate: (day: Date, hour: number) => void
  openEdit: (m: Meeting) => void
}) {
  const firstDay = (() => { const d = new Date(monthStart).getDay(); return d === 0 ? 6 : d - 1 })()
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()

  const cells: Array<Date | null> = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of meetings) {
      const key = new Date(m.starts_at).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return map
  }, [meetings])

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8e9ef', boxShadow: '0 2px 12px rgba(15,23,42,.04)', overflow: 'hidden' }}>
      {/* Weekday headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '2px solid #f1f5f9' }}>
        {WEEK_DAYS.map(d => (
          <div key={d} style={{ padding: '12px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} style={{ minHeight: 110, borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', background: '#fafbfc' }} />
          const isToday = isSameDay(date, now)
          const dayMs = meetingsByDay.get(date.toDateString()) || []
          const isWeekend = date.getDay() === 0 || date.getDay() === 6
          return (
            <div key={i}
              onClick={() => openCreate(date, 10)}
              style={{
                minHeight: 110, padding: '8px 6px',
                borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                cursor: 'pointer', background: isToday ? 'rgba(220,38,38,.04)' : isWeekend ? '#fbfbfd' : '#fff',
                transition: 'background .1s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isToday) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = isToday ? 'rgba(220,38,38,.04)' : isWeekend ? '#fbfbfd' : '#fff' }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isToday ? '#dc2626' : 'transparent',
                color: isToday ? '#fff' : isWeekend ? '#94a3b8' : '#0f172a',
                fontWeight: isToday ? 800 : 600, fontSize: 13, marginBottom: 4,
              }}>{date.getDate()}</div>

              {/* Meeting chips */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayMs.slice(0, 3).map(m => (
                  <button key={m.id} type="button"
                    onClick={e => { e.stopPropagation(); openEdit(m) }}
                    style={{
                      border: 'none', borderRadius: 5, padding: '3px 7px',
                      background: m.service_bg, borderLeft: `3px solid ${m.service_border}`,
                      fontSize: 11, fontWeight: 600, color: '#0f172a',
                      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      width: '100%',
                    }}>
                    {fmtTime(new Date(m.starts_at))} {m.contact_name}
                  </button>
                ))}
                {dayMs.length > 3 && (
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, paddingLeft: 4 }}>
                    +{dayMs.length - 3} ещё
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Form & Page ─────────────────────────────────────────────────────────────
type FormState = {
  contact_name: string
  company_name: string
  sales_company_id: number | ''
  service_type: string
  starts_at: string
  duration_minutes: number
  notes: string
  participant_user_ids: number[]
}

export default function SalesCalendarPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))   // week/day/month anchor
  const [now, setNow] = useState(() => new Date())

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [users, setUsers] = useState<SalesUser[]>([])
  const [companies, setCompanies] = useState<SalesCompany[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [saving, setSaving] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [companyDropOpen, setCompanyDropOpen] = useState(false)
  const [form, setForm] = useState<FormState>({
    contact_name: '', company_name: '', sales_company_id: '',
    service_type: 'discovery', starts_at: '', duration_minutes: 60,
    notes: '', participant_user_ids: [],
  })

  const canAccess = hasCrmPipelineAccess(user)

  // Derive displayed days based on view
  const { days, rangeFrom, rangeTo, title } = useMemo(() => {
    if (view === 'day') {
      const d = startOfDay(anchor)
      return {
        days: [d],
        rangeFrom: d,
        rangeTo: addDays(d, 1),
        title: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
      }
    }
    if (view === 'week') {
      const ws = startOfWeek(anchor)
      const we = addDays(ws, 7)
      return {
        days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)),
        rangeFrom: ws,
        rangeTo: we,
        title: `${fmtDate(ws)} — ${fmtDate(addDays(ws, 6))}`,
      }
    }
    // month
    const ms = startOfMonth(anchor)
    const me = addMonths(ms, 1)
    return {
      days: [],
      rangeFrom: ms,
      rangeTo: me,
      title: ms.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    }
  }, [view, anchor])

  const navigate = (dir: -1 | 1) => {
    if (view === 'day') setAnchor(addDays(anchor, dir))
    else if (view === 'week') setAnchor(addDays(anchor, dir * 7))
    else setAnchor(addMonths(anchor, dir))
  }
  const goToday = () => {
    const t = new Date()
    if (view === 'day') setAnchor(startOfDay(t))
    else if (view === 'week') setAnchor(startOfWeek(t))
    else setAnchor(startOfMonth(t))
  }
  const switchView = (v: ViewMode) => {
    const t = new Date()
    setView(v)
    if (v === 'day') setAnchor(startOfDay(t))
    else if (v === 'week') setAnchor(startOfWeek(t))
    else setAnchor(startOfMonth(t))
  }

  const load = useCallback(async () => {
    try {
      const [mRes, sRes, uRes, cRes] = await Promise.all([
        api.get<Meeting[]>('sales/calendar/meetings', { params: { date_from: rangeFrom.toISOString(), date_to: rangeTo.toISOString() } }),
        api.get<ServiceType[]>('sales/calendar/service-types'),
        api.get<SalesUser[]>('sales/users-list'),
        api.get<SalesCompany[]>(`sales/companies?scope=${user?.role === 'admin' ? 'all' : 'mine'}`),
      ])
      setMeetings(mRes.data)
      setServiceTypes(sRes.data)
      setUsers(uRes.data)
      setCompanies(cRes.data)
    } catch { setMeetings([]) }
  }, [rangeFrom, rangeTo, user?.role])

  useEffect(() => { if (!loading && user && !canAccess) void router.replace('/') }, [loading, user, canAccess, router])
  useEffect(() => { if (canAccess) void load() }, [canAccess, load])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])

  const openCreate = (day: Date, hour: number) => {
    const dt = new Date(day); dt.setHours(hour, 0, 0, 0)
    setEditing(null)
    setForm({ contact_name: '', company_name: '', sales_company_id: '', service_type: 'discovery', starts_at: toIsoLocal(dt), duration_minutes: 60, notes: '', participant_user_ids: user ? [user.id] : [] })
    setCompanySearch(''); setCompanyDropOpen(false)
    setModalOpen(true)
  }
  const openEdit = (m: Meeting) => {
    setEditing(m)
    const dt = new Date(m.starts_at)
    setForm({ contact_name: m.contact_name, company_name: m.company_name, sales_company_id: m.sales_company_id ?? '', service_type: m.service_type, starts_at: toIsoLocal(dt), duration_minutes: m.duration_minutes, notes: m.notes || '', participant_user_ids: m.participants.map(p => p.id) })
    setCompanySearch(''); setCompanyDropOpen(false)
    setModalOpen(true)
  }
  const onCompanyPick = (id: number | '') => {
    if (id === '') { setForm(f => ({ ...f, sales_company_id: '', company_name: '' })); return }
    const co = companies.find(c => c.id === id)
    setForm(f => ({ ...f, sales_company_id: id, company_name: co?.company_name || '', contact_name: f.contact_name || co?.contact_name || '' }))
  }
  const saveMeeting = async () => {
    if (!form.contact_name.trim()) return
    if (form.sales_company_id === '' && !form.company_name.trim()) return
    setSaving(true)
    try {
      const payload = {
        contact_name: form.contact_name.trim(),
        company_name: form.company_name.trim(),
        sales_company_id: form.sales_company_id === '' ? null : Number(form.sales_company_id),
        service_type: form.service_type,
        starts_at: new Date(form.starts_at).toISOString(),
        duration_minutes: form.duration_minutes,
        notes: form.notes || null,
        participant_user_ids: form.participant_user_ids,
      }
      if (editing) await api.patch(`sales/calendar/meetings/${editing.id}`, payload)
      else await api.post('sales/calendar/meetings', payload)
      setModalOpen(false)
      await load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      window.alert(typeof msg === 'string' ? msg : 'Не удалось сохранить встречу')
    } finally { setSaving(false) }
  }
  const deleteMeeting = async () => {
    if (!editing) return
    setSaving(true)
    try { await api.delete(`sales/calendar/meetings/${editing.id}`); setModalOpen(false); await load() }
    finally { setSaving(false) }
  }
  const toggleParticipant = (uid: number) => setForm(f => ({ ...f, participant_user_ids: f.participant_user_ids.includes(uid) ? f.participant_user_ids.filter(x => x !== uid) : [...f.participant_user_ids, uid] }))

  if (loading || !user || !canAccess) return null

  return (
    <Layout>
      <div style={{ minHeight: '100%', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e8e9ef', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          {/* Title */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Продажи / Календарь</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginTop: 2, textTransform: 'capitalize' }}>{title}</div>
          </div>

          {/* View switcher */}
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 3, gap: 2 }}>
            {(['day','week','month'] as ViewMode[]).map(v => (
              <button key={v} type="button" onClick={() => switchView(v)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
                background: view === v ? '#fff' : 'transparent',
                color: view === v ? '#0f172a' : '#64748b',
                boxShadow: view === v ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s',
              }}>
                {v === 'day' ? 'День' : v === 'week' ? 'Неделя' : 'Месяц'}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <button type="button" onClick={() => navigate(-1)} style={navBtn}>‹</button>
            <button type="button" onClick={goToday} style={{ ...navBtn, padding: '8px 14px', fontWeight: 600, fontSize: 12 }}>Сегодня</button>
            <button type="button" onClick={() => navigate(1)} style={navBtn}>›</button>
          </div>

          {/* New meeting */}
          <button type="button" onClick={() => openCreate(now, 10)} style={{
            padding: '9px 18px', borderRadius: 10, border: 'none', background: '#0f172a', color: '#fff',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>
            + Новая встреча
          </button>
        </div>

        {/* ─── Calendar body ───────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 28px' }}>
          {view === 'month'
            ? <MonthView monthStart={anchor} meetings={meetings} now={now} openCreate={openCreate} openEdit={openEdit} />
            : <TimeGrid days={days} meetings={meetings} now={now} openCreate={openCreate} openEdit={openEdit} />
          }

          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {serviceTypes.map(s => (
              <span key={s.key} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 600, color: '#475569',
                background: '#fff', padding: '5px 11px', borderRadius: 20,
                border: `1px solid ${s.border}`,
              }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: s.bg, border: `2px solid ${s.border}` }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* ─── Modal ───────────────────────────────────────────────────────── */}
        {modalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => !saving && setModalOpen(false)}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.2)', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 16 }}>
                {editing ? 'Редактировать встречу' : 'Новая встреча'}
              </div>

              {/* Company picker with search */}
              <label style={lbl}>Компания из базы</label>
              <div style={{ position: 'relative', marginBottom: 2 }}>
                <div style={{ ...inp, display: 'flex', alignItems: 'center', gap: 6, cursor: 'text', padding: 0, overflow: 'hidden', borderColor: companyDropOpen ? '#2563eb' : undefined, boxShadow: companyDropOpen ? '0 0 0 3px rgba(37,99,235,.12)' : undefined }}
                  onClick={() => setCompanyDropOpen(true)}>
                  <input
                    value={companyDropOpen ? companySearch : (form.sales_company_id ? companies.find(c => c.id === form.sales_company_id)?.company_name ?? '' : '')}
                    onChange={e => { setCompanySearch(e.target.value); setCompanyDropOpen(true) }}
                    onFocus={() => { setCompanySearch(''); setCompanyDropOpen(true) }}
                    onBlur={() => setTimeout(() => setCompanyDropOpen(false), 150)}
                    placeholder="— Ввести вручную —"
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '10px 12px', fontSize: 14, color: '#0f172a', fontFamily: 'inherit' }}
                  />
                  {form.sales_company_id !== '' && <button type="button" onMouseDown={e => { e.preventDefault(); onCompanyPick(''); setCompanySearch('') }} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 10px', color: '#94a3b8', fontSize: 16 }}>×</button>}
                  {form.sales_company_id === '' && <span style={{ padding: '0 10px', color: '#94a3b8', fontSize: 12, pointerEvents: 'none' }}>▾</span>}
                </div>
                {companyDropOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', marginTop: 4, maxHeight: 200, overflowY: 'auto' }}>
                    <div onMouseDown={e => { e.preventDefault(); onCompanyPick(''); setCompanySearch(''); setCompanyDropOpen(false) }} style={{ padding: '9px 14px', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = '')}>— Ввести вручную —</div>
                    {companies.filter(c => !companySearch || c.company_name.toLowerCase().includes(companySearch.toLowerCase())).map(c => (
                      <div key={c.id} onMouseDown={e => { e.preventDefault(); onCompanyPick(c.id); setCompanySearch(''); setCompanyDropOpen(false) }}
                        style={{ padding: '9px 14px', fontSize: 14, color: '#0f172a', cursor: 'pointer', background: form.sales_company_id === c.id ? '#eff6ff' : undefined }}
                        onMouseEnter={e => { if (form.sales_company_id !== c.id) e.currentTarget.style.background = '#f8fafc' }}
                        onMouseLeave={e => { e.currentTarget.style.background = form.sales_company_id === c.id ? '#eff6ff' : '' }}>
                        {c.company_name}
                      </div>
                    ))}
                    {companySearch && companies.filter(c => c.company_name.toLowerCase().includes(companySearch.toLowerCase())).length === 0 && (
                      <div style={{ padding: '9px 14px', fontSize: 13, color: '#94a3b8' }}>Ничего не найдено</div>
                    )}
                  </div>
                )}
              </div>

              {form.sales_company_id === '' && (
                <>
                  <label style={lbl}>Название компании</label>
                  <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} style={inp} placeholder="ООО Пример" />
                </>
              )}

              <label style={lbl}>Контактное лицо</label>
              <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} style={inp} placeholder="Имя клиента" />

              <label style={lbl}>Услуга</label>
              <select value={form.service_type} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))} style={inp}>
                {serviceTypes.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Дата и время</label>
                  <DateTimePicker value={form.starts_at} onChange={v => setForm(f => ({ ...f, starts_at: v }))} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={lbl}>Длительность (мин)</label>
                  <input type="number" min={15} step={15} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))} style={inp} />
                </div>
              </div>

              <label style={lbl}>Участники</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {users.map(u => {
                  const on = form.participant_user_ids.includes(u.id)
                  return (
                    <button key={u.id} type="button" onClick={() => toggleParticipant(u.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 20, border: on ? '2px solid #1a6b3c' : '1px solid #e2e8f0', background: on ? '#e8f5ee' : '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
                      <Avatar name={u.name} size={22} />
                      {u.name}
                    </button>
                  )
                })}
              </div>

              <label style={lbl}>Заметка</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="button" onClick={() => void saveMeeting()} disabled={saving || !form.contact_name.trim() || (form.sales_company_id === '' && !form.company_name.trim())} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
                {editing && (
                  <button type="button" onClick={() => void deleteMeeting()} disabled={saving} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Удалить
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

const navBtn: React.CSSProperties = { padding: '8px 12px', border: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, color: '#475569' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: '.04em' }
const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }
