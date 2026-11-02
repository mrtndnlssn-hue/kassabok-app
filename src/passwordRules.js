import { translate as t } from './i18n'

// Krav på nya lösenord (vid registrering och när man byter lösenord). Inloggning kontrollerar inte detta,
// så äldre lösenord fortsätter fungera. Samma krav bör ställas in i Supabase (Authentication → Sign In / Providers → Email).
export const MIN_PASSWORD_LENGTH = 10

const COMMON = [
  'password', 'lösenord', 'losenord', 'qwerty', 'qwertyuiop', 'abcdef', 'letmein', 'welcome', 'admin', 'administrator',
  'iloveyou', 'monkey', 'dragon', 'sommar', 'vinter', 'foreningen', 'föreningen', 'foreningsbalans', 'kassabok', 'kassören',
]

export const passwordHint = () => t('Minst 10 tecken, med både bokstäver och siffror.')

// Returnerar ett felmeddelande, eller tom text om lösenordet duger
export function checkPassword(password, email = '') {
  const pw = String(password || '')
  if (pw.length < MIN_PASSWORD_LENGTH) return t('Lösenordet måste vara minst 10 tecken.')
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return t('Lösenordet måste innehålla både bokstäver och siffror.')
  const letters = pw.toLowerCase().replace(/[^a-zåäö]/g, '')
  if (COMMON.includes(letters) || /^(.)\1+$/.test(pw)) return t('Lösenordet är för vanligt. Välj något mindre förutsägbart.')
  const local = String(email).split('@')[0].toLowerCase()
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return t('Lösenordet får inte innehålla din e-postadress.')
  return ''
}
