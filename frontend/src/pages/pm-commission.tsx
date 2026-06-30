import { useEffect } from 'react'
import { useRouter } from 'next/router'

/** Старый URL — единый раздел комиссий, по умолчанию «Комиссия менеджера». */
export default function PmCommissionRedirect() {
  const router = useRouter()

  useEffect(() => {
    void router.replace('/commissions')
  }, [router])

  return null
}
