import { ReactNode, CSSProperties, useState, MouseEvent, MouseEventHandler, type InputHTMLAttributes } from 'react'

// ── Badge ─────────────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<string, CSSProperties> = {
  green:   { background: '#e8f5ee', color: '#1a6b3c' },
  red:     { background: '#fef0f0', color: '#e84040' },
  amber:   { background: '#fff8ee', color: '#f0900a' },
  blue:    { background: '#eff4ff', color: '#2563eb' },
  gray:    { background: '#f5f6fa', color: '#8a8fa8' },
}

export function Badge({ variant = 'gray', children }: { variant?: string; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 600,
      ...BADGE_STYLES[variant],
    }}>
      {children}
    </span>
  )
}

export function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: string }> = {
    pending:  { label: 'Ожидается', variant: 'amber' },
    paid:     { label: 'Оплачено',  variant: 'green' },
    overdue:  { label: 'Просрочено', variant: 'red'  },
    postponed:{ label: 'Отложено',  variant: 'blue'  },
    active:   { label: 'Активный',  variant: 'green' },
    paused:   { label: 'Приостановлен', variant: 'amber' },
    archive:  { label: 'Архив',     variant: 'gray'  },
    admin:    { label: 'Администратор', variant: 'green' },
    manager:  { label: 'Менеджер',  variant: 'blue'  },
    accountant:{ label: 'Бухгалтерия', variant: 'gray' },
    administration:{ label: 'Администрация', variant: 'blue' },
    employee:{ label: 'Сотрудник', variant: 'blue' },
    not_started:{ label: 'Не начато', variant: 'gray' },
    in_progress:{ label: 'В процессе', variant: 'blue' },
    pending_approval:{ label: 'На утверждении', variant: 'amber' },
    done:{ label: 'Готово', variant: 'green' },
    regular:   { label: 'Рекуррентный', variant: 'blue' },
    recurring: { label: 'Рекуррентный', variant: 'blue' },
    one_time: { label: 'Разовый',   variant: 'gray'  },
    service:  { label: 'Сервисный', variant: 'amber' },
    A: { label: 'A', variant: 'blue' },
    B: { label: 'B', variant: 'amber' },
    C: { label: 'C', variant: 'gray' },
  }
  const m = map[status] || { label: status, variant: 'gray' }
  return <Badge variant={m.variant}>{m.label}</Badge>
}

/** Статусы задач сотрудника — совпадают с backend VALID_STATUS */
export const EMPLOYEE_TASK_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'not_started', label: 'Не начато' },
  { value: 'in_progress', label: 'В процессе' },
  { value: 'pending_approval', label: 'На утверждении' },
  { value: 'done', label: 'Готово' },
]

function employeeTaskStatusBadgeVariant(status: string): keyof typeof BADGE_STYLES {
  const m: Record<string, keyof typeof BADGE_STYLES> = {
    not_started: 'gray',
    in_progress: 'blue',
    pending_approval: 'amber',
    done: 'green',
  }
  return m[status] || 'gray'
}

