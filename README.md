# Föreningsbalans – bokföring för ideell förening

Webb-app för bokföring i ideella föreningar. Körs i webbläsaren och sparar data i molnet via Supabase.

**Live:** https://app.foreningsbalans.se

---

## Utveckling lokalt

1. Klona repot och kör `npm install`
2. Skapa en `.env`-fil med dina Supabase-nycklar:
   ```
   VITE_SUPABASE_URL=https://ditt-projekt.supabase.co
   VITE_SUPABASE_ANON_KEY=din-anon-nyckel
   ```
3. Starta dev-servern:
   ```
   npm run dev
   ```
4. Öppna `http://localhost:5173`

---

## Teknisk info
- React 19 + Vite (frontend)
- Supabase (databas, autentisering och fillagring)
- jsPDF (PDF-generering)
- JSZip (ZIP-export vid stängning av räkenskapsår)
- Vercel (hosting)
