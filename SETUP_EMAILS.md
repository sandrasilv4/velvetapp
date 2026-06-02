# 📧 Configuração de Gerenciador de Emails Hostinger

## O que foi criado?

Um dashboard completo para gerenciar emails da Hostinger dentro do seu admin, similar a configurar Gmail no Outlook.

## Arquivos Modificados/Criados

### Frontend
- ✅ `public/admin/admin-dashboard.html` - Adicionado menu "Emails" e 3 abas
- ✅ `public/admin/admin-dashboard.js` - Funções para gerenciar emails

### Backend
- ✅ `routes/adminEmail.js` - Rotas de API para emails
- ✅ `server.js` - Integração das rotas

### Banco de Dados
- ✅ `migrations/add_email_config_to_admin.sql` - Schema de configuração

## Passos para Implementar

### 1️⃣ Instalar Dependências

Execute no terminal do projeto:
```bash
npm install imap mailparser
```

### 2️⃣ Aplicar Migração do Banco de Dados

Execute a migração SQL no seu banco PostgreSQL:
```sql
ALTER TABLE admin ADD COLUMN IF NOT EXISTS email_config JSONB;
```

Ou se estiver usando um arquivo de migração:
```bash
psql -U seu_usuario -d seu_banco -f migrations/add_email_config_to_admin.sql
```

### 3️⃣ Reiniciar o Servidor

```bash
npm start
```

## Como Usar

### Configurar Email
1. Acesse **Admin Dashboard** → **Emails** → **Configuração**
2. Insira seus dados:
   - **Email**: seu.email@seudominio.com
   - **Senha**: Sua senha de email
   - **Servidor IMAP**: mail.seudominio.com (para Hostinger)
   - **Porta IMAP**: 993
   - **Servidor SMTP**: mail.seudominio.com (para Hostinger)
   - **Porta SMTP**: 587
3. Clique **Conectar Email**

### Caixa de Entrada
- Sincronize emails com o botão 🔄
- Clique em qualquer email para visualizar o conteúdo completo
- Os últimos 20 emails são exibidos

### Enviar Emails
- Clique **✏️ Novo Email**
- Preencha: Para, Assunto, Mensagem
- Enviar!

## Configurações Hostinger

### Dados Corretos para Hostinger

Para emails hospedados na Hostinger, use:

| Campo | Valor |
|-------|-------|
| **IMAP Host** | mail.seudominio.com |
| **IMAP Port** | 993 (SSL) ou 143 (TLS) |
| **SMTP Host** | mail.seudominio.com |
| **SMTP Port** | 587 (TLS) ou 465 (SSL) |
| **Segurança** | TLS/SSL ativado |

⚠️ Substitua `seudominio.com` pelo seu domínio real!

### Onde Encontrar seus Dados na Hostinger

1. Entre no painel da Hostinger
2. Vá para **Email** → Seu email
3. Procure por **Configurações IMAP/SMTP** ou **Detalhes de Acesso**
4. Copie o servidor e porta

## Recursos Implementados

✅ **Configuração Segura**
- Credenciais armazenadas no banco de dados
- Suporte a TLS/SSL

✅ **Sincronização de Emails**
- Carrega últimos 20 emails
- Exibe De, Assunto, Data
- Visualização de conteúdo completo

✅ **Enviar Emails**
- Interface simples de composer
- Suporte a formatação de texto

✅ **Interface Intuitiva**
- 3 abas: Configuração, Caixa de Entrada, Enviados
- Status de conexão visual
- Botões de ação rápida

## Limitações Atuais

⚠️ Enviados apenas salvos em cache (não sincronizados com IMAP)
⚠️ Suporta apenas texto simples e HTML básico
⚠️ Não há suporte a anexos ainda
⚠️ Sincronização manual (não automática)

## Próximas Melhorias

Possíveis implementações futuras:
- ✓ Sincronização automática por cron
- ✓ Suporte a anexos
- ✓ Pasta Enviados do IMAP
- ✓ Busca avançada
- ✓ Labels/Tags
- ✓ Deletar emails

## Troubleshooting

### "Erro ao conectar ao email"
- Verifique se o servidor, porta e credenciais estão corretos
- Tente desativar 2FA temporariamente se houver
- Hostinger pode exigir "Senhas de aplicativo"

### "Timeout na sincronização"
- Verifique conexão de internet
- Reduzir quantidade de emails carregados
- Verificar firewall/antivírus bloqueando IMAP

### "Email não sincroniza"
- Verifique se o servidor IMAP está ativado na Hostinger
- Tente testar conexão com outro cliente de email primeiro

## Suporte

Para dúvidas sobre configuração:
1. Consulte documentação da Hostinger
2. Verifique console do navegador (F12) para erros
3. Verifique logs do servidor Node.js
