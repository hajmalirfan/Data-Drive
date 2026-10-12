import { createContext, useContext, useEffect, useState } from 'react'
import { fetchMe } from '../services/authService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  })
  const [token, setToken] = useState(() => localStorage.getItem('token'))

  useEffect(() => {
    if (token && !user) {
      fetchMe().then(setUser).catch(() => {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        setToken(null)
      })
    }
  }, [token]) // eslint-disable-line

  const saveAuth = (data) => {
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    setToken(data.access_token)
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  const role = user?.role || null
  const hasRole = (...allowed) => !!role && allowed.includes(role)
  const isAdmin = role === 'admin'
  const isFarmer = role === 'farmer'
  const isFpo = role === 'fpo'
  const isMarketer = role === 'marketer'

  return (
    <AuthContext.Provider value={{ user, token, role, saveAuth, logout, isAuth: !!token, hasRole, isAdmin, isFarmer, isFpo, isMarketer }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
