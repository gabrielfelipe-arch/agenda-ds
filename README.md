# Agenda 5588 — Solicitação de Agenda

Sistema de solicitação e gestão de agendas públicas, no estilo Google Forms, com área
administrativa, integração com o Google Agenda, relatórios em Excel e retorno ao solicitante
pelo WhatsApp.

- **Formulário público** (`/`): qualquer pessoa com o link preenche e envia. Sem cadastro, sem login.
- **Área restrita** (`/admin`): somente com e-mail e senha (e biometria, depois do primeiro login).

Stack: **TypeScript** em todo o projeto — Node + Express + SQLite no backend, React + Vite no
frontend. Roda em **Docker** e foi pensado para ser publicado via **Tailscale**.

---

## 1. Subir o sistema

```bash
cp .env.example .env      # edite as variáveis (veja a seção 2)
docker compose up -d --build
```

Acesse `http://localhost:8080`. O primeiro boot cria o administrador definido no `.env`.

Para acompanhar os logs:

```bash
docker compose logs -f
```

Os dados ficam em dois volumes na pasta do projeto:

| Pasta      | Conteúdo                                     |
| ---------- | -------------------------------------------- |
| `./data`   | banco SQLite (`agenda.sqlite`)               |
| `./uploads`| imagem de fundo enviada pela área admin      |

Backup = copiar essas duas pastas.

## 2. Variáveis de ambiente (`.env`)

| Variável           | Para que serve                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`       | URL completa por onde o sistema é acessado. **Precisa bater com o endereço do navegador.** É usada no OAuth do Google e como origem da biometria. |
| `JWT_SECRET`       | Segredo das sessões. Gere: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_EMAIL`      | E-mail do administrador criado no primeiro boot                                                      |
| `ADMIN_PASSWORD`   | Senha inicial desse administrador — troque no primeiro acesso                                        |
| `RP_NAME`          | Nome exibido no prompt de biometria do celular                                                       |
| `WEBAUTHN_ORIGINS` | Origens extras aceitas na biometria, separadas por vírgula (opcional)                                |
| `TZ`               | Fuso horário (padrão `America/Sao_Paulo`)                                                            |

## 3. Publicar via Tailscale

A biometria (WebAuthn) **exige HTTPS**. O `tailscale serve` já entrega certificado válido:

```bash
tailscale serve --bg 8080
tailscale serve status        # mostra a URL https://<maquina>.<tailnet>.ts.net
```

Coloque essa URL no `.env` e reinicie:

```env
PUBLIC_URL=https://minha-maquina.tailXXXX.ts.net
```

```bash
docker compose up -d
```

Para deixar o formulário acessível fora da tailnet (o solicitante não precisa ter Tailscale),
use `tailscale funnel --bg 8080`. Nesse caso, revise se quer expor a rota `/admin` publicamente —
ela continua protegida por senha, com limite de tentativas de login.

---

## 4. Perfis de acesso

| Ação                                          | Administrador | Gerente de agenda |
| --------------------------------------------- | :-----------: | :---------------: |
| Ver solicitações e dados do solicitante        |       ✅       |         ✅         |
| Confirmar / alterar status do agendamento      |       ✅       |         ✅         |
| Falar com o solicitante pelo WhatsApp          |       ✅       |         ✅         |
| Ver agenda (calendário, semana, lista)         |       ✅       |         ✅         |
| Relatórios e exportação para Excel             |       ✅       |         ✅         |
| Criar / editar / desativar usuários            |       ✅       |         ❌         |
| Editar título, descrição e imagem do formulário|       ✅       |         ❌         |
| Configurar a integração com o Google Agenda    |       ✅       |         ❌         |
| Excluir solicitações                           |       ✅       |         ❌         |

A separação é aplicada **no servidor**, rota por rota — não é só a interface que esconde os botões.

## 5. Login e biometria (padrão de app de banco)

1. Primeiro acesso: e-mail e senha.
2. Logo após entrar, o sistema pergunta se você quer ativar a biometria daquele aparelho.
3. A partir daí, a tela de login abre direto no botão de digital / reconhecimento facial.

A biometria usa **WebAuthn/passkey**: a digital nunca sai do aparelho — o servidor guarda apenas
uma chave pública. Trocar a senha de um usuário remove as biometrias dele, por segurança.

> A biometria só aparece em conexões HTTPS (ou `localhost`). Em HTTP puro o sistema segue
> funcionando normalmente com senha.

## 6. Integração com o Google Agenda

Em **Configurações → Google Agenda**:

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a
   **Google Calendar API**.
2. Em *Credenciais*, crie um **ID do cliente OAuth → Aplicativo da Web**.
3. Em *URIs de redirecionamento autorizados*, cole exatamente a URI mostrada na tela de
   configurações (`<PUBLIC_URL>/api/google/callback`).
4. Copie Client ID e Client Secret para a tela e clique em **Conectar com o Google**.
5. Escolha o calendário de destino na lista.

Depois disso:

- Confirmar uma agenda **cria o evento** no Google Agenda.
- Editar a agenda confirmada **atualiza** o evento.
- Mudar o status para pendente/recusado/cancelado **remove** o evento.
- A tela **Agenda** permite alternar entre a visão do sistema e a leitura direta do Google.

