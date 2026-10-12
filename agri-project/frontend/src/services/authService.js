import api from './api'

export const ROLES = ['farmer', 'fpo', 'marketer', 'admin']

export const signup = (email, password, role = 'farmer') =>
  api.post('/api/auth/signup', { email, password, role }).then((r) => r.data)

export const login = (email, password) =>
  api.post('/api/auth/login', { email, password }).then((r) => r.data)

export const fetchMe = () => api.get('/api/auth/me').then((r) => r.data)

export const fetchUsers = () => api.get('/api/auth/users').then((r) => r.data)

export const updateUserRole = (userId, role) =>
  api.patch(`/api/auth/users/${userId}/role`, { role }).then((r) => r.data)
