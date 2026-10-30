# Kassabok – för ideell förening

## Köra som webbapp (befintligt sätt)

1. Kör `npm install` (första gången)
2. Öppna två terminalfönster:
   - Fönster 1: `node server.js`
   - Fönster 2: `npm run dev`
3. Öppna `http://localhost:5173` i webbläsaren

**Windows:** Dubbelklicka på `starta.bat`  
**Mac/Linux:** Kör `./starta.sh`

---

## Bygga ett fristående Windows-program (.exe)

### Krav
- Node.js 18+ (https://nodejs.org)
- Windows 10/11 (för att bygga .exe)
- Internetanslutning (för att ladda ner Electron, ~150 MB)

### Bygg-instruktioner

1. Öppna en terminal i mappen `kassabok-app`
2. Kör:
   ```
   bygg-exe.bat
   ```
   (eller `npm run electron:build` manuellt)

3. När det är klart finns installationsprogrammet i:
   ```
   release/Kassabok Setup 1.0.0.exe
   ```

### Vad händer vid installation?
- Programmet installeras i `C:\Program Files\Kassabok\`
- En genväg skapas på skrivbordet och i Startmenyn
- Data sparas i `C:\Users\[ditt namn]\Kassabok\`
  - `kassabok.json` – all data
  - `bilagor/` – uppladdade filer

### Avinstallera
Använd Windows "Lägg till eller ta bort program" – data i hemkatalogen tas inte bort automatiskt.

---

## Teknisk info
- React 19 + Vite (frontend)
- Express 5 (lokal API-server)
- Electron 35 (skrivbordsapp-wrapper)
- jsPDF (PDF-generering)
- JSZip (ZIP-export)
- Data sparas lokalt, ingen molntjänst
