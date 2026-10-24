import api from './api'

// Government mandi prices (Agmarknet). Prices are rupees per quintal, as published.
export const getMandiPrices = (params) =>
  api.get('/api/mandi-prices', { params }).then((r) => r.data)

export const getMandiFilters = (params) =>
  api.get('/api/mandi-prices/filters', { params }).then((r) => r.data)

export const getMandiStatus = () =>
  api.get('/api/mandi-prices/status').then((r) => r.data)

export const triggerMandiSync = () =>
  api.post('/api/mandi-prices/sync').then((r) => r.data)

// Market finder: best place to sell after real road distance and costs.
export const getFinderCommodities = () =>
  api.get('/api/market-finder/commodities').then((r) => r.data)

export const findMarkets = (params) =>
  api.get('/api/market-finder', { params, timeout: 120000 }).then((r) => r.data)

export const getFinderRoute = (params) =>
  api.get('/api/market-finder/route', { params }).then((r) => r.data)
