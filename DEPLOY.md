# Guia de implantação — Agenda 5588

Passo a passo para colocar o sistema no ar. Feito para ser seguido de cima para baixo, sem
conhecimento prévio do projeto.

Tempo estimado: **30 minutos** (mais 15 se for configurar o Google Agenda).

---

## Antes de começar

Você vai precisar de:

- [ ] Uma máquina com **Docker** instalado ([docker.com/get-started](https://www.docker.com/get-started/))
- [ ] A pasta do projeto nessa máquina
- [ ] Uma conta **Tailscale** (gratuita) — [tailscale.com](https://tailscale.com)
- [ ] *(Opcional)* Uma conta Google para sincronizar a agenda

Por que Tailscale: o sistema precisa de **HTTPS** para o login por biometria funcionar, e o
Tailscale entrega um certificado válido sem você ter que comprar domínio nem configurar
certificado à mão. Sem ele o sistema funciona, mas só com senha.

---

## Passo 1 — Preparar o arquivo de configuração

Na pasta do projeto:

```bash
cp .env.example .env
```

Abra o `.env` e ajuste **quatro linhas**. As outras podem ficar como estão.

### 1.1 Gere o segredo das sessões

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copie o resultado para:

```env
JWT_SECRET=cole-aqui-o-valor-gerado
```

> Se trocar esse valor depois, todo mundo é deslogado. É o comportamento esperado.

### 1.2 Defina o administrador inicial

```env
ADMIN_EMAIL=seu.email@exemplo.com
ADMIN_PASSWORD=UmaSenhaForte123!
```

Esse usuário é criado **apenas no primeiro boot**, quando o banco ainda está vazio. Depois disso,
mudar essas variáveis não tem efeito — novos usuários se criam pela tela.

### 1.3 A URL pública — o ponto mais importante

```env
PUBLIC_URL=http://localhost:8080
```

Deixe assim por enquanto. No Passo 4 você troca pela URL definitiva.

> **Este valor precisa ser idêntico ao endereço que aparece na barra do navegador.** Ele é usado
> como origem da biometria e no redirecionamento do Google. Se estiver errado, o login por
> digital falha e o Google recusa a conexão.

---

## Passo 2 — Colocar a imagem dos candidatos

Duas artes, ambas opcionais (o sistema funciona sem elas):

| Arquivo | Onde aparece | Formato ideal |
| --- | --- | --- |
| `web/public/assets/5588.jpg` | banner no topo do formulário | faixa 4:1 — 1600×400 |
| `web/public/assets/candidatos.jpg` | marca d'água de fundo | retrato, quanto maior melhor |

Aceita JPG, PNG e WEBP. Também dá para trocar depois pela área administrativa, sem mexer em
arquivo — e esse é o caminho preferível, porque a imagem enviada pela tela vai para a pasta
`uploads/`, que sobrevive a reconstruções.

---

## Passo 3 — Subir pela primeira vez

```bash
docker compose up -d --build
```

A primeira construção leva alguns minutos. Verifique:

```bash
docker compose ps          # deve mostrar "Up (healthy)"
docker compose logs -f     # Ctrl+C para sair
```

Nos logs você deve ver:

```
[auth] usuário administrador inicial criado: seu.email@exemplo.com
Agenda 5588 rodando em http://0.0.0.0:8080 (público: http://localhost:8080)
```

Abra `http://localhost:8080` — o formulário deve aparecer. Depois `http://localhost:8080/admin`
e entre com o e-mail e a senha do `.env`.

**Deu certo? Vá para o Passo 4.** Se não, pule para *Problemas comuns* no fim deste guia.

---

## Passo 4 — Publicar com Tailscale

### 4.1 Instale e conecte

Baixe em [tailscale.com/download](https://tailscale.com/download), instale e rode:

```bash
tailscale up
```

Faça login na conta. A máquina entra na sua rede privada.

### 4.2 Exponha o sistema

```bash
tailscale serve --bg 8080
tailscale serve status
```

O comando mostra uma URL parecida com:

```
https://nome-da-maquina.tailXXXX.ts.net
```

**Copie essa URL.**

### 4.3 Aponte o sistema para ela

No `.env`:

```env
PUBLIC_URL=https://nome-da-maquina.tailXXXX.ts.net
NODE_ENV=production
```

Reinicie:

```bash
docker compose up -d
```

Abra a URL no navegador e no celular. Agora é HTTPS, e a biometria vai funcionar.

### 4.4 Quem precisa alcançar o formulário?

O `tailscale serve` deixa o sistema visível **só para quem está na sua rede Tailscale**. Se o
formulário vai para pessoas de fora — que é o caso normal —, use:

```bash
tailscale funnel --bg 8080
```

Aí a URL fica acessível na internet pública, e qualquer pessoa com o link consegue preencher.

> **O que isso expõe.** A rota `/admin` também fica alcançável, protegida por senha e com limite
> de 12 tentativas de login a cada 15 minutos. Se preferir manter a administração fechada, uma
> alternativa é usar `serve` (só a equipe, via Tailscale) e distribuir o formulário por outro
> caminho. Decida isso com quem responde pela campanha.

---

## Passo 5 — Primeiro acesso da equipe

### 5.1 Troque a senha do administrador

Entre em `/admin`, clique no seu nome no rodapé da barra lateral e troque a senha. A do `.env`
foi só para o primeiro acesso.

### 5.2 Crie os usuários

Em **Usuários → Novo usuário**. Dois perfis:

- **Administrador** — faz tudo, inclusive criar usuários e mexer nas configurações.
- **Gerente de agenda** — confirma, reagenda, altera status, fala com o solicitante e vê
  relatórios. Não cria usuários nem muda configurações.

Dê **Gerente de agenda** para quem só opera a agenda. É o perfil certo para a maioria.

### 5.3 Oriente sobre a biometria

Cada pessoa entra pela primeira vez com e-mail e senha **no próprio celular**. O sistema pergunta
se quer ativar a digital. A partir daí, o login abre direto na biometria.

Só funciona em celular e tablet, e só em HTTPS. No computador é sempre senha.

### 5.4 Ajuste o formulário

Em **Configurações → Formulário**: título, descrição, mensagem de sucesso e as imagens.

Em **Configurações → Mensagens**: os três modelos de WhatsApp (confirmação, remarcação, recusa).

---

## Passo 6 — Google Agenda (opcional)

Sem isso o sistema funciona normalmente; só não cria eventos no Google.

### 6.1 No Google Cloud Console

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) e crie um projeto.
2. Em **APIs e serviços → Biblioteca**, ative a **Google Calendar API**.
3. Em **Tela de permissão OAuth**, configure como *Externo*, preencha o nome do app e o e-mail de
   contato. Em *Usuários de teste*, adicione a conta Google que vai receber os eventos.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**, escolha **Aplicativo da Web**.
5. Em *URIs de redirecionamento autorizados*, cole exatamente a URI que aparece na tela de
   configurações do sistema:

   ```
   https://sua-url.ts.net/api/google/callback
   ```

6. Copie o **Client ID** e o **Client Secret**.

### 6.2 No sistema

Em **Configurações → Google Agenda**, cole as duas credenciais e clique em **Conectar com o
Google**. Autorize, escolha o calendário de destino e salve.

### 6.3 Confira

Confirme uma solicitação de teste e veja se o evento aparece no Google Agenda. Depois mude o
status para pendente e confira se o evento sumiu.

> Se a URI de redirecionamento não bater **caractere por caractere** com a `PUBLIC_URL`, o Google
> recusa. É o erro mais comum aqui.

---

## Passo 7 — Backup

Todo o sistema cabe em duas pastas dentro do projeto:

| Pasta | Conteúdo |
| --- | --- |
| `data/` | banco SQLite com solicitações, usuários e configurações |
| `uploads/` | imagens enviadas pela área administrativa |

Backup = copiar essas duas pastas. Restaurar = colocá-las de volta e subir o container.

Com o sistema parado (`docker compose stop`), a cópia é sempre consistente:

```bash
docker compose stop
tar -czf backup-agenda-$(date +%F).tar.gz data uploads
docker compose start
```

Vale automatizar isso diariamente e guardar as cópias fora da máquina. **Sem backup, perder o
disco é perder todas as solicitações.**

---

## Operação do dia a dia

| Tarefa | Comando |
| --- | --- |
| Ver os logs | `docker compose logs -f` |
| Reiniciar | `docker compose restart` |
| Parar | `docker compose stop` |
| Subir de novo | `docker compose start` |
| Aplicar mudanças de código | `docker compose up -d --build` |
| Ver se está saudável | `curl http://localhost:8080/api/health` |

Mudanças no `.env` só valem depois de `docker compose up -d`.

---

## Problemas comuns

**A página não abre / container reiniciando**
`docker compose logs --tail 50`. Quase sempre é porta 8080 já em uso — troque `PORT` no `.env` e
a porta publicada no `docker-compose.yml`.

**"Sessão expirada" logo após entrar**
`JWT_SECRET` mudou entre reinicializações. Fixe um valor no `.env`.

**Não consigo entrar com o administrador**
Ele é criado só no primeiro boot com o banco vazio. Se você mudou `ADMIN_EMAIL` depois, o usuário
antigo continua valendo. Sem acesso nenhum, apague `data/agenda.sqlite` e suba de novo — **isso
apaga todas as solicitações**.

**A biometria não aparece no celular**
Confira as três condições: o endereço é HTTPS, o `PUBLIC_URL` é idêntico ao da barra do
navegador, e é um celular ou tablet (no computador não aparece por decisão de projeto).

**O Google recusa a conexão**
A URI de redirecionamento no Console precisa ser exatamente `PUBLIC_URL` + `/api/google/callback`.
Sem barra sobrando, com o mesmo `https://`.

**Emojis quebrados no WhatsApp**
Acontece quando o link abre no aplicativo desktop do Windows. O sistema já contorna abrindo o
WhatsApp Web no computador. Se persistir, use *Configurações → Mensagens → Nunca usar emojis*.

**O formulário abre mas some a imagem de fundo**
O arquivo não está no caminho configurado. Envie pela área administrativa em
*Configurações → Formulário*, que resolve sem depender do arquivo no repositório.

---

## Checklist final

Antes de divulgar o link:

- [ ] `JWT_SECRET` com valor aleatório próprio
- [ ] Senha do administrador trocada pela tela
- [ ] `PUBLIC_URL` igual ao endereço real, com HTTPS
- [ ] `NODE_ENV=production`
- [ ] Usuários da equipe criados com o perfil certo
- [ ] Título, descrição e imagens do formulário revisados
- [ ] Os três modelos de mensagem revisados
- [ ] Um envio de teste feito do começo ao fim: preencher → confirmar → WhatsApp → Google Agenda
- [ ] Um reagendamento de teste
- [ ] Exportação para Excel conferida
- [ ] Backup das pastas `data/` e `uploads/` agendado
- [ ] Alguém além de você tem acesso de administrador
