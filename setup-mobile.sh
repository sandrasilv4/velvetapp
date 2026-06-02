#!/bin/bash
# Setup inicial do Capacitor para Android e iOS (Mac only para iOS)

set -e

echo "===== Velvet Mobile Setup ====="
echo ""

# Verifica Node
if ! command -v node &> /dev/null; then
  echo "ERRO: Node.js não encontrado. Instale em https://nodejs.org"
  exit 1
fi

echo "1. Instalando dependências npm..."
npm install

echo ""
echo "2. Inicializando projetos nativos..."

# Android
echo "   Gerando projeto Android..."
npx cap add android 2>/dev/null || echo "   (Android já existe, pulando)"

# iOS — só no Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "   Gerando projeto iOS..."
  npx cap add ios 2>/dev/null || echo "   (iOS já existe, pulando)"
else
  echo "   (iOS requer Mac — pulando geração local)"
fi

echo ""
echo "3. Sincronizando assets..."
npx cap sync

echo ""
echo "===== Setup concluído! ====="
echo ""
echo "Próximos passos:"
echo ""
echo "  ANDROID:"
echo "    npm run cap:android   → Abre no Android Studio"
echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "  iOS:"
  echo "    npm run cap:ios       → Abre no Xcode"
  echo ""
fi
echo "  CI/CD:"
echo "    Configure os GitHub Secrets conforme MOBILE_SETUP.md"
echo ""
