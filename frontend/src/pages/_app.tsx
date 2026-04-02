import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import axios from 'axios'
import { AuthProvider } from '@/context/AuthContext'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import '@/styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      const r = e.reason
      if (axios.isAxiosError(r)) {
        e.preventDefault()
      }
    }
    window.addEventListener('unhandledrejection', handler)
    return () => window.removeEventListener('unhandledrejection', handler)
  }, [])

  return (
    <AppErrorBoundary>
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    </AppErrorBoundary>
  )
}
