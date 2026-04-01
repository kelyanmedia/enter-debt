import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import { SubscriptionsTopTabs } from '@/components/SubscriptionGuide'

/** /subscriptions → первая подкатегория; выбор раздела — вкладками сверху на страницах гайда. */
export default function SubscriptionsIndexPage() {
  const router = useRouter()
  useEffect(() => {
    void router.replace('/subscriptions/household')
  }, [router])
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
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8fa8', fontSize: 14 }}>
          Загрузка…
        </div>
      </div>
    </Layout>
  )
}