/** Выпадающий список статуса в таблице задач (без отдельного редактирования) */
export function EmployeeTaskStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const variant = employeeTaskStatusBadgeVariant(value)
  const colors = BADGE_STYLES[variant]
  const chevron =
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 d=%27M3 4.5L6 7.5L9 4.5%27/%3E%3C/svg%3E")'
  const bg =
    typeof colors.background === 'string' ? colors.background : '#f5f6fa'
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      aria-label="Статус задачи"
      style={{
        color: colors.color,
        backgroundColor: bg,
        padding: '5px 26px 5px 10px',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        border: '1px solid rgba(0,0,0,.06)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.65 : 1,
        appearance: 'none',
        WebkitAppearance: 'none',
        maxWidth: '100%',
        minWidth: 158,
        backgroundImage: chevron,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
      }}
    >
      {!EMPLOYEE_TASK_STATUS_OPTIONS.some(o => o.value === value) && (
        <option value={value}>{value}</option>
      )}
      {EMPLOYEE_TASK_STATUS_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, width = 480 }: {
  open: boolean; onClose: () => void; title: string;
  children: ReactNode; footer?: ReactNode; width?: number
}) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div style={{ background: '#fff', borderRadius: 16, width, maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e8e9ef', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: '#f5f6fa', border: 'none', cursor: 'pointer', fontSize: 16, color: '#8a8fa8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: '16px 24px', borderTop: '1px solid #e8e9ef', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  )
}

// ── ConfirmModal (centered; replaces window.confirm) ──────────────────────────

export function ConfirmModal({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  onConfirm,
  danger = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  danger?: boolean
}) {
  const [busy, setBusy] = useState(false)
  if (!open) return null
  const confirmBg = danger ? '#e84040' : '#1f7a46'
  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: '#fff',
          borderRadius: 16,
          width: 420,
          maxWidth: '100%',
          boxShadow: '0 12px 48px rgba(0,0,0,.22)',
          padding: '24px 24px 20px',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: '#1a1d23' }}>{title}</div>
        <div style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.55, marginBottom: 22 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <BtnOutline
            onClick={() => { if (!busy) onClose() }}
            style={{ opacity: busy ? 0.65 : 1, pointerEvents: busy ? 'none' : 'auto' }}
          >
            {cancelLabel}
          </BtnOutline>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 600,
              background: confirmBg,
              color: '#fff',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.75 : 1,
              fontFamily: 'inherit',
            }}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────

export function BtnPrimary({ children, onClick, disabled, type = 'button', style }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button'|'submit'; style?: CSSProperties }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
      background: '#1f7a46', color: '#fff', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .6 : 1, fontFamily: 'inherit', ...style,
    }}>{children}</button>
  )
}

export function BtnOutline({
  children,
  onClick,
  style,
  type = 'button',
  disabled,
  title,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  style?: CSSProperties
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  title?: string
  'aria-label'?: string
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600,
        background: '#fff', color: '#1a1d23', border: '1px solid #e8e9ef',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: 'inherit', ...style,
      }}
    >
      {children}
    </button>
  )
}

/** Иконка карандаша для строк таблиц (партнёры, пользователи, проекты) */
export function BtnIconEdit({
  onClick,
  title = 'Редактировать',
  style: styleProp,
  disabled,
}: {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  title?: string
  style?: CSSProperties
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 30,
        borderRadius: 8,
        border: '1px solid #e8e9ef',
        background: '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: '#64748b',
        flexShrink: 0,
        transition: 'background .15s, color .15s, border-color .15s, box-shadow .15s',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
        ...styleProp,
      }}
      onMouseEnter={e => {
        if (e.currentTarget.disabled) return
        const t = e.currentTarget
        t.style.background = '#eff6ff'
        t.style.color = '#2563eb'
        t.style.borderColor = '#93c5fd'
        t.style.boxShadow = '0 2px 6px rgba(37,99,235,.12)'
      }}
      onMouseLeave={e => {
        const t = e.currentTarget
        t.style.background = '#fff'
        t.style.color = '#64748b'
        t.style.borderColor = '#e8e9ef'
        t.style.boxShadow = '0 1px 2px rgba(0,0,0,.04)'
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  )
}

// ── Form Fields ───────────────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%', border: '1px solid #e8e9ef', borderRadius: 9,
  padding: '9px 12px', fontSize: 13.5, outline: 'none', color: '#1a1d23',
  fontFamily: 'inherit', background: '#fff',
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />
}

/** Убрать пробелы/группировку; одна точка как разделитель дроби (запятая → точка). */
export function sanitizeMoneyInputString(raw: string): string {
  let t = raw.replace(/\s/g, '').replace(/,/g, '.')
  let out = ''
  let dot = false
  for (const c of t) {
    if (c >= '0' && c <= '9') out += c
    else if (c === '.' && !dot) {
      dot = true
      out += '.'
    }
  }
  return out
}

function normalizeMoneyBlurValue(raw: string): string {
  if (raw === '' || raw === '.') return ''
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const r = Math.round(n * 100) / 100
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r))
  return String(r)
}

type GroupedInputExtra = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>