Se o Google não estiver conectado, tudo continua funcionando — só não há sincronização.

## 7. Formulário público

Campos, com o tipo de dado certo em cada um:

| Campo                  | Tipo                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| Nome completo          | texto                                                                 |
| WhatsApp               | telefone com máscara `(21) 99999-9999`                                |
| Data do evento         | seletor de data, sem permitir datas passadas                          |
| Horário de início      | seletor de hora                                                       |
| Duração                | 1 ou 2 horas (mostra o término calculado)                             |
| Horário para chegada   | seletor de hora, validado contra o início                             |
| CEP                    | busca automática no ViaCEP e preenche rua/bairro/cidade/UF            |
| Número, complemento    | texto (o foco pula direto para o número depois do CEP)                |
| Público estimado       | lista: de 5 a 10, de 10 em 10 até 200, e “Mais de 200 pessoas”        |
| Pauta / briefing       | texto longo                                                           |

Cada envio gera um **protocolo** (`AG-2026-0001`) mostrado ao solicitante.

O título, a descrição, a mensagem de sucesso e a imagem de fundo são editáveis pelo
administrador e aparecem no topo do formulário, igual ao Google Forms.

### Imagem de fundo dos candidatos

A arte entra como **marca d'água opaca** (estilo sombra de documento) atrás do formulário:
esmaecida e dessaturada, sem atrapalhar a leitura dos campos.

Duas formas de colocar:

- **Pela área admin** (recomendado): *Configurações → Formulário → Enviar imagem de fundo*.
- **Pelo repositório**: o arquivo é `web/public/assets/candidatos.jpg` — esse é o caminho padrão.
  Aceita JPG, PNG e WEBP; quanto maior a resolução, mais nítida a marca d'água em telas grandes.

Se a imagem não existir, o formulário simplesmente aparece sem fundo, sem quebrar.

## 8. WhatsApp

Ao confirmar uma agenda, o sistema abre a prévia da mensagem e o botão **Abrir WhatsApp**, que
chama o WhatsApp Web/app já com o número do solicitante e o texto pronto — com emojis, negrito e
os dados do evento preenchidos.

Os dois modelos (confirmação e recusa) são editáveis em *Configurações → Mensagens*, com as
variáveis: `{{nome}}`, `{{data}}`, `{{hora}}`, `{{fim}}`, `{{duracao}}`, `{{chegada}}`,
`{{endereco}}`, `{{publico}}`, `{{pauta}}`, `{{protocolo}}`.

## 9. Relatórios

A tela **Relatórios** aplica filtros de status, período, cidade, público e busca livre, mostra o
consolidado (por mês, por cidade, horas de agenda) e exporta para **Excel** — a planilha sai com
cabeçalho formatado, filtros automáticos e exatamente as linhas do filtro em tela.

## 10. Segurança

- Nenhum dado de solicitante trafega em rota pública. As rotas públicas são só duas: ler o
  cabeçalho do formulário e gravar uma solicitação.
- Toda rota de leitura de dados exige token válido, verificado no servidor a cada requisição.
- O token **só** é aceito no cabeçalho `Authorization` — nunca em querystring (nem no download do
  Excel, que é feito por `fetch` autenticado).
- Permissões por perfil validadas no backend, rota por rota.
- Senhas com bcrypt; usuário desativado tem o token recusado na hora.
- Limite de tentativas: 12 logins por 15 min e 15 envios de formulário por hora, por IP.
- Helmet com CSP restritiva, sem `frame-ancestors`, sem exposição de stack trace em erro.
- Client Secret do Google nunca volta para a tela; tokens OAuth nunca saem da API.
- Histórico interno de quem confirmou, alterou status ou acionou o WhatsApp.

## 11. Desenvolvimento local (sem Docker)

```bash
# terminal 1
cd server && npm install && npm run dev

# terminal 2
cd web && npm install && npm run dev
```

O front sobe em `http://localhost:5173` e chama a API em `8080` via proxy.

## 12. Estrutura

```
server/src
  index.ts              servidor, CSP, rate limit, arquivos estáticos
  db.ts                 SQLite, tabelas e configurações
  auth.ts               usuários, perfis, hash de senha, middlewares
  shared.ts             tipos, formatação, modelo de mensagem, link do WhatsApp
  routes/public.ts      formulário público (única rota sem login)
  routes/auth.ts        login, troca de senha, biometria (WebAuthn)
  routes/users.ts       CRUD de usuários (só administrador)
  routes/admin.ts       solicitações, status, WhatsApp, Excel, configurações
  routes/google.ts      OAuth e leitura do Google Agenda
  services/googleCalendar.ts

web/src
  pages/FormPage.tsx     formulário público
  pages/LoginPage.tsx    senha + biometria
  pages/AdminLayout.tsx  sidebar, navegação mobile, perfil
  pages/RequestsPage.tsx lista, filtros, detalhe, confirmação, WhatsApp
  pages/CalendarPage.tsx mês / semana / lista, sistema ou Google
  pages/ReportsPage.tsx  consolidado e exportação
  pages/UsersPage.tsx    usuários e perfis
  pages/SettingsPage.tsx formulário, mensagens, Google
```
