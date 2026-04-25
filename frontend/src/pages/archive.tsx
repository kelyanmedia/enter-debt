import { useEffect, useState, type ReactNode } from 'react'
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
  formatAmount,
  BtnOutline,
  ConfirmModal,
  Empty,
  Modal,
} from '@/components/ui'
import api from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return `${MONTHS_RU[parseInt(m, 10) - 1]} ${y}`
}

function hostingYearPeriodTitle(ym: string): string {
  const [y, m] = ym.split('-')
  const mi = parseInt(m, 10)
  const mon = MONTHS_RU[mi - 1] ?? m
  return `${y} год — ${mon}`
}

function sortArchiveMonths<T extends { month: string; id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.month.localeCompare(b.month) || a.id - b.id)
}

function Ro({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#8a8fa8',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: '#1a1d23', marginTop: 4, lineHeight: 1.45 }}>{children}</div>
    </div>
  )
}

interface PaymentMonthRow {
  id: number
  month: string
  due_date?: string | null
  amount?: number | null
  status: string
  description?: string | null
  note?: string | null
  paid_at?: string | null
  act_issued?: boolean
  act_issued_at?: string | null
}

interface ArchivedPayment {
  id: number
  description: string
  amount: number
  payment_type: string
  status: string
  paid_at?: string | null
  created_at: string
  updated_at?: string
  partner: { id: number; name: string; manager?: { name: string } }
  confirmed_by_user?: { name: string }
  contract_url?: string | null
  notify_accounting?: boolean
  project_category?: string | null
  day_of_month?: number | null
  deadline_date?: string | null
  contract_months?: number | null
  remind_days_before?: number
  service_period?: string | null
  billing_variant?: string | null
  billing_notes?: string | null
  hosting_contact_name?: string | null
  hosting_payment_kind?: string | null
  hosting_renewal_anchor?: string | null
  hosting_prepaid_years?: number | null
  received_payment_method?: string | null
  months?: PaymentMonthRow[]
}

interface ArchivedPartner {
  id: number
  name: string
  contact_person?: string
  phone?: string
  partner_type: string
  created_at: string
  updated_at?: string
  manager?: { name: string }
  open_payments_count: number
  overdue_count: number
}

type Tab = 'payments' | 'partners'

