import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import {
  PageHeader,
  Card,
  Th,
  Td,
  PartnerAvatar,
  statusBadge,
  formatMoneyNumber,
  formatDate,
  BtnOutline,
  BtnPrimary,
  ConfirmModal,
  Empty,
} from '@/components/ui'
import api from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

const RETENTION_DAYS = 30

function daysLeftInTrash(trashedAt: string | null | undefined): number {
  if (!trashedAt) return 0
  const t = new Date(trashedAt).getTime()
  if (Number.isNaN(t)) return 0
  const deadline = t + RETENTION_DAYS * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000)))
}

interface TrashedPayment {
  id: number
  description: string
  amount: number
  payment_type: string
  status: string
  trashed_at?: string | null
  partner: { id: number; name: string; manager?: { name: string } }
}

interface TrashedPartner {
  id: number
  name: string
  partner_type: string
  trashed_at?: string | null
  manager?: { name: string }
  open_payments_count?: number
}

type Tab = 'payments' | 'partners'

export default function TrashPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('payments')
  const [payments, setPayments] = useState<TrashedPayment[]>([])
  const [partners, setPartners] = useState<TrashedPartner[]>([])
  const [fetching, setFetching] = useState(false)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [restorePaymentId, setRestorePaymentId] = useState<number | null>(null)
  const [restorePartnerId, setRestorePartnerId] = useState<number | null>(null)
  const [wipePaymentId, setWipePaymentId] = useState<number | null>(null)
  const [wipePartnerId, setWipePartnerId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!user || user.role !== 'admin') return
    setFetching(true)
    try {
      const [rp, rpart] = await Promise.all([
        api.get('trash/payments'),
        api.get('trash/partners'),
      ])
      setPayments(rp.data)
      setPartners(rpart.data)
    } catch {
      setPayments([])
      setPartners([])
    } finally {
      setFetching(false)
    }
  }, [user])

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') router.replace('/')
  }, [user, loading, router])

  useEffect(() => {
    void load()
  }, [load])

  const runRestorePayment = async () => {
    if (restorePaymentId === null) return
    await api.post(`trash/payments/${restorePaymentId}/restore`)
    await load()
  }

  const runRestorePartner = async () => {
    if (restorePartnerId === null) return
    await api.post(`trash/partners/${restorePartnerId}/restore`)
    await load()
  }

  const runWipePayment = async () => {
    if (wipePaymentId === null) return
    await api.delete(`trash/payments/${wipePaymentId}`)
    await load()
  }

  const runWipePartner = async () => {
    if (wipePartnerId === null) return
    await api.delete(`trash/partners/${wipePartnerId}`)
    await load()
  }

  const runPurgeExpired = async () => {
    setPurgeBusy(true)
    try {
      await api.post('trash/purge-expired')
      await load()
    } finally {
      setPurgeBusy(false)
    }
  }

  if (loading || !user || user.role !== 'admin') return null

  const tabStyle = (t: Tab) => ({
    padding: '8px 20px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    background: tab === t ? '#475569' : '#f0f1f5',
    color: tab === t ? '#fff' : '#6b7280',
    transition: 'all .15s',
  })

  return (
    <Layout>
      <PageHeader
        title="Корзина"
        subtitle={`Удалённые из списков проекты и компании. Хранение ${RETENTION_DAYS} суток, затем автоматическое удаление из базы (ещё и по расписанию сервера). Архив — отдельно, в пункте «Архив».`}
        action={
          <BtnOutline onClick={runPurgeExpired} disabled={purgeBusy || fetching}>
            {purgeBusy ? '…' : `Очистить просроченные (> ${RETENTION_DAYS} дн.)`}
          </BtnOutline>
        }
      />

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button type="button" style={tabStyle('payments')} onClick={() => setTab('payments')}>
            Проекты ({payments.length})
          </button>
          <button type="button" style={tabStyle('partners')} onClick={() => setTab('partners')}>
            Компании ({partners.length})
          </button>
        </div>

        {tab === 'payments' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Компания</Th>
                  <Th>Проект</Th>
                  <Th>Тип</Th>
                  <Th>Сумма</Th>
                  <Th>Удалён</Th>
                  <Th>Осталось</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PartnerAvatar name={p.partner.name} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                          <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.partner.manager?.name}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>{p.description}</Td>
                    <Td>{statusBadge(p.payment_type)}</Td>
                    <Td>{formatMoneyNumber(p.amount)}</Td>
                    <Td style={{ fontSize: 13 }}>{p.trashed_at ? formatDate(p.trashed_at) : '—'}</Td>
                    <Td style={{ fontWeight: 600, color: daysLeftInTrash(p.trashed_at) <= 3 ? '#e84040' : '#64748b' }}>
                      {daysLeftInTrash(p.trashed_at)} дн.
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap' }}>
                      <BtnPrimary onClick={() => setRestorePaymentId(p.id)} style={{ padding: '6px 12px', fontSize: 12, marginRight: 8 }}>
                        Восстановить
                      </BtnPrimary>
                      <BtnOutline onClick={() => setWipePaymentId(p.id)} style={{ padding: '6px 12px', fontSize: 12, color: '#e84040' }}>
                        Удалить навсегда
                      </BtnOutline>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payments.length === 0 && !fetching && <Empty text="В корзине нет проектов" />}
          </Card>
        )}

        {tab === 'partners' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Компания</Th>
                  <Th>Тип</Th>
                  <Th>Менеджер</Th>
                  <Th>Удалена</Th>
                  <Th>Осталось</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PartnerAvatar name={p.name} />
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                      </div>
                    </Td>
                    <Td>{statusBadge(p.partner_type)}</Td>
                    <Td>{p.manager?.name || '—'}</Td>
                    <Td style={{ fontSize: 13 }}>{p.trashed_at ? formatDate(p.trashed_at) : '—'}</Td>
                    <Td style={{ fontWeight: 600, color: daysLeftInTrash(p.trashed_at) <= 3 ? '#e84040' : '#64748b' }}>
                      {daysLeftInTrash(p.trashed_at)} дн.
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap' }}>
                      <BtnPrimary onClick={() => setRestorePartnerId(p.id)} style={{ padding: '6px 12px', fontSize: 12, marginRight: 8 }}>
                        Восстановить
                      </BtnPrimary>
                      <BtnOutline onClick={() => setWipePartnerId(p.id)} style={{ padding: '6px 12px', fontSize: 12, color: '#e84040' }}>
                        Удалить навсегда
                      </BtnOutline>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {partners.length === 0 && !fetching && <Empty text="В корзине нет компаний" />}
          </Card>
        )}
      </div>

      <ConfirmModal
        open={restorePaymentId !== null}
        onClose={() => setRestorePaymentId(null)}
        title="Восстановить проект?"
        message="Проект снова появится в списках (если компания не в корзине)."
        confirmLabel="Восстановить"
        danger={false}
        onConfirm={runRestorePayment}
      />
      <ConfirmModal
        open={restorePartnerId !== null}
        onClose={() => setRestorePartnerId(null)}
        title="Восстановить компанию?"
        message="Компания снова будет доступна в списке партнёров."
        confirmLabel="Восстановить"
        danger={false}
        onConfirm={runRestorePartner}
      />
      <ConfirmModal
        open={wipePaymentId !== null}
        onClose={() => setWipePaymentId(null)}
        title="Удалить проект навсегда?"
        message="Данные проекта и строк графика будут безвозвратно удалены из базы."
        confirmLabel="Удалить"
        onConfirm={runWipePayment}
      />
      <ConfirmModal
        open={wipePartnerId !== null}
        onClose={() => setWipePartnerId(null)}
        title="Удалить компанию навсегда?"
        message="Компания и все связанные проекты будут безвозвратно удалены из базы."
        confirmLabel="Удалить"
        onConfirm={runWipePartner}
      />
    </Layout>
  )
}
