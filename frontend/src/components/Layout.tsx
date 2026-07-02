import { ReactNode, useEffect, useCallback, useState, type ChangeEvent } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { NotificationBell } from '@/components/NotificationDrawer'
import { EmployeeQaDrawer } from '@/components/EmployeeSidebarGuide'
import { companyDisplayName, getCompanySlug, getTokenForSlug } from '@/lib/company'
import { canAccessFinanceSection, canAccessPersonalCashFlow } from '@/lib/roles'
import { hasCrmPipelineAccess, hasSalesCompaniesAccess } from '@/lib/salesAccess'

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
  /** Только для роли «Менеджер» (ПМ) — экран «Моя комиссия» */
  managerOnly?: boolean
  administrationHidden?: boolean
  accountantHidden?: boolean
  badge?: string
  /** Подсветка пункта для всех путей с этим префиксом (например /subscriptions/*) */
  activePathPrefix?: string
  /** Раздел «Продажи» — мастер-база лидов, только админ */
  salesClientBase?: boolean
  /** Раздел «Продажи» — список компаний менеджера (и админ) */
  salesCompanies?: boolean
  /** Раздел «Продажи» — воронки/kanban: admin + mop */
  salesPipeline?: boolean
  /** Раздел «Продажи» — аналитика */
  salesAnalytics?: boolean
  /** Раздел «Продажи» — календарь встреч */
  salesCalendar?: boolean
  financeSectionKey?: 'ceo' | 'pl' | 'cashflow' | 'projects_cost' | 'received_payments' | 'expenses' | 'lending'
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
      { href: '/ceo', label: 'CEO Dashboard', icon: '📊', managerHidden: true, financeSectionKey: 'ceo' },
      { href: '/finance/pl', label: 'P&L', icon: '📈', financeTeam: true, financeSectionKey: 'pl' },
      { href: '/finance/cashflow', label: 'ДДС', icon: '💸', financeTeam: true, financeSectionKey: 'cashflow' },
      { href: '/finance/projects-cost', label: 'Projects Cost', icon: '🧮', financeTeam: true, financeSectionKey: 'projects_cost' },
      { href: '/received-payments', label: 'Оплаты', icon: '💳', financeTeam: true, financeSectionKey: 'received_payments' },
      { href: '/finance/expenses', label: 'Расходы', icon: '📤', financeTeam: true, financeSectionKey: 'expenses' },
      { href: '/finance/lending', label: 'Кредитование', icon: '🏦', financeTeam: true, financeSectionKey: 'lending' },
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
      {
        href: '/subscriptions/property',
        label: 'Имущество',
        icon: '🏷️',
        activePathPrefix: '/subscriptions/property',
      },
    ],
  },
  {
    title: 'Продажи',
    hideForFinancier: true,
    items: [
      {
        href: '/sales/pipeline',
        label: 'Воронки',
        icon: '📊',
        salesPipeline: true,
        activePathPrefix: '/sales/pipeline',
      },
      {
        href: '/sales/client-base',
        label: 'Клиентская база',
        icon: '🗂️',
        salesClientBase: true,
        activePathPrefix: '/sales/client-base',
      },
      {
        href: '/sales/analytics',
        label: 'Аналитика',
        icon: '📈',
        salesAnalytics: true,
        activePathPrefix: '/sales/analytics',
      },
      {
        href: '/sales/calendar',
        label: 'Календарь',
        icon: '📅',
        salesCalendar: true,
        activePathPrefix: '/sales/calendar',
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

function filterVisibleNavItems(section: NavSection, user: { role: string; can_view_sales?: boolean; can_view_crm?: boolean; can_view_subscriptions?: boolean; can_view_accesses?: boolean }) {
  return section.items.filter(n => {
    if (n.administrationDdsInput) return user.role === 'administration'
    if (n.adminOnly && user.role !== 'admin') return false
    if (
      n.financeTeam &&
      user.role !== 'admin' &&
      user.role !== 'financier' &&
      user.role !== 'accountant' &&
      !(n.financeSectionKey === 'cashflow' && canAccessPersonalCashFlow(user))
    ) return false
    if (
      n.financeSectionKey &&
      !canAccessFinanceSection(user, n.financeSectionKey) &&
      !(n.financeSectionKey === 'cashflow' && canAccessPersonalCashFlow(user))
    ) return false
    if (n.accountantHidden && user.role === 'accountant') return false
    if (n.administrationHidden && user.role === 'administration') return false
    if (n.managerHidden && (user.role === 'manager' || user.role === 'administration')) return false
    if (n.managerOnly && user.role !== 'manager') return false
    if (n.salesClientBase && user.role !== 'admin') return false
    if (n.salesPipeline) return hasCrmPipelineAccess(user)
    if (n.salesAnalytics) return hasCrmPipelineAccess(user)
    if (n.salesCalendar) return hasCrmPipelineAccess(user)
    if (n.salesCompanies) return hasSalesCompaniesAccess(user)
    if (user.role === 'administration') {
      if (n.href.startsWith('/subscriptions/accesses') || n.href.startsWith('/subscriptions/property')) {
        if (!user.can_view_accesses) return false
      } else if (n.href.startsWith('/subscriptions')) {
        if (!user.can_view_subscriptions) return false
      }
    }
    return true
  })
}

function NavLinkItem({
  n,
  active,
  narrow,
}: {
  n: NavItem
  active: boolean
  narrow: boolean
}) {
  return (
    <Link key={n.href} href={n.href} style={{ textDecoration: 'none' }} title={narrow ? n.label : undefined}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: narrow ? 'center' : 'flex-start',
          gap: narrow ? 0 : 10,
          padding: narrow ? '10px 0' : '9px 12px',
          borderRadius: 9,
          marginBottom: 2,
          cursor: 'pointer',
          fontSize: 13.5,
          fontWeight: 500,
          background: active ? '#e8f5ee' : 'transparent',
          color: active ? '#1a6b3c' : '#8a8fa8',
          borderLeft: narrow ? 'none' : active ? '2px solid #1a6b3c' : '2px solid transparent',
          transition: 'all .15s',
        }}
      >
        <span style={{ fontSize: narrow ? 18 : 15, lineHeight: 1 }}>{n.icon}</span>
        {!narrow && n.label}
      </div>
    </Link>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout, authBootstrapFailed, retryAuthBootstrap } = useAuth()
  const router = useRouter()
  const [employeeQaOpen, setEmployeeQaOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarManualExpand, setSidebarManualExpand] = useState(false)

  const isSalesRoute =
    router.pathname.startsWith('/sales/client-base') ||
    router.pathname.startsWith('/sales/companies') ||
    router.pathname.startsWith('/sales/pipeline') ||
    router.pathname.startsWith('/sales/analytics') ||
    router.pathname.startsWith('/sales/calendar')

  // В разделе «Продажи» — сворачиваем в иконки; при уходе — разворачиваем обратно
  useEffect(() => {
    if (isSalesRoute) {
      setSidebarCollapsed(true)
      setSidebarManualExpand(false)
    } else {
      setSidebarCollapsed(false)
      setSidebarManualExpand(false)
    }
  }, [isSalesRoute])

  const sidebarNarrow = isSalesRoute && sidebarCollapsed && !sidebarManualExpand

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

  useEffect(() => {
    const mopAllowed = ['/sales/pipeline', '/sales/companies', '/sales/analytics', '/sales/calendar', '/commissions', '/profile']
    if (
      !loading &&
      user?.role === 'mop' &&
      !mopAllowed.some(p => router.pathname.startsWith(p))
    ) {
      router.replace('/sales/pipeline')
    }
  }, [loading, user, router.pathname, router])

  useEffect(() => {
    const salesPaths = ['/sales/pipeline', '/sales/analytics', '/sales/calendar', '/sales/companies', '/sales/client-base']
    const onSales = salesPaths.some(p => router.pathname.startsWith(p))
    if (!loading && user && onSales && user.role !== 'admin' && user.role !== 'mop') {
      const pipelinePages = ['/sales/pipeline', '/sales/analytics', '/sales/calendar', '/sales/client-base']
      if (pipelinePages.some(p => router.pathname.startsWith(p)) && !hasCrmPipelineAccess(user)) {
        router.replace(hasSalesCompaniesAccess(user) ? '/sales/companies' : '/')
        return
      }
      if (router.pathname.startsWith('/sales/companies') && !hasSalesCompaniesAccess(user)) {
        router.replace(hasCrmPipelineAccess(user) ? '/sales/pipeline' : '/')
      }
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
    mop: 'МОП',
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
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {children}
          </div>
        </div>
        <EmployeeQaDrawer open={employeeQaOpen} onClose={() => setEmployeeQaOpen(false)} />
      </div>
    )
  }

  if (user.role === 'mop') {
    const mopNav = [
      { href: '/sales/pipeline', label: 'Воронки', icon: '📊' },
      { href: '/sales/analytics', label: 'Аналитика', icon: '📈' },
      { href: '/sales/calendar', label: 'Календарь', icon: '📅' },
      { href: '/sales/companies', label: 'Мои компании', icon: '🏢' },
      { href: '/commissions', label: 'Комиссия', icon: '💰' },
      { href: '/profile', label: 'Профиль', icon: '👤' },
    ]
    const mopNarrow = sidebarCollapsed && !sidebarManualExpand
    const toggleMopSidebar = () => {
      if (sidebarManualExpand) {
        setSidebarManualExpand(false)
        setSidebarCollapsed(true)
      } else {
        setSidebarManualExpand(true)
        setSidebarCollapsed(false)
      }
    }
    return (
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
        <aside style={{
          width: mopNarrow ? 58 : 240,
          background: '#fff',
          borderRight: '1px solid #e8e9ef',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width .2s ease',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            padding: mopNarrow ? '16px 0 12px' : '20px 16px 16px',
            borderBottom: '1px solid #e8e9ef',
            display: 'flex',
            alignItems: 'center',
            justifyContent: mopNarrow ? 'center' : 'flex-start',
            gap: 8,
          }}>
            <img src="/kelyanmedia-logo.png" alt="" style={{ height: 28, width: 'auto', maxWidth: mopNarrow ? 36 : 56, objectFit: 'contain' }} />
            {!mopNarrow && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23' }}>Продажи</div>
                <div style={{ fontSize: 10, color: '#8a8fa8' }}>МОП-кабинет</div>
              </div>
            )}
          </div>
          {!mopNarrow && (
            <div style={{ padding: '0 16px 12px' }}>
              <CompanyWorkspaceSelect readOnly />
            </div>
          )}
          <div style={{ padding: mopNarrow ? '4px 6px 8px' : '0 10px 8px', borderBottom: '1px solid #e8e9ef', flexShrink: 0 }}>
            <button
              type="button"
              onClick={toggleMopSidebar}
              title={mopNarrow ? 'Развернуть меню' : 'Свернуть в иконки'}
              style={{
                width: '100%',
                height: 30,
                borderRadius: 8,
                border: '1px solid #e8e9ef',
                background: '#f8fafc',
                color: '#5c6378',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontFamily: 'inherit',
              }}
            >
              {mopNarrow ? '→' : '←'}
              {!mopNarrow && <span style={{ fontSize: 11, fontWeight: 600 }}>Свернуть</span>}
            </button>
          </div>
          <nav style={{ padding: mopNarrow ? '8px 6px' : 14, flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {!mopNarrow && (
              <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8fa8', letterSpacing: '.07em', textTransform: 'uppercase', padding: '0 4px 8px' }}>Продажи</div>
            )}
            {mopNav.map(n => {
              const active = router.pathname.startsWith(n.href)
              return (
                <Link key={n.href} href={n.href} style={{ textDecoration: 'none' }} title={mopNarrow ? n.label : undefined}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: mopNarrow ? 'center' : 'flex-start',
                    gap: mopNarrow ? 0 : 10,
                    padding: mopNarrow ? '10px 0' : '10px 12px',
                    borderRadius: 9,
                    marginBottom: 2,
                    cursor: 'pointer',
                    fontSize: 13.5,
                    fontWeight: 500,
                    background: active ? '#e8f5ee' : 'transparent',
                    color: active ? '#1a6b3c' : '#8a8fa8',
                    borderLeft: mopNarrow ? 'none' : active ? '2px solid #1a6b3c' : '2px solid transparent',
                  }}>
                    <span style={{ fontSize: mopNarrow ? 18 : 15 }}>{n.icon}</span>
                    {!mopNarrow && n.label}
                  </div>
                </Link>
              )
            })}
          </nav>
          <div style={{ padding: mopNarrow ? '10px 6px' : '14px 10px', borderTop: '1px solid #e8e9ef' }}>
            {mopNarrow ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div title={user.name} style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{initials}</div>
                <button type="button" onClick={logout} title="Выйти" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}>↩</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f5f6fa', borderRadius: 9 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: '#8a8fa8' }}>МОП</div>
                </div>
                <button type="button" onClick={logout} title="Выйти" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}>↩</button>
              </div>
            )}
          </div>
        </aside>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {children}
          </div>
        </div>
      </div>
    )
  }

  const canUseSalesFocusMode = isSalesRoute
  const toggleSidebar = () => {
    if (sidebarManualExpand) {
      setSidebarManualExpand(false)
      setSidebarCollapsed(true)
    } else {
      setSidebarManualExpand(true)
      setSidebarCollapsed(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: sidebarNarrow ? 58 : 260,
          background: '#fff',
          borderRight: '1px solid #e8e9ef',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width .2s ease',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Logo */}
        <div style={{
          padding: sidebarNarrow ? '16px 0 12px' : '20px 16px 16px',
          borderBottom: '1px solid #e8e9ef',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarNarrow ? 'center' : 'flex-start',
          gap: 8,
          flexDirection: sidebarNarrow ? 'column' : 'row',
        }}>
          <img
            src="/kelyanmedia-logo.png"
            alt="KelyanMedia"
            style={{ height: sidebarNarrow ? 28 : 32, width: 'auto', maxWidth: sidebarNarrow ? 36 : 64, objectFit: 'contain', flexShrink: 0, display: 'block' }}
          />
          {!sidebarNarrow && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2, color: '#1a1d23', whiteSpace: 'nowrap' }}>
                Финансовый модуль
              </div>
              <CompanyWorkspaceSelect />
            </div>
          )}
        </div>

        {/* Toggle — только в разделе Продажи */}
        {canUseSalesFocusMode && (
          <div style={{
            padding: sidebarNarrow ? '4px 6px 8px' : '0 10px 8px',
            borderBottom: sidebarNarrow ? '1px solid #e8e9ef' : 'none',
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={toggleSidebar}
              title={sidebarNarrow ? 'Развернуть меню' : 'Свернуть в иконки'}
              style={{
                width: '100%',
                height: 30,
                borderRadius: 8,
                border: '1px solid #e8e9ef',
                background: '#f8fafc',
                color: '#5c6378',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontFamily: 'inherit',
              }}
              aria-label={sidebarNarrow ? 'Развернуть меню' : 'Свернуть меню'}
            >
              {sidebarNarrow ? '→' : '←'}
              {!sidebarNarrow && <span style={{ fontSize: 11, fontWeight: 600 }}>Свернуть</span>}
            </button>
          </div>
        )}

        {/* Nav */}
        <nav style={{ padding: sidebarNarrow ? '8px 6px' : '14px 10px', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {NAV_SECTIONS.map((section, si) => {
            if (section.hideForFinancier && user.role === 'financier') return null
            const visible = filterVisibleNavItems(section, user)
            if (visible.length === 0) return null
            return (
              <div key={section.title} style={{ marginTop: si > 0 ? (sidebarNarrow ? 8 : 12) : 0 }}>
                {!sidebarNarrow && <div style={sectionHeadingStyle}>{section.title}</div>}
                {sidebarNarrow && si > 0 && (
                  <div style={{ height: 1, background: '#e8e9ef', margin: '6px 4px 8px' }} />
                )}
                {visible.map(n => {
                  const active = n.activePathPrefix
                    ? router.pathname.startsWith(n.activePathPrefix)
                    : router.pathname === n.href
                  return <NavLinkItem key={n.href} n={n} active={active} narrow={sidebarNarrow} />
                })}
              </div>
            )
          })}
        </nav>

        {user.role === 'admin' && (
          <div style={{ padding: sidebarNarrow ? '8px 6px' : '10px 10px 12px', borderTop: '1px solid #e8e9ef', flexShrink: 0 }}>
            <Link href="/trash" style={{ textDecoration: 'none' }} title={sidebarNarrow ? 'Корзина' : undefined}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: sidebarNarrow ? 'center' : 'flex-start',
                  gap: sidebarNarrow ? 0 : 10,
                  padding: sidebarNarrow ? '10px 0' : '9px 12px',
                  borderRadius: 9,
                  fontSize: 13.5,
                  fontWeight: 500,
                  background: router.pathname === '/trash' ? '#f1f5f9' : 'transparent',
                  color: router.pathname === '/trash' ? '#475569' : '#94a3b8',
                  borderLeft: sidebarNarrow ? 'none' : router.pathname === '/trash' ? '2px solid #64748b' : '2px solid transparent',
                }}
              >
                <span style={{ fontSize: sidebarNarrow ? 18 : 15 }}>🗑️</span>
                {!sidebarNarrow && 'Корзина'}
              </div>
            </Link>
            {!sidebarNarrow && (
              <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.35, padding: '4px 12px 0' }}>
                Удалённые проекты и компании до 30 дней; архив — в разделе «Архив».
              </div>
            )}
          </div>
        )}

        {/* User */}
        <div style={{ padding: sidebarNarrow ? '10px 6px' : '14px 10px', borderTop: '1px solid #e8e9ef' }}>
          {sidebarNarrow ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div
                title={`${user.name} — ${roleLabel}`}
                style={{
                  width: 36, height: 36, borderRadius: '50%', background: '#1a6b3c',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'default',
                }}
              >
                {initials}
              </div>
              <button
                type="button"
                onClick={logout}
                title="Выйти"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}
              >
                ↩
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f5f6fa', borderRadius: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1a6b3c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: '#8a8fa8' }}>{roleLabel}</div>
              </div>
              <button onClick={logout} title="Выйти" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a8fa8', fontSize: 16, padding: 2 }}>↩</button>
            </div>
          )}
        </div>
      </aside>

      {/* Main — без правого отступа: контент на всю ширину, колокол поверх (fixed) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          minWidth: 0,
          width: '100%',
        }}
      >
        <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 120 }}>
          <NotificationBell />
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
