# Agenda 5588 — Solicitação de Agenda

Sistema de solicitação e gestão de agendas públicas, no estilo Google Forms, com área
administrativa, integração com o Google Agenda, relatórios em Excel e retorno ao solicitante
pelo WhatsApp.

- **Formulário público** (`/`) — você envia o link, a pessoa preenche e envia. Sem cadastro, sem login.
- **Área restrita** (`/admin`) — só com e-mail e senha; no celular, biometria depois do primeiro acesso.

TypeScript em todo o projeto: Node + Express + SQLite no backend, React + Vite no frontend.
Roda em Docker e foi pensado para ser publicado via Tailscale.

> **Vai colocar no ar?** O passo a passo operacional está em **[DEPLOY.md](DEPLOY.md)**.
> Este arquivo descreve o que o sistema faz e como ele é feito por dentro.

---

## 1. O que o sistema faz

### Formulário público

| Campo | Tipo |
| --- | --- |
| Nome completo do solicitante | texto |
| WhatsApp do solicitante | telefone com máscara `(21) 99999-9999` |
| Data do evento | seletor de data, sem permitir datas passadas |
| Horário de início | seletor de hora |
| Duração | 1 hora · 2 horas · 3 horas · Mais de 3 horas |
| Horário de chegada da equipe | seletor de hora, limitado ao início do evento |
| CEP | consulta o ViaCEP e preenche rua, bairro, cidade e UF |
| Número, complemento, referência | texto (o foco pula para o número após o CEP) |
| Público estimado | de 10 em 10 até 100, depois 100–150, 150–200 e mais de 200 |
| Pauta / briefing | texto longo |

Detalhes de comportamento:

- Todo texto é gravado **em caixa alta**, independente de como foi digitado. Acentos preservados.
- Cada envio gera um **protocolo** (`AG-2026-0001`) mostrado ao solicitante.
- Título, descrição, mensagem de sucesso, banner do topo e marca d'água de fundo são editáveis
  pelo administrador.
- Limite de 15 envios por hora por IP, contra spam.

### Área administrativa

**Solicitações** — lista com busca e filtros de múltipla escolha. Cada linha traz o botão do
WhatsApp (abre a conversa, sem texto pronto), o botão de reagendar e o detalhe completo.

**Agenda** — visões de mês, semana e lista. Alterna entre os eventos do sistema e a leitura
direta do Google Agenda.

**Relatórios** — duas abas: *Respostas*, com as 25 colunas do formulário e a resposta individual;
e *Resumo*, com consolidados por mês, cidade, bairro, público e dia da semana. Exporta para Excel
respeitando os filtros aplicados.

**Usuários** e **Configurações** — só para administradores.

### Perfis de acesso

| Ação | Administrador | Gerente de agenda |
| --- | :---: | :---: |
| Ver solicitações e dados do solicitante | ✅ | ✅ |
| Confirmar, recusar, alterar status | ✅ | ✅ |
| Reagendar (mudar data e horários) | ✅ | ✅ |
| Falar com o solicitante pelo WhatsApp | ✅ | ✅ |
| Ver a agenda e os relatórios | ✅ | ✅ |
| Exportar para Excel | ✅ | ✅ |
| Criar, editar e desativar usuários | ✅ | ❌ |
| Editar o formulário e as mensagens | ✅ | ❌ |
| Configurar o Google Agenda | ✅ | ❌ |
| Excluir solicitações | ✅ | ❌ |

A separação é aplicada **no servidor**, rota por rota — não é só a interface escondendo botões.

### Fluxo de trabalho

1. A solicitação chega como **Pendente**.
2. Você abre o WhatsApp pelo botão da lista e conversa com a pessoa.
3. Se a data serve: **Confirmar agenda** → o sistema abre a mensagem de confirmação pronta.
4. Se precisa mudar: **Reagendar** → nova data e horários → salvar e enviar a mensagem de
   remarcação.
5. Confirmar cria o evento no Google Agenda; mudar para pendente, recusado ou cancelado remove.

### Mensagens de WhatsApp

