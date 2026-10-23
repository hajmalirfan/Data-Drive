import api from './api'

export const ROLES = [
  'farmer',
  'truck_operator',
  'market_manager',
  'admin',
  'buyer',
]

export const ROLE_LABELS = {
  farmer: 'Farmer',
  truck_operator: 'Truck Operator',
  market_manager: 'Market Price Manager',
  admin: 'Admin',
  buyer: 'Buyer / General Public',
  marketer: 'Marketer',
}

export const signup = (payload) =>
  api.post('/api/auth/signup', payload).then((r) => r.data)

export const login = (identifier, password) =>
  api.post('/api/auth/login', { identifier, password }).then((r) => r.data)

export const forgotPassword = (email) =>
  api.post('/api/auth/forgot-password', { email }).then((r) => r.data)

export const verifyResetOtp = (email, otp) =>
  api.post('/api/auth/verify-otp', { email, otp }).then((r) => r.data)

export const resetPassword = (resetToken, newPassword) =>
  api.post('/api/auth/reset-password', { reset_token: resetToken, new_password: newPassword }).then((r) => r.data)

export const fetchMe = () => api.get('/api/auth/me').then((r) => r.data)

export const updateProfile = (payload) =>
  api.patch('/api/auth/me', payload).then((r) => r.data)

export const fetchUsers = () => api.get('/api/auth/users').then((r) => r.data)

export const updateUserRole = (userId, role) =>
  api.patch(`/api/auth/users/${userId}/role`, { role }).then((r) => r.data)
