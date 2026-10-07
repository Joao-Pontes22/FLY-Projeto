# FLY Olist — atualização preparada

## O que foi feito

- Corrigida a consulta da API Olist v3: `/produtos`, em vez de `/produto`.
- Busca exata por SKU e consulta de detalhes, incluindo `precos.precoCusto`.
- Custo médio e preço de venda retornados separadamente. Custo ausente/zero é sinalizado e não deve ser usado para precificar automaticamente.
- Tratamento de erros, timeout de 30 segundos, paginação e identificação de SKUs duplicados.
- Endpoint MCP POST `/mcp`, somente leitura, com três ferramentas.
- Consultas de produtos e MCP exigem uma chave própria `FLY_CONNECTOR_KEY`, diferente das credenciais do Olist.
- O callback de conexão não retorna mais tokens ao navegador.

## Atualizar no GitHub/Render

1. Substitua no repositório os arquivos da pasta `Olist` que constam neste pacote; inclua os novos arquivos de `services` e `security.py`. O restante do projeto foi preservado.
2. No Render, mantenha as variáveis existentes do Olist e confirme `API_URL=https://api.tiny.com.br/public-api/v3`.
3. Cadastre no Render uma chave aleatória forte de pelo menos 32 caracteres em `FLY_CONNECTOR_KEY`. Não publique a chave no GitHub ou no chat.
4. Publique uma nova versão pelo fluxo habitual do serviço. O comando existente deve continuar apontando para `Olist.app:app`.
5. Confira a documentação `/docs`: devem aparecer `/produtos/por-sku/{codigo}` e POST `/mcp`.
6. Faça a conexão Olist pela rotina já existente `/login`, caso o token precise ser renovado. Confirme que a conta autorizada é a FLY.
7. Configure o cliente local do plugin com a mesma `FLY_CONNECTOR_KEY` no ambiente do processo. Instale o pacote local apenas após validar o endpoint publicado.

## Limitações e compatibilidade

O endpoint protegido ainda não foi publicado ou validado no Render. Os testes são locais, com respostas simuladas, sem acesso a custos reais.

O servidor continua utilizando o mecanismo original `token.json`; renovação automática de tokens e armazenamento persistente no Render não foram acrescentados. Se o token expirar, será necessário reconectar. Não substitua nem apague credenciais ou o banco existente ao atualizar.

Clientes existentes que consultem `/produtos` precisam enviar `Authorization: Bearer <FLY_CONNECTOR_KEY>` pelo seu backend. Nunca coloque essa chave no JavaScript público.

As outras rotas existentes (pedidos, expedição, separações e motoboys) foram preservadas e não passaram por revisão de acesso neste trabalho. O pacote não representa uma auditoria completa de segurança do servidor.

O plugin local usa uma ponte stdio para o endpoint protegido. Não há OAuth MCP para instalação web no ChatGPT nesta versão.

## Testes

Com fastapi, requests, python-dotenv e httpx instalados:

`python -m unittest discover -s tests -v`

Referência de campos e caminhos: https://erp.tiny.com.br/public-api/v3/swagger/index.html
