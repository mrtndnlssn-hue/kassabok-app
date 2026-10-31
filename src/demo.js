// Demokontot: användarnamn "demo" och lösenord "demo" på inloggningssidan.
// I databasen är det en läsare i föreningen "Demoförening – Björkbyns IF"; alla ändringar
// görs i webbläsarens minne (se store.js) och försvinner när sidan laddas om eller man loggar ut.
export const DEMO_EMAIL = 'demo@kassabok-demo.app'
export const DEMO_PASSWORD = 'dmk_7Qp2Zr9Lw4Ts8Vn'

export const isDemoSession = session => session?.user?.email === DEMO_EMAIL

export function demoCredentials(email, password) {
  if (email.trim().toLowerCase() === 'demo' && password === 'demo') {
    return { email: DEMO_EMAIL, password: DEMO_PASSWORD }
  }
  return null
}
