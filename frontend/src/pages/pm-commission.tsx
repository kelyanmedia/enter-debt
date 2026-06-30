import { useEffect } from 'react'
import { useRouter } from 'next/router'

/** Старый URL — перенаправление на единый раздел с переключателем МОП/ПМ. */
export default function PmCommissionRedirect() {
  const router = useRouter()

  useEffect(() => {
    void router.replace('/commissions?area=pm')
  }, [router])

  return null
}
