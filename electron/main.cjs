'use strict';
const { app, BrowserWindow, shell, dialog } = require('electron');
const path   = require('path');
const { spawn } = require('child_process');
const http   = require('http');
const fs     = require('fs');
const os     = require('os');

const isDev = !app.isPackaged;
const ROOT  = isDev
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'app');

// Loggfil i samma mapp som kassabok.json
const LOG_DIR  = path.join(os.homedir(), 'Kassabok');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

function log(...args) {
  const line = new Date().toISOString() + ' ' + args.join(' ') + '\n';
  process.stdout.write(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

let mainWindow    = null;
let serverProcess = null;

function startServer() {
  return new Promise(resolve => {
    // I packad app ligger server.cjs i app.asar.unpacked
    // electron-builder kopierar asarUnpack-filer dit automatiskt
    const asarUnpacked = ROOT.replace('app.asar', 'app.asar.unpacked');
    
    // Prova asar.unpacked först, sedan ROOT direkt
    let serverFile = path.join(asarUnpacked, 'server.cjs');
    if (!fs.existsSync(serverFile)) {
      serverFile = path.join(ROOT, 'server.cjs');
    }

    log('ROOT:', ROOT);
    log('asarUnpacked:', asarUnpacked);
    log('serverFile:', serverFile);
    log('serverFile finns:', fs.existsSync(serverFile));
    log('execPath:', process.execPath);

    if (!fs.existsSync(serverFile)) {
      log('FEL: server.cjs hittades inte!');
      // Lista vad som faktiskt finns i ROOT
      try {
        const files = fs.readdirSync(ROOT);
        log('Filer i ROOT:', files.join(', '));
      } catch (e) {
        log('Kunde inte lista ROOT:', e.message);
      }
      resolve();
      return;
    }

    serverProcess = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    serverProcess.stdout.on('data', d => {
      const text = d.toString();
      log('[server]', text.trim());
      if (text.includes('3001') || text.includes('igång')) done();
    });
    serverProcess.stderr.on('data', d => {
      log('[server err]', d.toString().trim());
    });
    serverProcess.on('error', err => {
      log('Spawn-fel:', err.message);
      done();
    });
    serverProcess.on('exit', (code, signal) => {
      log('Server exit:', code, signal);
    });

    setTimeout(done, 20000);
  });
}

function waitForServer(attempts = 60) {
  return new Promise((resolve, reject) => {
    function try_() {
      const req = http.get('http://localhost:3001/api/data', res => {
        res.resume();
        log('Server svarar OK!');
        resolve();
      });
      req.on('error', (e) => {
        log('Väntar på server... försök kvar:', attempts, e.message);
        if (--attempts <= 0) {
          reject(new Error('Servern svarar inte på port 3001.\n\nSe loggfil: ' + LOG_FILE));
        } else {
          setTimeout(try_, 500);
        }
      });
      req.setTimeout(1000, () => req.destroy());
      req.end();
    }
    setTimeout(try_, 2000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820,
    minWidth: 900, minHeight: 600,
    title: 'Kassabok',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.loadFile(path.join(ROOT, 'dist', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  // Rensa gammal logg
  try { fs.writeFileSync(LOG_FILE, '--- Kassabok start ' + new Date().toISOString() + ' ---\n'); } catch {}
  
  log('app.whenReady, isDev:', isDev);
  try {
    await startServer();
    await waitForServer();
    createWindow();
  } catch (err) {
    log('STARTFEL:', err.message);
    dialog.showErrorBox('Kassabok – startfel', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',          () => { if (!mainWindow) createWindow(); });
app.on('before-quit',       () => { if (serverProcess) { log('Stänger server'); serverProcess.kill(); } });
