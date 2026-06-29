/**
 * Lead Listing — красивый card view для клиентской базы.
 * Вдохновлён скрином с карточками лидов, с группировкой по нише.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '@/lib/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SalesInteraction {
  id: number
  interaction_date: string
  project_name?: string | null
  status?: string | null
  note?: string | null
}

interface SalesCompany {
  id: number
  company_name: string
  brand_name?: string | null
  client_type?: string | null
  group_id?: number | null
  group_name?: string | null
  status?: string | null
  comment?: string | null
  assigned_manager_id?: number | null
  assigned_manager_name?: string | null
  brought_by_manager_name?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  lpr_name?: string | null
  lpr_role?: string | null
  interactions?: SalesInteraction[]
  created_at?: string | null
}

interface SalesGroup {
  id: number
  name: string
  note?: string | null
  company_count: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string | null | undefined, fallback = '?') {
  if (!name?.trim()) return fallback
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const GROUP_PALETTE = [
  { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  { bg: '#faf5ff', text: '#7c3aed', border: '#ddd6fe' },
  { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  { bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8' },
  { bg: '#ecfdf5', text: '#0d9488', border: '#99f6e4' },
  { bg: '#fefce8', text: '#a16207', border: '#fde68a' },
  { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' },
]

function groupColor(idx: number) {
  return GROUP_PALETTE[idx % GROUP_PALETTE.length]
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// CompanyCard
// ---------------------------------------------------------------------------

function CompanyCard({
  company,
  groupColor: gc,
  onClick,
}: {
  company: SalesCompany
  groupColor: { bg: string; text: string; border: string }
  onClick: () => void
}) {
  const lastInteraction = company.interactions?.[company.interactions.length - 1]

  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: '1.5px solid #e8e9ef',
        borderRadius: 14,
        padding: '16px 16px 13px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '0 1px 4px rgba(15,23,42,.05)',
        transition: 'box-shadow .15s, border-color .15s',
        minHeight: 160,
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(15,23,42,.10)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = '#c7d2fe'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(15,23,42,.05)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = '#e8e9ef'
      }}
    >
      {/* Header: avatar + name */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: gc.bg, border: `1.5px solid ${gc.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: gc.text, flexShrink: 0,
        }}>
          {initials(company.company_name, '?')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1d23', lineHeight: 1.2, marginBottom: 2 }}>
            {company.company_name}
          </div>
          {company.brand_name && company.brand_name !== company.company_name && (
            <div style={{ fontSize: 11.5, color: '#64748b', fontStyle: 'italic' }}>{company.brand_name}</div>
          )}
        </div>
        {company.client_type && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: company.client_type === 'A' ? '#f0fdf4' : company.client_type === 'B' ? '#fffbeb' : '#fef2f2',
            color: company.client_type === 'A' ? '#15803d' : company.client_type === 'B' ? '#a16207' : '#dc2626',
            border: `1px solid ${company.client_type === 'A' ? '#bbf7d0' : company.client_type === 'B' ? '#fde68a' : '#fecaca'}`,
            borderRadius: 6, padding: '2px 7px', flexShrink: 0,
          }}>
            {company.client_type}
          </span>
        )}
      </div>

      {/* Contact info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {company.contact_name && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
            <span style={{ fontSize: 12 }}>👤</span>
            <span>{company.contact_name}</span>
            {company.lpr_role && <span style={{ color: '#94a3b8', fontSize: 11 }}>· {company.lpr_role}</span>}
          </div>
        )}
        {company.email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
            <span style={{ fontSize: 12 }}>✉️</span>
            <a href={`mailto:${company.email}`} onClick={e => e.stopPropagation()} style={{ color: '#1e40af', textDecoration: 'none' }}>
              {company.email}
            </a>
          </div>
        )}
        {company.phone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
            <span style={{ fontSize: 12 }}>📞</span>
            <a href={`tel:${company.phone}`} onClick={e => e.stopPropagation()} style={{ color: '#1e40af', textDecoration: 'none' }}>
              {company.phone}
            </a>
          </div>
        )}
      </div>

      {/* Status & comment */}
      {(company.status || company.comment) && (
        <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
          {company.status && <span style={{ fontWeight: 600, color: '#475569' }}>{company.status}. </span>}
          {company.comment}
        </div>
      )}

      {/* Last interaction */}
      {lastInteraction && (
        <div style={{ background: '#f8fafc', border: '1px solid #e8e9ef', borderRadius: 8, padding: '6px 10px', fontSize: 11 }}>
          <span style={{ color: '#94a3b8', marginRight: 6 }}>{fmtDate(lastInteraction.interaction_date)}</span>
          {lastInteraction.status && <span style={{ fontWeight: 600, color: '#475569' }}>{lastInteraction.status}. </span>}
          <span style={{ color: '#64748b' }}>{lastInteraction.note}</span>
        </div>
      )}

      {/* Footer: assigned + interactions count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        {company.assigned_manager_name ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', background: '#dbeafe',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: '#1e40af', flexShrink: 0,
            }}>
              {initials(company.assigned_manager_name)}
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>{company.assigned_manager_name}</span>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Не назначен</span>
        )}
        {(company.interactions?.length ?? 0) > 0 && (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {company.interactions!.length} заметок
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupHeader
// ---------------------------------------------------------------------------

function GroupHeader({ group, color, count }: { group: SalesGroup; color: { bg: string; text: string; border: string }; count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 16px', marginBottom: 2,
      background: color.bg, border: `1px solid ${color.border}`,
      borderRadius: 10,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color.text, flexShrink: 0,
      }} />
      <div style={{ fontSize: 13, fontWeight: 700, color: color.text, flex: 1 }}>{group.name}</div>
      <span style={{
        fontSize: 11, fontWeight: 700, color: color.text,
        background: '#fff', border: `1px solid ${color.border}`,
        borderRadius: 999, padding: '2px 9px',
      }}>{count}</span>
      {group.note && (
        <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>{group.note}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CompanyDetailPanel (right panel on click)
// ---------------------------------------------------------------------------

function CompanyDetailPanel({ company, onClose }: { company: SalesCompany; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.35)', zIndex: 100,
      display: 'flex', justifyContent: 'flex-end',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 460, height: '100%',
        background: '#fff', boxShadow: '-10px 0 40px rgba(15,23,42,.12)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e8e9ef', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1d23' }}>{company.company_name}</div>
              {company.brand_name && company.brand_name !== company.company_name && (
                <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>{company.brand_name}</div>
              )}
            </div>
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
          </div>
          {company.status && (
            <div style={{ marginTop: 8, display: 'inline-block', background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, border: '1px solid #bbf7d0' }}>
              {company.status}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Info grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {[
              { label: 'Контакт', value: company.contact_name },
              { label: 'Должность', value: company.lpr_role },
              { label: 'Email', value: company.email },
              { label: 'Телефон', value: company.phone },
              { label: 'Ответственный', value: company.assigned_manager_name },
              { label: 'Привёл', value: company.brought_by_manager_name },
            ].filter(r => r.value).map(row => (
              <div key={row.label} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ color: '#94a3b8', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>{row.label}</span>
                <span style={{ color: '#1a1d23', flex: 1 }}>{row.value}</span>
              </div>
            ))}
          </div>

          {company.comment && (
            <div style={{ background: '#f8fafc', border: '1px solid #e8e9ef', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              {company.comment}
            </div>
          )}

          {/* Interactions timeline */}
          {(company.interactions?.length ?? 0) > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 12 }}>
                История взаимодействий
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...(company.interactions ?? [])].reverse().map(it => (
                  <div key={it.id} style={{ background: '#f8fafc', border: '1px solid #e8e9ef', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                        {fmtDate(it.interaction_date)}
                        {it.project_name && <span style={{ color: '#1e40af', marginLeft: 8 }}>{it.project_name}</span>}
                      </span>
                      {it.status && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#1a6b3c', background: '#e8f5ee', padding: '1px 7px', borderRadius: 4 }}>
                          {it.status}
                        </span>
                      )}
                    </div>
                    {it.note && <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>{it.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  scope: 'all' | 'mine'
  isAdmin: boolean
}

export function SalesLeadCards({ scope, isAdmin }: Props) {
  const [companies, setCompanies] = useState<SalesCompany[]>([])
  const [groups, setGroups] = useState<SalesGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState<number | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SalesCompany | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [companiesRes, groupsRes] = await Promise.all([
        api.get<SalesCompany[]>(`sales/companies?scope=${scope}`),
        api.get<SalesGroup[]>('sales/companies/groups'),
      ])
      setCompanies(companiesRes.data)
      setGroups(groupsRes.data)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { void loadAll() }, [loadAll])

  // Filtered
  const filtered = useMemo(() => {
    let list = companies
    if (filterGroup !== null) {
      list = list.filter(c => c.group_id === filterGroup)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.company_name.toLowerCase().includes(q) ||
        (c.brand_name ?? '').toLowerCase().includes(q) ||
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.status ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [companies, filterGroup, search])

  // Group index map for colors
  const groupColorMap = useMemo(() => {
    const map = new Map<number, typeof GROUP_PALETTE[0]>()
    groups.forEach((g, i) => { map.set(g.id, groupColor(i)) })
    return map
  }, [groups])

  // Group companies
  const grouped = useMemo(() => {
    const withGroup: Array<{ group: SalesGroup | null; companies: SalesCompany[] }> = []
    const byGroupId = new Map<number, SalesCompany[]>()
    const noGroup: SalesCompany[] = []

    for (const c of filtered) {
      if (c.group_id) {
        const arr = byGroupId.get(c.group_id) ?? []
        arr.push(c)
        byGroupId.set(c.group_id, arr)
      } else {
        noGroup.push(c)
      }
    }

    for (const g of groups) {
      const list = byGroupId.get(g.id)
      if (list && list.length > 0) {
        withGroup.push({ group: g, companies: list })
      }
    }
    if (noGroup.length > 0) {
      withGroup.push({ group: null, companies: noGroup })
    }
    return withGroup
  }, [filtered, groups])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>
        Загрузка клиентской базы...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Search + filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 400 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#94a3b8', pointerEvents: 'none' }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск компаний..."
            style={{
              width: '100%', boxSizing: 'border-box',
              border: '1.5px solid #e2e8f0', borderRadius: 10,
              padding: '9px 12px 9px 34px', fontSize: 13, outline: 'none', fontFamily: 'inherit',
              background: '#fff', color: '#1a1d23',
            }}
          />
        </div>

        {/* Niche/group filter chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setFilterGroup(null)}
            style={{
              padding: '6px 12px', borderRadius: 999,
              border: filterGroup === null ? '1.5px solid #1a6b3c' : '1.5px solid #e2e8f0',
              background: filterGroup === null ? '#e8f5ee' : '#fff',
              color: filterGroup === null ? '#1a6b3c' : '#64748b',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Все ({companies.length})
          </button>
          {groups.map((g, i) => {
            const gc = groupColor(i)
            const active = filterGroup === g.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setFilterGroup(active ? null : g.id)}
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  border: active ? `1.5px solid ${gc.text}` : `1.5px solid ${gc.border}`,
                  background: active ? gc.bg : '#fff',
                  color: active ? gc.text : '#64748b',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {g.name} ({g.company_count})
              </button>
            )
          })}
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>
          {filtered.length} из {companies.length}
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 14 }}>
          {search ? 'Ничего не найдено по запросу' : 'База клиентов пуста'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {grouped.map(({ group, companies: list }, gi) => {
            const gc = group ? (groupColorMap.get(group.id) ?? groupColor(gi)) : { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' }
            return (
              <div key={group?.id ?? 'nogroup'}>
                {group && (
                  <GroupHeader group={group} color={gc} count={list.length} />
                )}
                {!group && list.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', padding: '4px 4px 8px', marginBottom: 2 }}>
                    Без группы · {list.length}
                  </div>
                )}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12,
                  marginTop: group ? 10 : 0,
                }}>
                  {list.map(c => (
                    <CompanyCard
                      key={c.id}
                      company={c}
                      groupColor={gc}
                      onClick={() => setSelectedCompany(c)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedCompany && (
        <CompanyDetailPanel
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}
    </div>
  )
}
