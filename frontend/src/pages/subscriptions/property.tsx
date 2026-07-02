import Layout from '@/components/Layout'
import { PageHeader } from '@/components/ui'
import { SubscriptionsTopTabs } from '@/components/SubscriptionGuide'
import { CompanyAssetsSection } from '@/components/CompanyAssetsSection'

export default function SubscriptionPropertyPage() {
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
          title="Имущество"
          subtitle="Учёт купленных активов: мебель, техника, инвентарь — с фото, датой и контактами продавца"
        />
        <div style={{ padding: '22px 24px 28px', overflowY: 'auto', flex: 1 }}>
          <CompanyAssetsSection />
        </div>
      </div>
    </Layout>
  )
}
