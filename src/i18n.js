import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './locales/en'

// Svenska är källspråket: texten i koden är nyckeln. Engelska hämtas ur src/locales/en.
// Saknas en översättning visas den svenska texten (och en varning skrivs i utvecklingsläge).
export const LANGUAGES = [
  { code: 'sv', label: 'Svenska' },
  { code: 'en', label: 'English' },
]

const STORAGE_KEY = 'kb_lang'

function detectLanguage() {
  // ?lang=en|sv i adressen (t.ex. länk från marknadssidan) gäller först och sparas
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang')
    if (fromUrl === 'sv' || fromUrl === 'en') {
      localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
  } catch { /* ignore */ }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'sv' || saved === 'en') return saved
  } catch { /* ingen lagring tillgänglig */ }
  return (navigator.language || 'sv').toLowerCase().startsWith('sv') ? 'sv' : 'en'
}

let current = detectLanguage()
const warned = new Set()

export const getLang = () => current
export const locale = () => (current === 'en' ? 'en-GB' : 'sv-SE')

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : text)

// Mallnycklar ("Koden {kod} finns redan.") kan också matcha färdiga texter, t.ex. felmeddelanden från databasen.
let templates = null
function matchTemplate(text) {
  if (!templates) {
    templates = Object.keys(en).filter(k => /\{\w+\}/.test(k)).map(k => {
      const names = []
      const re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (m, n) => { names.push(n); return '(.+?)' }) + '$')
      return { k, re, names }
    })
  }
  for (const { k, re, names } of templates) {
    const m = text.match(re)
    if (m) return fill(en[k], Object.fromEntries(names.map((n, i) => [n, m[i + 1]])))
  }
  return null
}

export function translate(key, vars) {
  let text = key
  if (current === 'en') {
    if (key in en) text = en[key]
    else {
      const viaTemplate = matchTemplate(key)
      if (viaTemplate) return viaTemplate
      if (import.meta.env.DEV && !warned.has(key)) { warned.add(key); console.warn('[i18n] saknar översättning:', key) }
    }
  }
  return fill(text, vars)
}

const I18nContext = createContext({ lang: current, setLang: () => {}, t: translate })

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(current)

  const setLang = useCallback(code => {
    current = code
    try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
    document.documentElement.lang = code
    document.title = translate('Föreningsbalans – Bokföring för ideella föreningar')
    setLangState(code)
  }, [])

  useEffect(() => {
    document.documentElement.lang = current
    document.title = translate('Föreningsbalans – Bokföring för ideella föreningar')
  }, [])

  const value = useMemo(() => ({ lang, setLang, t: translate }), [lang, setLang])
  return createElement(I18nContext.Provider, { value }, children)
}

// Komponenter som visar text anropar useI18n() så att de ritas om när språket byts.
export const useI18n = () => useContext(I18nContext)
