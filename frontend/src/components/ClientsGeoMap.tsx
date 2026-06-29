import { useMemo, useState } from 'react'
import { clientGeoName } from '@/lib/clientGeo'

export type GeoLocationPoint = {
  code: string
  name: string
  pct: number
  count: number
  lat: number
  lng: number
}

/** Тестовые данные — показываются, пока в API одна страна или меньше 10 */
export const DEMO_GEO_LOCATIONS: GeoLocationPoint[] = [
  { code: 'UZ', name: 'Узбекистан', pct: 32, count: 52, lat: 41.38, lng: 64.59 },
  { code: 'KZ', name: 'Казахстан', pct: 18, count: 29, lat: 48.02, lng: 66.92 },
  { code: 'RU', name: 'Россия', pct: 14, count: 23, lat: 55.76, lng: 37.62 },
  { code: 'TR', name: 'Турция', pct: 11, count: 18, lat: 39.93, lng: 32.86 },
  { code: 'AE', name: 'ОАЭ', pct: 9, count: 15, lat: 23.42, lng: 53.85 },
  { code: 'DE', name: 'Германия', pct: 6, count: 10, lat: 51.17, lng: 10.45 },
  { code: 'US', name: 'США', pct: 4, count: 7, lat: 37.09, lng: -95.71 },
  { code: 'CN', name: 'Китай', pct: 3, count: 5, lat: 35.86, lng: 104.20 },
  { code: 'IN', name: 'Индия', pct: 2, count: 3, lat: 20.59, lng: 78.96 },
  { code: 'KG', name: 'Кыргызстан', pct: 1, count: 2, lat: 41.20, lng: 74.77 },
]

/** bbox для OpenStreetMap embed: minLon,minLat,maxLon,maxLat */
const GEO_BBOX: Record<string, string> = {
  UZ: '55.5,37.0,73.5,45.6',
  KZ: '46.4,40.5,87.4,55.5',
  RU: '19.6,41.0,180,82',
  KG: '69.2,39.1,80.3,43.3',
  TJ: '67.3,36.6,75.2,41.0',
  TM: '52.4,35.1,66.7,42.5',
  AZ: '44.7,38.4,50.4,41.9',
  TR: '25.6,35.8,44.8,42.1',
  AE: '51.0,22.5,56.4,26.1',
  SA: '34.5,16.0,55.7,32.2',
  DE: '5.8,47.2,15.1,55.1',
  US: '-125,24,-66,49',
  CN: '73,18,135,53',
  IN: '68,6,97,36',
  GB: '-8.7,49.8,1.8,60.9',
  FR: '-5.2,41.3,9.6,51.1',
  OTHER: '25,25,95,55',
}

const DEFAULT_BBOX = '25,25,95,55'

function osmEmbedUrl(bbox: string) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik`
}

export function ClientsGeoMap({ locations }: { locations: GeoLocationPoint[] }) {
  const [hovered, setHovered] = useState<string | null>(null)

  const rows = useMemo(() => {
    const useDemo = locations.length < 10
    const base = useDemo ? DEMO_GEO_LOCATIONS : locations.slice(0, 20)
    return [...base].sort((a, b) => b.count - a.count)
  }, [locations])

  const maxCount = useMemo(() => Math.max(...rows.map((r) => r.count), 1), [rows])
  const activeCode = hovered || rows[0]?.code || null
  const active = rows.find((r) => r.code === activeCode) || rows[0]
  const mapBbox = (activeCode && GEO_BBOX[activeCode]) || DEFAULT_BBOX
  const usingDemo = locations.length < 10

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', flexWrap: 'wrap' }}>
      <div style={{
        flex: 1.25,
        minWidth: 300,
        position: 'relative',
        background: '#eef2f7',
        borderRadius: 16,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        minHeight: 340,
        height: 340,
      }}>
        <iframe
          title={`Карта — ${active?.name || 'GEO клиентов'}`}
          src={osmEmbedUrl(mapBbox)}
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
          }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />

        {active && (
          <div style={{
            position: 'absolute',
            left: 14,
            bottom: 14,
            padding: '9px 12px',
            borderRadius: 10,
            background: '#fff',
            border: '1px solid #e2e8f0',
            boxShadow: '0 8px 22px rgba(15,23,42,.10)',
            fontSize: 12,
            fontWeight: 800,
            color: '#111827',
            pointerEvents: 'none',
            maxWidth: 'calc(100% - 28px)',
          }}>
            {active.name}: {active.pct}% · {active.count} клиентов
          </div>
        )}

        {usingDemo && (
          <div style={{
            position: 'absolute',
            right: 12,
            top: 10,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(255,255,255,.92)',
            border: '1px solid #e2e8f0',
            fontSize: 10,
            fontWeight: 700,
            color: '#64748b',
          }}>
            Демо-данные
          </div>
        )}

        <div style={{
          position: 'absolute',
          left: 12,
          top: 10,
          fontSize: 10,
          color: '#64748b',
          fontWeight: 600,
          pointerEvents: 'none',
          background: 'rgba(255,255,255,.85)',
          padding: '3px 7px',
          borderRadius: 6,
        }}>
          OpenStreetMap · наведите на страну справа
        </div>
      </div>

      <div style={{
        flex: '0 0 240px',
        minWidth: 200,
        maxWidth: 280,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 8,
          padding: '0 10px 10px',
          fontSize: 11,
          fontWeight: 800,
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          flexShrink: 0,
        }}>
          <span>Страна</span>
          <span>Клиенты</span>
        </div>

        <div style={{
          flex: 1,
          minHeight: 0,
          maxHeight: 340,
          overflowY: 'auto',
          paddingRight: 4,
          WebkitOverflowScrolling: 'touch',
        }}>
          {rows.map((p) => {
            const activeRow = activeCode === p.code
            const barW = Math.max(8, Math.round((p.count / maxCount) * 100))
            return (
              <div
                key={p.code}
                onMouseEnter={() => setHovered(p.code)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  padding: '11px 10px 13px',
                  borderBottom: '1px solid #edf0f5',
                  borderRadius: 8,
                  background: activeRow ? '#eff6ff' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background .15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ color: activeRow ? '#1d4ed8' : '#475569', fontWeight: activeRow ? 850 : 700, fontSize: 14 }}>
                    {clientGeoName(p.code)}
                  </span>
                  <span style={{ fontWeight: 900, color: '#111827', fontSize: 14, flexShrink: 0 }}>
                    {p.count}
                    <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 12, marginLeft: 4 }}>({p.pct}%)</span>
                  </span>
                </div>
                <div style={{
                  marginTop: 8,
                  height: 4,
                  borderRadius: 999,
                  background: '#e2e8f0',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${barW}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: activeRow ? '#2563eb' : '#93c5fd',
                    transition: 'width .2s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
