import api from './api'

export const signup = (email, password) =>
  api.post('/api/auth/signup', { email, password }).then((r) => r.data)

export const login = (email, password) =>
  api.post('/api/auth/login', { email, password }).then((r) => r.data)

export const fetchMe = () => api.get('/api/auth/me').then((r) => r.data)
