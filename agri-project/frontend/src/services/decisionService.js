import api from './api'

// Market comparison (PRD v4.2). Uses the signed-in session like every other service.
export const getDecisionOptions = () =>
  api.get('/api/decision/options').then((r) => r.data)

export const compareMarkets = (payload) =>
  api.post('/api/decision/compare', payload).then((r) => r.data)
