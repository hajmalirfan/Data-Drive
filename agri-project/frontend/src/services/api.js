import axios from 'axios'

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'https://smartag-ops-backend.onrender.com'

const api = axios.create({
  baseURL: API_BASE_URL,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// A rejected session (expired, revoked after a password change, deleted user) signs the user out.
const PUBLIC_AUTH = /\/api\/auth\/(login|signup|forgot-password|verify-otp|reset-password)/
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || ''
    if (error.response?.status === 401 && localStorage.getItem('token') && !PUBLIC_AUTH.test(url)) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (window.location.pathname !== '/login') window.location.assign('/login')
    }
    return Promise.reject(error)
  }
)

export default api
