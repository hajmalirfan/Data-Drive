import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
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
import BookingRequests from './pages/BookingRequests'
import MyTrips from './pages/MyTrips'
import Notifications from './pages/Notifications'

// Farmer/operator workflow pages (crops, markets, prices, trucks, tracking, bookings) are hidden from admins.
const NON_ADMIN_ROLES = ['farmer', 'truck_operator', 'market_manager', 'buyer', 'marketer']

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
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/chat" element={<Chat />} />
            </Route>
            <Route element={<ProtectedLayout allowedRoles={NON_ADMIN_ROLES} />}>
              <Route path="/crops" element={<Crops />} />
              <Route path="/markets" element={<Markets />} />
              <Route path="/trucks" element={<Trucks />} />
              <Route path="/market-prices" element={<MarketPrices />} />
              <Route path="/tracking" element={<Tracking />} />
              <Route path="/bookings" element={<Bookings />} />
            </Route>
            <Route element={<ProtectedLayout allowedRoles={['truck_operator', 'admin']} />}>
              <Route path="/booking-requests" element={<BookingRequests />} />
              <Route path="/trips" element={<MyTrips />} />
              <Route path="/notifications" element={<Notifications />} />
            </Route>
            <Route element={<ProtectedLayout allowedRoles={['admin']} />}>
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="/farmer" element={<Navigate to="/dashboard" replace />} />
            <Route path="/marketer" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