/**
 * Сумма / денежное поле: в состоянии храните строку без пробелов («90000000» или «90000000.5»).
 * Вне фокуса показываются группы разрядов (1 000, 10 000, 100 000 …).
 */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
  style,
  ...rest
}: GroupedInputExtra & { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const displayValue =
    focused || value === '' || value === '.'
      ? sanitizeMoneyInputString(value)
      : (() => {
          const n = Number(value)
          return Number.isFinite(n) ? formatMoneyNumber(n) : sanitizeMoneyInputString(value)
        })()

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={(e) => {
        setFocused(true)
        rest.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        const n = normalizeMoneyBlurValue(sanitizeMoneyInputString(value))
        if (n !== value) onChange(n)
        rest.onBlur?.(e)
      }}
      onChange={(e) => onChange(sanitizeMoneyInputString(e.target.value))}
      style={{ ...inputStyle, ...style }}
    />
  )
}

/** Целое число с группировкой разрядов (Telegram chat id, штуки и т.д.). */
export function IntegerGroupedInput({
  value,
  onChange,
  placeholder,
  disabled,
  style,
  ...rest
}: GroupedInputExtra & { value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const displayValue =
    focused || value === ''
      ? value
      : (() => {
          const n = parseInt(value, 10)
          return Number.isFinite(n) ? formatMoneyNumber(n) : value
        })()

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={(e) => {
        setFocused(true)
        rest.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        const digits = value.replace(/\D/g, '')
        if (digits !== value) onChange(digits)
        rest.onBlur?.(e)
      }}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      style={{ ...inputStyle, ...style }}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{ ...inputStyle, cursor: 'pointer', ...props.style }} />
}

// ── Page Header ───────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        borderBottom: '1px solid #e8e9ef',
        padding: '0 24px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: '#8a8fa8' }}>{subtitle}</div>}
      </div>
      {action && <div style={{ marginRight: 48 }}>{action}</div>}
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCardInfoTip({ text, light }: { text: string; light?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ position: 'absolute', top: 12, right: 12, zIndex: 4 }}
    >
      <span
        role="img"
        aria-label="Пояснение к показателю"
        style={{
          display: 'inline-flex',
          width: 22,
          height: 22,
          borderRadius: '50%',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 800,
          lineHeight: 1,
          cursor: 'help',
          userSelect: 'none',
          border: light ? '1px solid rgba(255,255,255,0.55)' : '1px solid #cbd5e1',
          color: light ? '#fff' : '#475569',
          background: light ? 'rgba(255,255,255,0.2)' : '#f8fafc',
        }}
      >
        !
      </span>
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 'min(100vw - 32px, 300px)',
            maxWidth: 300,
            padding: '12px 14px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.5,
            color: '#f8fafc',
            background: '#1e293b',
            boxShadow: '0 10px 28px rgba(0,0,0,.22)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  )
}

const STAT_CARD_MIN_HEIGHT = 130

export function StatCard({
  label,
  value,
  sub,
  subColor = '#2d9b5a',
  featured,
  compactValue,
  onClick,
  infoText,
}: {
  label: string
  value: string
  sub?: string
  subColor?: string
  featured?: boolean
  /** Чуть меньший шрифт суммы (длинные «N Uzs» в одной строке с соседними карточками) */
  compactValue?: boolean
  onClick?: () => void
  /** Подсказка при наведении на значок «!» в углу карточки */
  infoText?: string
}) {
  const valueSize = compactValue ? 22 : 28
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: featured ? '#1a6b3c' : '#fff',
        border: featured ? '1px solid #145a32' : '1px solid #e8e9ef',
        borderRadius: 14,
        padding: infoText ? '18px 40px 18px 20px' : '18px 20px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow .15s',
        minHeight: STAT_CARD_MIN_HEIGHT,
        height: '100%',
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {infoText && <StatCardInfoTip text={infoText} light={!!featured} />}
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: featured ? 'rgba(255,255,255,.7)' : '#8a8fa8',
          marginBottom: 8,
          minWidth: 0,
          wordBreak: 'break-word',
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: valueSize,
          fontWeight: 700,
          letterSpacing: '-.02em',
          lineHeight: 1.15,
          color: featured ? '#fff' : '#1a1d23',
          marginBottom: 6,
          minWidth: 0,
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 12,
            fontWeight: featured ? 600 : 400,
            marginTop: 'auto',
            minWidth: 0,
            wordBreak: 'break-word',
            lineHeight: 1.35,
            color: featured ? 'rgba(255,255,255,.85)' : subColor,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

export function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: '#8a8fa8', fontSize: 14 }}>{text}</div>
  )
}

