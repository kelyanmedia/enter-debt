import axios from 'axios'
import {
  clearTokenForSlug,
  getCompanySlug,
  getTokenForSlug,
  migrateLegacyToken,
} from '@/lib/company'

const api = axios.create({
  baseURL: '/api/',
  timeout: 30_000,
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    migrateLegacyToken()
    const slug = getCompanySlug()
    config.headers['X-Company-Slug'] = slug
    const token = getTokenForSlug(slug)
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      clearTokenForSlug(getCompanySlug())
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    throw err
  }
)

export default api
