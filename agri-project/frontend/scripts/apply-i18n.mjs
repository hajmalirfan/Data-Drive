import { readFile, writeFile } from 'node:fs/promises'
import { MESSAGES } from '../src/i18n/messages.js'

const files = [
  'src/components/AppShell.jsx',
  'src/components/Modal.jsx',
  'src/pages/Login.jsx',
  'src/pages/Dashboard.jsx',
  'src/pages/Crops.jsx',
  'src/pages/MarketPrices.jsx',
  'src/pages/Markets.jsx',
  'src/pages/Trucks.jsx',
  'src/pages/Tracking.jsx',
  'src/pages/Bookings.jsx',
  'src/pages/Reports.jsx',
  'src/pages/Profile.jsx',
  'src/pages/Admin.jsx',
]

const reverse = new Map()
for (const [key, value] of Object.entries(MESSAGES)) {
  if (!reverse.has(value)) reverse.set(value, key)
}

const lookup = (raw) => {
  const cleaned = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\s+/g, ' ').trim()
  return reverse.get(cleaned)
}

const escapeForSingle = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

for (const file of files) {
  const url = new URL(`../${file}`, import.meta.url)
  let source = await readFile(url, 'utf8')

  if (!source.includes("from '../context/LanguageContext'")) {
    const lastImport = [...source.matchAll(/^import .*$/gm)].pop()
    if (lastImport) {
      const insertAt = lastImport.index + lastImport[0].length
      source = `${source.slice(0, insertAt)}\nimport { useLanguage } from '../context/LanguageContext'${source.slice(insertAt)}`
    }
  }

  if (!source.includes('const { t } = useLanguage()')) {
    source = source.replace(
      /(export default function [A-Za-z0-9_]+\([^)]*\)\s*\{\n)/,
      `$1  const { t, statusLabel, roleLabel } = useLanguage()\n`,
    )
  }

  // JSX attribute values: prop="English text"
  source = source.replace(/="([^"\n]+)"/g, (match, value) => {
    const key = lookup(value)
    return key ? `={t('${key}')}` : match
  })

  // JSX text nodes: >English text<
  source = source.replace(/>([^<>{}\n]+)</g, (match, value) => {
    const key = lookup(value)
    return key ? `>{t('${key}')}<` : match
  })

  // JavaScript single-quoted string literals
  source = source.replace(/'((?:[^'\\\n]|\\.)*)'/g, (match, value) => {
    const key = lookup(value)
    return key ? `t('${key}')` : match
  })

  await writeFile(url, source, 'utf8')
  console.log(`updated ${file}`)
}
