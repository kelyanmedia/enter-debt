/**
 * Модальное окно «Закрыть сделку» — заполнение договора, графика оплат и % комиссии МОП.
 */
import { useState, useEffect } from 'react'
import DatePicker from '@/components/DatePicker'
import api from '@/lib/api'
import {
  Modal, BtnPrimary, BtnOutline, Field, Input, Select, IntegerGroupedInput,
} from '@/components/ui'
import type { DealData } from '@/components/SaleDealCard'

interface Stage {
  id: number
  name: string
  is_closed_won?: boolean
}

interface CompanyUiLine {
  category_slug: string
  label: string
}

interface ScheduleRow {
  month: string
  amount: string
  due_date: string
  description: string
}

const PROJECT_TYPES = [
  { value: 'site', label: 'Сайт / веб' },
  { value: 'seo', label: 'SEO' },
  { value: 'ppc', label: 'PPC / таргет' },
]

const PAYMENT_METHODS = [
  { value: 'transfer', label: 'Банковский перевод' },
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
]

function isoMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym: string) {
  if (!ym || ym.length < 7) return ym
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

function addMonths(ym: string, n: number): string {
  if (!ym || ym.length < 7) return ym
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return isoMonth(d)
}

function emptyRow(month: string): ScheduleRow {
  return { month, amount: '', due_date: '', description: '' }
}

export function DealCloseWonModal({
  deal,
  stages,
  open,
  onClose,
  onDone,
  mopDefaultPercent,
}: {
  deal: DealData
  stages: Stage[]
  open: boolean
  onClose: () => void
  onDone: (updated: DealData & { payment_id: number; commission_id: number }) => void
  mopDefaultPercent?: number | null
}) {
  const wonStages = stages.filter(s => s.is_closed_won)
  const defaultStage = wonStages[0]

  const [stageId, setStageId] = useState<string>(defaultStage ? String(defaultStage.id) : '')
  const [category, setCategory] = useState('smm')
  const [projectType, setProjectType] = useState('site')
  const [paymentType, setPaymentType] = useState<'recurring' | 'one_time'>('recurring')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState(deal.budget ? String(Math.round(deal.budget)) : '')
  const [contractMonths, setContractMonths] = useState('')
  const [dayOfMonth, setDayOfMonth] = useState('')
  const [contractUrl, setContractUrl] = useState('')
  const [productionCost, setProductionCost] = useState('0')
  const [managerPercent, setManagerPercent] = useState(
    mopDefaultPercent ? String(mopDefaultPercent) : '10'
  )
  const [schedule, setSchedule] = useState<ScheduleRow[]>([emptyRow(isoMonth(new Date()))])
  const [firstPaid, setFirstPaid] = useState(false)
  const [receivedAmount, setReceivedAmount] = useState('')
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10))
  const [receivedMethod, setReceivedMethod] = useState('transfer')
  const [lines, setLines] = useState<CompanyUiLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<{ lines: CompanyUiLine[] }>('company-ui/payments')
      .then(r => setLines(r.data?.lines ?? []))
      .catch(() => setLines([]))
  }, [])

  useEffect(() => {
    if (!open) return
    setStageId(defaultStage ? String(defaultStage.id) : '')
    setDescription(deal.title)
    setAmount(deal.budget ? String(Math.round(deal.budget)) : '')
    setManagerPercent(mopDefaultPercent ? String(mopDefaultPercent) : '10')
    setSchedule([emptyRow(isoMonth(new Date()))])
    setFirstPaid(false)
    setReceivedAmount('')
    setReceivedOn(new Date().toISOString().slice(0, 10))
    setError('')
  }, [open])

  function syncScheduleMonths(baseMonth: string, n: number) {
    const rows: ScheduleRow[] = []
    for (let i = 0; i < Math.max(1, n); i++) {
      const m = addMonths(baseMonth, i)
      rows.push(schedule[i] ? { ...schedule[i], month: m } : emptyRow(m))
    }
    setSchedule(rows)
  }

  function handleContractMonths(v: string) {
    setContractMonths(v)
    const n = parseInt(v) || 0
    if (n > 0 && schedule.length > 0) syncScheduleMonths(schedule[0].month, n)
  }

  function addRow() {
    const lastMonth = schedule[schedule.length - 1]?.month || isoMonth(new Date())
    setSchedule(prev => [...prev, emptyRow(addMonths(lastMonth, 1))])
  }

  function removeRow(i: number) {
    setSchedule(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateRow(i: number, field: keyof ScheduleRow, v: string) {
    setSchedule(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: v } : r))
  }

  function distributeAmount() {
    const total = parseInt(amount) || 0
    if (!total || !schedule.length) return
    const per = Math.floor(total / schedule.length)
    const remainder = total - per * (schedule.length - 1)
    setSchedule(prev => prev.map((r, i) => ({
      ...r,
      amount: String(i === prev.length - 1 ? remainder : per),
    })))
  }

  async function handleSave() {
    setError('')
    if (!stageId) { setError('Выберите этап'); return }
    if (!category) { setError('Выберите линию проекта'); return }
    if (!description.trim()) { setError('Укажите название услуги'); return }
    const amtNum = parseInt(amount)
    if (!amtNum || amtNum <= 0) { setError('Укажите сумму договора'); return }
    const pctNum = parseFloat(managerPercent)
    if (!pctNum || pctNum < 1 || pctNum > 20) { setError('% комиссии: от 1 до 20'); return }
    for (let idx = 0; idx < schedule.length; idx++) {
      const r = schedule[idx]
      if (!r.month || r.month.length !== 7) { setError(`Строка ${idx + 1}: неверный месяц`); return }
      if (!parseInt(r.amount)) { setError(`Строка ${idx + 1}: укажите сумму`); return }
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        stage_id: parseInt(stageId),
        project_category: category,
        project_type: projectType,
        payment_type: paymentType,
        description: description.trim(),
        amount: amtNum,
        production_cost: parseInt(productionCost) || 0,
        manager_percent: pctNum,
        contract_url: contractUrl.trim() || null,
        contract_months: contractMonths ? parseInt(contractMonths) : null,
        day_of_month: dayOfMonth ? parseInt(dayOfMonth) : null,
        first_payment_received: firstPaid,
        received_amount: firstPaid && receivedAmount ? parseInt(receivedAmount) : null,
        received_amount_on: firstPaid ? receivedOn || null : null,
        received_payment_method: firstPaid ? receivedMethod : null,
        schedule: schedule.map(r => ({
          month: r.month,
          amount: parseInt(r.amount),
          due_date: r.due_date || null,
          description: r.description.trim() || null,
        })),
      }
      const res = await api.post<DealData & { payment_id: number; commission_id: number }>(
        `sales/deals/${deal.id}/close-won`,
        payload
      )
      onDone(res.data)
    } catch (e: any) {
      const msg = e?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Ошибка при сохранении')
    } finally {
      setSaving(false)
    }
  }

  const sortedLines = [...lines].sort((a, b) => a.label.localeCompare(b.label, 'ru'))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Закрыть сделку — заполнить договор"
      width={640}
      footer={
        <>
          <BtnOutline onClick={onClose}>Отмена</BtnOutline>
          <BtnPrimary onClick={handleSave} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Закрыть и создать проект'}
          </BtnPrimary>
        </>
      }
    >
      {error && (
        <div style={{
          background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
          borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {wonStages.length > 1 && (
        <Field label="Этап «Успешно закрыта»">
          <Select value={stageId} onChange={e => setStageId(e.target.value)}>
            {wonStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Линия проекта *">
          <Select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— выберите —</option>
            {sortedLines.map(l => (
              <option key={l.category_slug} value={l.category_slug}>{l.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Тип (для комиссии)">
          <Select value={projectType} onChange={e => setProjectType(e.target.value)}>
            {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Название услуги / договора *">
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="SEO продвижение, апрель 2026"
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Вид платежа">
          <Select value={paymentType} onChange={e => setPaymentType(e.target.value as 'recurring' | 'one_time')}>
            <option value="recurring">Рекуррентный (абонемент)</option>
            <option value="one_time">Разовый</option>
          </Select>
        </Field>
        <Field label="Сумма договора (сум) *">
          <IntegerGroupedInput
            value={amount}
            onChange={v => setAmount(v)}
            placeholder="0"
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Кол-во месяцев">
          <Input
            type="number"
            min={1}
            max={120}
            value={contractMonths}
            onChange={e => handleContractMonths(e.target.value)}
            placeholder="12"
          />
        </Field>
        <Field label="День оплаты (1–28)">
          <Input
            type="number"
            min={1}
            max={28}
            value={dayOfMonth}
            onChange={e => setDayOfMonth(e.target.value)}
            placeholder="25"
          />
        </Field>
        <Field label="Себестоимость (сум)">
          <IntegerGroupedInput
            value={productionCost}
            onChange={v => setProductionCost(v)}
            placeholder="0"
          />
        </Field>
      </div>

      <Field label="Ссылка на договор">
        <Input
          value={contractUrl}
          onChange={e => setContractUrl(e.target.value)}
          placeholder="https://drive.google.com/..."
        />
      </Field>

      <Field label="% комиссии МОП">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            type="number"
            min={1}
            max={20}
            step={0.5}
            value={managerPercent}
            onChange={e => setManagerPercent(e.target.value)}
            placeholder="10"
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 13, color: '#64748b' }}>% (от 1 до 20)</span>
        </div>
      </Field>

      {/* График оплат */}
      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>График оплат *</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={distributeAmount}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 6,
                border: '1px solid #cbd5e1', background: '#f8fafc',
                color: '#475569', cursor: 'pointer',
              }}
            >
              Разбить поровну
            </button>
            <button
              type="button"
              onClick={addRow}
              style={{
                padding: '5px 10px', fontSize: 12, borderRadius: 6,
                border: '1px solid #1a6b3c', background: '#f0faf4',
                color: '#1a6b3c', cursor: 'pointer', fontWeight: 600,
              }}
            >
              + Добавить месяц
            </button>
          </div>
        </div>

        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '120px 1fr 110px 1fr 32px',
            gap: 0, background: '#f8fafc', padding: '8px 10px',
            fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase',
          }}>
            <span>Месяц</span>
            <span style={{ paddingLeft: 8 }}>Сумма, сум</span>
            <span style={{ paddingLeft: 8 }}>Срок оплаты</span>
            <span style={{ paddingLeft: 8 }}>Описание</span>
            <span />
          </div>
          {schedule.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid', gridTemplateColumns: '120px 1fr 110px 1fr 32px',
                gap: 0, padding: '6px 10px',
                borderTop: '1px solid #f1f5f9',
                background: i % 2 === 1 ? '#fafbfc' : '#fff',
                alignItems: 'center',
              }}
            >
              <input
                type="month"
                value={row.month}
                onChange={e => updateRow(i, 'month', e.target.value)}
                style={{
                  border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px',
                  fontSize: 13, fontFamily: 'inherit', outline: 'none',
                  background: 'transparent', width: '100%',
                }}
              />
              <div style={{ paddingLeft: 8 }}>
                <IntegerGroupedInput
                  value={row.amount}
                  onChange={v => updateRow(i, 'amount', v)}
                  placeholder="0"
                  style={{ width: '100%', fontSize: 13, padding: '5px 8px' }}
                />
              </div>
              <div style={{ paddingLeft: 8 }}>
                <DatePicker
                  value={row.due_date}
                  onChange={v => updateRow(i, 'due_date', v)}
                  inputStyle={{
                    border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px',
                    fontSize: 13, width: '100%',
                  }}
                />
              </div>
              <div style={{ paddingLeft: 8 }}>
                <input
                  value={row.description}
                  onChange={e => updateRow(i, 'description', e.target.value)}
                  placeholder="необязательно"
                  style={{
                    border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px',
                    fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={schedule.length === 1}
                style={{
                  width: 24, height: 24, borderRadius: 4, border: 'none',
                  background: 'transparent', color: '#94a3b8',
                  cursor: schedule.length === 1 ? 'not-allowed' : 'pointer',
                  fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Первый платёж получен? */}
      <div style={{ marginTop: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={firstPaid}
            onChange={e => setFirstPaid(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#1a6b3c' }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
            Деньги уже получены (первый платёж)
          </span>
        </label>

        {firstPaid && (
          <div style={{ marginTop: 12, paddingLeft: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Сумма получена (сум)">
              <IntegerGroupedInput
                value={receivedAmount}
                onChange={v => setReceivedAmount(v)}
                placeholder={schedule[0]?.amount || '0'}
              />
            </Field>
            <Field label="Дата получения">
              <DatePicker
                value={receivedOn}
                onChange={v => setReceivedOn(v)}
              />
            </Field>
            <Field label="Способ оплаты">
              <Select value={receivedMethod} onChange={e => setReceivedMethod(e.target.value)}>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}
