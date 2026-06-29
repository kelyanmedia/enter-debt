import { CSSProperties, useEffect, useRef, useState } from 'react'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

export function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseYMD(s: string): Date | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function formatRuDate(s: string): string {
  const d = parseYMD(s)
  if (!d) return ''
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} г.`
}

export function isDateInRange(dateStr: string, from: string, to: string): boolean {
  const d = dateStr.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate()
}

function firstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay()
  return d === 0 ? 6 : d - 1
}

const navBtn: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#475569',
  fontSize: 18,
  fontWeight: 800,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

export function DateRangePicker({
  from,
  to,
  onApply,
  size = 'default',
  align = 'right',
}: {
  from: string
  to: string
  onApply: (range: { from: string; to: string }) => void
  size?: 'default' | 'compact'
  align?: 'left' | 'right'
}) {
  const today = new Date()
  const fromDate = parseYMD(from)
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)
  const [view, setView] = useState({
    y: fromDate?.getFullYear() ?? today.getFullYear(),
    m: fromDate?.getMonth() ?? today.getMonth(),
  })
  const ref = useRef<HTMLDivElement>(null)

  const compact = size === 'compact'

  useEffect(() => {
    setDraftFrom(from)
    setDraftTo(to)
  }, [from, to])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function prevMonth() {
    setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })
  }

  function nextMonth() {
    setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })
  }

  function selectDate(dateStr: string) {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(dateStr)
      setDraftTo('')
      return
    }
    if (dateStr < draftFrom) {
      setDraftTo(draftFrom)
      setDraftFrom(dateStr)
      return
    }
    setDraftTo(dateStr)
  }

  function quickRange(days: number) {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - (days - 1))
    setDraftFrom(toYMD(start))
    setDraftTo(toYMD(end))
    setView({ y: start.getFullYear(), m: start.getMonth() })
  }

  function applyRange() {
    const nextFrom = draftFrom || toYMD(today)
    const nextTo = draftTo || draftFrom || toYMD(today)
    onApply(nextFrom <= nextTo ? { from: nextFrom, to: nextTo } : { from: nextTo, to: nextFrom })
    setOpen(false)
  }

  const { y, m } = view
  const cells: Array<{ day: number | null; date: Date | null }> = []
  for (let i = 0; i < firstDayOfMonth(y, m); i++) cells.push({ day: null, date: null })
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push({ day: d, date: new Date(y, m, d) })
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null })

  const todayStr = toYMD(today)
  const label = from && to && from !== to
    ? `${formatRuDate(from)} – ${formatRuDate(to)}`
    : formatRuDate(to || from)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          padding: compact ? '9px 14px' : '14px 20px',
          borderRadius: compact ? 10 : 16,
          border: open ? '2px solid #2563eb' : '1px solid #e2e8f0',
          background: '#fff',
          fontSize: compact ? 13 : 15,
          fontWeight: 800,
          color: '#475569',
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: open ? '0 0 0 4px rgba(37,99,235,.08)' : 'none',
          transition: 'border-color .15s, box-shadow .15s',
          whiteSpace: 'nowrap',
        }}
      >
        📅 {label}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 10px)',
          left: align === 'left' ? 0 : undefined,
          right: align === 'right' ? 0 : undefined,
          zIndex: 9999,
          width: 360,
          padding: 16,
          borderRadius: 18,
          background: '#fff',
          border: '1px solid #e8edf3',
          boxShadow: '0 18px 50px rgba(15,23,42,.18)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={{
              border: '1px solid #e2e8f0', borderRadius: 12, padding: '9px 12px',
              background: draftFrom && !draftTo ? '#eff6ff' : '#f8fafc',
            }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>От</div>
              <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 700, marginTop: 3 }}>
                {draftFrom ? formatRuDate(draftFrom) : 'Выберите дату'}
              </div>
            </div>
            <div style={{
              border: '1px solid #e2e8f0', borderRadius: 12, padding: '9px 12px',
              background: draftFrom && !draftTo ? '#fefce8' : '#f8fafc',
            }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>До</div>
              <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 700, marginTop: 3 }}>
                {draftTo ? formatRuDate(draftTo) : 'Выберите дату'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: '7 дней', days: 7 },
              { label: '30 дней', days: 30 },
              { label: '90 дней', days: 90 },
            ].map(x => (
              <button
                key={x.days}
                type="button"
                onClick={() => quickRange(x.days)}
                style={{
                  border: '1px solid #dbeafe',
                  background: '#eff6ff',
                  color: '#2563eb',
                  borderRadius: 999,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {x.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
              {MONTHS[m]} {y}
            </div>
            <button type="button" onClick={() => setView({ y: today.getFullYear(), m: today.getMonth() })} style={{
              ...navBtn, width: 'auto', padding: '0 10px', color: '#2563eb', fontSize: 12,
            }}>Сегодня</button>
            <button type="button" onClick={nextMonth} style={navBtn}>›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 5 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, color: '#94a3b8', padding: '4px 0' }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
            {cells.map((cell, i) => {
              if (!cell.day || !cell.date) return <div key={i} />
              const dateStr = toYMD(cell.date)
              const isStart = dateStr === draftFrom
              const isEnd = dateStr === draftTo
              const isInRange = Boolean(draftFrom && draftTo && dateStr > draftFrom && dateStr < draftTo)
              const isToday = dateStr === todayStr
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => selectDate(dateStr)}
                  style={{
                    aspectRatio: '1',
                    border: isToday && !isStart && !isEnd ? '1.5px solid #2563eb' : 'none',
                    borderRadius: isStart || isEnd ? 12 : 9,
                    background: isStart || isEnd ? '#2563eb' : isInRange ? '#dbeafe' : 'transparent',
                    color: isStart || isEnd ? '#fff' : isToday ? '#2563eb' : '#0f172a',
                    fontWeight: isStart || isEnd || isToday ? 800 : 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            <button type="button" onClick={() => { setDraftFrom(''); setDraftTo('') }} style={{
              background: 'transparent', border: 'none', color: '#64748b', fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', padding: '8px 4px',
            }}>
              Очистить
            </button>
            <button type="button" onClick={applyRange} style={{
              background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', border: 'none',
              borderRadius: 12, padding: '10px 22px', fontSize: 13, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 18px rgba(37,99,235,.25)',
            }}>
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function thisMonthRange(): { from: string; to: string } {
  const now = new Date()
  return {
    from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toYMD(now),
  }
}

export function previousMonthRange(): { from: string; to: string } {
  const now = new Date()
  return {
    from: toYMD(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: toYMD(new Date(now.getFullYear(), now.getMonth(), 0)),
  }
}
