import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import { PageHeader, Card, Th, Td, Badge, Empty, formatDate } from '@/components/ui'
import api from '@/lib/api'

interface Log {
  id: number; payment_id?: number; sent_to_name?: string
  message_text: string; status: string; sent_at: string
}

export default function NotificationsPage() {
  const [logs, setLogs] = useState<Log[]>([])

  useEffect(() => {
    api.get('notifications').then(r => setLogs(r.data))
  }, [])

  return (
    <Layout>
      <PageHeader title="Уведомления" subtitle="Лог Telegram-пушей по платежам. События (новые проекты, компании, сотрудники) — в колокольчике справа вверху." />
      <div style={{ padding: '22px 24px', overflowY: 'auto', flex: 1 }}>
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Кому</Th>
                <Th>Платёж</Th>
                <Th style={{ width: '40%' }}>Сообщение</Th>
                <Th>Статус</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #e8e9ef' }}>
                  <Td style={{ whiteSpace: 'nowrap', color: '#8a8fa8', fontSize: 12 }}>{formatDate(l.sent_at)}</Td>
                  <Td style={{ fontWeight: 600 }}>{l.sent_to_name || '—'}</Td>
                  <Td style={{ color: '#8a8fa8', fontSize: 12 }}>{l.payment_id ? `#${l.payment_id}` : '—'}</Td>
                  <Td>
                    <div style={{ fontSize: 12, color: '#8a8fa8', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.message_text.replace(/<[^>]+>/g, '').slice(0, 120)}
                    </div>
                  </Td>
                  <Td>
                    <Badge variant={l.status === 'success' ? 'green' : 'red'}>
                      {l.status === 'success' ? '✓ Отправлено' : '✕ Ошибка'}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <Empty text="Уведомлений ещё не было" />}
        </Card>
      </div>
    </Layout>
  )
}
