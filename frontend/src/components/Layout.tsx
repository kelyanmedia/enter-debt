import { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { NotificationBell } from '@/components/NotificationDrawer'

const NAV = [
  { href: '/', label: 'Дашборд', icon: '▦' },
  { href: '/ceo', label: 'CEO Dashboard', icon: '📊' },
  { href: '/payments', label: 'Проекты', icon: '₽', badge: 'overdue' },
  { href: '/partners', label: 'Партнёры', icon: '🤝' },
  { href: '/users', label: 'Пользователи', icon: '👥', adminOnly: true },
  { href: '/notifications', label: 'Уведомления', icon: '🔔' },
  { href: '/archive', label: 'Архив', icon: '🗄️', adminOnly: true },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  if (loading || !user) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa' }}>
      <div style={{ color: '#8a8fa8', fontSize: 14 }}>Загрузка...</div>
    </div>
  )

  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const roleLabel = { admin: 'Администратор', manager: 'Менеджер', accountant: 'Бухгалтерия' }[user.role]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f6fa' }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: '#fff', borderRight: '1px solid #e8e9ef', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid #e8e9ef', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, background: '#1a6b3c', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>EnterDebt</div>
            <div style={{ fontSize: 11, color: '#8a8fa8' }}>Enter Group</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '14px 10px', flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8fa8', letterSpacing: '.07em', textTransform: 'uppercase', padding: '6px 10px 8px' }}>Меню</div>
          {NAV.filter(n => !n.adminOnly || user.role === 'admin').map(n => {
            const active = router.pathname === n.href
            return (
              <Link key={n.href} href={n.href} style={{ textDecoration: 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  borderRadius: 9, marginBottom: 2, cursor: 'pointer', fontSize: 13.5, fontWeight: 500,
                  background: active ? '#e8f5ee' : 'transparent',
                  color: active ? '#1a6b3c' : '#8a8fa8',
                  borderLeft: active ? '2px solid #1a6b3c' : '2px solid transparent',
                  transition: 'all .15s',
                }}>
                  <span style={{ fontSize: 15 }}>{n.icon}</span>
                  {n.label}
                </div>
              </Link>
            )
          })}
        </nav>

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

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'fixed', top: 12, right: 20, zIndex: 50 }}>
          <NotificationBell />
        </div>
        {children}
      </div>
    </div>
  )
}
