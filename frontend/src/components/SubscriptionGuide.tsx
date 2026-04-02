import { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { PageHeader, Card } from '@/components/ui'
import { SubscriptionItemsSection, type SubscriptionCategory } from '@/components/SubscriptionItemsSection'
import { useAuth } from '@/context/AuthContext'

type Step = { title: string; body: ReactNode }

export const SUBSCRIPTION_TABS = [
  {
    href: '/subscriptions/household',
    label: 'Бытовые',
    icon: '🏠',
    title: 'Wi‑Fi, ЖКХ, аренда, сервисы офиса',
  },
  {
    href: '/subscriptions/phones',
    label: 'Номера телефонов',
    icon: '📱',
    title: 'SIM, АТС, тарифы',
  },
  {
    href: '/subscriptions/services',
    label: 'Подписки',
    icon: '🔄',
    title: 'SaaS, домены, лицензии',
  },
  {
    href: '/subscriptions/accesses',
    label: 'Доступы',
    icon: '🔐',
    title: 'Доступы сотрудников к сервисам и технике',
  },
  {
    href: '/subscriptions/service-accesses',
    label: 'Доступы сервисов',
    icon: '🧩',
    title: 'Отдельный список доступов к сервисам',
  },
] as const

export function SubscriptionsTopTabs() {
  const router = useRouter()
  const { user } = useAuth()
  const tabs = SUBSCRIPTION_TABS.filter((tab) => {
    if (user?.role !== 'administration') return true
    if (tab.href === '/subscriptions/accesses' || tab.href === '/subscriptions/service-accesses') {
      return !!user.can_view_accesses
    }
    return !!user.can_view_subscriptions
  })
  return (
    <div
      style={{
        flexShrink: 0,
        background: '#fff',
        borderBottom: '1px solid #e8e9ef',
        padding: '12px 24px 0',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 600, color: '#8a8fa8', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Категории
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 12 }}>
        {tabs.map((tab) => {
          const on = router.pathname === tab.href
          return (
            <Link key={tab.href} href={tab.href} style={{ textDecoration: 'none' }} title={tab.title}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: on ? 700 : 600,
                  border: on ? '1px solid #1a6b3c' : '1px solid #e8e9ef',
                  background: on ? '#e8f5ee' : '#fafbfc',
                  color: on ? '#1a6b3c' : '#64748b',
                  transition: 'background .15s, border-color .15s, color .15s',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }} aria-hidden>{tab.icon}</span>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function SubscriptionGuidePage({
  category,
  listTitle,
  title,
  subtitle,
  intro,
  examples,
  steps,
  future,
}: {
  category: SubscriptionCategory
  listTitle: string
  title: string
  subtitle: string
  intro: string
  examples: string[]
  steps: Step[]
  future: string
}) {
  return (
    <Layout>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <SubscriptionsTopTabs />
        <PageHeader title={title} subtitle={subtitle} />
        <div
          style={{
            padding: '22px 24px 28px',
            overflowY: 'auto',
            flex: 1,
            width: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
            alignSelf: 'stretch',
          }}
        >
        <SubscriptionItemsSection category={category} listTitle={listTitle} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10, marginTop: 8 }}>
          Справка
        </div>
        <Card style={{ padding: '20px 22px', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#334155', lineHeight: 1.6 }}>{intro}</p>
          {examples.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                Примеры
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#475569', fontSize: 14, lineHeight: 1.65 }}>
                {examples.map((ex) => (
                  <li key={ex}>{ex}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card style={{ padding: '20px 22px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>
            Как вести учёт
          </div>
          <ol style={{ margin: 0, paddingLeft: 22, color: '#334155', fontSize: 14, lineHeight: 1.65 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 12 }}>
                <strong style={{ color: '#1a1d23' }}>{s.title}</strong>
                <div style={{ marginTop: 4 }}>{s.body}</div>
              </li>
            ))}
          </ol>
        </Card>
        <Card style={{ padding: '16px 18px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
            Дальше в системе
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>{future}</p>
        </Card>
        </div>
      </div>
    </Layout>
  )
}
