import { useCallback, useEffect, useState } from 'react'
import { Card, Empty, formatMoneyNumber } from '@/components/ui'
import api from '@/lib/api'

interface PmRow {
  payment_id: number
  project_name: string
  status: 'forecast' | 'locked' | 'paid'
  rate_percent: number
  amount: number
  paid_uzs: number
  debt_uzs: number
  hint_next_rate?: string | null
  planned_deadline?: string | null
  actual_close_date?: string | null
}

interface PmStats {
  locked_total: number
  forecast_total: number
  paid_total: number
  debt_total: number
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    forecast: { label: 'Прогноз', color: '#b45309', bg: '#fef3c7' },
    locked: { label: 'Зафиксировано', color: '#2563eb', bg: '#dbeafe' },
    paid: { label: 'Выплачено', color: '#059669', bg: '#d1fae5' },
  }
  const s = map[status] || { label: status, color: '#64748b', bg: '#f1f5f9' }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 700,
        color: s.color,
        background: s.bg,
      }}
    >
      {s.label}
    </span>
  )
}

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PmCommissionPanel() {
  const [rows, setRows] = useState<PmRow[]>([])
  const [stats, setStats] = useState<PmStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get<PmRow[]>('pm-commissions/my'),
        api.get<PmStats>('pm-commissions/my/stats'),
      ])
      setRows(listRes.data)
      setStats(statsRes.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      {loading && <p style={{ color: '#94a3b8', padding: 24 }}>Загрузка…</p>}

      {!loading && rows.length === 0 && (
        <Card>
          <Empty text="Нет проектов с комиссией ПМ. В разделе «Проекты» откройте проект и включите галочку «ПМ получает комиссию» (вы должны быть назначены ПМ у партнёра)." />
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', minWidth: 0 }}>
          {rows.map((r) => (
            <Card key={r.payment_id} style={{ overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 16,
                  alignItems: 'start',
                  width: '100%',
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, overflow: 'hidden' }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      marginBottom: 8,
                      wordBreak: 'break-word',
                    }}
                  >
                    {r.project_name}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    {statusBadge(r.status)}
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      Ставка: <strong style={{ color: '#2563eb' }}>{r.rate_percent}%</strong>
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    План сдачи: {fmtDate(r.planned_deadline)}
                    {r.actual_close_date && <> · Закрыт: {fmtDate(r.actual_close_date)}</>}
                  </div>
                  {r.hint_next_rate && r.status === 'forecast' && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 12px',
                        background: '#f0fdf4',
                        borderRadius: 8,
                        fontSize: 13,
                        color: '#166534',
                        border: '1px solid #bbf7d0',
                        wordBreak: 'break-word',
                      }}
                    >
                      До следующей ставки: {r.hint_next_rate}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    minWidth: 0,
                    maxWidth: '42%',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#94a3b8',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    К выплате
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(18px, 4.5vw, 26px)',
                      fontWeight: 800,
                      color: '#059669',
                      letterSpacing: '-0.02em',
                      lineHeight: 1.15,
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatMoneyNumber(r.amount)}
                  </div>
                  {r.status === 'paid' && r.paid_uzs > 0 && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      Выплачено: {formatMoneyNumber(r.paid_uzs)}
                    </div>
                  )}
                  {r.status === 'locked' && r.debt_uzs > 0 && (
                    <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>
                      Ожидает: {formatMoneyNumber(r.debt_uzs)}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {stats && (
        <div style={{ marginTop: 28 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#64748b',
              marginBottom: 12,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Итого
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {[
              { label: 'Зафиксировано', val: stats.locked_total, color: '#2563eb' },
              { label: 'Прогноз (открытые)', val: stats.forecast_total, color: '#b45309' },
              { label: 'Выплачено', val: stats.paid_total, color: '#059669' },
              { label: 'Ожидает выплаты', val: stats.debt_total, color: stats.debt_total > 0 ? '#ef4444' : '#059669' },
            ].map(({ label, val, color }) => (
              <Card key={label}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#94a3b8',
                    marginBottom: 8,
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{formatMoneyNumber(val)}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32 }}>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '14px 18px',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#fff',
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 700,
            color: '#1e293b',
          }}
        >
          {manualOpen ? '▼' : '▶'} Как считается моя комиссия
        </button>
        {manualOpen && (
          <Card style={{ marginTop: 8, lineHeight: 1.65, color: '#475569', fontSize: 14 }}>
            <p style={{ fontWeight: 700, color: '#1e293b', marginTop: 0 }}>Как работает твоя комиссия</p>
            <p>
              Ты получаешь процент с каждого закрытого проекта. Размер процента зависит только от тебя — от того,
              как ты сдал проект.
            </p>
            <ul style={{ paddingLeft: 20 }}>
              <li>
                <strong>5%</strong> — если сдал проект <strong>в срок</strong>.
              </li>
              <li>
                <strong>6%</strong> — если сдал <strong>в срок</strong>, клиент поставил оценку{' '}
                <strong>9 или 10</strong>, и проект взяли в портфолио как показательный кейс. Это максимум.
              </li>
              <li>
                <strong>4%</strong> — если опоздал <strong>не больше чем на месяц</strong>, но качество в порядке и
                клиент доволен (оценка от <strong>6</strong>).
              </li>
              <li>
                <strong>0%</strong> — если проект сдан плохо (серьёзные нарекания, не принят) или опоздание{' '}
                <strong>больше месяца</strong>.
              </li>
            </ul>
            <p style={{ fontWeight: 600, color: '#1e293b' }}>Важно:</p>
            <ul style={{ paddingLeft: 20 }}>
              <li>
                Комиссия начисляется только когда проект полностью закрыт: клиент оплатил финал и оставил оценку
                (NPS). Нет оплаты или оценки — проект не закрыт, комиссия в режиме «прогноз».
              </li>
              <li>
                Пока проект идёт, ты видишь <strong>прогноз</strong> своей ставки и подсказку, что нужно сделать,
                чтобы поднять её до следующей.
              </li>
              <li>
                Если сроки сдвинулись <strong>по вине клиента</strong> (не дал вовремя контент, не согласовал) — это
                фиксируется отдельно и <strong>против тебя не считается</strong>. Скажи руководителю, чтобы оформил
                перенос.
              </li>
            </ul>
            <p style={{ marginBottom: 0 }}>
              Смысл простой: сдавай вовремя, делай качественно, доводи до показательного кейса — и твой процент растёт.
            </p>
          </Card>
        )}
      </div>
    </>
  )
}
