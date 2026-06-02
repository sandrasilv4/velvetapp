# 📦 Como Instalar Node.js

Node.js não foi detectado no seu sistema. É necessário instalá-lo para usar npm.

## ⬇️ Passo 1: Baixar Node.js

1. Acesse: **https://nodejs.org/**
2. Clique em **"LTS"** (versão recomendada - estável)
3. Faça download do instalador `.msi` para Windows

## 🔧 Passo 2: Instalar

1. Execute o instalador baixado
2. Clique **"Next"** em todas as telas
3. Na tela "Custom Setup", certifique-se que:
   - ✅ **Node.js runtime** está marcado
   - ✅ **npm package manager** está marcado
   - ✅ **Add to PATH** está marcado
4. Clique **"Install"** e aguarde

## ✅ Passo 3: Verificar Instalação

Abra um **novo PowerShell** ou **Terminal** e execute:

```powershell
node --version
npm --version
```

Devem aparecer versões como `v18.x.x` ou superior.

## 🚀 Passo 4: Instalar Dependências do Projeto

Após confirmar que Node.js está instalado, navegue até o projeto e execute:

```powershell
cd C:\Users\sandr\Downloads\velvet-app
npm install imap mailparser
```

Depois aplique a migração SQL:

```sql
ALTER TABLE admin ADD COLUMN IF NOT EXISTS email_config JSONB;
```

E reinicie o servidor:

```powershell
npm start
```

## 🆘 Se Still Não Funcionar

Às vezes o PowerShell precisa ser reiniciado. Tente:

1. Feche o PowerShell completamente
2. Abra um **novo PowerShell** como Administrador
3. Execute novamente

## ⚠️ Alternativa: Usar Git Bash

Se continuar com problemas, você pode usar Git Bash (que geralmente vem com Node.js):

```bash
cd /c/Users/sandr/Downloads/velvet-app
npm install imap mailparser
```

---

**Precisa de ajuda?** Envie um print do erro ao executar `node --version`
