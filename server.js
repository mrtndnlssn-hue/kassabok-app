// server.js – lokal API-server som sparar data till kassabok.json
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require   = createRequire(import.meta.url);
const multer    = require('multer');

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const app        = express();
const PORT       = 3001;
// I Electron-läge sparas data i användarens hem-mapp, inte i app-mappen
// (app-mappen kan vara skrivskyddad vid installation)
const isElectron = !!process.env.ELECTRON_RUN_AS_NODE;
const DATA_DIR   = isElectron
  ? path.join(os.homedir(), 'Kassabok')
  : __dirname;
const DATA_FILE  = path.join(DATA_DIR, 'kassabok.json');
const ATTACH_DIR = path.join(DATA_DIR, 'bilagor');

// Se till att datamappen finns
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR);

// memoryStorage: vi skriver filen till disk i route-handleren
// (diskStorage kan inte använda req.params i destination-funktionen)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const DEFAULT_DATA = {
  orgName: 'Min Förening',
  activeYear: new Date().getFullYear(),
  categories: [
    { id: 'I01', name: 'Medlemsavgifter',         type: 'income'  },
    { id: 'I02', name: 'Bidrag och gåvor',         type: 'income'  },
    { id: 'I03', name: 'Sponsring',                type: 'income'  },
    { id: 'I04', name: 'Försäljning',              type: 'income'  },
    { id: 'I05', name: 'Arrangemang/Evenemang',    type: 'income'  },
    { id: 'I06', name: 'Ränteintäkter',            type: 'income'  },
    { id: 'I07', name: 'Övriga inkomster',         type: 'income'  },
    { id: 'U01', name: 'Lokalkostnader',           type: 'expense' },
    { id: 'U02', name: 'Löner och arvoden',        type: 'expense' },
    { id: 'U03', name: 'Administrationskostnader', type: 'expense' },
    { id: 'U04', name: 'IT och kommunikation',     type: 'expense' },
    { id: 'U05', name: 'Marknadsföring',           type: 'expense' },
    { id: 'U06', name: 'Arrangemang/Evenemang',    type: 'expense' },
    { id: 'U07', name: 'Resor och transport',      type: 'expense' },
    { id: 'U08', name: 'Material och förbrukning', type: 'expense' },
    { id: 'U09', name: 'Utbildning',               type: 'expense' },
    { id: 'U10', name: 'Övriga utgifter',          type: 'expense' },
  ],
  transactions: [],
  budget: {},
};

// ── Data helpers ─────────────────────────────────────────────
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return structuredClone(DEFAULT_DATA);
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Kunde inte läsa datafilen:', e.message);
    return structuredClone(DEFAULT_DATA);
  }
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
if (!fs.existsSync(DATA_FILE)) {
  writeData(DEFAULT_DATA);
  console.log(`  📄 Skapade ny datafil: ${DATA_FILE}`);
}

