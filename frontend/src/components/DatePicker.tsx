/**
 * DatePicker — красивый кастомный выбор даты.
 * value/onChange: строка формата "YYYY-MM-DD"
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

function parseYMD(s: string): Date | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatDisplay(s: string): string {
  const d = parseYMD(s)
  if (!d) return ''
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} г.`
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate()
}

function firstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay()
  return d === 0 ? 6 : d - 1 // Mon=0 … Sun=6
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

export default function DatePicker({
  value,
  onChange,
  placeholder = 'Выберите дату',
  style,
  inputStyle,
  allowClear = true,
  disabled,
}: Props) {
  const today = new Date()
  const parsed = parseYMD(value)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<{ y: number; m: number }>({
    y: parsed?.getFullYear() ?? today.getFullYear(),
    m: parsed?.getMonth() ?? today.getMonth(),
  })
  const [pending, setPending] = useState<string>(value)
  const ref = useRef<HTMLDivElement>(null)

  // sync view when value changes from outside
  useEffect(() => {
    const d = parseYMD(value)
    if (d) setView({ y: d.getFullYear(), m: d.getMonth() })
    setPending(value)
  }, [value])

  // close on outside click
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
  function goToday() {
    setView({ y: today.getFullYear(), m: today.getMonth() })
  }

  const { y, m } = view
  const totalDays = daysInMonth(y, m)
  const firstDay = firstDayOfMonth(y, m)

  // build calendar grid (6 weeks × 7 days)
  const cells: Array<{ day: number | null; date: Date | null }> = []
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, date: null })
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ day: d, date: new Date(y, m, d) })
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null })

  const todayStr = toYMD(today)

  const baseInput: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 12px', borderRadius: 10,
    border: '1px solid #e2e8f0', background: '#fff',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 14, color: value ? '#0f172a' : '#94a3b8',
    fontFamily: 'inherit', outline: 'none',
    transition: 'border-color .15s, box-shadow .15s',
    userSelect: 'none',
    opacity: disabled ? 0.6 : 1,
    ...inputStyle,
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      {/* Trigger */}
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
            ? <span
                role="button"
                onMouseDown={e => { e.stopPropagation(); onChange(''); setOpen(false) }}
                style={{ cursor: 'pointer', padding: '0 2px', color: '#94a3b8' }}
              >×</span>
            : '📅'}
        </span>
      </div>

      {/* Popup */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 9999,
          background: '#fff', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,.14)', border: '1px solid #e8edf3',
          width: 320, padding: '14px 14px 12px',
        }}>
          {/* Selected date display */}
          {pending && (
            <div style={{
              background: '#f1f5f9', borderRadius: 9, padding: '8px 12px',
              fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 12,
            }}>
              {formatDisplay(pending)}
            </div>
          )}

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>‹</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 15, color: '#0f172a' }}>
              {MONTHS[m]} {y}
            </div>
            <button type="button" onClick={goToday} style={{
              ...navBtn, width: 'auto', padding: '0 8px', fontSize: 12,
              color: '#2563eb', fontWeight: 600,
            }}>Сегодня</button>
            <button type="button" onClick={nextMonth} style={navBtn}>›</button>
          </div>

          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: 11, fontWeight: 700,
                color: '#94a3b8', padding: '2px 0 6px',
                letterSpacing: '.03em',
              }}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {cells.map((cell, i) => {
              if (!cell.day || !cell.date) {
                return <div key={i} />
              }
              const dateStr = toYMD(cell.date)
              const isSelected = dateStr === pending
              const isToday = dateStr === todayStr
              const isSat = cell.date.getDay() === 6
              const isSun = cell.date.getDay() === 0

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPending(dateStr)}
                  style={{
                    width: '100%', aspectRatio: '1', borderRadius: 9,
                    border: isToday && !isSelected ? '1.5px solid #2563eb' : 'none',
                    background: isSelected ? '#1e293b' : 'transparent',
                    color: isSelected ? '#fff'
                      : isToday ? '#2563eb'
                      : (isSat || isSun) ? '#94a3b8'
                      : '#0f172a',
                    fontWeight: isSelected || isToday ? 700 : 500,
                    fontSize: 13,
                    cursor: 'pointer',
                    transition: 'background .1s',
                    fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSelected ? '#1e293b' : 'transparent' }}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9',
          }}>
            <button
              type="button"
              onClick={() => { setPending(''); onChange(''); setOpen(false) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#2563eb', fontSize: 13, fontWeight: 600, padding: '6px 4px',
                fontFamily: 'inherit',
              }}
            >Удалить</button>
            <button
              type="button"
              onClick={() => { onChange(pending); setOpen(false) }}
              style={{
                background: '#1e293b', color: '#fff', border: 'none',
                borderRadius: 9, padding: '8px 22px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Готово</button>
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
