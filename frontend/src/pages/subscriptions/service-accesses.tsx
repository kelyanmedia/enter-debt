import Layout from '@/components/Layout'
import { PageHeader } from '@/components/ui'
import { SubscriptionsTopTabs } from '@/components/SubscriptionGuide'
import { AccessEntriesSection } from '@/components/AccessEntriesSection'

export default function ServiceAccessesPage() {
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
        <PageHeader
          title="Доступы сервисов"
          subtitle="Отдельный список: сервис, тип сервиса, логин, пароль"
        />
        <div style={{ padding: '22px 24px 28px', overflowY: 'auto', flex: 1 }}>
          <AccessEntriesSection view="services" />
        </div>
      </div>
    </Layout>
  )
}
