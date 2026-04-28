import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'

/** /sales — перенаправление на первый доступный подраздел. */
export default function SalesIndexPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading || !user) return
    if (user.role === 'admin') {
      void router.replace('/sales/client-base')
      return
    }
    if ((user.role === 'manager' || user.role === 'administration') && user.can_view_sales === true) {
      void router.replace('/sales/companies')
      return
    }
    void router.replace('/')
  }, [loading, user, router])

  return null
}
