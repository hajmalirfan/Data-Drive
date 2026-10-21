import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { translations, LANGUAGES } from '../i18n/translations'

const LanguageContext = createContext(null)
const STORAGE_KEY = 'agri-lang'

function getInitial() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && translations[saved]) return saved
  const nav = (navigator.language || 'en').toLowerCase()
  // map e.g. hi-IN -> hi
  const base = nav.split('-')[0]
  if (translations[base]) return base
  return 'en'
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(getInitial)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => {
    const t = (key, vars) => {
      let text = translations[lang]?.[key] ?? translations.en[key] ?? key
      if (vars) {
        if (Array.isArray(vars)) {
          vars.forEach((value, index) => {
            text = text.split(`<${index}>`).join(String(value ?? ''))
          })
        } else {
          Object.entries(vars).forEach(([name, value]) => {
            text = text.split(`<${name}>`).join(String(value ?? ''))
          })
        }
      }
      return text
    }
    const statusLabel = (status) => {
      const map = {
        requested: 'status.requested',
        accepted: 'status.accepted',
        assigned: 'status.assigned',
        picked_up: 'status.pickedUp',
        in_transit: 'status.inTransit',
        delivered: 'status.delivered',
        rejected: 'status.rejected',
        cancelled: 'status.cancelled',
        on_trip: 'status.onTrip',
        maintenance: 'status.maintenance',
        available: 'status.available',
        sold: 'status.sold',
        reserved: 'status.reserved',
        closed: 'status.closed',
      }
      return t(map[status] || '', undefined) || status
    }
    const roleLabel = (role) => {
      const map = {
        farmer: 'role.farmer',
        truck_operator: 'role.truckOperator',
        fpo: 'role.fpo',
        market_manager: 'role.marketManager',
        admin: 'role.admin',
        buyer: 'role.buyer',
        marketer: 'role.marketer',
      }
      return t(map[role] || '', undefined) || role
    }
    return { lang, setLang, t, statusLabel, roleLabel, languages: LANGUAGES }
  }, [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useLanguage = () => {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
