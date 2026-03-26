import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import { AuthProvider } from '@/context/AuthContext'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason?.isAxiosError || e.reason?.name === 'AxiosError') {
        e.preventDefault()
      }
    }
    window.addEventListener('unhandledrejection', handler)
    return () => window.removeEventListener('unhandledrejection', handler)
  }, [])

  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  )
}
