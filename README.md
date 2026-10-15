# Controle Financeiro

Aplicativo financeiro com dados compartilhados entre dispositivos usando Supabase. O projeto inclui uma API serverless do Vercel para autenticar os usuários e acessar o banco; a chave privilegiada do Supabase fica somente no servidor.

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. No **SQL Editor**, execute [`supabase/schema.sql`](./supabase/schema.sql) para criar a tabela compartilhada e bloquear o acesso direto de usuários anônimos/autenticados.
3. Em **Project Settings → API**, copie a URL do projeto e a chave `service_role`. Essa chave é secreta: configure-a somente no Vercel e nunca a coloque no HTML, em variáveis `VITE_*` ou no Git.

## Configuração do Vercel

Importe o repositório no Vercel e mantenha a pasta raiz do projeto como **Root Directory**. O arquivo [`vercel.json`](./vercel.json) direciona as rotas `/api/*` à função compartilhada em [`api/index.js`](./api/index.js). Em **Settings → Environment Variables**, configure as variáveis abaixo para os ambientes que usa (Production, Preview e/ou Development):

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | URL base do projeto, por exemplo `https://<project-ref>.supabase.co`; não acrescente `/rest/v1`, `/dashboard` ou `/project` |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta `service_role` do Supabase |
| `APP_SESSION_SECRET` | Segredo aleatório com pelo menos 32 bytes; gere com `openssl rand -base64 48` |
| `APP_PASSWORD_GABRIEL` | Senha atual do usuário `gabriel` (mínimo de 4 caracteres) |
| `APP_PASSWORD_ALIPIO` | Senha atual do usuário `alipio` (mínimo de 4 caracteres) |

Configure nessas variáveis as senhas que os usuários já utilizam. Depois de salvar as variáveis, faça um novo deploy. Os dois usuários acessam o mesmo conjunto de dados. As senhas são verificadas no servidor e a sessão usa um cookie `HttpOnly`; não são gravadas no banco nem no navegador.

## Dados que já estavam neste navegador

Ao entrar após a configuração, o app tenta migrar para o Supabase os lançamentos, contas, vacas e saldo que ainda estejam no armazenamento local antigo daquele navegador. Faça login em cada dispositivo usado no teste para migrar os dados locais de cada um. As antigas senhas salvas somente no navegador não são migradas: use as senhas configuradas no Vercel.

Dados do arquivo SQLite local antigo não são migrados automaticamente.

## Executar localmente

Requer Node.js 18 ou superior. Configure o backend online primeiro (projeto Supabase, tabela e credenciais). Para testar localmente, copie `.env.example` para `.env` e preencha os mesmos valores usados no Vercel:

```sh
cp .env.example .env
# Edite .env com a URL e a chave service_role do seu projeto Supabase
npm start
```

Use as senhas atuais dos usuários, com o mínimo de 4 caracteres. O `.env` é carregado ao iniciar o servidor e ignorado pelo Git. Abra o endereço exibido no terminal. O app local e o publicado no Vercel usam o mesmo banco Supabase, e o polling atualiza os dados dos outros dispositivos em até aproximadamente 5 segundos.