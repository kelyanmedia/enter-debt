import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'

export type CarouselEntity = {
  id: number | null
  name: string
  subtitle?: string
}

const navBtn: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#64748b',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  flexShrink: 0,
  transition: 'border-color .15s ease, color .15s ease, background .15s ease',
  padding: 0,
}

export function EntityCarousel({
  items,
  value,
  onChange,
  ariaLabel = 'Переключатель',
}: {
  items: CarouselEntity[]
  value: number | null
  onChange: (id: number | null) => void
  ariaLabel?: string
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (items.length === 0) return null

  const idx = Math.max(0, items.findIndex(i => i.id === value))
  const current = items[idx] ?? items[0]
  const canPrev = idx > 0
  const canNext = idx < items.length - 1
  const showDrawer = items.length > 1

  function openDrawer() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    if (showDrawer) setDrawerOpen(true)
  }

  function closeDrawerSoon() {
    leaveTimer.current = setTimeout(() => setDrawerOpen(false), 120)
  }

  function pickItem(id: number | null) {
    onChange(id)
    setDrawerOpen(false)
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <button
        type="button"
        aria-label="Предыдущий"
        disabled={!canPrev}
        onClick={() => canPrev && onChange(items[idx - 1].id)}
        style={{
          ...navBtn,
          opacity: canPrev ? 1 : 0.35,
          cursor: canPrev ? 'pointer' : 'default',
        }}
      >
        ‹
      </button>

      <div
        style={{ position: 'relative' }}
        onMouseEnter={openDrawer}
        onMouseLeave={closeDrawerSoon}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid #e8eaef',
            background: '#fff',
            boxShadow: drawerOpen ? '0 4px 16px rgba(15,23,42,.1)' : '0 2px 10px rgba(15,23,42,.05)',
            minWidth: 160,
            maxWidth: 280,
            cursor: showDrawer ? 'pointer' : 'default',
            transition: 'box-shadow .15s ease, border-color .15s ease',
            borderColor: drawerOpen ? '#cbd5e1' : '#e8eaef',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#0f172a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {current.name}
            </div>
            {current.subtitle ? (
              <div style={{
                fontSize: 11,
                color: '#94a3b8',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 1,
              }}>
                {current.subtitle}
              </div>
            ) : null}
          </div>
          {showDrawer && (
            <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0, lineHeight: 1 }} aria-hidden>
              ▾
            </span>
          )}
        </div>

        {drawerOpen && showDrawer && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: '50%',
              transform: 'translateX(-50%)',
              minWidth: '100%',
              width: 'max-content',
              maxWidth: 320,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              boxShadow: '0 12px 32px rgba(15,23,42,.14)',
              zIndex: 80,
              overflow: 'hidden',
              padding: 6,
            }}
          >
            {items.map(item => {
              const active = item.id === value
              return (
                <button
                  key={item.id ?? 'all'}
                  type="button"
                  onClick={() => pickItem(item.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 'none',
                    borderRadius: 8,
                    background: active ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.background = '#f8fafc'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = active ? '#f1f5f9' : 'transparent'
                  }}
                >
                  <div style={{
                    fontSize: 14,
                    fontWeight: active ? 700 : 600,
                    color: active ? '#0f172a' : '#334155',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.name}
                  </div>
                  {item.subtitle ? (
                    <div style={{
                      fontSize: 11,
                      color: '#94a3b8',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.subtitle}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label="Следующий"
        disabled={!canNext}
        onClick={() => canNext && onChange(items[idx + 1].id)}
        style={{
          ...navBtn,
          opacity: canNext ? 1 : 0.35,
          cursor: canNext ? 'pointer' : 'default',
        }}
      >
        ›
      </button>
    </div>
  )
}
