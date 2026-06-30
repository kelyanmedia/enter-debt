export type CommissionArea = 'mop' | 'pm'

interface Props {
  value: CommissionArea
  onChange: (area: CommissionArea) => void
}

export default function CommissionScopeToggle({ value, onChange }: Props) {
  const items: { id: CommissionArea; label: string; hint: string }[] = [
    { id: 'mop', label: 'Область МОП', hint: 'Комиссия менеджера по проектам' },
    { id: 'pm', label: 'Область ПМ', hint: 'Комиссия проектного менеджера' },
  ]

  return (
    <div
      role="tablist"
      aria-label="Область комиссии"
      style={{
        display: 'inline-flex',
        padding: 4,
        borderRadius: 14,
        background: 'linear-gradient(180deg, #f1f5f9 0%, #e8edf3 100%)',
        border: '1px solid #e2e8f0',
        boxShadow: 'inset 0 1px 2px rgba(15,23,42,.06)',
        gap: 4,
      }}
    >
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.hint}
            onClick={() => onChange(item.id)}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 10,
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              transition: 'all .18s ease',
              background: active
                ? item.id === 'mop'
                  ? 'linear-gradient(180deg, #1a6b3c 0%, #14532d 100%)'
                  : 'linear-gradient(180deg, #0d9488 0%, #0f766e 100%)'
                : 'transparent',
              color: active ? '#fff' : '#64748b',
              boxShadow: active ? '0 4px 14px rgba(15,23,42,.14)' : 'none',
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
