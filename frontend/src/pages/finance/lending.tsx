import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/router'
import Layout from '@/components/Layout'
import {
  PageHeader,
  Card,
  Th,
  Td,
  Empty,
  Input,
  Field,
  MoneyInput,
  BtnOutline,
  BtnPrimary,
  Modal,
  formatMoneyNumber,
} from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import api from '@/lib/api'
import { isFinanceTeamRole } from '@/lib/roles'

type LendingType = 'interest_loan' | 'interest_free'

interface LendingRecord {
  id: number
  entity_name: string
  record_type: LendingType
  payment_id?: number | null
  payment_label?: string | null
  issued_on: string
  principal_uzs: string
  monthly_rate_percent?: string | null
  total_repayment_uzs: string
  deadline_date?: string | null
  charged_months: number
  calculation_date: string
  period_note?: string | null
  note?: string | null
  created_at?: string | null
}

interface LendingFormState {
  entity_name: string
  payment_id: string
  record_type: LendingType
  issued_on: string
  principal_uzs: string
  monthly_rate_percent: string
  total_repayment_uzs: string
  deadline_date: string
  period_note: string
  note: string
}

const emptyForm = (): LendingFormState => ({
  entity_name: '',
  payment_id: '',
  record_type: 'interest_loan',
  issued_on: todayYmd(),
  principal_uzs: '',
  monthly_rate_percent: '5',
  total_repayment_uzs: '',
  deadline_date: '',
  period_note: '',
  note: '',
})

interface ProjectOption {
  payment_id: number
  project_name: string
  partner_name: string
}

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 76,
  border: '1px solid #e8e9ef',
  borderRadius: 9,
  padding: '9px 12px',
  fontSize: 13.5,
  outline: 'none',
  color: '#1a1d23',
  fontFamily: 'inherit',
  background: '#fff',
  resize: 'vertical',
}

function formatDate(iso: string) {
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso || '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function chargedMonths(issuedYmd: string, calculationYmd: string) {
  const issued = new Date(`${issuedYmd}T12:00:00`)
  const calc = new Date(`${calculationYmd}T12:00:00`)
  if (Number.isNaN(issued.getTime()) || Number.isNaN(calc.getTime()) || calc <= issued) return 0
  let months = (calc.getFullYear() - issued.getFullYear()) * 12 + (calc.getMonth() - issued.getMonth())
  if (calc.getDate() > issued.getDate()) months += 1
  return Math.max(0, months)
}

function calculatedRepayment(form: LendingFormState) {
  const principal = Number(form.principal_uzs) || 0
  const calcDate = form.deadline_date || todayYmd()
  const months = chargedMonths(form.issued_on, calcDate)
  if (form.record_type === 'interest_free') return { total: principal, months, calcDate }
  const rate = Number(form.monthly_rate_percent) || 0
  return { total: Math.round((principal + principal * (rate / 100) * months) * 100) / 100, months, calcDate }
}

function typeLabel(t: LendingType) {
  return t === 'interest_loan' ? 'Кредит под %' : 'Безвозмездно / инвестиция'
}

function formatApiError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => String((x as { msg?: unknown }).msg || x)).join('\n')
  return err.message || 'Ошибка'
}

function formFromRecord(r: LendingRecord): LendingFormState {
  return {
    entity_name: r.entity_name || '',
    payment_id: r.payment_id != null ? String(r.payment_id) : '',
    record_type: r.record_type,
    issued_on: r.issued_on || todayYmd(),
    principal_uzs: String(Number(r.principal_uzs) || ''),
    monthly_rate_percent: r.monthly_rate_percent != null ? String(Number(r.monthly_rate_percent)) : '',
    total_repayment_uzs: String(Number(r.total_repayment_uzs) || ''),
    deadline_date: r.deadline_date || '',
    period_note: r.period_note || '',
    note: r.note || '',
  }
}

