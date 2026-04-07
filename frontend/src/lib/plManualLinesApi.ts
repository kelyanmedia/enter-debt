import axios from 'axios'
import api from '@/lib/api'
import { getCompanySlug, getTokenForSlug } from '@/lib/company'

function financeAuthHeaders(): Record<string, string> {
  const slug = getCompanySlug()
  const token = getTokenForSlug(slug)
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Company-Slug': slug,
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

/** 404 без тела / с generic «Not Found» — часто прокси отдал POST не на FastAPI (нужен путь /finance/... на бэкенде). */
function shouldRetryFinance404(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false
  if (e.response?.status !== 404) return false
  const d = e.response?.data?.detail
  if (typeof d === 'string' && /not found/i.test(d)) return true
  if (d === undefined || d === null) return true
  return false
}

async function postFinanceNoApiSuffix(path: string, body?: object): Promise<void> {
  if (typeof window === 'undefined') return
  const base = window.location.origin.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  await axios.post(`${base}/finance${p}`, body ?? {}, { headers: financeAuthHeaders() })
}

async function putFinanceNoApiSuffix(path: string, body: object): Promise<void> {
  if (typeof window === 'undefined') return
  const base = window.location.origin.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  await axios.put(`${base}/finance${p}`, body, { headers: financeAuthHeaders() })
}

async function deleteFinanceNoApiSuffix(path: string): Promise<void> {
  if (typeof window === 'undefined') return
  const base = window.location.origin.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  await axios.delete(`${base}/finance${p}`, { headers: financeAuthHeaders() })
}

/** Обход сломанного прокси: прямой URL бэкенда (тот же хост, что в BACKEND_URL для Next). CORS на API уже открыт. */
function directBackendOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL?.trim().replace(/\/+$/, '')
  return raw || null
}

async function directFinanceRequest(
  method: 'post' | 'put' | 'delete',
  apiPath: string,
  financePath: string,
  body?: object,
): Promise<void> {
  const origin = directBackendOrigin()
  if (!origin) throw new Error('direct backend URL not set')
  const headers = financeAuthHeaders()
  const urlFin = `${origin}${financePath}`
  const urlApi = `${origin}${apiPath}`
  try {
    if (method === 'post') await axios.post(urlFin, body ?? {}, { headers })
    else if (method === 'put') await axios.put(urlFin, body ?? {}, { headers })
    else await axios.delete(urlFin, { headers })
  } catch (e) {
    if (!shouldRetryFinance404(e)) throw e
    if (method === 'post') await axios.post(urlApi, body ?? {}, { headers })
    else if (method === 'put') await axios.put(urlApi, body ?? {}, { headers })
    else await axios.delete(urlApi, { headers })
  }
}

export async function postPlManualLine(body: {
  section: string
  label: string
  sort_order: number
  link_to_net_profit?: boolean
}): Promise<void> {
  try {
    await api.post('finance/pl-manual-lines', body)
    return
  } catch (e) {
    if (!shouldRetryFinance404(e)) throw e
  }
  let lastFallbackErr: unknown
  try {
    await postFinanceNoApiSuffix('/pl-manual-lines', body)
    return
  } catch (e2) {
    lastFallbackErr = e2
    if (!shouldRetryFinance404(e2)) throw e2
  }
  if (directBackendOrigin()) {
    await directFinanceRequest(
      'post',
      '/api/finance/pl-manual-lines',
      '/finance/pl-manual-lines',
      body,
    )
    return
  }
  throw lastFallbackErr
}

export async function putPlManualCell(
  lineId: number,
  body: { period_month: string; uzs: number; usd: number },
): Promise<void> {
  try {
    await api.put(`finance/pl-manual-lines/${lineId}/cell`, body)
    return
  } catch (e) {
    if (!shouldRetryFinance404(e)) throw e
  }
  let lastFallbackErr: unknown
  try {
    await putFinanceNoApiSuffix(`/pl-manual-lines/${lineId}/cell`, body)
    return
  } catch (e2) {
    lastFallbackErr = e2
    if (!shouldRetryFinance404(e2)) throw e2
  }
  if (directBackendOrigin()) {
    await directFinanceRequest(
      'put',
      `/api/finance/pl-manual-lines/${lineId}/cell`,
      `/finance/pl-manual-lines/${lineId}/cell`,
      body,
    )
    return
  }
  throw lastFallbackErr
}

export async function deletePlManualLine(lineId: number): Promise<void> {
  try {
    await api.delete(`finance/pl-manual-lines/${lineId}`)
    return
  } catch (e) {
    if (!shouldRetryFinance404(e)) throw e
  }
  let lastFallbackErr: unknown
  try {
    await deleteFinanceNoApiSuffix(`/pl-manual-lines/${lineId}`)
    return
  } catch (e2) {
    lastFallbackErr = e2
    if (!shouldRetryFinance404(e2)) throw e2
  }
  if (directBackendOrigin()) {
    await directFinanceRequest(
      'delete',
      `/api/finance/pl-manual-lines/${lineId}`,
      `/finance/pl-manual-lines/${lineId}`,
    )
    return
  }
  throw lastFallbackErr
}
