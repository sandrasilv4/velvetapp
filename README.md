# Velvet App — Portfólio

Plataforma de conteúdo por assinatura. Este repositório é uma cópia de portfólio com dados de simulação para demonstração.

---

## Contas de Demonstração

### Admin
| Email | Senha |
|-------|-------|
| admin@velvet.portfolio | Admin123! |

### Agência
| Email | Senha |
|-------|-------|
| agencia@velvet.portfolio | Agencia123! |

### Modelos
| Email | Senha | Perfil |
|-------|-------|--------|
| sofia@velvet.portfolio | Modelo123! | Sofia — Lifestyle & Moda · São Paulo |
| luna@velvet.portfolio | Modelo123! | Luna — Fitness & Bem-estar · Rio de Janeiro |
| valentina@velvet.portfolio | Modelo123! | Valentina — Arte & Fotografia · Florianópolis |

### Clientes
| Email | Senha |
|-------|-------|
| cliente1@velvet.portfolio | Cliente123! |
| cliente2@velvet.portfolio | Cliente123! |

---

## Funcionalidades

- Feed de descoberta de criadores
- Perfil público de modelo com bio, localização e plano de assinatura
- Sistema de chat em tempo real (Socket.IO)
- Inbox separado por role (modelo / cliente)
- Área do usuário com edição de perfil e upload de avatar/capa
- Painel administrativo
- Painel de agência
- Sistema de conteúdos (feed, premium, mídia paga)
- Pagamentos via PIX e cartão (Pagar.me / Stripe)
- Notificações push (VAPID)
- PWA instalável

---

## Stack

- **Backend:** Node.js + Express + Socket.IO
- **Banco de dados:** PostgreSQL (Supabase)
- **Storage:** Supabase Storage
- **Autenticação:** JWT com token versioning
- **Pagamentos:** Pagar.me, Stripe, AbacatePay

---

## Rodar localmente

```bash
npm install
npm start
```

Acesse: `http://localhost:3000`

> Requer arquivo `.env` com `DATABASE_URL`, `JWT_SECRET` e demais variáveis configuradas.
