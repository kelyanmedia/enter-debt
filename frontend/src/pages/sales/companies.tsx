import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { PageHeader } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { SalesCompaniesTable } from '@/components/SalesCompaniesTable'

/**
 * Список компаний в работе у менеджера (собственные записи + позже — выданные из базы админом).
 * Каркас UI; данные подключите отдельно.
 */
export default function SalesCompaniesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (
      !loading &&
      user &&
      user.role !== 'admin' &&
      (!['manager', 'administration'].includes(user.role) || user.can_view_sales !== true)
    ) {
      void router.replace('/')
    }
  }, [loading, user, router])

  if (
    loading ||
    !user ||
    (user.role !== 'admin' && (!['manager', 'administration'].includes(user.role) || user.can_view_sales !== true))
  ) return null

  const isAdmin = user.role === 'admin'

  return (
    <Layout>
      <PageHeader
        title="Компании"
        subtitle={
          isAdmin
            ? 'Как у менеджера: личный список проработки. Позже можно разделить режим «все менеджеры» и «только мои».'
            : 'Ваши компании и контакты: статусы, комментарии, назначение из клиентской базы (когда подключите бэкенд).'
        }
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {isAdmin ? (
            <Link href="/sales/client-base" style={{ fontSize: 13, fontWeight: 600, color: '#1a6b3c' }}>
              ← Клиентская база
            </Link>
          ) : null}
        </div>
        <SalesCompaniesTable scope="mine" isAdmin={isAdmin} />

        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, maxWidth: 900 }}>
          Здесь менеджер видит свои компании и может добавлять новые. Админ может добавлять записи себе или назначать их менеджерам из общей базы.
        </div>
      </div>
    </Layout>
  )
}
