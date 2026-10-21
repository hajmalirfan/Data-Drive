import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Crops from './pages/Crops'
import MarketPrices from './pages/MarketPrices'
import Markets from './pages/Markets'
import Trucks from './pages/Trucks'
import Tracking from './pages/Tracking'
import Bookings from './pages/Bookings'
import Reports from './pages/Reports'
import Profile from './pages/Profile'
import Chat from './pages/Chat'
import Admin from './pages/Admin'

function ProtectedLayout({ allowedRoles }) {
  const { isAuth, role } = useAuth()
  if (!isAuth) return <Navigate to="/login" replace />
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function RootRedirect() {
  const { isAuth } = useAuth()
  return <Navigate to={isAuth ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/crops" element={<Crops />} />
              <Route path="/market-prices" element={<MarketPrices />} />
              <Route path="/markets" element={<Markets />} />
              <Route path="/trucks" element={<Trucks />} />
              <Route path="/tracking" element={<Tracking />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/chat" element={<Chat />} />
            </Route>
            <Route element={<ProtectedLayout allowedRoles={['admin']} />}>
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="/farmer" element={<Navigate to="/dashboard" replace />} />
            <Route path="/fpo" element={<Navigate to="/dashboard" replace />} />
            <Route path="/marketer" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
