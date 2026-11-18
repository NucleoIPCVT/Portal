# Integração IA · Planner IPCVT — etapa 3

Base **isolada** para um Cloudflare Worker. Este diretório não é importado pelo
Portal nem pelo Planner publicado, e não contém credenciais ou modificações nas
regras do Firebase.

## Situação atual

- `GET /health`: informa disponibilidade sem revelar dados do Planner.
- `GET /api/session`: valida token Firebase já emitido pelo login Google; verifica assinatura RS256, emissor, audiência, validade, e-mail verificado e provedor `google.com`; consulta `comissao_acessos/{email}` com o **mesmo ID token**, respeitando as regras atuais do Firestore.
- Membros desativados, tokens inválidos e solicitações sem login são bloqueados.
- Outras rotas (`/api/plans`, `/api/tasks`, `/mcp`) continuam desabilitadas; nenhum método de criação ou edição existe.
- **Não há credenciais administrativas, conexão MCP ou publicação em produção nesta etapa.**
- O Planner normal continua colaborativo e com as mesmas permissões.

## Desenvolvimento local

Requer Node.js 20+.

```bash
cd integracoes/planner-ia
npm install
npm test
npm run dev
```

`npm run deploy` exige conta Cloudflare autenticada e só deve ser executado
**depois** de concluídos os controles de segurança e testes. Não automatizar
deploy para a branch principal nesta etapa.

## Arquitetura (segurança-base implementada; integração ainda pendente)

1. **Implementado em teste:** verificar no servidor o Firebase ID token existente, incluindo assinatura Google e claims obrigatórias.
2. **Implementado em teste:** consultar autorização ativa em `comissao_acessos/{email-minúsculo}` com o ID token do próprio usuário.
3. Para consultas e criação futuras, usar acesso ao Firestore limitado ao usuário; se uma
   credencial de serviço for necessária, reimplementar os controles no backend
   (Admin SDK e credenciais privilegiadas não obedecem às regras do Firestore).
4. Expor **somente** consultas autorizadas e criação de planos, buckets e demandas,
   sem rotas de atualização, conclusão, arquivamento ou exclusão.
5. Na criação, servidor preenche `createdBy`, `updatedBy` e carimbos de tempo;
   validar os campos e referências e exigir confirmação do usuário antes do comando
   de escrita. Exigir chave de idempotência para evitar duplicações.
6. Testar acesso indevido, perfis desativados, métodos proibidos, concorrência,
   limites de requisições, tamanho do payload e registro de auditoria.
7. Adaptar a camada para conexões MCP/OAuth quando o modo de conexão de cada IA
   (ChatGPT, Claude, Gemini) estiver definido e validado.

**Atenção:** ter uma URL pública de Worker não significa que um cliente de IA
consiga autenticar-se nela; fluxos OAuth/MCP por plataforma precisam ser testados.

## Compatibilidade com o Planner atual

O banco de dados de produção está em `repertorio-ipcvt`; registros do Planner:
`comissao_planner/main/plans/{id}`, `buckets/{id}`, `tasks/{id}`.

O código existente usa documentos versionados, `createdBy`, `updatedBy` e
auditoria em `comissao_planner/main/activity`. A implementação deverá seguir
esse contrato, sem tocar em outras coleções.

**Pendência identificada para teste:** o código do Planner tem campos de
responsável do plano (`ownerEmail`, `ownerName`) e tipo recorrente, mas as
regras Firestore fornecidas em 18/11/2026 não os autorizam em `plnrPlan`.
Não alterar regras existentes nesta etapa: validar a compatibilidade com dados
reais antes de propor qualquer correção.

## Custos e publicação

Cloudflare Workers oferece um nível gratuito, sujeito a franquias e limites.
Nenhum serviço pago foi habilitado por este código. Nenhuma conta Cloudflare foi
conectada ou configurada. Firebase permanece na configuração atual.

## Próximas etapas

- Etapa 3: autenticação/autorização implementadas no código e testadas localmente; **falta ensaio real com contas Firebase e Cloudflare**.
- Etapa 4: consultas.
- Etapa 5: criação, com aprovação e idempotência.
- Etapa 6: MCP e integração com as IAs.

## Teste local e limites

`npm test` executa testes de segurança com chaves RSA geradas localmente e
simulação do Firestore; não altera dados reais. A etapa foi testada com Node 22.
Para validar em serviço real será necessário conectar conta Cloudflare, publicar
**somente após aprovação**, usar token Firebase real do próprio usuário e
comprovar comportamento com membro ativo, desativado e sem login.

**Integração por IA ainda indisponível:** ChatGPT/Claude/Gemini não enviam
necessariamente um Firebase ID token do site ao MCP. OAuth e consentimento
para esses clientes são uma etapa separada e ainda não implementada.
