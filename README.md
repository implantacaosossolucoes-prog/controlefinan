# Controle Financeiro

Aplicativo estático de controle financeiro. Os lançamentos, contas, dados das vacas e credenciais ficam salvos no armazenamento local do navegador (`localStorage`).

## Executar localmente

Requer Node.js 18 ou superior.

```sh
npm start
```

Abra o endereço exibido no terminal. Os dados ficam neste navegador e não são enviados para um servidor nem sincronizados com outros dispositivos. Limpar os dados do site ou usar outro navegador/dispositivo resulta em um armazenamento separado.

## Publicar no Vercel

Importe o repositório no Vercel e mantenha a pasta raiz do projeto como **Root Directory**. Não é necessário configurar build ou variáveis de ambiente: o Vercel servirá `index.html` diretamente.

No primeiro acesso, informe `gabriel` ou `alipio` e defina uma senha com pelo menos 4 caracteres. As credenciais também são locais a cada navegador.