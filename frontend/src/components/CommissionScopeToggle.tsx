export type CommissionArea = 'manager' | 'pm'

interface Props {
  value: CommissionArea
  onChange: (area: CommissionArea) => void
}

export default function CommissionScopeToggle({ value, onChange }: Props) {
  const items: { id: CommissionArea; label: string; hint: string }[] = [
    {
      id: 'manager',
      label: 'Комиссия менеджера',
      hint: 'Проекты, которые вы вручную вносите в раздел «Комиссия»',
    },
    {
      id: 'pm',
      label: 'Комиссия ПМ',
      hint: 'Проекты из «Проекты», где включена галочка «ПМ получает комиссию»',
    },
  ]

  return (
    <div
      role="tablist"
      aria-label="Тип комиссии"
      style={{
        display: 'flex',
        width: '100%',
        maxWidth: 560,
        padding: 4,
        borderRadius: 14,
        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        border: '1px solid #e2e8f0',
        boxShadow: 'inset 0 1px 2px rgba(15,23,42,.05)',
        gap: 4,
        boxSizing: 'border-box',
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
              flex: 1,
              minWidth: 0,
              border: 'none',
              cursor: 'pointer',
              borderRadius: 10,
              padding: '11px 14px',
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
              transition: 'all .18s ease',
              background: active
                ? item.id === 'manager'
                  ? 'linear-gradient(180deg, #1a6b3c 0%, #14532d 100%)'
                  : 'linear-gradient(180deg, #0d9488 0%, #0f766e 100%)'
                : 'transparent',
              color: active ? '#fff' : '#64748b',
              boxShadow: active ? '0 4px 14px rgba(15,23,42,.12)' : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
