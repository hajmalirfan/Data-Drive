import api from './api'

// Dashboard and reports
export const getDashboard = () => api.get('/api/dashboard').then((r) => r.data)
export const getReports = () => api.get('/api/reports/summary').then((r) => r.data)

// Crop stock
export const getCrops = (params) => api.get('/api/crops', { params }).then((r) => r.data)
export const createCrop = (payload) => api.post('/api/crops', payload).then((r) => r.data)
export const updateCrop = (id, payload) =>
  api.patch(`/api/crops/${id}`, payload).then((r) => r.data)
export const deleteCrop = (id) => api.delete(`/api/crops/${id}`)

// Markets and prices
export const getMarkets = (params) => api.get('/api/markets', { params }).then((r) => r.data)
export const compareMarkets = (params) =>
  api.get('/api/markets/compare', { params }).then((r) => r.data)
export const getPrices = (params) => api.get('/api/prices', { params }).then((r) => r.data)
export const getPriceCrops = () => api.get('/api/prices/crops').then((r) => r.data)
export const createPrice = (payload) => api.post('/api/prices', payload).then((r) => r.data)

// Trucks
export const getTrucks = (params) => api.get('/api/trucks', { params }).then((r) => r.data)
export const createTruck = (payload) => api.post('/api/trucks', payload).then((r) => r.data)
export const updateTruck = (id, payload) =>
  api.patch(`/api/trucks/${id}`, payload).then((r) => r.data)
export const deleteTruck = (id) => api.delete(`/api/trucks/${id}`)

// Bookings and tracking
export const getBookings = (params) => api.get('/api/bookings', { params }).then((r) => r.data)
export const createBooking = (payload) => api.post('/api/bookings', payload).then((r) => r.data)
export const updateBookingStatus = (id, payload) =>
  api.patch(`/api/bookings/${id}/status`, payload).then((r) => r.data)
export const recordDelivery = (id, payload) =>
  api.patch(`/api/bookings/${id}/delivery`, payload).then((r) => r.data)
export const updateBookingLocation = (id, payload) =>
  api.patch(`/api/bookings/${id}/location`, payload).then((r) => r.data)

// Notifications and search
export const getNotifications = (params) =>
  api.get('/api/notifications', { params }).then((r) => r.data)
export const markNotificationRead = (id) =>
  api.patch(`/api/notifications/${id}/read`).then((r) => r.data)
export const markAllNotificationsRead = () =>
  api.patch('/api/notifications/read-all').then((r) => r.data)
export const searchAll = (q) => api.get('/api/search', { params: { q } }).then((r) => r.data)
