import { useEffect, useState, FormEvent, type CSSProperties } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/context/AuthContext'
import Layout from '@/components/Layout'
import { PageHeader, Card, Field, Input, BtnPrimary, BtnOutline } from '@/components/ui'
import api from '@/lib/api'

const textAreaStyle: CSSProperties = {
  width: '100%',
  minHeight: 140,
  border: '1px solid #e8e9ef',
  borderRadius: 9,
  padding: '10px 12px',
  fontSize: 13.5,
  outline: 'none',
  color: '#1a1d23',
  fontFamily: 'inherit',
  background: '#fff',
  resize: 'vertical',
  lineHeight: 1.45,
}

export default function NewContractPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [comment, setComment] = useState('')
  const [contractUrl, setContractUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (!loading && user?.role === 'accountant') router.replace('/payments')
  }, [loading, user, router])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setOk('')
    const c = comment.trim()
    if (c.length < 3) {
      setError('Опишите задачу для бухгалтерии (несколько предложений)')
      return
    }
    if (!contractUrl.trim() && !file) {
      setError('Укажите ссылку на договор или прикрепите файл')
      return
    }
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('comment', c)
      if (contractUrl.trim()) fd.append('contract_url', contractUrl.trim())
      if (file) fd.append('file', file)
      const r = await api.post<{ ok: boolean; recipients: number; detail?: string }>(
        'contract-requests/notify-accounting',
        fd,
      )
      setOk(
        r.data.detail
          ? `Отправлено: ${r.data.detail}`
          : `Сообщение отправлено в Telegram бухгалтерии (${r.data.recipients} получ.)`,
      )
      setComment('')
      setContractUrl('')
      setFile(null)
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const d = ax.response?.data?.detail
      setError(typeof d === 'string' ? d : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  if (loading || !user) return null
  if (user.role === 'accountant') return null

  return (
    <Layout>
      <PageHeader
        title="Новый договор"
        subtitle="Запрос бухгалтерии: описание задачи и ссылка или файл — уйдёт в Telegram"
      />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1, maxWidth: 640 }}>
        <Card style={{ padding: '22px 24px' }}>
          <form onSubmit={submit}>
            <Field label="Создать контракт — комментарий для бухгалтерии *">
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Например: нужен договор на абонентское обслуживание сайта для ООО «…», срок 12 мес., ежемесячная оплата, приложить типовую редакцию с правками клиента…"
                style={textAreaStyle}
              />
            </Field>
            <Field label="Ссылка на черновик / документ (если есть)">
              <Input
                type="url"
                value={contractUrl}
                onChange={e => setContractUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Или файл">
              <input
                type="file"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                style={{
                  width: '100%',
                  border: '1px solid #e8e9ef',
                  borderRadius: 9,
                  padding: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  background: '#fff',
                }}
              />
              {file && (
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                  Выбрано: <b>{file.name}</b> ({(file.size / 1024).toFixed(1)} КБ)
                </div>
              )}
            </Field>
            <p style={{ fontSize: 12, color: '#8a8fa8', lineHeight: 1.5, marginBottom: 16 }}>
              Нужны <b>комментарий</b> и хотя бы одно из двух: <b>ссылка</b> или <b>файл</b>. Можно указать и ссылку, и файл —
              в Telegram уйдёт документ с подписью и ссылкой в тексте.
            </p>
            {error && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  background: '#fef0f0',
                  borderRadius: 9,
                  fontSize: 13,
                  color: '#b91c1c',
                }}
              >
                {error}
              </div>
            )}
            {ok && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  background: '#e8f5ee',
                  borderRadius: 9,
                  fontSize: 13,
                  color: '#1a6b3c',
                }}
              >
                {ok}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <BtnPrimary type="submit" disabled={sending}>
                {sending ? 'Отправка…' : 'Отправить в бухгалтерию'}
              </BtnPrimary>
              <BtnOutline
                type="button"
                onClick={() => {
                  setComment('')
                  setContractUrl('')
                  setFile(null)
                  setError('')
                  setOk('')
                }}
              >
                Очистить
              </BtnOutline>
            </div>
          </form>
        </Card>
      </div>
    </Layout>
  )
}
