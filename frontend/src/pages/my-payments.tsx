import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import { PageHeader, Card } from '@/components/ui'
import { EmployeePaymentHistory } from '@/components/EmployeePaymentHistory'

export default function MyPaymentsPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user && user.role !== 'employee') router.replace('/')
  }, [loading, user, router])

  if (loading || !user || user.role !== 'employee') return null

  return (
    <Layout>
      <PageHeader
        title="История выплат"
        subtitle="Отдельно от задач: фиксируйте переводы, период и сумму; можно прикрепить чек"
      />
      <div style={{ padding: '22px 24px', overflow: 'auto', flex: 1 }}>
        <Card style={{ padding: '18px 20px' }}>
          <EmployeePaymentHistory mode="employee" />
        </Card>
      </div>
    </Layout>
  )
}
