#!/bin/bash
echo "================================================"
echo " Kassabok - Bygger program"
echo "================================================"
echo ""

echo "[1/4] Installerar beroenden..."
npm install || { echo "FEL vid npm install"; exit 1; }

echo ""
echo "[2/4] Bygger React-appen..."
npm run build || { echo "FEL vid vite build"; exit 1; }

echo ""
echo "[3/4] Skapar installationsprogram..."
npx electron-builder || { echo "FEL vid electron-builder"; exit 1; }

echo ""
echo "Klart! Hitta programmet i mappen: release/"
