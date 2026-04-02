import { ReactNode, useEffect, useCallback, type ChangeEvent } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { NotificationBell } from '@/components/NotificationDrawer'
import { companyDisplayName } from '@/lib/company'

type NavItem = {
  href: string
  label: string
  icon: string
  adminOnly?: boolean
  /** P&L, ДДС, Projects Cost, Оплаты, Расходы — админ и роль «Финансист» */
  financeTeam?: boolean
  managerHidden?: boolean
  administrationHidden?: boolean
  accountantHidden?: boolean
  badge?: string
  /** Подсветка пункта для всех путей с этим префиксом (например /subscriptions/*) */
  activePathPrefix?: string
}

type NavSection = { title: string; items: NavItem[]; hideForFinancier?: boolean }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Аналитика',
    hideForFinancier: true,
    items: [{ href: '/', label: 'Дашборд', icon: '▦', managerHidden: true }],
  },
  {
    title: 'Проекты',
    hideForFinancier: true,
    items: [
      { href: '/debitor', label: 'Дебиторка', icon: '📒' },
      { href: '/payments', label: 'Проекты', icon: '📁', badge: 'overdue' },
      { href: '/partners', label: 'Партнёры', icon: '🤝' },
      {
        href: '/new-contract',
        label: 'Новый договор',
        icon: '📝',
        accountantHidden: true,
      },
      { href: '/commissions', label: 'Комиссия', icon: '💰', administrationHidden: true },
    ],
  },
  {
    title: 'Финансы',
    items: [
      { href: '/ceo', label: 'CEO Dashboard', icon: '📊', managerHidden: true },
      { href: '/finance/pl', label: 'P&L', icon: '📈', financeTeam: true },
      { href: '/finance/cashflow', label: 'ДДС', icon: '💸', financeTeam: true },
      { href: '/finance/projects-cost', label: 'Projects Cost', icon: '🧮', financeTeam: true },
      { href: '/received-payments', label: 'Оплаты', icon: '💳', financeTeam: true },
      { href: '/finance/expenses', label: 'Расходы', icon: '📤', financeTeam: true },
    ],
  },
  {
    title: 'Подписки',
    hideForFinancier: true,
    items: [
      {
        href: '/subscriptions/household',
        label: 'Подписки',
        icon: '📑',
        activePathPrefix: '/subscriptions/household',
      },
      {
        href: '/subscriptions/accesses',
        label: 'Доступы',
        icon: '🔐',
        activePathPrefix: '/subscriptions/accesses',
      },
    ],
  },
  {
    title: 'Область админа',
    items: [
      { href: '/profile', label: 'Профиль', icon: '👤' },
      { href: '/users', label: 'Пользователи', icon: '👥', adminOnly: true },
      { href: '/staff', label: 'Команда', icon: '👷', adminOnly: true },
      { href: '/notifications', label: 'Уведомления', icon: '🔔' },
      { href: '/archive', label: 'Архив', icon: '🗄️', adminOnly: true },
    ],
  },
]

const sectionHeadingStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#8a8fa8',
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  padding: '10px 10px 8px',
}

