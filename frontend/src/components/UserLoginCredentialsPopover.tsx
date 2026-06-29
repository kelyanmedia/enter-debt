import { ReactNode, useState } from 'react'

function copyText(value: string) {
  if (!value) return
  void navigator.clipboard?.writeText(value)
}

function CopyBtn({ value }: { value?: string | null }) {
  if (!value?.trim()) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        copyText(value)
      }}
      style={{
        border: '1px solid #d6dae5',
        background: '#fff',
        borderRadius: 8,
        padding: '4px 8px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        color: '#334155',
        flexShrink: 0,
      }}
      title="Скопировать"
    >
      Копировать
    </button>
  )
}

function CredInfoField({
  label,
  value,
  copy,
  mono,
  accent,
  emptyHint,
}: {
  label: string
  value?: string | null
  copy?: boolean
  mono?: boolean
  accent?: boolean
  emptyHint?: string
}) {
  const trimmed = value?.trim() || ''
  const display = trimmed || (emptyHint ? emptyHint : '—')

  return (
    <div
      style={{
        fontSize: 12,
        background: accent ? 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)' : '#f8fafc',
        border: accent ? '1px solid #bbf7d0' : '1px solid #e8e9ef',
        borderRadius: 10,
        padding: '9px 10px',
        minHeight: 40,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '5px 8px',
      }}
    >
      <span style={{ color: '#64748b', fontWeight: 600, flexShrink: 0 }}>{label}:</span>
      <span
        style={{
          flex: '1 1 120px',
          minWidth: 0,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
          fontSize: mono ? 13 : 12,
          fontWeight: mono && trimmed ? 600 : 400,
          color: trimmed ? '#1a1d23' : '#94a3b8',
          wordBreak: 'break-all',
          lineHeight: 1.35,
          fontStyle: !trimmed && emptyHint ? 'italic' : 'normal',
        }}
      >
        {display}
      </span>
      {copy && <CopyBtn value={trimmed || undefined} />}
    </div>
  )
}

export function UserLoginCredentialsPanel({
  name,
  email,
  password,
  loginUrl,
  compact,
}: {
  name: string
  email: string
  password?: string | null
  loginUrl?: string
  compact?: boolean
}) {
  const url =
    loginUrl ||
    (typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login')
  const pwd = password?.trim() || ''

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
        borderRadius: compact ? 12 : 14,
        padding: compact ? '12px 14px' : '14px 16px',
        border: '1px solid #e8e9ef',
        boxShadow: compact ? '0 1px 3px rgba(15,23,42,.05)' : '0 8px 24px rgba(15,23,42,.08)',
        minWidth: compact ? undefined : 320,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 10px',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#1a6b3c',
            fontWeight: 700,
            background: '#e8f5ee',
            padding: '3px 10px',
            borderRadius: 999,
          }}
        >
          Вход в систему
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23' }}>{name}</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 8,
        }}
      >
        <CredInfoField label="Логин" value={email} copy mono />
        <CredInfoField
          label="Пароль"
          value={pwd}
          copy={!!pwd}
          mono
          accent
          emptyHint="не задан — укажите ниже"
        />
        <CredInfoField label="Ссылка" value={url} copy mono />
      </div>
    </div>
  )
}

export function UserLoginCredentialsPopover({
  name,
  email,
  password,
  children,
}: {
  name: string
  email: string
  password?: string | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 8,
            zIndex: 80,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <UserLoginCredentialsPanel name={name} email={email} password={password} />
        </div>
      )}
    </span>
  )
}
