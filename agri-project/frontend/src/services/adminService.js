import api from './api'

export const getAdminOverview = (range = '7d') =>
  api.get('/api/admin/overview', { params: { range } }).then((r) => r.data)