Três modelos editáveis — confirmação, remarcação e recusa — com as variáveis `{{nome}}`,
`{{data}}`, `{{hora}}`, `{{fim}}`, `{{duracao}}`, `{{chegada}}`, `{{endereco}}`, `{{publico}}`,
`{{pauta}}`, `{{protocolo}}` e `{{whatsapp}}`.

O sistema monta o link conforme o aparelho: no celular abre o aplicativo; no computador abre o
WhatsApp Web. Isso existe porque, no Windows, o link entregue ao aplicativo desktop passa por uma
codificação antiga que quebra emojis (acentos sobrevivem, emojis não). Em
*Configurações → Mensagens* há três modos: **Automático** (com emojis no celular, sem no
computador), **Sempre com emojis** e **Nunca usar emojis**.

### Login e biometria

Primeiro acesso com e-mail e senha. Logo depois, no celular, o sistema oferece ativar a
biometria daquele aparelho — nos acessos seguintes a tela de login abre direto na digital.
É o padrão de aplicativo de banco.

Usa **WebAuthn/passkey**: a digital nunca sai do aparelho, o servidor guarda apenas uma chave
pública. Trocar a senha de um usuário remove as biometrias dele.

Biometria aparece **só em celular e tablet**, e só em HTTPS (ou `localhost`). No computador o
acesso é sempre por senha.

---

## 2. Segurança

- Só duas rotas são públicas: ler o cabeçalho do formulário e gravar uma solicitação. Nenhum dado
  de solicitante sai sem autenticação.
- O token só é aceito no cabeçalho `Authorization`, nunca em querystring — inclusive o download do
  Excel, que é feito por `fetch` autenticado.
- Permissões por perfil validadas no backend, rota por rota.
- Senhas com bcrypt. Usuário desativado tem o token recusado na hora.
- Limite de tentativas: 12 logins por 15 minutos e 15 envios de formulário por hora, por IP.
- Helmet com CSP restritiva, `frame-ancestors: none`, sem stack trace em erro.
- O Client Secret do Google nunca volta para a tela; os tokens OAuth nunca saem da API.
- Histórico interno de quem confirmou, reagendou, alterou status ou acionou o WhatsApp.

---

## 3. Como rodar

### Docker (produção)

```bash
cp .env.example .env      # edite antes de subir — veja DEPLOY.md
docker compose up -d --build
```

### Sem Docker (desenvolvimento)

```bash
# terminal 1
cd server && npm install && npm run dev

# terminal 2
cd web && npm install && npm run dev
```

O front sobe em `http://localhost:5173` e chama a API na `8080` via proxy.

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:8080` | URL completa por onde o sistema é acessado. **Precisa bater com o endereço do navegador** — é usada no OAuth do Google e como origem da biometria. |
| `JWT_SECRET` | *(inseguro)* | Segredo das sessões. Gere um valor aleatório longo. |
| `ADMIN_EMAIL` | `admin@agenda5588.local` | Administrador criado no primeiro boot. |
| `ADMIN_PASSWORD` | *(inseguro)* | Senha inicial desse administrador. |
| `PORT` | `8080` | Porta interna do servidor. |
| `TZ` | `America/Sao_Paulo` | Fuso horário. |
| `RP_NAME` | `Agenda 5588` | Nome exibido no prompt de biometria do aparelho. |
| `WEBAUTHN_ORIGINS` | — | Origens extras aceitas na biometria, separadas por vírgula. |
| `DATA_DIR` | `./data` | Pasta do banco SQLite. |
| `UPLOADS_DIR` | `./uploads` | Pasta das imagens enviadas pelo admin. |
| `WEB_DIR` | `./web/dist` | Pasta do frontend compilado. |
| `NODE_ENV` | `development` | Em `production`, o CORS só aceita `PUBLIC_URL`. |

---

## 4. Estrutura

```
server/src
  index.ts                    servidor, CSP, rate limit, arquivos estáticos
  env.ts                      variáveis de ambiente
  db.ts                       SQLite, tabelas e configurações padrão
  auth.ts                     usuários, perfis, hash de senha, middlewares
  shared.ts                   tipos, formatação, modelos de mensagem, link do WhatsApp
  routes/public.ts            formulário público (as duas únicas rotas sem login)
  routes/auth.ts              login, troca de senha, biometria (WebAuthn)
  routes/users.ts             usuários e perfis (só administrador)
  routes/admin.ts             solicitações, status, WhatsApp, Excel, configurações
  routes/google.ts            OAuth e leitura do Google Agenda
  services/googleCalendar.ts  criação, atualização e remoção de eventos

