# Controle Financeiro

Aplicativo financeiro com dados compartilhados entre dispositivos usando Supabase. O projeto inclui uma API serverless do Vercel para autenticar os usuários e acessar o banco; a chave privilegiada do Supabase fica somente no servidor.

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. No **SQL Editor**, execute [`supabase/schema.sql`](./supabase/schema.sql) para criar a tabela compartilhada e bloquear o acesso direto de usuários anônimos/autenticados.
3. Em **Project Settings → API**, copie a URL do projeto e a chave `service_role`. Essa chave é secreta: configure-a somente no Vercel e nunca a coloque no HTML, em variáveis `VITE_*` ou no Git.

## Configuração do Vercel

Importe o repositório no Vercel e mantenha a pasta raiz do projeto como **Root Directory**. Em **Settings → Environment Variables**, configure as variáveis abaixo para os ambientes que usa (Production, Preview e/ou Development):

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta `service_role` do Supabase |
| `APP_SESSION_SECRET` | Segredo aleatório com pelo menos 32 bytes; gere com `openssl rand -base64 48` |
| `APP_PASSWORD_GABRIEL` | Senha forte para o usuário `gabriel` (mínimo de 12 caracteres) |
| `APP_PASSWORD_ALIPIO` | Senha forte para o usuário `alipio` (mínimo de 12 caracteres) |

Depois de salvar as variáveis, faça um novo deploy. Os dois usuários acessam o mesmo conjunto de dados. As senhas são verificadas no servidor e a sessão usa um cookie `HttpOnly`; não são gravadas no banco nem no navegador.

## Dados que já estavam neste navegador

Ao entrar após a configuração, o app tenta migrar para o Supabase os lançamentos, contas, vacas e saldo que ainda estejam no armazenamento local antigo daquele navegador. Faça login em cada dispositivo usado no teste para migrar os dados locais de cada um. As antigas senhas salvas somente no navegador não são migradas: use as senhas configuradas no Vercel.

Dados do arquivo SQLite local antigo não são migrados automaticamente.

## Executar localmente

Requer Node.js 18 ou superior. Configure as mesmas variáveis de ambiente do backend e execute:

```sh
npm start
```

Abra o endereço exibido no terminal. O polling atualiza os dados dos outros dispositivos em até aproximadamente 5 segundos.