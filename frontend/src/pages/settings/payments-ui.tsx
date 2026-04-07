import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import { PageHeader, Card, BtnPrimary, BtnOutline, Field, Input } from '@/components/ui'
import api from '@/lib/api'
import {
  type CompanyPaymentsUi,
  defaultCompanyPaymentsUi,
  effectiveCompanyUi,
} from '@/lib/companyUi'

function formatApiError(e: unknown): string {
  const err = e as { response?: { data?: { detail?: unknown } }; message?: string }
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  return err.message || 'Ошибка сохранения'
}

export default function PaymentsUiSettingsPage() {
  const router = useRouter()
  const { user, companySlug } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<CompanyPaymentsUi>(() => defaultCompanyPaymentsUi())

  const canEdit = user?.role === 'admin'

  useEffect(() => {
    if (!canEdit) return
    setLoading(true)
    api
      .get<CompanyPaymentsUi>('company-ui/payments')
      .then((r) => setDraft(effectiveCompanyUi(r.data)))
      .catch(() => setDraft(defaultCompanyPaymentsUi()))
      .finally(() => setLoading(false))
  }, [canEdit, companySlug])

  useEffect(() => {
    if (user && !canEdit) router.replace('/payments')
  }, [user, canEdit, router])

  const sortedDraft = useMemo(() => {
    const segs = [...draft.segments].sort((a, b) => a.sort_order - b.sort_order)
    const lines = [...draft.lines].sort((a, b) => a.sort_order - b.sort_order)
    return { segments: segs, lines }
  }, [draft])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await api.put<CompanyPaymentsUi>('company-ui/payments', draft)
      setDraft(effectiveCompanyUi(r.data))
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (!user || !canEdit) return null

  return (
    <Layout>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          width: '100%',
          minWidth: 0,
        }}
      >
        <PageHeader
          title="Подписи: проекты и дебиторка"
          subtitle="Названия разделов («Все», «Услуги», «Домены/хостинг») и линий (Web, SEO, …) хранятся для текущей компании. Технические коды категорий в проектах не меняются — только отображение."
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
      <div style={{ padding: '22px 24px 28px', maxWidth: 900, width: '100%', boxSizing: 'border-box', flex: '1 1 auto' }}>
        <div
          style={{
            marginBottom: 18,
            padding: '12px 14px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 10,
            fontSize: 13,
            color: '#14532d',
            lineHeight: 1.5,
          }}
        >
          <strong>Как устроены фильтры.</strong> Новые разделы и линии <strong>не создаются</strong> здесь — список ключей
          (например <code style={{ fontSize: 12 }}>all</code>, <code style={{ fontSize: 12 }}>web</code>) задан в системе и
          совпадает с категориями в проектах. На этой странице вы меняете только <strong>подписи</strong>,{' '}
          <strong>порядок</strong> и <strong>видимость</strong> в табах. Быстрый переход сюда с экрана фильтров: кнопка{' '}
          <strong style={{ fontFamily: 'system-ui' }}>+</strong> справа от «Раздел» и «Линии» на страницах{' '}
          <a href="/payments" style={{ color: '#166534', fontWeight: 600 }}>
            Проекты
          </a>{' '}
          и{' '}
          <a href="/debitor" style={{ color: '#166534', fontWeight: 600 }}>
            Дебиторка
          </a>{' '}
          (только администратор).
        </div>
        {error && (
          <div
            style={{
              background: '#fef0f0',
              color: '#e84040',
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#64748b', fontSize: 14 }}>Загрузка…</div>
        ) : (
          <>
            <div id="payments-ui-segments" style={{ scrollMarginTop: 72 }}>
              <Card style={{ marginBottom: 20, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, marginBottom: 0, fontSize: 14 }}>Разделы (табы)</div>
              </div>
              <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.45 }}>
                Скрытый раздел не показывается на страницах «Проекты» и «Дебиторка». Логика фильтра (хостинг в «Все» и т.д.) не меняется.
                Добавить новый раздел нельзя — только три ключа: <code style={{ fontSize: 11 }}>all</code>,{' '}
                <code style={{ fontSize: 11 }}>services</code>, <code style={{ fontSize: 11 }}>hosting</code>.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sortedDraft.segments.map((s) => (
                  <div
                    key={s.segment_key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 12,
                      alignItems: 'end',
                      borderBottom: '1px solid #eef0f4',
                      paddingBottom: 12,
                    }}
                  >
                    <Field label={`Ключ: ${s.segment_key}`}>
                      <Input
                        value={s.label}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            segments: d.segments.map((x) =>
                              x.segment_key === s.segment_key ? { ...x, label: e.target.value } : x
                            ),
                          }))
                        }
                      />
                    </Field>
                    <Field label="Порядок">
                      <Input
                        type="number"
                        value={String(s.sort_order)}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            segments: d.segments.map((x) =>
                              x.segment_key === s.segment_key
                                ? { ...x, sort_order: Number(e.target.value) || 0 }
                                : x
                            ),
                          }))
                        }
                      />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={s.is_visible}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            segments: d.segments.map((x) =>
                              x.segment_key === s.segment_key ? { ...x, is_visible: e.target.checked } : x
                            ),
                          }))
                        }
                      />
                      Виден
                    </label>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 4,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px dashed #cbd5e1',
                  background: '#f8fafc',
                  fontSize: 12,
                  color: '#64748b',
                  lineHeight: 1.45,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 700, color: '#94a3b8', marginRight: 8, verticalAlign: 'middle' }}>+</span>
                Новый раздел не добавляется — список ключей фиксирован.
              </div>
            </Card>
            </div>

            <div id="payments-ui-lines" style={{ scrollMarginTop: 72 }}>
            <Card style={{ marginBottom: 20, padding: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Линии (категории проектов)</div>
              <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.45 }}>
                Набор категорий фиксирован (как в данных проектов). Можно переименовать и скрыть строку в фильтрах; в форме проекта остаются все линии, чтобы не потерять старые значения.
                Новую линию в данных из этого экрана добавить нельзя — нужен новый тип в проектах (доработка системы).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sortedDraft.lines.map((l) => (
                  <div
                    key={l.category_slug}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 12,
                      alignItems: 'end',
                      borderBottom: '1px solid #eef0f4',
                      paddingBottom: 12,
                    }}
                  >
                    <Field label={l.category_slug}>
                      <Input
                        value={l.label}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            lines: d.lines.map((x) =>
                              x.category_slug === l.category_slug ? { ...x, label: e.target.value } : x
                            ),
                          }))
                        }
                      />
                    </Field>
                    <Field label="Порядок">
                      <Input
                        type="number"
                        value={String(l.sort_order)}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            lines: d.lines.map((x) =>
                              x.category_slug === l.category_slug
                                ? { ...x, sort_order: Number(e.target.value) || 0 }
                                : x
                            ),
                          }))
                        }
                      />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={l.is_visible}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            lines: d.lines.map((x) =>
                              x.category_slug === l.category_slug ? { ...x, is_visible: e.target.checked } : x
                            ),
                          }))
                        }
                      />
                      В фильтрах
                    </label>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 4,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px dashed #cbd5e1',
                  background: '#f8fafc',
                  fontSize: 12,
                  color: '#64748b',
                  lineHeight: 1.45,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 700, color: '#94a3b8', marginRight: 8, verticalAlign: 'middle' }}>+</span>
                Новую линию (категорию проекта) здесь не создать — только переименование и скрытие из фильтров.
              </div>
            </Card>
            </div>
          </>
        )}
      </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '12px 24px 16px',
          borderTop: '1px solid #e8e9ef',
          background: 'linear-gradient(180deg, rgba(245,246,250,0.92) 0%, #f5f6fa 100%)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <BtnPrimary onClick={() => void save()} disabled={saving || loading}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </BtnPrimary>
        <BtnOutline type="button" onClick={() => router.push('/payments')}>
          К проектам
        </BtnOutline>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Панель закреплена внизу окна — можно сохранить и без прокрутки.</span>
      </div>
      </div>
    </Layout>
  )
}
