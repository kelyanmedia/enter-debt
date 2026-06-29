/**
 * DateTimePicker — красивый кастомный выбор даты + времени.
 * value/onChange: строка формата "YYYY-MM-DDTHH:MM" (datetime-local)
 */
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

function parseLocal(s: string): { y: number; mo: number; d: number; h: number; min: number } | null {
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], min: +m[5] }
}

function toLocal(y: number, mo: number, d: number, h: number, min: number): string {
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function formatDisplay(s: string): string {
  const p = parseLocal(s)
  if (!p) return ''
  return `${p.d} ${MONTHS_GEN[p.mo]} ${p.y} г., ${String(p.h).padStart(2,'0')}:${String(p.min).padStart(2,'0')}`
}

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay()
  return d === 0 ? 6 : d - 1
}
function toYMD(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  style?: CSSProperties
  inputStyle?: CSSProperties
  allowClear?: boolean
  disabled?: boolean
}

export default function DateTimePicker({
  value,
  onChange,
  placeholder = 'Выберите дату и время',
  style,
  inputStyle,
  allowClear = true,
  disabled,
}: Props) {
  const now = new Date()
  const parsed = parseLocal(value)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ y: parsed?.y ?? now.getFullYear(), m: parsed?.mo ?? now.getMonth() })
  const [selDate, setSelDate] = useState<string>(value ? `${value.split('T')[0]}` : '')
  const [hour, setHour] = useState(parsed?.h ?? 10)
  const [minute, setMinute] = useState(parsed?.min ?? 0)
  const ref = useRef<HTMLDivElement>(null)
  const hourRef = useRef<HTMLDivElement>(null)
  const minRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = parseLocal(value)
    if (p) {
      setView({ y: p.y, m: p.mo })
      setSelDate(`${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`)
      setHour(p.h)
      setMinute(p.min)
    } else {
      setSelDate('')
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Scroll selected time into center
  useEffect(() => {
    if (!open) return
    setTimeout(() => {
      scrollToSelected(hourRef.current, hour)
      scrollToSelected(minRef.current, minute)
    }, 50)
  }, [open, hour, minute])

  function scrollToSelected(el: HTMLDivElement | null, val: number) {
    if (!el) return
    const item = el.querySelector(`[data-val="${val}"]`) as HTMLElement
    if (item) item.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function prevMonth() { setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }) }
  function nextMonth() { setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }) }

  const { y, m } = view
  const totalDays = daysInMonth(y, m)
  const firstDay = firstDayOfMonth(y, m)
  const cells: Array<{ day: number | null }> = []
  for (let i = 0; i < firstDay; i++) cells.push({ day: null })
  for (let d = 1; d <= totalDays; d++) cells.push({ day: d })
  while (cells.length % 7 !== 0) cells.push({ day: null })

  const todayYMD = toYMD(now.getFullYear(), now.getMonth(), now.getDate())
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = Array.from({ length: 60 }, (_, i) => i)

  function confirm() {
    if (!selDate) { setOpen(false); return }
    const [sy, smo, sd] = selDate.split('-').map(Number)
    onChange(toLocal(sy, smo - 1, sd, hour, minute))
    setOpen(false)
  }

  function clear() {
    setSelDate(''); setHour(10); setMinute(0)
    onChange(''); setOpen(false)
  }

  const baseInput: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 12px', borderRadius: 10,
    border: '1px solid #e2e8f0', background: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 14, color: value ? '#0f172a' : '#94a3b8',
    fontFamily: 'inherit', outline: 'none',
    transition: 'border-color .15s',
    userSelect: 'none',
    opacity: disabled ? 0.6 : 1,
    ...inputStyle,
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <div
        tabIndex={disabled ? -1 : 0}
        role="button"
        style={baseInput}
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setOpen(o => !o) }}
      >
        <span>{value ? formatDisplay(value) : placeholder}</span>
        <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 6 }}>
          {value && allowClear
            ? <span role="button" onMouseDown={e => { e.stopPropagation(); clear() }}
                style={{ cursor: 'pointer', padding: '0 2px' }}>×</span>
            : '📅'}
        </span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 9999,
          background: '#fff', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,.14)', border: '1px solid #e8edf3',
          display: 'flex', flexDirection: 'column',
          minWidth: 340,
        }}>
          <div style={{ display: 'flex' }}>
            {/* Calendar side */}
            <div style={{ flex: 1, padding: '14px 14px 12px' }}>
              {/* Selected date display */}
              {selDate && (
                <div style={{
                  background: '#f1f5f9', borderRadius: 9, padding: '8px 12px',
                  fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 12,
                }}>
                  {(() => {
                    const [sy, smo, sd] = selDate.split('-').map(Number)
                    return `${sd} ${MONTHS_GEN[smo - 1]} ${sy} г.`
                  })()}
                </div>
              )}

              {/* Month nav */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
                <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
                  {MONTHS[m]} {y}
                </div>
                <button type="button" onClick={() => {
                  const td = now
                  setView({ y: td.getFullYear(), m: td.getMonth() })
                }} style={{ ...navBtn, width: 'auto', padding: '0 8px', fontSize: 12, color: '#2563eb', fontWeight: 600 }}>
                  Сегодня
                </button>
                <button type="button" onClick={nextMonth} style={navBtn}>›</button>
              </div>

              {/* Weekday headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
                {DAYS.map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', paddingBottom: 6, letterSpacing: '.03em' }}>{d}</div>
                ))}
              </div>

              {/* Days */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                {cells.map((cell, i) => {
                  if (!cell.day) return <div key={i} />
                  const dateStr = toYMD(y, m, cell.day)
                  const isSelected = dateStr === selDate
                  const isToday = dateStr === todayYMD
                  const wd = new Date(y, m, cell.day).getDay()
                  const isWeekend = wd === 0 || wd === 6
                  return (
                    <button key={i} type="button"
                      onClick={() => setSelDate(dateStr)}
                      style={{
                        width: '100%', aspectRatio: '1', borderRadius: 9,
                        border: isToday && !isSelected ? '1.5px solid #2563eb' : 'none',
                        background: isSelected ? '#1e293b' : 'transparent',
                        color: isSelected ? '#fff' : isToday ? '#2563eb' : isWeekend ? '#94a3b8' : '#0f172a',
                        fontWeight: isSelected || isToday ? 700 : 500,
                        fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f1f5f9' }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? '#1e293b' : 'transparent' }}
                    >{cell.day}</button>
                  )
                })}
              </div>
            </div>

            {/* Time side */}
            <div style={{
              width: 110, borderLeft: '1px solid #f1f5f9',
              display: 'flex', gap: 0, padding: '14px 8px 12px',
              flexDirection: 'column',
            }}>
              <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8, letterSpacing: '.04em' }}>ВРЕМЯ</div>
              <div style={{ display: 'flex', flex: 1, gap: 4, minHeight: 0 }}>
                {/* Hours */}
                <div ref={hourRef} style={{
                  flex: 1, overflowY: 'auto', maxHeight: 230,
                  scrollbarWidth: 'none',
                }} className="hide-scrollbar">
                  {hours.map(h => (
                    <button key={h} type="button" data-val={h}
                      onClick={() => setHour(h)}
                      style={{
                        width: '100%', padding: '6px 0', borderRadius: 8, border: 'none',
                        background: hour === h ? '#1e293b' : 'transparent',
                        color: hour === h ? '#fff' : '#334155',
                        fontWeight: hour === h ? 700 : 500,
                        fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                        textAlign: 'center',
                      }}
                      onMouseEnter={e => { if (hour !== h) e.currentTarget.style.background = '#f1f5f9' }}
                      onMouseLeave={e => { e.currentTarget.style.background = hour === h ? '#1e293b' : 'transparent' }}
                    >{String(h).padStart(2, '0')}</button>
                  ))}
                </div>
                {/* Minutes */}
                <div ref={minRef} style={{
                  flex: 1, overflowY: 'auto', maxHeight: 230,
                  scrollbarWidth: 'none',
                }} className="hide-scrollbar">
                  {minutes.map(mn => (
                    <button key={mn} type="button" data-val={mn}
                      onClick={() => setMinute(mn)}
                      style={{
                        width: '100%', padding: '6px 0', borderRadius: 8, border: 'none',
                        background: minute === mn ? '#1e293b' : 'transparent',
                        color: minute === mn ? '#fff' : '#334155',
                        fontWeight: minute === mn ? 700 : 500,
                        fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                        textAlign: 'center',
                      }}
                      onMouseEnter={e => { if (minute !== mn) e.currentTarget.style.background = '#f1f5f9' }}
                      onMouseLeave={e => { e.currentTarget.style.background = minute === mn ? '#1e293b' : 'transparent' }}
                    >{String(mn).padStart(2, '0')}</button>
                  ))}
                </div>
              </div>
              {/* Current time display */}
              <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: '#1e293b', marginTop: 8 }}>
                {String(hour).padStart(2,'0')}:{String(minute).padStart(2,'0')}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px 12px', borderTop: '1px solid #f1f5f9',
          }}>
            <button type="button" onClick={clear} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#2563eb', fontSize: 13, fontWeight: 600, padding: '6px 4px',
              fontFamily: 'inherit',
            }}>Удалить</button>
            <button type="button" onClick={confirm} style={{
              background: '#1e293b', color: '#fff', border: 'none',
              borderRadius: 9, padding: '8px 22px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
              opacity: selDate ? 1 : 0.4,
            }}>Готово</button>
          </div>
        </div>
      )}
    </div>
  )
}

const navBtn: CSSProperties = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid #e2e8f0',
  background: '#f8fafc', cursor: 'pointer', fontSize: 16, fontWeight: 700,
  color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center',
  lineHeight: 1, fontFamily: 'inherit', padding: 0,
}