export default function FinanceLendingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<LendingRecord[]>([])
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<LendingFormState>(() => emptyForm())
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const repaymentCalc = useMemo(() => calculatedRepayment(form), [form])

  useEffect(() => {
    if (!loading && user && !isFinanceTeamRole(user.role)) router.replace('/')
  }, [loading, user, router])

  const load = useCallback(async () => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setFetching(true)
    try {
      const r = await api.get<LendingRecord[]>('finance/lending')
      setRows(r.data || [])
    } catch {
      setRows([])
    } finally {
      setFetching(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const loadProjectOptions = useCallback(async () => {
    if (!user || !isFinanceTeamRole(user.role)) return
    setProjectsLoading(true)
    try {
      const r = await api.get<ProjectOption[]>('finance/projects-cost')
      setProjectOptions(r.data || [])
    } catch {
      setProjectOptions([])
    } finally {
      setProjectsLoading(false)
    }
  }, [user])

  const filteredRows = useMemo(() => {
    const raw = search.trim().toLowerCase()
    if (!raw) return rows
    const tokens = raw.split(/\s+/).filter(Boolean)
    return rows.filter((r) => {
      const hay = [
        r.entity_name,
        r.payment_label,
        typeLabel(r.record_type),
        r.period_note,
        r.note,
        r.issued_on,
        r.deadline_date,
        r.calculation_date,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return tokens.every((t) => hay.includes(t))
    })
  }, [rows, search])

  const totals = useMemo(() => {
    let principal = 0
    let repayment = 0
    for (const r of filteredRows) {
      principal += Number(r.principal_uzs) || 0
      repayment += Number(r.total_repayment_uzs) || 0
    }
    return { principal, repayment, income: repayment - principal }
  }, [filteredRows])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setModalOpen(true)
    void loadProjectOptions()
  }

  const openEdit = (r: LendingRecord) => {
    setEditingId(r.id)
    setForm(formFromRecord(r))
    setModalOpen(true)
    void loadProjectOptions()
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  const save = async () => {
    const entity = form.entity_name.trim()
    if (!entity) {
      alert('Укажите проект или компанию')
      return
    }
    if (!form.issued_on) {
      alert('Укажите дату выдачи')
      return
    }
    if (form.deadline_date && new Date(`${form.deadline_date}T12:00:00`) < new Date(`${form.issued_on}T12:00:00`)) {
      alert('Дедлайн не может быть раньше даты выдачи')
      return
    }
    const principal = Number(form.principal_uzs)
    if (!Number.isFinite(principal) || principal <= 0) {
      alert('Укажите сумму кредита')
      return
    }
    if (form.record_type === 'interest_loan' && form.monthly_rate_percent.trim() === '') {
      alert('Для кредита под процент укажите % в месяц')
      return
    }
    const payload = {
      entity_name: entity,
      payment_id: form.payment_id ? Number(form.payment_id) : null,
      record_type: form.record_type,
      issued_on: form.issued_on,
      principal_uzs: form.principal_uzs || '0',
      monthly_rate_percent:
        form.record_type === 'interest_loan' ? form.monthly_rate_percent || '0' : null,
      deadline_date: form.deadline_date || null,
      period_note: form.period_note.trim() || null,
      note: form.note.trim() || null,
    }
    setSaving(true)
    try {
      if (editingId == null) {
        await api.post('finance/lending', payload)
      } else {
        await api.put(`finance/lending/${editingId}`, payload)
      }
      await load()
      closeModal()
    } catch (e) {
      alert(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (r: LendingRecord) => {
    if (!window.confirm(`Удалить запись «${r.entity_name}»?`)) return
    try {
      await api.delete(`finance/lending/${r.id}`)
      await load()
    } catch (e) {
      alert(formatApiError(e))
    }
  }

  const setType = (recordType: LendingType) => {
    setForm((f) => ({
      ...f,
      record_type: recordType,
      monthly_rate_percent: recordType === 'interest_free' ? '' : f.monthly_rate_percent || '5',
    }))
  }

  if (loading || !user || !isFinanceTeamRole(user.role)) return null

  return (
    <Layout>
      <PageHeader
        title="Кредитование"
        subtitle="Учёт денег, которые компания выдаёт проектам или другим компаниям. К возврату считается автоматически: процент за месяц начисляется по дате выдачи (25 апр. → 25 мая = 1 месяц, 26 мая = уже 2). Если дедлайна нет, запись бессрочная и расчёт идёт на сегодня."
      />
      <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <BtnPrimary type="button" onClick={openCreate}>
            Добавить запись
          </BtnPrimary>
          <BtnOutline type="button" onClick={() => void load()} disabled={fetching} style={{ fontSize: 12, padding: '6px 12px' }}>
            {fetching ? 'Загрузка…' : 'Обновить'}
          </BtnOutline>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: '#f8fafc',
            borderRadius: 10,
            border: '1px solid #e8e9ef',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>ПОИСК</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Проект, компания, тип, комментарий…"
            autoComplete="off"
            style={{ flex: '1 1 220px', maxWidth: 420, minWidth: 160 }}
          />
          {search.trim() !== '' && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Сбросить
            </button>
          )}
        </div>

        <Card style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            role="region"
            aria-label="Таблица кредитования"
            tabIndex={0}
            style={{
              maxHeight: 'min(72vh, calc(100vh - 200px))',
              overflow: 'auto',
              overflowX: 'auto',
              overscrollBehavior: 'contain',
              outline: 'none',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 3, boxShadow: '0 1px 0 #e2e8f0' }}>
                <tr style={{ background: '#f8fafc' }}>
                  <Th style={{ width: 42 }}>№</Th>
                  <Th>Проект / компания</Th>
                  <Th>Тип</Th>
                  <Th>Выдано</Th>
                  <Th>Сумма кредита</Th>
                  <Th>% в месяц</Th>
                  <Th>К возврату</Th>
                  <Th>Месяцев</Th>
                  <Th>Дедлайн</Th>
                  <Th>Период / условия</Th>
                  <Th>Комментарий</Th>
                  <Th style={{ width: 130 }}>Действия</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && !fetching ? (
                  <tr>
                    <Td colSpan={12} style={{ padding: 0, border: 'none' }}>
                      <Empty text="Пока нет записей кредитования. Нажмите «Добавить запись», чтобы зафиксировать проект или компанию, сумму, процент и дату выдачи." />
                    </Td>
                  </tr>
                ) : (
                  filteredRows.map((r, idx) => {
                    const isFree = r.record_type === 'interest_free'
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #eef2f7', background: isFree ? '#f8fafc' : '#fff7ed' }}>
                        <Td style={{ fontWeight: 600 }}>{idx + 1}</Td>
                        <Td style={{ fontWeight: 700, maxWidth: 240, lineHeight: 1.35 }}>
                          <div>{r.entity_name}</div>
                          {r.payment_label ? (
                            <div style={{ marginTop: 3, fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                              Привязан: {r.payment_label}
                            </div>
                          ) : null}
                        </Td>
                        <Td>
                          <span
                            style={{
                              display: 'inline-flex',
                              padding: '4px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              color: isFree ? '#334155' : '#9a3412',
                              background: isFree ? '#e2e8f0' : '#ffedd5',
                            }}
                          >
                            {typeLabel(r.record_type)}
                          </span>
                        </Td>
                        <Td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{formatDate(r.issued_on)}</Td>
                        <Td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMoneyNumber(Number(r.principal_uzs))}</Td>
                        <Td style={{ fontWeight: 700, color: isFree ? '#94a3b8' : '#2563eb', whiteSpace: 'nowrap' }}>
                          {isFree ? '—' : `${formatMoneyNumber(Number(r.monthly_rate_percent || 0))} %`}
                        </Td>
                        <Td style={{ fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>{formatMoneyNumber(Number(r.total_repayment_uzs))}</Td>
                        <Td style={{ fontSize: 13, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{r.charged_months}</Td>
                        <Td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                          {r.deadline_date ? formatDate(r.deadline_date) : `Бессрочно · на ${formatDate(r.calculation_date)}`}
                        </Td>
                        <Td style={{ fontSize: 13, color: '#475569', maxWidth: 200 }}>{r.period_note?.trim() || '—'}</Td>
                        <Td style={{ fontSize: 13, color: '#475569', maxWidth: 220 }}>{r.note?.trim() || '—'}</Td>
                        <Td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <BtnOutline type="button" onClick={() => openEdit(r)} style={{ fontSize: 12, padding: '5px 9px' }}>
                              Изм.
                            </BtnOutline>
                            <BtnOutline
                              type="button"
                              onClick={() => void remove(r)}
                              style={{ fontSize: 12, padding: '5px 9px', color: '#b91c1c' }}
                            >
                              Удалить
                            </BtnOutline>
                          </div>
                        </Td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 2 }}>
                  <tr style={{ background: '#e2e8f0', fontWeight: 700, boxShadow: '0 -1px 0 #cbd5e1' }}>
                    <Td colSpan={4} style={{ borderTop: '2px solid #94a3b8', color: '#334155' }}>
                      Итого{search.trim() ? ' (по фильтру)' : ''}
                    </Td>
                    <Td style={{ borderTop: '2px solid #94a3b8', whiteSpace: 'nowrap' }}>{formatMoneyNumber(totals.principal)}</Td>
                    <Td style={{ borderTop: '2px solid #94a3b8', color: '#64748b' }}>—</Td>
                    <Td style={{ borderTop: '2px solid #94a3b8', color: '#166534', whiteSpace: 'nowrap' }}>{formatMoneyNumber(totals.repayment)}</Td>
                    <Td colSpan={5} style={{ borderTop: '2px solid #94a3b8', color: '#1e3a5f' }}>
                      Потенциальный доход: {formatMoneyNumber(totals.income)}
                    </Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55, maxWidth: 900 }}>
          Запись может быть про внутренний проект или компанию, которую кредитуем. Расчёт простой: сумма + сумма × % в месяц ×
          количество начисленных месяцев. День после очередной месячной даты уже открывает следующий месяц процента.
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId == null ? 'Новая запись кредитования' : 'Редактировать кредитование'}
        width={640}
        footer={
          <>
            <BtnOutline type="button" onClick={closeModal} disabled={saving}>
              Отмена
            </BtnOutline>
            <BtnPrimary type="button" onClick={() => void save()} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </BtnPrimary>
          </>
        }
      >
        <Field label="Проект или компания">
          <Input
            value={form.entity_name}
            onChange={(e) => setForm((f) => ({ ...f, entity_name: e.target.value }))}
            placeholder="Например: проект Hi Pad Web или ООО ..."
            autoFocus
          />
        </Field>

        <Field label="Привязать проект (необязательно)">
          <select
            value={form.payment_id}
            onChange={(e) => {
              const nextId = e.target.value
              const opt = projectOptions.find((p) => String(p.payment_id) === nextId)
              setForm((f) => ({
                ...f,
                payment_id: nextId,
                entity_name: !f.entity_name.trim() && opt ? opt.project_name : f.entity_name,
              }))
            }}
            disabled={projectsLoading}
            style={{
              width: '100%',
              border: '1px solid #e8e9ef',
              borderRadius: 9,
              padding: '9px 12px',
              fontSize: 13.5,
              color: '#1a1d23',
              background: '#fff',
              fontFamily: 'inherit',
            }}
          >
            <option value="">{projectsLoading ? 'Загрузка проектов…' : 'Без привязки'}</option>
            {projectOptions.map((p) => (
              <option key={p.payment_id} value={p.payment_id}>
                #{p.payment_id} · {p.project_name || '—'} · {p.partner_name || '—'}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Field label="Тип">
            <select
              value={form.record_type}
              onChange={(e) => setType(e.target.value as LendingType)}
              style={{
                width: '100%',
                border: '1px solid #e8e9ef',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: 13.5,
                color: '#1a1d23',
                background: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <option value="interest_loan">Кредит под % в месяц</option>
              <option value="interest_free">Безвозмездно / инвестиция</option>
            </select>
          </Field>
          <Field label="Дата выдачи">
            <Input
              type="date"
              value={form.issued_on}
              onChange={(e) => setForm((f) => ({ ...f, issued_on: e.target.value }))}
            />
          </Field>
          <Field label="Дедлайн возврата">
            <Input
              type="date"
              value={form.deadline_date}
              onChange={(e) => setForm((f) => ({ ...f, deadline_date: e.target.value }))}
              title="Можно оставить пустым — запись будет бессрочной, расчёт пойдёт на сегодня"
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <Field label="Сумма кредита">
            <MoneyInput
              value={form.principal_uzs}
              onChange={(v) => setForm((f) => ({ ...f, principal_uzs: v }))}
              placeholder="0"
            />
          </Field>
          <Field label="% в месяц">
            <MoneyInput
              value={form.monthly_rate_percent}
              onChange={(v) => setForm((f) => ({ ...f, monthly_rate_percent: v }))}
              placeholder="5"
              disabled={form.record_type === 'interest_free'}
            />
          </Field>
          <Field label="К возврату">
            <Input
              value={formatMoneyNumber(repaymentCalc.total)}
              readOnly
              title={`Начислено месяцев: ${repaymentCalc.months}. Расчёт на ${formatDate(repaymentCalc.calcDate)}.`}
              style={{ background: '#f8fafc', fontWeight: 700, color: '#166534' }}
            />
          </Field>
        </div>

        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45, marginTop: -4, marginBottom: 10 }}>
          Начислено месяцев: <strong>{repaymentCalc.months}</strong>. Расчёт на{' '}
          <strong>{formatDate(repaymentCalc.calcDate)}</strong>
          {form.deadline_date ? '' : ' (бессрочно, берём сегодняшнюю дату)'}.
        </div>

        <Field label="Период / условия">
          <Input
            value={form.period_note}
            onChange={(e) => setForm((f) => ({ ...f, period_note: e.target.value }))}
            placeholder="Например: 3 месяца, до запуска, до закрытия сделки..."
          />
        </Field>

        <Field label="Комментарий">
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Дополнительные условия, договорённости, источник решения..."
            style={textareaStyle}
          />
        </Field>
      </Modal>
    </Layout>
  )
}
