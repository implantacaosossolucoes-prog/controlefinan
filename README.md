# Controle Financeiro

Aplicativo financeiro com dados compartilhados entre dispositivos usando Supabase. O projeto inclui uma API serverless do Vercel para autenticar os usuários e acessar o banco; a chave privilegiada do Supabase fica somente no servidor.

## Configuração do Supabase

1. Crie um projeto no Supabase.
2. No **SQL Editor**, execute [`supabase/schema.sql`](./supabase/schema.sql) para criar as tabelas compartilhadas e de auditoria, o bucket privado de fotos, bloquear o acesso direto de usuários anônimos/autenticados e instalar as funções transacionais de restauração, pagamento, exclusão e registro de atividades. O script também configura o trigger de atualização de `updated_at`. Reexecutá-lo não apaga os registros nem os históricos.
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

O backend limita o corpo JSON de restauração a 4 MB, valida os registros também no servidor e exige IDs únicos por coleção. A restauração é enviada em uma chamada à função `restore_records`, que aplica o lote dentro de uma transação; em caso de erro, a transação é revertida. O pagamento de uma conta também registra a saída e remove a conta em uma única chamada transacional à função `pay_bill`. A autenticação não tem limitador distribuído de tentativas de login na aplicação. Antes de expor o ambiente à Internet, configure limitação de tentativas no perímetro/plano Vercel e monitore tentativas de login; um limite apenas em memória da função serverless não protegeria todas as instâncias.

## Ícone no celular

O atalho instalado usa `icon-192.png` (192 × 192), `icon-512.png` (512 × 512) e `apple-touch-icon.png` (180 × 180). Para trocar a imagem, substitua `logo.png` (usada dentro do app) e esses três arquivos por versões da nova logo, mantendo os nomes, formatos PNG e dimensões. Publique a atualização e, no celular, remova o atalho antigo e adicione o app à tela inicial novamente para atualizar o ícone em cache.

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

Na aplicação, os lançamentos, contas e animais podem ser pesquisados e editados. Na tela de vacas, use **Registrar parto** quando o nascimento acontecer; o app salva a data, mostra o registro na consulta e remove a vaca dos alertas de partos previstos e secagem. O filtro permite consultar partos aguardando, registrados ou todos, com busca por nome, brinco ou touro e intervalo de datas. Cada exclusão exige uma justificativa, que fica registrada junto com os dados excluídos, a data e o usuário responsável. O histórico pode ser consultado pelo login `alipio` no item **Exclusões**; o menu não é exibido para `gabriel` e a API também bloqueia essa consulta para os demais usuários. A tela de histórico permite filtrar por texto, tipo de registro, usuário e intervalo de datas; mostra as 500 exclusões mais recentes carregadas, com os dados originais disponíveis em cada item. Contas pagas são registradas no histórico com a justificativa automática “Conta paga.”. O item **Logs do sistema**, disponível somente para `alipio`, registra entradas e saídas de sessão, cliques na tela e alterações de campos; cada linha identifica o botão ou campo acionado e a tela correspondente. Para proteger os dados, o log registra o nome do campo, mas não os valores digitados nem conteúdo de arquivos. A tela de logs permite filtrar por evento, usuário, texto e período e lista até 1.000 eventos recentes; o histórico não é apagado automaticamente. O painel permite filtrar entradas, saídas e categorias por mês (ou consultar todo o período); o saldo do período é entradas menos saídas nesse recorte, enquanto o saldo atual acumulado é o saldo inicial mais todos os lançamentos. A evolução mostra o fluxo líquido mensal dos seis meses até o mês selecionado. O painel também mostra contas vencidas e próximos cuidados pecuários. **Exportar dados em CSV** gera uma planilha dos registros com proteção contra fórmulas; **Baixar backup JSON** cria um arquivo versionado de até 4 MB que pode ser restaurado pelo botão correspondente. A restauração valida todos os registros antes de enviar o lote e atualiza os que têm o mesmo identificador sem apagar os demais registros. Alterações atômicas dependem da função `restore_records` instalada pelo schema; fotos existentes são preservadas para bezerros com o mesmo identificador, mas as imagens não são incluídas no backup.

No cadastro de bezerros, a idade aparece abaixo da data de nascimento e é calculada em anos, meses e dias, com atualização diária. Use os campos de foto para tirar ou selecionar uma imagem do animal e outra do brinco. As fotos são reduzidas no navegador e enviadas como JPEG binário para um bucket privado do Supabase; somente usuários autenticados conseguem consultá-las. O app usa cache privado com versão da imagem para agilizar consultas seguintes; toque em uma miniatura para abrir a foto em tela cheia. A remoção do bezerro também exclui suas fotos. Os arquivos de backup JSON não contêm as imagens; elas permanecem no armazenamento privado do Supabase.
