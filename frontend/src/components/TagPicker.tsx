import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'

export function TagPicker({
  value,
  onChange,
  options,
  placeholder = 'Начните вводить…',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  options: readonly string[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputId = useId()

  const available = options.filter(
    o => !value.includes(o) && o.toLowerCase().includes(query.trim().toLowerCase())
  )

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function addTag(tag: string) {
    if (value.includes(tag)) return
    onChange([...value, tag])
    setQuery('')
    setOpen(false)
  }

  function removeTag(tag: string) {
    onChange(value.filter(t => t !== tag))
  }

  const fieldShell: CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
    padding: '8px 10px',
    minHeight: 42,
    boxSizing: 'border-box',
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={fieldShell}>
        {value.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: value.length ? 8 : 0 }}>
            {value.map(tag => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px 4px 10px',
                  borderRadius: 999,
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  color: '#6d28d9',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Убрать тег ${tag}`}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#7c3aed',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          id={inputId}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? placeholder : 'Добавить тег…'}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            color: '#0f172a',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {open && available.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(15,23,42,.12)',
            padding: 6,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {available.map(tag => (
            <button
              key={tag}
              type="button"
              role="option"
              onClick={() => addTag(tag)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 13,
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && available.length === 0 && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 50,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 12,
          color: '#94a3b8',
        }}>
          Выберите тег из списка
        </div>
      )}
    </div>
  )
}
