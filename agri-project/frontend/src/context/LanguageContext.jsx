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
    const t = (key) => translations[lang]?.[key] ?? translations.en[key] ?? key
    return { lang, setLang, t, languages: LANGUAGES }
  }, [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useLanguage = () => {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
