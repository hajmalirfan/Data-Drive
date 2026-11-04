import api from './api'

// Shared truck trips: farmers share one truck to market and split the fare by kg.
export const getSharedTrips = (params) => api.get('/api/shared-trips', { params }).then((r) => r.data)
export const getTripQuote = (id, quantityKg) =>
  api.get(`/api/shared-trips/${id}/quote`, { params: { quantity_kg: quantityKg } }).then((r) => r.data)
export const openSharedTrip = (payload) => api.post('/api/shared-trips', payload).then((r) => r.data)
export const joinSharedTrip = (id, payload) =>
  api.post(`/api/shared-trips/${id}/join`, payload).then((r) => r.data)
export const closeSharedTrip = (id) => api.post(`/api/shared-trips/${id}/close`).then((r) => r.data)
export const getSharedTrip = (id) => api.get(`/api/shared-trips/${id}`).then((r) => r.data)