// ── Table wrapper ─────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e9ef', borderRadius: 14, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8e9ef', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 700 }}>{children}</div>
}

export function Th({
  children,
  style,
  onClick,
  title,
}: {
  children?: ReactNode
  style?: CSSProperties
  onClick?: MouseEventHandler<HTMLTableCellElement>
  title?: string
}) {
  return (
    <th
      style={{
        padding: '10px 16px',
        textAlign: 'left',
        fontSize: 11.5,
        fontWeight: 600,
        color: '#8a8fa8',
        textTransform: 'uppercase',
        letterSpacing: '.05em',
        borderBottom: '1px solid #e8e9ef',
        background: '#f5f6fa',
        whiteSpace: 'nowrap',
        ...style,
      }}
      onClick={onClick}
      title={title}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  style,
  colSpan,
  rowSpan,
}: {
  children?: ReactNode
  style?: CSSProperties
  colSpan?: number
  rowSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      rowSpan={rowSpan}
      style={{ padding: '12px 16px', fontSize: 13, borderBottom: '1px solid #e8e9ef', ...style }}
    >
      {children}
    </td>
  )
}

export function PartnerAvatar({ name }: { name: string }) {
  const letters = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ width: 30, height: 30, borderRadius: 8, background: '#e8f5ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#1a6b3c', flexShrink: 0 }}>{letters}</div>
  )
}

/** Группы разрядов с пробелами (ru-RU), без валюты; до 2 знаков после запятой */
export function formatMoneyNumber(n: number | string) {
  const num = Number(n)
  if (!Number.isFinite(num)) return '0'
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
    .format(num)
    .replace(/[\u00A0\u202F]/g, ' ')
}

/** Полная сумма: «100 000 000 Uzs» */
export function formatAmount(n: number | string) {
  return `${formatMoneyNumber(n)} Uzs`
}

export function formatDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Дата «окончания» для проекта: deadline или ближайший платёж по числу месяца. */
function _paymentDeadlineDate(deadline?: string | null, dayOfMonth?: number | null): Date | null {
  if (deadline) return new Date(deadline)
  if (dayOfMonth) {
    const now = new Date()
    let date = new Date(now.getFullYear(), now.getMonth(), dayOfMonth)
    if (date < now) date = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth)
    return date
  }
  return null
}

/**
 * Дней до дедлайна: отрицательное — просрочка, положительное — осталось; null — нет даты.
 * Совпадает с расчётом подписи в daysLeft.
 */
export function daysLeftSortKey(deadline?: string | null, dayOfMonth?: number | null): number | null {
  const date = _paymentDeadlineDate(deadline, dayOfMonth)
  if (!date) return null
  return Math.ceil((date.getTime() - Date.now()) / 86400000)
}

export function daysLeft(
  deadline?: string | null,
  dayOfMonth?: number | null,
  variant: 'standard' | 'cashflow' = 'standard',
): { label: string; color: string } {
  const date = _paymentDeadlineDate(deadline, dayOfMonth)
  if (!date) return { label: '—', color: '#8a8fa8' }
  const diff = Math.ceil((date.getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: `−${Math.abs(diff)} дн.`, color: '#e84040' }
  if (variant === 'cashflow') {
    // Дебиторка: красный — просрочка; жёлтый — скоро к оплате (≤14 дн.); остальное — нейтрально
    if (diff <= 14) return { label: diff === 0 ? 'Сегодня' : `${diff} дн.`, color: '#ca8a04' }
    return { label: `${diff} дн.`, color: '#94a3b8' }
  }
  if (diff <= 3) return { label: `${diff} дн.`, color: '#f0900a' }
  return { label: `${diff} дн.`, color: '#2d9b5a' }
}