// ── Mappnamn ─────────────────────────────────────────────────
function safeName(str) {
  return (str || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').slice(0, 60);
}
function folderName(verNum, description) {
  return `VER${String(verNum).padStart(3, '0')}_${safeName(description) || 'verifikat'}`;
}
function txFolder(tx, allTransactions) {
  const sorted = [...allTransactions].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const verNum = sorted.findIndex(t => t.id === tx.id) + 1;
  return path.join(ATTACH_DIR, folderName(verNum, tx.description));
}

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Loggning (syns i terminalen där node server.js körs)
app.use((req, res, next) => {
  console.log(`  ${req.method} ${req.url}`);
  next();
});

app.use('/bilagor', express.static(ATTACH_DIR));

// ── API: data ────────────────────────────────────────────────
app.get('/api/data', (req, res) => res.json(readData()));
app.post('/api/data', (req, res) => { writeData(req.body); res.json({ ok: true }); });
app.patch('/api/data', (req, res) => {
  const data = readData();
  Object.assign(data, req.body);
  writeData(data);
  res.json({ ok: true });
});

// ── API: verifikat ───────────────────────────────────────────
app.post('/api/transactions', (req, res) => {
  const data = readData();
  const tx   = { ...req.body, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  data.transactions.push(tx);
  writeData(data);
  res.json(tx);
});

app.put('/api/transactions/:id', (req, res) => {
  const data = readData();
  const idx  = data.transactions.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Hittades inte' });
  const oldTx = data.transactions[idx];
  data.transactions[idx] = { ...oldTx, ...req.body };
  writeData(data);
  if (req.body.description && req.body.description !== oldTx.description) {
    const oldFolder = txFolder(oldTx, data.transactions);
    const newFolder = txFolder(data.transactions[idx], data.transactions);
    if (fs.existsSync(oldFolder) && oldFolder !== newFolder) {
      try { fs.renameSync(oldFolder, newFolder); } catch {}
    }
  }
  res.json(data.transactions[idx]);
});

app.delete('/api/transactions/:id', (req, res) => {
  const data = readData();
  data.transactions = data.transactions.filter(t => t.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ── API: bilagor ─────────────────────────────────────────────
app.get('/api/transactions/:id/attachments', (req, res) => {
  const data = readData();
  const tx   = data.transactions.find(t => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Verifikat hittades inte' });
  const folder = txFolder(tx, data.transactions);
  if (!fs.existsSync(folder)) return res.json([]);
  const files = fs.readdirSync(folder)
    .filter(f => !f.startsWith('.'))
    .map(f => ({
      name: f,
      url:  `/bilagor/${encodeURIComponent(path.basename(folder))}/${encodeURIComponent(f)}`,
      size: fs.statSync(path.join(folder, f)).size,
    }));
  res.json(files);
});

// Upload – multer anropas manuellt (inte som middleware) för att
// undvika att Express 5 returnerar HTML-felsidor vid fel
app.post('/api/transactions/:id/attachments', (req, res) => {
  upload.array('files', 20)(req, res, (multerErr) => {
    if (multerErr) {
      console.error('  Multer-fel:', multerErr.message);
      return res.status(400).json({ error: `Uppladdningsfel: ${multerErr.message}` });
    }

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Inga filer mottagna' });
    }

    const data = readData();
    const tx   = data.transactions.find(t => t.id === req.params.id);
    if (!tx) {
      return res.status(404).json({ error: `Verifikat ${req.params.id} hittades inte` });
    }

    const folder = txFolder(tx, data.transactions);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {
      return res.status(500).json({ error: `Kunde inte skapa mapp: ${e.message}` });
    }

    const saved = [];
    for (const file of files) {
      try {
        // Fixa latin1→utf8 kodning som webbläsare skickar i multipart
        const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const safeFn = decodedName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        fs.writeFileSync(path.join(folder, safeFn), file.buffer);
        saved.push({
          name: safeFn,
          url:  `/bilagor/${encodeURIComponent(path.basename(folder))}/${encodeURIComponent(safeFn)}`,
          size: file.size,
        });
        console.log(`  Sparade bilaga: ${safeFn} (${file.size} bytes) → ${path.basename(folder)}/`);
      } catch (e) {
        console.error(`  Fel vid skrivning av ${file.originalname}:`, e.message);
      }
    }

    res.json({ ok: true, files: saved, folder: path.basename(folder) });
  });
});

app.delete('/api/transactions/:id/attachments/:filename', (req, res) => {
  const data = readData();
  const tx   = data.transactions.find(t => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Hittades inte' });
  const filePath = path.join(txFolder(tx, data.transactions), req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});


// ── API: lista bilagor för en grupp verifikat (används av klientens ZIP-export) ──
app.get('/api/period-attachments', (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (ids.length === 0) return res.json([]);

  const data      = readData();
  const txIds     = new Set(ids);
  const txs       = data.transactions.filter(t => txIds.has(t.id));
  const result    = [];

  for (const tx of txs) {
    const folder = txFolder(tx, data.transactions);
    if (!fs.existsSync(folder)) continue;
    const folderBase = path.basename(folder);
    const files = fs.readdirSync(folder).filter(f => !f.startsWith('.'));
    for (const file of files) {
      result.push({
        zipPath: `bilagor/${folderBase}/${file}`,
        url:     `/bilagor/${encodeURIComponent(folderBase)}/${encodeURIComponent(file)}`,
      });
    }
  }

  console.log(`  Bilagor för zip: ${result.length} filer från ${txs.length} verifikat`);
  res.json(result);
});

// ── Global JSON-felhanterare (förhindrar HTML-svar vid oväntade fel) ──
app.use((err, req, res, next) => {
  console.error('  Serverfel:', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ✅ Kassabok-server igång!');
  console.log(`  📁 Datafil:   ${DATA_FILE}`);
  console.log(`  📎 Bilagor:   ${ATTACH_DIR}`);
  console.log(`  🌐 Adress:    http://localhost:${PORT}`);
  console.log('');
  console.log('  Öppna appen:  http://localhost:5173');
  console.log('  (Kör npm run dev i ett annat terminalfönster)');
  console.log('');
});
