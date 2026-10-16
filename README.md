# Controle Financeiro

Aplicativo financeiro com dados compartilhados entre dispositivos usando Supabase. O projeto inclui uma API serverless do Vercel para autenticar os usuários e acessar o banco; a chave privilegiada do Supabase fica somente no servidor.

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. No **SQL Editor**, execute [`supabase/schema.sql`](./supabase/schema.sql) para criar a tabela compartilhada, o bucket privado de fotos e bloquear o acesso direto de usuários anônimos/autenticados. Execute o arquivo novamente quando houver atualizações no schema.
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

Ao entrar após a configuração, o app tenta migrar para o Supabase os lançamentos, contas, vacas, bezerros e saldo que ainda estejam no armazenamento local antigo daquele navegador. Faça login em cada dispositivo usado no teste para migrar os dados locais de cada um. As antigas senhas salvas somente no navegador não são migradas: use as senhas configuradas no Vercel.

Dados do arquivo SQLite local antigo não são migrados automaticamente.

## Executar localmente

Requer Node.js 18 ou superior. Configure o backend online primeiro (projeto Supabase, tabela e credenciais). Para testar localmente, copie `.env.example` para `.env` e preencha os mesmos valores usados no Vercel:

```sh
cp .env.example .env
# Edite .env com a URL e a chave service_role do seu projeto Supabase
npm start
```

Use as senhas atuais dos usuários, com o mínimo de 4 caracteres. O `.env` é carregado ao iniciar o servidor e ignorado pelo Git. Abra o endereço exibido no terminal. O app local e o publicado no Vercel usam o mesmo banco Supabase, e o polling atualiza os dados dos outros dispositivos em até aproximadamente 5 segundos.

### Testar sem conectar ao Supabase

Para testar a interface e os fluxos sem configurar o Supabase, execute:

```sh
npm run dev:demo
```

Abra a URL exibida no terminal (normalmente `http://localhost:3000` ou a URL encaminhada pelo Codespaces), em vez da prévia estática da porta 5500. Entre com `gabriel` ou `alipio` e a senha `teste123`. A senha pode ser alterada definindo `LOCAL_DEMO_PASSWORD`. Os dados desse modo ficam somente na memória e são apagados quando o servidor é encerrado; esse modo é apenas para testes e não deve ser usado com dados reais.

Na aplicação, os lançamentos, contas e animais podem ser pesquisados e editados. O painel mostra contas vencidas e próximos cuidados pecuários. **Exportar dados em CSV** gera uma planilha dos registros; **Baixar backup JSON** cria um arquivo que pode ser restaurado pelo botão correspondente. A restauração atualiza os registros com o mesmo identificador e não apaga outros registros existentes.

No cadastro de bezerros, use os campos de foto para tirar ou selecionar uma imagem do animal e outra do brinco. As fotos são reduzidas no navegador e enviadas como JPEG binário para um bucket privado do Supabase; somente usuários autenticados conseguem consultá-las. O app usa cache privado com versão da imagem para agilizar consultas seguintes; toque em uma miniatura para abrir a foto em tela cheia. A remoção do bezerro também exclui suas fotos. Os arquivos de backup JSON não contêm as imagens; elas permanecem no armazenamento privado do Supabase.