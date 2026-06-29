import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Layout from '@/components/Layout'
import { useAuth } from '@/context/AuthContext'
import { SalesCompaniesTable } from '@/components/SalesCompaniesTable'
import { SalesLeadCards } from '@/components/SalesLeadCards'

type ViewMode = 'cards' | 'table'

const viewTabs: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'cards', label: 'Карточки', icon: '▦' },
  { key: 'table', label: 'Таблица', icon: '☰' },
]

export default function SalesClientBasePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') {
      void router.replace('/')
    }
  }, [loading, user, router])

  if (loading || !user || user.role !== 'admin') return null

  return (
    <Layout>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f4f5f7' }}>
        <div style={{
          padding: '20px 28px 16px',
          background: '#f4f5f7',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: '-.02em' }}>
                Клиентская база
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b', lineHeight: 1.45, maxWidth: 520 }}>
                Мастер-база компаний. Назначайте менеджерам, ведите историю взаимодействий.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{
                display: 'inline-flex',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: 3,
                boxShadow: '0 1px 2px rgba(15,23,42,.04)',
              }}>
                {viewTabs.map(v => {
                  const active = viewMode === v.key
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setViewMode(v.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 7, border: 'none',
                        background: active ? '#f1f5f9' : 'transparent',
                        color: active ? '#0f172a' : '#64748b',
                        fontSize: 13, fontWeight: active ? 600 : 500,
                        cursor: 'pointer', fontFamily: 'inherit',
                        boxShadow: active ? '0 1px 2px rgba(15,23,42,.06)' : 'none',
                        transition: 'all .15s',
                      }}
                    >
                      <span style={{ fontSize: 14, opacity: active ? 1 : 0.7 }}>{v.icon}</span>
                      {v.label}
                    </button>
                  )
                })}
              </div>

              <Link
                href="/sales/companies"
                style={{
                  fontSize: 13, fontWeight: 600, color: '#1a6b3c',
                  textDecoration: 'none', padding: '8px 12px',
                  borderRadius: 8, border: '1px solid #bbf7d0', background: '#fff',
                }}
              >
                Компании менеджеров →
              </Link>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '0 28px 28px' }}>
          {viewMode === 'cards' ? (
            <SalesLeadCards scope="all" isAdmin />
          ) : (
            <SalesCompaniesTable scope="all" isAdmin />
          )}
        </div>
      </div>
    </Layout>
  )
}
