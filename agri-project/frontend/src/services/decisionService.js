import axios from 'axios'
import { API_BASE_URL } from './api'

// The guest comparison uses its own client: a guest token must never replace or be
// replaced by a signed-in user's token, and a 401 here must not sign anyone out.
const client = axios.create({ baseURL: API_BASE_URL })
const TOKEN_KEY = 'guest_token'

function storedToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

async function freshToken() {
  const { data } = await client.post('/api/auth/guest')
  try {
    sessionStorage.setItem(TOKEN_KEY, data.access_token)
  } catch {
    // Storage blocked: the token still works for this page load.
  }
  return data.access_token
}

async function withGuest(request) {
  const token = storedToken() || (await freshToken())
  try {
    return await request({ Authorization: `Bearer ${token}` })
  } catch (error) {
    if (error.response?.status !== 401) throw error
    return request({ Authorization: `Bearer ${await freshToken()}` })
  }
}

export const getDecisionOptions = () =>
  withGuest((headers) => client.get('/api/decision/options', { headers })).then((r) => r.data)

export const compareMarkets = (payload) =>
  withGuest((headers) => client.post('/api/decision/compare', payload, { headers })).then((r) => r.data)