function CompanyWorkspaceSelect({ readOnly }: { readOnly?: boolean }) {
  const { companies, companySlug, switchCompany } = useAuth()
  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      void switchCompany(e.target.value)
    },
    [switchCompany]
  )
  const label = companies.find((c) => c.slug === companySlug)?.name ?? companyDisplayName(companySlug)
  if (readOnly) {
    return (
      <div
        title="Компания закреплена за этим входом. Переключение включает администратор, если вы работаете с несколькими компаниями (у каждой свои задачи и выплаты)."
        style={{
          marginTop: 4,
          width: '100%',
          maxWidth: '100%',
          fontSize: 11.5,
          fontWeight: 600,
          color: '#5c6378',
          border: '1px solid #e8e9ef',
          borderRadius: 8,
          padding: '6px 8px',
          background: '#f8fafc',
          fontFamily: 'inherit',
          lineHeight: 1.35,
        }}
      >
        {label}
      </div>
    )
  }
  return (
    <select
      value={companySlug}
      onChange={onChange}
      aria-label="Организация"
      style={{
        marginTop: 4,
        width: '100%',
        maxWidth: '100%',
        fontSize: 11.5,
        fontWeight: 600,
        color: '#5c6378',
        border: '1px solid #e8e9ef',
        borderRadius: 8,
        padding: '5px 8px',
        background: '#fafbfc',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {companies.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  useEffect(() => {
    if (
      !loading &&
      user?.role === 'employee' &&
      router.pathname !== '/my-work' &&
      router.pathname !== '/my-payments' &&
      router.pathname !== '/profile'
    ) {
      router.replace('/my-work')
    }
  }, [loading, user, router.pathname, router])

  if (loading || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa' }}>
      <div style={{ color: '#8a8fa8', fontSize: 14 }}>Загрузка...</div>
    </div>
  )

  const initials = (() => {
    const raw = (user.name || '').trim()
    if (!raw) return '?'
    return raw
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  })()
  const roleLabel = {
    admin: 'Администратор',
    manager: 'Менеджер',
    accountant: 'Бухгалтерия',
    financier: 'Финансист',
    administration: 'Администрация',
    employee: 'Сотрудник',
  }[user.role]

  if (user.role === 'employee') {
    const activeWork = router.pathname === '/my-work'
    const activePayments = router.pathname === '/my-payments'
    const activeProfile = router.pathname === '/profile'
    return (
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
        <aside style={{ width: 220, background: '#fff', borderRight: '1px solid #e8e9ef', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #e8e9ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/kelyanmedia-logo.png" alt="" style={{ height: 28, width: 'auto', maxWidth: 56, objectFit: 'contain' }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23' }}>Задачи</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <CompanyWorkspaceSelect readOnly={user.multi_company_access !== true} />
            </div>
          </div>
          <nav style={{ padding: 14, flex: 1 }}>
            <Link href="/my-work" style={{ textDecoration: 'none' }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 600,
                  background: activeWork ? '#e8f5ee' : 'transparent',
                  color: activeWork ? '#1a6b3c' : '#8a8fa8',
                  borderLeft: activeWork ? '2px solid #1a6b3c' : '2px solid transparent',
                }}
              >
                📋 Мои задачи
              </div>
            </Link>
            <Link href="/my-payments" style={{ textDecoration: 'none', display: 'block', marginTop: 6 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 600,
                  background: activePayments ? '#e8f5ee' : 'transparent',
                  color: activePayments ? '#1a6b3c' : '#8a8fa8',
                  borderLeft: activePayments ? '2px solid #1a6b3c' : '2px solid transparent',
                }}
              >
                💳 История выплат
              </div>
            </Link>
            <Link href="/profile" style={{ textDecoration: 'none', display: 'block', marginTop: 6 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 14,
                  fontWeight: 600,
                  background: activeProfile ? '#e8f5ee' : 'transparent',
                  color: activeProfile ? '#1a6b3c' : '#8a8fa8',
                  borderLeft: activeProfile ? '2px solid #1a6b3c' : '2px solid transparent',
                }}
              >
                👤 Профиль
              </div>
            </Link>
            <div style={{ fontSize: 11, color: '#8a8fa8', marginTop: 16, lineHeight: 1.45, padding: '0 4px' }}>
              Задачи и история выплат — разные разделы. В профиле — пароль и реквизиты. Компания сверху совпадает с
              выбранной при входе. Остальной модуль недоступен.
            </div>
          </nav>
          <div style={{ padding: '14px 10px', borderTop: '1px solid #e8e9ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f5f6fa', borderRadius: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: '#8a8fa8' }}>{roleLabel}</div>
              </div>
              <button type="button" onClick={logout} title="Выйти" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}>↩</button>
            </div>
          </div>
        </aside>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>{children}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
      {/* Sidebar */}
      <aside style={{ width: 260, background: '#fff', borderRight: '1px solid #e8e9ef', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #e8e9ef', display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
            src="/kelyanmedia-logo.png"
            alt="KelyanMedia"
            style={{ height: 32, width: 'auto', maxWidth: 64, objectFit: 'contain', flexShrink: 0, display: 'block' }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                lineHeight: 1.2,
                color: '#1a1d23',
                whiteSpace: 'nowrap',
              }}
            >
              Финансовый модуль
            </div>
            <CompanyWorkspaceSelect />
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '14px 10px', flex: 1, overflowY: 'auto' }}>
          {NAV_SECTIONS.map((section, si) => {
            if (section.hideForFinancier && user.role === 'financier') return null
            const visible = section.items.filter(n => {
              if (n.adminOnly && user.role !== 'admin') return false
              if (
                n.financeTeam &&
                user.role !== 'admin' &&
                user.role !== 'financier'
              ) {
                return false
              }
              if (n.accountantHidden && user.role === 'accountant') return false
              if (n.administrationHidden && user.role === 'administration') return false
              if (n.managerHidden && (user.role === 'manager' || user.role === 'administration')) return false
              if (user.role === 'administration') {
                if (n.href.startsWith('/subscriptions/accesses')) {
                  if (!user.can_view_accesses) return false
                } else if (n.href.startsWith('/subscriptions')) {
                  if (!user.can_view_subscriptions) return false
                }
              }
              return true
            })
            if (visible.length === 0) return null
            return (
              <div key={section.title} style={{ marginTop: si > 0 ? 12 : 0 }}>
                <div style={sectionHeadingStyle}>{section.title}</div>
                {visible.map(n => {
                  const active = n.activePathPrefix
                    ? router.pathname.startsWith(n.activePathPrefix)
                    : router.pathname === n.href
                  return (
                    <Link key={n.href} href={n.href} style={{ textDecoration: 'none' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 12px',
                          borderRadius: 9,
                          marginBottom: 2,
                          cursor: 'pointer',
                          fontSize: 13.5,
                          fontWeight: 500,
                          background: active ? '#e8f5ee' : 'transparent',
                          color: active ? '#1a6b3c' : '#8a8fa8',
                          borderLeft: active ? '2px solid #1a6b3c' : '2px solid transparent',
                          transition: 'all .15s',
                        }}
                      >
                        <span style={{ fontSize: 15 }}>{n.icon}</span>
                        {n.label}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {user.role === 'admin' && (
          <div style={{ padding: '10px 10px 12px', borderTop: '1px solid #e8e9ef', flexShrink: 0 }}>
            <Link href="/trash" style={{ textDecoration: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 9,
                  fontSize: 13.5,
                  fontWeight: 500,
                  background: router.pathname === '/trash' ? '#f1f5f9' : 'transparent',
                  color: router.pathname === '/trash' ? '#475569' : '#94a3b8',
                  borderLeft: router.pathname === '/trash' ? '2px solid #64748b' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: 15 }}>🗑️</span>
                Корзина
              </div>
            </Link>
            <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.35, padding: '4px 12px 0' }}>
              Удалённые проекты и компании до 30 дней; архив — в разделе «Архив».
            </div>
          </div>
        )}

        {/* User */}
        <div style={{ padding: '14px 10px', borderTop: '1px solid #e8e9ef' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f5f6fa', borderRadius: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: '#8a8fa8' }}>{roleLabel}</div>
            </div>
            <button onClick={logout} title="Выйти" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}>↩</button>
          </div>
        </div>
      </aside>

      {/* Main — отступ справа под фиксированный колокольчик (40px + бейдж), чтобы шапки и фильтры не перекрывались */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          paddingRight: 72,
          minWidth: 0,
          width: '100%',
        }}
      >
        <div style={{ position: 'fixed', top: 12, right: 20, zIndex: 50 }}>
          <NotificationBell />
        </div>
        {children}
      </div>
    </div>
  )
}
