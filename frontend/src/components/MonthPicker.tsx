/**
 * MonthPicker — выбор месяца: ← [Октябрь 2026 ▾] → и поповер с сеткой месяцев.
 * value/onChange: строка формата "YYYY-MM"
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const GREEN = '#1f7a46'

function parseYm(ym: string): [number, number] {
  const [y, m] = ym.split('-').map(Number)
  return [y || new Date().getFullYear(), (m || 1) - 1]
}

function toYm(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

function shift(ym: string, delta: number) {
  const [y, m] = parseYm(ym)
  const d = new Date(y, m + delta, 1)
  return toYm(d.getFullYear(), d.getMonth())
}

function currentYm() {
  const d = new Date()
  return toYm(d.getFullYear(), d.getMonth())
}

const arrowBtn: CSSProperties = {
  width: 36,
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9,
  border: '1px solid #e8e9ef',
  background: '#fff',
  color: '#475569',
  fontSize: 16,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export default function MonthPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (ym: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => parseYm(value)[0])
  const ref = useRef<HTMLDivElement>(null)
  const [selYear, selMonth] = parseYm(value)
  const [nowYear, nowMonth] = parseYm(currentYm())

  useEffect(() => {
    if (!open) return
    setViewYear(selYear)
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, selYear])

  const pick = (ym: string) => {
    onChange(ym)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" style={arrowBtn} onClick={() => onChange(shift(value, -1))} disabled={disabled} aria-label="Предыдущий месяц">
        ‹
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          ...arrowBtn,
          width: 172,
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: 14,
          fontWeight: 700,
          color: '#1a1d23',
          borderColor: open ? GREEN : '#e8e9ef',
          boxShadow: open ? '0 0 0 3px rgba(31,122,70,.12)' : 'none',
        }}
      >
        <span>
          {MONTHS[selMonth]} {selYear}
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▼</span>
      </button>
      <button type="button" style={arrowBtn} onClick={() => onChange(shift(value, 1))} disabled={disabled} aria-label="Следующий месяц">
        ›
      </button>

      {open ? (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 42,
            zIndex: 60,
            width: 264,
            padding: 12,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #e8edf3',
            boxShadow: '0 8px 32px rgba(0,0,0,.14)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" style={{ ...arrowBtn, width: 30, height: 30 }} onClick={() => setViewYear((y) => y - 1)} aria-label="Предыдущий год">
              ‹
            </button>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#1a1d23' }}>{viewYear}</span>
            <button type="button" style={{ ...arrowBtn, width: 30, height: 30 }} onClick={() => setViewYear((y) => y + 1)} aria-label="Следующий год">
              ›
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {MONTHS_SHORT.map((label, m) => {
              const selected = viewYear === selYear && m === selMonth
              const isNow = viewYear === nowYear && m === nowMonth
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(toYm(viewYear, m))}
                  style={{
                    height: 38,
                    borderRadius: 9,
                    border: `1px solid ${selected ? GREEN : isNow ? '#bbe5cb' : 'transparent'}`,
                    background: selected ? GREEN : isNow ? '#f0faf4' : '#f8fafc',
                    color: selected ? '#fff' : '#1a1d23',
                    fontSize: 13,
                    fontWeight: selected || isNow ? 700 : 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => pick(currentYm())}
            style={{
              marginTop: 10,
              width: '100%',
              height: 34,
              borderRadius: 9,
              border: '1px solid #e8e9ef',
              background: '#fff',
              color: GREEN,
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Текущий месяц
          </button>
        </div>
      ) : null}
    </div>
  )
}
