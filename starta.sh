#!/bin/bash
echo "Installerar beroenden..."
npm install

echo ""
echo "Startar kassabok-server..."
node server.js &
SERVER_PID=$!

echo "Startar Vite..."
npm run dev &
VITE_PID=$!

sleep 2
open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null

echo ""
echo "Kassabok körs. Stäng detta fönster för att avsluta."
wait $SERVER_PID