export default function ArchivePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [tab, setTab] = useState<Tab>('payments')
  const [payments, setPayments] = useState<ArchivedPayment[]>([])
  const [partners, setPartners] = useState<ArchivedPartner[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [fetching, setFetching] = useState(false)
  const [restorePartnerId, setRestorePartnerId] = useState<number | null>(null)
  const [deletePaymentId, setDeletePaymentId] = useState<number | null>(null)
  const [detailPayment, setDetailPayment] = useState<ArchivedPayment | null>(null)

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') router.replace('/')
  }, [user, loading, router])

  const load = async () => {
    if (!user || user.role !== 'admin') return
    setFetching(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)
      if (tab === 'payments') {
        const r = await api.get<ArchivedPayment[]>(`archive/payments?${params}`)
        setPayments(r.data)
      } else {
        const r = await api.get(`archive/partners?${params}`)
        setPartners(r.data)
      }
    } catch {
      setPayments([])
      setPartners([])
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => { load() }, [tab, dateFrom, dateTo, user])

  const runRestorePartner = async () => {
    if (restorePartnerId === null) return
    await api.post(`archive/partners/${restorePartnerId}/restore`)
    load()
  }

  const runPermanentDeletePayment = async () => {
    if (deletePaymentId === null) return
    await api.delete(`archive/payments/${deletePaymentId}`)
    setDetailPayment((d) => (d && d.id === deletePaymentId ? null : d))
    load()
  }

  if (loading || !user || user.role !== 'admin') return null

  const tabStyle = (t: Tab) => ({
    padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: 'none', fontFamily: 'inherit',
    background: tab === t ? '#1a6b3c' : '#f0f1f5',
    color: tab === t ? '#fff' : '#6b7280',
    transition: 'all .15s',
  })

  return (
    <Layout>
      <PageHeader
        title="Архив"
        subtitle="Два раздела: архивные проекты и архивные партнёры. По кнопке «Просмотр» открывается карточка с графиком и полями только для чтения. Фильтр по датам — только для администратора."
      />

      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        {/* Раздел: проекты | партнёры */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button style={tabStyle('payments')} onClick={() => setTab('payments')}>Проекты</button>
          <button style={tabStyle('partners')} onClick={() => setTab('partners')}>Партнёры</button>
        </div>

        {/* Фильтр по датам (для обоих разделов) */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em' }}>С</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ border: '1px solid #e8e9ef', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', color: '#1a1d23', fontFamily: 'inherit', background: '#fff' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#8a8fa8', textTransform: 'uppercase', letterSpacing: '.05em' }}>По</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ border: '1px solid #e8e9ef', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', color: '#1a1d23', fontFamily: 'inherit', background: '#fff' }}
            />
          </div>
          {(dateFrom || dateTo) && (
            <BtnOutline onClick={() => { setDateFrom(''); setDateTo('') }} style={{ padding: '8px 14px', fontSize: 12 }}>
              Сбросить
            </BtnOutline>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#8a8fa8' }}>
            {fetching ? 'Загрузка...' : `${tab === 'payments' ? payments.length : partners.length} ${tab === 'payments' ? 'проектов' : 'партнёров'}`}
          </div>
        </div>

        {/* Архивные проекты */}
        {tab === 'payments' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Описание</Th>
                  <Th>Тип</Th>
                  <Th>Сумма</Th>
                  <Th>Статус при архивации</Th>
                  <Th>Дата оплаты</Th>
                  <Th>Подтвердил</Th>
                  <Th>Добавлен</Th>
                  <Th style={{ width: 110 }}>Действия</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f1f5' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PartnerAvatar name={p.partner.name} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.partner.name}</div>
                          {p.partner.manager && <div style={{ fontSize: 11, color: '#8a8fa8' }}>{p.partner.manager.name}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td style={{ color: '#6b7280', maxWidth: 200 }}>{p.description}</Td>
                    <Td>{statusBadge(p.payment_type)}</Td>
                    <Td><span style={{ fontWeight: 700 }}>{formatMoneyNumber(p.amount)}</span></Td>
                    <Td>{statusBadge(p.status)}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.paid_at ? formatDate(p.paid_at) : '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.confirmed_by_user?.name || '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                    <Td>
                      <BtnOutline onClick={() => setDetailPayment(p)} style={{ padding: '6px 12px', fontSize: 12 }}>
                        Просмотр
                      </BtnOutline>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {payments.length === 0 && !fetching && <Empty text="Архивных проектов нет" />}
          </Card>
        )}

        {/* Архивные партнёры */}
        {tab === 'partners' && (
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Партнёр</Th>
                  <Th>Тип</Th>
                  <Th>Менеджер</Th>
                  <Th>Контакт</Th>
                  <Th>Открытых платежей</Th>
                  <Th>Добавлен</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f0f1f5' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PartnerAvatar name={p.name} />
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                      </div>
                    </Td>
                    <Td>{statusBadge(p.partner_type)}</Td>
                    <Td style={{ color: '#6b7280' }}>{p.manager?.name || '—'}</Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{p.contact_person || p.phone || '—'}</Td>
                    <Td>
                      {p.open_payments_count > 0
                        ? <span style={{ fontWeight: 600, color: p.overdue_count > 0 ? '#e84040' : '#1a6b3c' }}>{p.open_payments_count}</span>
                        : <span style={{ color: '#8a8fa8' }}>0</span>
                      }
                    </Td>
                    <Td style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(p.created_at)}</Td>
                    <Td>
                      <BtnOutline onClick={() => setRestorePartnerId(p.id)} style={{ padding: '5px 12px', fontSize: 12, color: '#1a6b3c' }}>
                        ↩ Восстановить
                      </BtnOutline>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {partners.length === 0 && !fetching && <Empty text="Архивных партнёров нет" />}
          </Card>
        )}
      </div>

      <Modal
        open={detailPayment !== null}
        onClose={() => setDetailPayment(null)}
        title={detailPayment ? `Архив · ${detailPayment.description}` : 'Архив'}
        width={640}
        zIndex={12000}
        footer={
          detailPayment ? (
            <>
              <BtnOutline onClick={() => setDetailPayment(null)} style={{ padding: '8px 16px', fontSize: 13 }}>
                Закрыть
              </BtnOutline>
              <BtnOutline
                onClick={() => {
                  const id = detailPayment.id
                  setDetailPayment(null)
                  setDeletePaymentId(id)
                }}
                style={{ padding: '8px 16px', fontSize: 13, color: '#b91c1c', borderColor: '#fecaca' }}
              >
                Удалить из базы…
              </BtnOutline>
            </>
          ) : undefined
        }
      >
        {detailPayment && (() => {
          const d = detailPayment
          const isHosting = d.project_category === 'hosting_domain'
          const months = sortArchiveMonths(d.months || [])
          const paidTotal = months
            .filter((m) => m.status === 'paid')
            .reduce((s, m) => s + Number(m.amount ?? d.amount), 0)
          return (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: '#475569',
                  marginBottom: 16,
                  padding: '10px 12px',
                  background: '#f1f5f9',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  lineHeight: 1.5,
                }}
              >
                Данные только для просмотра: редактировать строки графика и проект здесь нельзя. Договор можно открыть
                по ссылке; удаление из базы — отдельно внизу окна.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px' }}>
                <Ro label="Партнёр">
                  <strong>{d.partner.name}</strong>
                  {d.partner.manager ? (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{d.partner.manager.name}</div>
                  ) : null}
                </Ro>
                <Ro label={isHosting ? 'Тариф в карточке (ориентир за период)' : 'Сумма по договору'}>
                  <strong>{formatMoneyNumber(d.amount)} UZS</strong>
                </Ro>
                <Ro label="Тип">{statusBadge(d.payment_type)}</Ro>
                <Ro label="Статус при архивации">{statusBadge(d.status)}</Ro>
                <Ro label="Дата оплаты (проект)">{d.paid_at ? formatDate(d.paid_at) : '—'}</Ro>
                <Ro label="Подтвердил">{d.confirmed_by_user?.name || '—'}</Ro>
                <Ro label="Добавлен в систему">{formatDate(d.created_at)}</Ro>
                <Ro label="Уведомлять бухгалтерию">{d.notify_accounting ? 'Да' : 'Нет'}</Ro>
              </div>

              {(d.contract_url || d.project_category || d.day_of_month || d.deadline_date || d.contract_months) && (
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 16,
                    borderTop: '1px solid #e8e9ef',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23', marginBottom: 10 }}>Договор и параметры</div>
                  {d.contract_url ? (
                    <Ro label="Договор (ссылка)">
                      <a href={d.contract_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', wordBreak: 'break-all' }}>
                        {d.contract_url}
                      </a>
                    </Ro>
                  ) : null}
                  {d.project_category ? <Ro label="Линия (категория)">{d.project_category}</Ro> : null}
                  {d.day_of_month != null ? <Ro label="День месяца по договору">{d.day_of_month}</Ro> : null}
                  {d.deadline_date ? <Ro label="Срок по договору">{formatDate(d.deadline_date)}</Ro> : null}
                  {d.contract_months != null && !isHosting ? <Ro label="Месяцев по договору">{d.contract_months}</Ro> : null}
                  {d.remind_days_before != null ? <Ro label="Напомнить за (дней)">{d.remind_days_before}</Ro> : null}
                </div>
              )}

              {isHosting && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e8e9ef' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23', marginBottom: 10 }}>Хостинг / домен</div>
                  {d.hosting_renewal_anchor ? <Ro label="Следующее продление">{formatDate(d.hosting_renewal_anchor)}</Ro> : null}
                  {d.hosting_prepaid_years != null && d.hosting_prepaid_years > 0 ? (
                    <Ro label="Предоплата лет">{d.hosting_prepaid_years}</Ro>
                  ) : null}
                  {d.hosting_contact_name ? <Ro label="Контакт">{d.hosting_contact_name}</Ro> : null}
                  {d.hosting_payment_kind ? <Ro label="Вид оплаты">{d.hosting_payment_kind}</Ro> : null}
                </div>
              )}

              {(d.billing_variant || d.billing_notes) && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e8e9ef' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1d23', marginBottom: 10 }}>Техподдержка / биллинг</div>
                  {d.billing_variant ? <Ro label="Вариант">{d.billing_variant}</Ro> : null}
                  {d.billing_notes ? <Ro label="Комментарий">{d.billing_notes}</Ro> : null}
                </div>
              )}

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #e8e9ef' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1d23', marginBottom: 12 }}>
                  {isHosting ? 'Разбивка по годам (только просмотр)' : 'Разбивка по месяцам (только просмотр)'}
                </div>
                {months.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>Строк графика не было или данные не загружены.</div>
                ) : (
                  <>
                    {months.map((m) => {
                      const isPaid = m.status === 'paid'
                      const actOk = !!m.act_issued
                      const bothDone = actOk && isPaid
                      const effAmount = m.amount ?? d.amount
                      return (
                        <div
                          key={m.id}
                          style={{
                            borderRadius: 12,
                            marginBottom: 10,
                            background: '#fafbfc',
                            border: '1px solid #e8e9ef',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: 10,
                              padding: '11px 14px',
                              borderBottom: '1px solid #f1f5f9',
                            }}
                          >
                            <div style={{ display: 'flex', gap: 10, minWidth: 0, flex: '1 1 180px' }}>
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 14,
                                  flexShrink: 0,
                                  background: bothDone ? '#d1f0de' : '#e8e9ef',
                                }}
                              >
                                {bothDone ? '✅' : '⏳'}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>
                                  {isHosting ? hostingYearPeriodTitle(m.month) : monthLabel(m.month)}
                                </div>
                                {m.due_date ? (
                                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                    Срок оплаты: {formatDate(m.due_date)}
                                  </div>
                                ) : null}
                                {m.description ? (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: '#64748b',
                                      marginTop: 4,
                                      lineHeight: 1.4,
                                      wordBreak: 'break-word',
                                    }}
                                  >
                                    {m.description}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <span style={{ fontWeight: 700, fontSize: 14, color: isPaid ? '#1a6b3c' : '#0f172a', whiteSpace: 'nowrap' }}>
                              {formatMoneyNumber(effAmount)}
                              <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginLeft: 4 }}>UZS</span>
                            </span>
                          </div>
                          <div style={{ padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.35 }}>
                              <b style={{ color: actOk ? '#166534' : '#94a3b8' }}>Акт</b>
                              {actOk
                                ? ` ✓ ${m.act_issued_at ? formatDate(m.act_issued_at) : ''}`
                                : ' — не отмечен'}
                            </div>
                            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.35 }}>
                              <b style={{ color: isPaid ? '#166534' : '#94a3b8' }}>Оплата</b>
                              {isPaid ? ` ✓ ${m.paid_at ? formatDate(m.paid_at) : ''}` : ' — ожидается'}
                            </div>
                            {m.note ? <div style={{ fontSize: 11, color: '#8a8fa8', lineHeight: 1.35 }}>{m.note}</div> : null}
                          </div>
                        </div>
                      )
                    })}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 13,
                        marginTop: 4,
                        padding: '10px 12px',
                        background: '#f0fdf4',
                        borderRadius: 10,
                        border: '1px solid #bbf7d0',
                      }}
                    >
                      <span style={{ color: '#64748b' }}>Итого оплачено по графику</span>
                      <span style={{ fontWeight: 700, color: '#166534' }}>{formatAmount(paidTotal)}</span>
                    </div>
                  </>
                )}
              </div>
            </>
          )
        })()}
      </Modal>

      <ConfirmModal
        open={restorePartnerId !== null}
        onClose={() => setRestorePartnerId(null)}
        title="Восстановить партнёра?"
        message="Партнёр снова появится в списке активных."
        confirmLabel="Восстановить"
        danger={false}
        onConfirm={runRestorePartner}
      />

      <ConfirmModal
        open={deletePaymentId !== null}
        onClose={() => setDeletePaymentId(null)}
        title="Безвозвратное удаление"
        message="Вы точно хотите безвозвратно удалить? Проект и строки графика исчезнут из базы без возможности восстановления."
        confirmLabel="Да"
        cancelLabel="Нет"
        danger
        onConfirm={runPermanentDeletePayment}
      />
    </Layout>
  )
}
