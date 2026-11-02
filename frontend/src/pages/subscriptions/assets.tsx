import Layout from '@/components/Layout'
import { PageHeader } from '@/components/ui'
import { SubscriptionsTopTabs } from '@/components/SubscriptionGuide'
import { EventAssetsSection } from '@/components/EventAssetsSection'

export default function SubscriptionAssetsPage() {
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
          title="Активы"
          subtitle="Позиции для мероприятий: стойки, оборудование — с отметками вывоза и возврата, PDF для печати"
        />
        <div style={{ padding: '22px 24px 28px', overflowY: 'auto', flex: 1 }}>
          <EventAssetsSection />
        </div>
      </div>
    </Layout>
  )
}
