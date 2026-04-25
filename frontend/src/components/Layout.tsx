import { ReactNode, useEffect, useCallback, useState, type ChangeEvent } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { NotificationBell } from '@/components/NotificationDrawer'
import { EmployeeQaDrawer } from '@/components/EmployeeSidebarGuide'
import { companyDisplayName, getCompanySlug, getTokenForSlug } from '@/lib/company'

type NavItem = {
  href: string
  label: string
  icon: string
  adminOnly?: boolean
  /** P&L, ДДС, Projects Cost, Оплаты, Расходы — админ и роль «Финансист» */
  financeTeam?: boolean
  /** Пункт «Ввод ДДС» для роли Администрация (упрощённый ввод без полного раздела Финансы) */
  administrationDdsInput?: boolean
  managerHidden?: boolean
  administrationHidden?: boolean
  accountantHidden?: boolean
  badge?: string
  /** Подсветка пункта для всех путей с этим префиксом (например /subscriptions/*) */
  activePathPrefix?: string
  /** Раздел «Продажи» — мастер-база лидов, только админ */
  salesClientBase?: boolean
  /** Раздел «Продажи» — список компаний менеджера (и админ) */
  salesCompanies?: boolean
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
      {
        href: '/finance/dds-input',
        label: 'Ввод ДДС',
        icon: '✏️',
        administrationDdsInput: true,
      },
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
      { href: '/finance/lending', label: 'Кредитование', icon: '🏦', financeTeam: true },
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
    title: 'Продажи',
    hideForFinancier: true,
    items: [
      {
        href: '/sales/client-base',
        label: 'Клиентская база',
        icon: '🗂️',
        salesClientBase: true,
        activePathPrefix: '/sales/client-base',
      },
      {
        href: '/sales/companies',
        label: 'Компании',
        icon: '🏢',
        salesCompanies: true,
        activePathPrefix: '/sales/companies',
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
      { href: '/settings/payments-ui', label: 'Подписи проектов', icon: '🏷️', adminOnly: true },
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
  const { workspaceCompanies, companySlug, switchCompany } = useAuth()
  const onChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      void switchCompany(e.target.value)
    },
    [switchCompany]
  )
  const label = workspaceCompanies.find((c) => c.slug === companySlug)?.name ?? companyDisplayName(companySlug)
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
      {workspaceCompanies.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout, authBootstrapFailed, retryAuthBootstrap } = useAuth()
  const router = useRouter()
  const [employeeQaOpen, setEmployeeQaOpen] = useState(false)
  const [salesFocusMode, setSalesFocusMode] = useState(false)

  useEffect(() => {
    if (loading || user) return
    const slug = getCompanySlug()
    if (getTokenForSlug(slug)) return
    router.push('/login')
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

  if (authBootstrapFailed && !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa', padding: 24 }}>
        <div
          style={{
            maxWidth: 420,
            background: '#fff',
            border: '1px solid #e8e9ef',
            borderRadius: 16,
            padding: '28px 24px',
            boxShadow: '0 4px 24px rgba(0,0,0,.06)',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1d23', marginBottom: 10 }}>Не удалось восстановить сессию</div>
          <p style={{ margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.55, marginBottom: 18 }}>
            Часто это краткий сбой сети или бэкенд ещё не поднялся после обновления страницы. Сессия не сброшена — нажмите «Повторить» или обновите страницу ещё раз.
          </p>
          <button
            type="button"
            onClick={() => void retryAuthBootstrap()}
            disabled={loading}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              background: '#1a6b3c',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Загрузка…' : 'Повторить'}
          </button>
        </div>
      </div>
    )
  }

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
        <aside style={{ width: 268, background: '#fff', borderRight: '1px solid #e8e9ef', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #e8e9ef' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/kelyanmedia-logo.png" alt="" style={{ height: 28, width: 'auto', maxWidth: 56, objectFit: 'contain' }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23' }}>Задачи</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <CompanyWorkspaceSelect readOnly={user.multi_company_access !== true} />
            </div>
          </div>
          <nav style={{ padding: 14, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
            <button
              type="button"
              onClick={() => setEmployeeQaOpen(true)}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid #e8e9ef',
                background: '#fff',
                color: '#1a6b3c',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.04em',
              }}
              title="Справка: задачи, выплаты, кнопки в таблице, реквизиты"
            >
              Q&amp;A
            </button>
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
        <EmployeeQaDrawer open={employeeQaOpen} onClose={() => setEmployeeQaOpen(false)} />
      </div>
    )
  }

  const canUseSalesFocusMode =
    router.pathname.startsWith('/sales/client-base') ||
    router.pathname.startsWith('/sales/companies')
  const isSidebarHidden = canUseSalesFocusMode && salesFocusMode

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 260,
          background: '#fff',
          borderRight: '1px solid #e8e9ef',
          display: isSidebarHidden ? 'none' : 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
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
              if (n.administrationDdsInput) {
                return user.role === 'administration'
              }
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
              if (n.salesClientBase && user.role !== 'admin') return false
              if (n.salesCompanies) {
                if (user.role === 'admin') return true
                if (user.role !== 'manager' || user.can_view_sales !== true) return false
              }
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
        {canUseSalesFocusMode ? (
          <button
            type="button"
            onClick={() => setSalesFocusMode((v) => !v)}
            title={
              salesFocusMode
                ? 'Вернуть левое меню и обычный режим'
                : 'Скрыть левое меню и развернуть рабочую область'
            }
            style={{
              position: 'fixed',
              top: 12,
              right: 74,
              zIndex: 60,
              width: 34,
              height: 34,
              borderRadius: 9,
              border: '1px solid #d7dde8',
              background: '#fff',
              color: '#334155',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(15,23,42,.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'inherit',
            }}
            aria-label={salesFocusMode ? 'Вернуть левое меню' : 'Скрыть левое меню'}
          >
            {salesFocusMode ? '←' : '⤢'}
          </button>
        ) : null}
        <div style={{ position: 'fixed', top: 12, right: 20, zIndex: 50 }}>
          <NotificationBell />
        </div>
        {children}
      </div>
    </div>
  )
}
