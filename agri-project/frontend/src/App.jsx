import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import LanguageSelector from './components/LanguageSelector'

function Protected({ children, allowedRoles }) {
  const { isAuth, role } = useAuth()
  if (!isAuth) return <Navigate to="/login" replace />
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

function Home() {
  const { t } = useLanguage()
  return (
    <div style={{ padding: 32, fontFamily: 'Inter, Arial', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <LanguageSelector />
      </div>
      <h1>{t('homeTitle')}</h1>
      <Link to="/login">{t('homeLogin')}</Link>
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/admin" element={<Protected allowedRoles={['admin']}><Admin /></Protected>} />
            <Route path="/farmer" element={<Protected allowedRoles={['farmer', 'admin']}><Dashboard /></Protected>} />
            <Route path="/fpo" element={<Protected allowedRoles={['fpo', 'admin']}><Dashboard /></Protected>} />
            <Route path="/marketer" element={<Protected allowedRoles={['marketer', 'admin']}><Dashboard /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