web/src
  api.ts                      cliente HTTP, tipos, download autenticado
  auth.tsx                    sessão e permissões na interface
  ui.tsx                      componentes, ícones, formatação, avisos
  styles.css                  tema (fundo claro, azul-marinho)
  pages/FormPage.tsx          formulário público
  pages/LoginPage.tsx         senha e biometria
  pages/AdminLayout.tsx       sidebar, navegação no celular, perfil
  pages/RequestsPage.tsx      lista, filtros, detalhe, confirmação, reagendamento
  pages/CalendarPage.tsx      mês, semana e lista — sistema ou Google
  pages/ReportsPage.tsx       respostas completas, resumo e exportação
  pages/UsersPage.tsx         usuários e perfis
  pages/SettingsPage.tsx      formulário, mensagens e Google
```

### Banco de dados

SQLite, arquivo único em `data/agenda.sqlite`. Quatro tabelas: `requests` (solicitações),
`users` (acessos), `webauthn_credentials` (biometrias) e `activity_log` (histórico), mais
`settings` (chave/valor) para o que é configurável pela tela.

As tabelas são criadas sozinhas no primeiro boot. Não há passo de migração manual.

### API

| Método | Rota | Acesso |
| --- | --- | --- |
| `GET` | `/api/public/form` | público |
| `POST` | `/api/public/requests` | público |
| `POST` | `/api/auth/login` | público |
| `POST` | `/api/auth/webauthn/login/options` · `/verify` | público |
| `GET` | `/api/auth/me` · `/webauthn/support` · `/webauthn/credentials` | autenticado |
| `POST` | `/api/auth/change-password` · `/webauthn/register/*` | autenticado |
| `GET` | `/api/admin/requests` · `/requests/:id` · `/options` · `/stats` · `/activity` | autenticado |
| `GET` | `/api/admin/requests/:id/whatsapp` · `/export.xlsx` | autenticado |
| `PATCH` | `/api/admin/requests/:id` | autenticado |
| `POST` | `/api/admin/requests/:id/sync` | autenticado |
| `DELETE` | `/api/admin/requests/:id` | **administrador** |
| `GET` `PUT` | `/api/admin/settings` | **administrador** |
| `POST` | `/api/admin/upload/:kind` (`background` \| `header`) | **administrador** |
| `GET` `POST` `PATCH` `DELETE` | `/api/admin/users` | **administrador** |
| `GET` | `/api/google/status` · `/events` | autenticado |
| `GET` | `/api/google/auth-url` · `/calendars` | **administrador** |
| `POST` | `/api/google/disconnect` | **administrador** |
| `GET` | `/api/google/callback` | público (validado por `state`) |
| `GET` | `/api/health` | público |

---

## 5. Personalização pela tela

Tudo em **Configurações**, sem mexer em código:

**Formulário** — título, descrição, mensagem de sucesso, abrir/fechar para novas solicitações,
banner do cabeçalho e imagem de fundo (marca d'água).

**Mensagens** — os três modelos de WhatsApp e o modo dos emojis.

**Google Agenda** — credenciais OAuth, calendário de destino, prefixo do título do evento e fuso.

### Imagens

| Arquivo | Onde aparece |
| --- | --- |
| `web/public/assets/5588.jpg` | banner no topo do formulário (proporção 4:1, ex. 1600×400) |
| `web/public/assets/candidatos.jpg` | marca d'água de fundo, esmaecida |
| `web/public/assets/icon.svg` | ícone da aba e do atalho no celular |

Trocar pela área admin (*Configurações → Formulário*) é o caminho recomendado: o arquivo vai para
`uploads/`, que é volume Docker, e sobrevive a reconstruções da imagem.
