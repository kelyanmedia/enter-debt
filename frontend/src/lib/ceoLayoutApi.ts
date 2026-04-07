/**
 * GET/PUT раскладки CEO с повторами на /dashboard/... и прямой NEXT_PUBLIC_BACKEND_URL —
 * тот же сценарий, что plManualLinesApi: nginx отрезает /api у POST/PUT, а GET /api/... работает.
 */
import axios from 'axios'
import api from '@/lib/api'
import { getCompanySlug, getTokenForSlug } from '@/lib/company'
import type { CeoLayoutBlock } from '@/components/CeoDashboardBlocks'

function authHeaders(): Record<string, string> {
  const slug = getCompanySlug()
  const token = getTokenForSlug(slug)
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Company-Slug': slug,
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function shouldRetry404(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false
  if (e.response?.status !== 404) return false
  const d = e.response?.data?.detail
  if (typeof d === 'string' && /not found/i.test(d)) return true
  if (d === undefined || d === null) return true
  return false
}

function directBackendOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, '')
  return raw || null
}

export type CeoLayoutSavePayload = {
  blocks: Array<{ kind: string; title: string | null; pl_row_id: string | null }>
}

export async function fetchCeoLayout(): Promise<{ blocks: CeoLayoutBlock[] }> {
  try {
    return (await api.get<{ blocks: CeoLayoutBlock[] }>('dashboard/ceo/layout')).data
  } catch (e) {
    if (!shouldRetry404(e)) throw e
  }
  let lastErr: unknown = new Error('CEO layout: нет ответа')
  if (typeof window !== 'undefined') {
    try {
      const r = await axios.get<{ blocks: CeoLayoutBlock[] }>(
        `${window.location.origin.replace(/\/+$/, '')}/dashboard/ceo/layout`,
        { headers: authHeaders() },
      )
      return r.data
    } catch (e2) {
      lastErr = e2
      if (!shouldRetry404(e2)) throw e2
    }
  }
  const origin = directBackendOrigin()
  if (origin) {
    const h = authHeaders()
    try {
      const r = await axios.get<{ blocks: CeoLayoutBlock[] }>(`${origin}/dashboard/ceo/layout`, { headers: h })
      return r.data
    } catch (e3) {
      if (!shouldRetry404(e3)) throw e3
      const r = await axios.get<{ blocks: CeoLayoutBlock[] }>(`${origin}/api/dashboard/ceo/layout`, { headers: h })
      return r.data
    }
  }
  throw lastErr
}

export async function saveCeoLayout(body: CeoLayoutSavePayload): Promise<{ blocks: CeoLayoutBlock[] }> {
  try {
    return (await api.put<{ blocks: CeoLayoutBlock[] }>('dashboard/ceo/layout', body)).data
  } catch (e) {
    if (!shouldRetry404(e)) throw e
  }
  let lastErr: unknown = new Error('CEO layout: нет ответа')
  if (typeof window !== 'undefined') {
    try {
      const r = await axios.put<{ blocks: CeoLayoutBlock[] }>(
        `${window.location.origin.replace(/\/+$/, '')}/dashboard/ceo/layout`,
        body,
        { headers: authHeaders() },
      )
      return r.data
    } catch (e2) {
      lastErr = e2
      if (!shouldRetry404(e2)) throw e2
    }
  }
  const origin = directBackendOrigin()
  if (origin) {
    const h = authHeaders()
    try {
      const r = await axios.put<{ blocks: CeoLayoutBlock[] }>(`${origin}/dashboard/ceo/layout`, body, { headers: h })
      return r.data
    } catch (e3) {
      if (!shouldRetry404(e3)) throw e3
      const r = await axios.put<{ blocks: CeoLayoutBlock[] }>(
        `${origin}/api/dashboard/ceo/layout`,
        body,
        { headers: h },
      )
      return r.data
    }
  }
  throw lastErr
}
