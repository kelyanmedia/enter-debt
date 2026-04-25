import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { PageHeader } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { SalesCompaniesTable } from '@/components/SalesCompaniesTable'

/**
 * Мастер-база лидов / компаний (CRM без воронок): админ видит всё и назначает менеджеров.
 * Данные и API — в следующих итерациях; сейчас каркас UI в духе Projects Cost.
 */
export default function SalesClientBasePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') {
      void router.replace('/')
    }
  }, [loading, user, router])

  if (loading || !user || user.role !== 'admin') return null

  return (
    <Layout>
      <PageHeader
        title="Клиентская база"
        subtitle="Общая база компаний и контактов. Назначайте проработку менеджерам; история статусов и комментариев — без воронок (как в вашей таблице). Раздел «Компании» — персональные списки менеджеров."
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <Link href="/sales/companies" style={{ fontSize: 13, fontWeight: 600, color: '#1a6b3c' }}>
            Компании (списки менеджеров) →
          </Link>
        </div>
        <SalesCompaniesTable scope="all" isAdmin />

        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, maxWidth: 900 }}>
          Админ ведёт общую базу и назначает менеджера в поле «Кто прорабатывает». Менеджер увидит назначенные записи в разделе «Компании».
        </div>
      </div>
    </Layout>
  )
}
