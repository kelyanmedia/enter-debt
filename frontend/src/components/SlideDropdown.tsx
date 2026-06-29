import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type SlideDropdownOption<T extends string | number = string | number> = {
  value: T
  label: string
  color?: string | null
  description?: string
}

type SlideDropdownProps<T extends string | number> = {
  value: T
  onChange: (value: T) => void
  options: SlideDropdownOption<T>[]
  variant?: 'dark' | 'light'
  fullWidth?: boolean
  disabled?: boolean
  ariaLabel?: string
  minWidth?: number
  renderTriggerLabel?: (option: SlideDropdownOption<T> | undefined) => ReactNode
}

const CHEVRON = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27none%27 stroke=%27%23ffffff%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 d=%27M3 4.5L6 7.5L9 4.5%27/%3E%3C/svg%3E")'
const CHEVRON_DARK = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 d=%27M3 4.5L6 7.5L9 4.5%27/%3E%3C/svg%3E")'

export function SlideDropdown<T extends string | number>({
  value,
  onChange,
  options,
  variant = 'light',
  fullWidth = false,
  disabled = false,
  ariaLabel,
  minWidth = 200,
  renderTriggerLabel,
}: SlideDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) {
      setRevealed(false)
      return
    }
    const frame = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const isDark = variant === 'dark'

  const triggerStyle: CSSProperties = isDark
    ? {
        width: fullWidth ? '100%' : 'auto',
        minWidth,
        padding: '12px 40px 12px 16px',
        borderRadius: 12,
        border: open ? '1px solid #475569' : '1px solid transparent',
        backgroundColor: '#334155',
        backgroundImage: `${CHEVRON}, linear-gradient(135deg, #334155 0%, #1e293b 100%)`,
        backgroundRepeat: 'no-repeat, no-repeat',
        backgroundPosition: 'right 14px center, 0 0',
        backgroundSize: '12px 12px, auto',
        boxShadow: open
          ? '0 8px 24px rgba(15,23,42,.22), inset 0 1px 0 rgba(255,255,255,.08)'
          : '0 2px 8px rgba(15,23,42,.12), inset 0 1px 0 rgba(255,255,255,.06)',
        transition: 'box-shadow .2s ease, border-color .2s ease',
        opacity: disabled ? 0.6 : 1,
        color: '#fff',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        letterSpacing: '.03em',
        textTransform: 'uppercase',
        lineHeight: 1.25,
        textAlign: 'left',
      }
    : {
        width: fullWidth ? '100%' : 'auto',
        minWidth,
        padding: '9px 36px 9px 14px',
        borderRadius: 10,
        border: open ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
        background: '#fff',
        color: '#475569',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        textAlign: 'left',
        appearance: 'none',
        backgroundImage: CHEVRON_DARK,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        backgroundSize: '12px 12px',
        boxShadow: open ? '0 4px 16px rgba(15,23,42,.08)' : 'none',
        transition: 'box-shadow .2s ease, border-color .2s ease',
        opacity: disabled ? 0.6 : 1,
      }

  return (
    <div ref={rootRef} style={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={triggerStyle}
      >
        {renderTriggerLabel ? renderTriggerLabel(selected) : (selected?.label ?? '—')}
      </button>

      {open && (
        <div
          role="listbox"
          id={listId}
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: fullWidth ? 0 : undefined,
            minWidth: fullWidth ? undefined : minWidth,
            zIndex: 300,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #e2e8f0',
            boxShadow: '0 16px 40px rgba(15,23,42,.14), 0 4px 12px rgba(15,23,42,.06)',
            padding: 6,
            overflow: 'hidden',
            transform: revealed ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(.98)',
            opacity: revealed ? 1 : 0,
            transformOrigin: 'top center',
            transition: 'transform .22s cubic-bezier(.22,1,.36,1), opacity .18s ease',
          }}
        >
          {options.map(opt => {
            const active = opt.value === value
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 10,
                  background: active ? '#f0fdf4' : 'transparent',
                  color: active ? '#15803d' : '#334155',
                  fontSize: 13,
                  fontWeight: active ? 700 : 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background .12s ease',
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                {opt.color ? (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: opt.color,
                      flexShrink: 0,
                      boxShadow: `0 0 0 2px ${opt.color}33`,
                    }}
                  />
                ) : null}
                <span style={{ flex: 1, minWidth: 0, textTransform: isDark ? 'uppercase' : 'none', letterSpacing: isDark ? '.03em' : 0 }}>
                  {opt.label}
                </span>
                {active && (
                  <span style={{ fontSize: 14, color: '#15803d', flexShrink: 0, lineHeight: 1 }} aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
