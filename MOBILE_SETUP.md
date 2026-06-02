# Velvet — Setup Mobile (Android & iOS)

## Visão Geral

O app usa **Capacitor** para empacotar o site `https://www.velvet.lat` em apps nativos para Android e iOS. O conteúdo é sempre carregado da URL de produção — não há assets locais.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Onde instalar |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org |
| Android Studio | Qualquer recente | https://developer.android.com/studio |
| Xcode | ≥ 15 | Mac App Store (**só no Mac**) |
| CocoaPods | ≥ 1.13 | `sudo gem install cocoapods` (**só no Mac**) |
| Java (JDK) | 17 | https://adoptium.net |

---

## 2. Primeiro Setup

```bash
# Clone o repo e entre na pasta
cd PLATAFORMA

# Roda o script de setup
bash setup-mobile.sh
```

Esse script:
- Instala as dependências npm (incluindo `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`)
- Gera os projetos nativos `android/` e `ios/`
- Sincroniza os assets

---

## 3. Desenvolver Localmente

### Android
```bash
npm run cap:android
# Abre o Android Studio com o projeto
# Clique em Run ▶ para rodar no emulador/device
```

### iOS (Mac apenas)
```bash
npm run cap:ios
# Abre o Xcode com o projeto
# Selecione um simulador e clique em Run ▶
```

---

## 4. CI/CD com GitHub Actions

Os workflows já estão configurados em `.github/workflows/`. Eles disparam automaticamente a cada push na branch `main` que altere arquivos relevantes.

### 4.1 GitHub Secrets Necessários

Acesse **Settings → Secrets and variables → Actions** no repositório e adicione:

#### iOS
| Secret | Descrição | Como obter |
|---|---|---|
| `APPLE_CERTIFICATE_BASE64` | Certificado P12 (distribution) em base64 | Exportar do Keychain Access → `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Senha do P12 | Senha usada na exportação |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Perfil de provisionamento em base64 | Baixar do Apple Developer → `base64 -i profile.mobileprovision` |
| `APPLE_TEAM_ID` | Team ID da Apple | developer.apple.com → Membership |
| `APPLE_API_KEY_ID` | ID da chave da API App Store Connect | App Store Connect → Users → Integrations → Keys |
| `APPLE_API_ISSUER_ID` | Issuer ID da API | Mesmo local da key |
| `APPLE_API_KEY_BASE64` | Arquivo `.p8` em base64 | Baixar .p8 → `base64 -i key.p8` |
| `EXPORT_OPTIONS_PLIST` | ExportOptions.plist em base64 | Ver seção 4.2 abaixo |
| `KEYCHAIN_PASSWORD` | Senha temporária para keychain no CI | Qualquer string aleatória |

#### Android
| Secret | Descrição | Como obter |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Keystore em base64 | `base64 -i velvet.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Senha do keystore | Senha usada na criação |
| `ANDROID_KEY_ALIAS` | Alias da chave | Definido na criação do keystore |
| `ANDROID_KEY_PASSWORD` | Senha da chave | Senha usada na criação |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | JSON da conta de serviço | Google Play Console → Setup → API access |

### 4.2 Criar ExportOptions.plist

Crie um arquivo `ExportOptions.plist` com o conteúdo abaixo, depois converta para base64:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>teamID</key>
    <string>SEU_TEAM_ID_AQUI</string>
    <key>uploadBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>provisioningProfiles</key>
    <dict>
        <key>lat.velvet.app</key>
        <string>velvet_appstore</string>
    </dict>
</dict>
</plist>
```

```bash
base64 -i ExportOptions.plist | pbcopy  # copia para clipboard
```

---

## 5. Conta Apple Developer

Para publicar na App Store você precisa:

1. **Apple Developer Program** — $99/ano em https://developer.apple.com/programs/
2. Criar o **App ID** `lat.velvet.app` em Certificates, Identifiers & Profiles
3. Criar um **Distribution Certificate** (exportar como P12)
4. Criar um **App Store Provisioning Profile** vinculado ao App ID acima
5. Criar uma **API Key** em App Store Connect para upload automatizado

---

## 6. Conta Google Play

Para publicar na Play Store:

1. **Google Play Developer Account** — taxa única de $25 em https://play.google.com/console
2. Criar o app com package name `lat.velvet.app`
3. Criar uma **Service Account** com permissão de Release Manager
4. Baixar o JSON da service account e adicionar como `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

---

## 7. Atualizar o App

Qualquer mudança no site `www.velvet.lat` reflete automaticamente no app (sem novo deploy da loja), pois o Capacitor carrega a URL de produção.

Para atualizar algo **nativo** (permissões, ícones, versão):

```bash
# Após alterar capacitor.config.json ou assets nativos
npx cap sync

# Commit e push → CI/CD faz o build e envia para as lojas
git add -A && git commit -m "update: versão mobile X.Y" && git push
```

---

## 8. Ícones e Splash Screen

Coloque os arquivos em `resources/` e rode:

```bash
npx capacitor-assets generate
```

Arquivos necessários:
- `resources/icon.png` — 1024×1024 px
- `resources/splash.png` — 2732×2732 px
- `resources/icon-foreground.png` — 432×432 px (Android adaptive icon)
- `resources/icon-background.png` — 432×432 px (Android adaptive icon)

---

## 9. Estrutura de Arquivos Criados

```
PLATAFORMA/
├── capacitor.config.json        ← Configuração principal do Capacitor
├── setup-mobile.sh              ← Script de setup inicial
├── fastlane/
│   ├── Appfile                  ← Identifiers do app (Apple)
│   └── Fastfile                 ← Lanes de build e deploy
├── .github/workflows/
│   ├── ios-build.yml            ← CI/CD iOS → TestFlight
│   └── android-build.yml        ← CI/CD Android → Play Store
├── ios/                         ← Gerado por: npx cap add ios (Mac)
└── android/                     ← Gerado por: npx cap add android
```
