// server-launcher.cjs – CJS wrapper som startar server.js (ESM)
// Körs av Electron via spawn med ELECTRON_RUN_AS_NODE=1
'use strict';

const path = require('path');
const url  = require('url');

// server.js ligger i samma mapp som denna fil's parent (ROOT)
const serverPath = path.join(__dirname, '..', 'server.js');
const serverUrl  = url.pathToFileURL(serverPath).href;

// Dynamisk import fungerar i CJS och laddar ESM-moduler
import(serverUrl).catch(err => {
  console.error('Kunde inte starta server:', err.message);
  console.error(err.stack);
  process.exit(1);
});
