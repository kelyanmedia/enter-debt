import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import api from '@/lib/api'
import { BtnOutline } from '@/components/ui'

export interface FeedItem {
  id: number
  kind: string
  title: string
  subtitle?: string | null
  entity_type: string
  entity_id: number
  created_at: string
  read: boolean
}

function groupHeading(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const cur = new Date(d)
  cur.setHours(0, 0, 0, 0)
  if (cur.getTime() === today.getTime()) return 'Сегодня'
  if (cur.getTime() === yesterday.getTime()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function kindIcon(kind: string) {
  if (kind === 'payment_created') return '📁'
  if (kind === 'partner_created') return '🏢'
  if (kind === 'user_created') return '👤'
  return '•'
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FeedItem[]>([])
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    try {
      const [rList, rCount] = await Promise.all([
        api.get<FeedItem[]>('feed-notifications'),
        api.get<{ count: number }>('feed-notifications/unread-count'),
      ])
      setItems(rList.data)
      setUnread(rCount.data.count)
    } catch {
      setItems([])
      setUnread(0)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const grouped = useMemo(() => {
    const map: { key: string; heading: string; rows: FeedItem[] }[] = []
    const idx = new Map<string, number>()
    for (const it of items) {
      const key = new Date(it.created_at).toDateString()
      let i = idx.get(key)
      if (i === undefined) {
        i = map.length
        idx.set(key, i)
        map.push({ key, heading: groupHeading(it.created_at), rows: [] })
      }
      map[i].rows.push(it)
    }
    return map
  }, [items])

  const readAll = async () => {
    await api.post('feed-notifications/read-all')
    await load()
  }

  const clearFeed = async () => {
    await api.post('feed-notifications/clear')
    setItems([])
    setUnread(0)
    setOpen(false)
  }

  const markRead = async (id: number) => {
    const wasUnread = items.some(x => x.id === id && !x.read)
    await api.post(`feed-notifications/${id}/read`)
    setItems(prev => prev.map(x => (x.id === id ? { ...x, read: true } : x)))
    if (wasUnread) setUnread(c => Math.max(0, c - 1))
  }

  const go = async (it: FeedItem) => {
    await markRead(it.id)
    setOpen(false)
    if (it.entity_type === 'payment') router.push('/payments')
    else if (it.entity_type === 'partner') router.push('/partners')
    else if (it.entity_type === 'user') router.push('/users')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          borderRadius: 10,
          border: '1px solid #e8e9ef',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
        title="Уведомления"
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: '#e84040',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            zIndex: 300,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
            style={{
              width: 400,
              maxWidth: '100vw',
              height: '100%',
              background: '#faf9f7',
              boxShadow: '-8px 0 40px rgba(0,0,0,.12)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid #e8e6e3', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 22, fontWeight: 700, color: '#1a1d23' }}>
                  Уведомления
                </div>
                <div style={{ fontSize: 12, color: '#8a8fa8', marginTop: 4 }}>
                  {unread > 0 ? `${unread} непрочитанных` : 'Нет непрочитанных'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={readAll}
                  style={{ fontSize: 12, fontWeight: 600, color: '#1a6b3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Прочитать все
                </button>
                <BtnOutline onClick={clearFeed} style={{ padding: '6px 12px', fontSize: 12, color: '#e84040', borderColor: '#f5c2c2' }}>
                  Очистить
                </BtnOutline>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: '1px solid #e8e9ef',
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: 16,
                    color: '#8a8fa8',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px' }}>
              {grouped.length === 0 && (
                <div style={{ textAlign: 'center', color: '#8a8fa8', fontSize: 13, padding: '40px 16px' }}>
                  Пока нет событий. Здесь появятся новые проекты, компании и сотрудники.
                </div>
              )}
              {grouped.map(g => (
                <div key={g.key} style={{ marginBottom: 20 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: '#8a8fa8',
                      textTransform: 'uppercase',
                      marginBottom: 10,
                      paddingLeft: 4,
                    }}
                  >
                    {g.heading}
                  </div>
                  {g.rows.map(it => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => go(it)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        gap: 12,
                        padding: '12px 12px',
                        marginBottom: 8,
                        borderRadius: 12,
                        border: it.read ? '1px solid transparent' : '1px solid #ebe4d8',
                        background: it.read ? '#fff' : '#faf6f0',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        position: 'relative',
                        boxShadow: it.read ? 'none' : '0 1px 0 rgba(0,0,0,.04)',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: '#ececec',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          flexShrink: 0,
                        }}
                      >
                        {kindIcon(it.kind)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23' }}>{it.title}</div>
                        {it.subtitle && (
                          <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 3, lineHeight: 1.35 }}>{it.subtitle}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, color: '#8a8fa8' }}>{timeOnly(it.created_at)}</span>
                        {!it.read && (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#d4a84b',
                            }}
                          />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
