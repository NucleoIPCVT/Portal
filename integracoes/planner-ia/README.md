# Integração IA · Planner IPCVT — etapa 5

Base **isolada** para um Cloudflare Worker. Este diretório não é importado pelo
Portal nem pelo Planner publicado, e não contém credenciais ou modificações nas
regras do Firebase.

## Situação atual

- `GET /health`: informa disponibilidade sem revelar dados do Planner.
- `GET /api/session`: valida token Firebase já emitido pelo login Google; verifica assinatura RS256, emissor, audiência, validade, e-mail verificado e provedor `google.com`; consulta `comissao_acessos/{email}` com o **mesmo ID token**, respeitando as regras atuais do Firestore.
- Membros desativados, tokens inválidos e solicitações sem login são bloqueados.
- `GET /api/plans`, `/api/buckets`, `/api/tasks`, `/api/events`, `/api/routines` e `/api/activity`: consultas paginadas ao Firestore usando o **ID token do usuário** (sem credencial administrativa). Cada requisição repete a verificação de identidade e de autorização ativa.
- `pageSize`: 1 a 50 (padrão 25); `pageToken`: cursor do Firestore retornado na página anterior. Uma resposta com `hasMore: true` **não representa todos os registros**.
- Converte os tipos do Firestore em objetos JSON: IDs, nomes, prazos, status, responsáveis, checklists, recorrências e histórico. O relatório de atrasos deverá percorrer **todas** as páginas e ignorar demandas concluídas/arquivadas.
- `POST /api/preview/{plans|buckets|tasks}` valida o rascunho e devolve a prévia, **sem salvar**.
- `POST /api/create/{plans|buckets|tasks}` contém a lógica de criação, mas exige um recibo criptográfico de aprovação humana que **ainda não pode ser emitido pela integração**. Sem `APPROVAL_SECRET`, retorna `503 approval_not_configured`.
- Não existem operações de edição, conclusão, arquivamento ou exclusão nesta API.
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
- Etapa 4: consultas paginadas implementadas em código e cobertas por testes simulados; **falta teste ao vivo com contas reais**.
- Etapa 5: criação e validação implementadas, incluindo recibo criptográfico, idempotência, gravação e auditoria atômicas. **Bloqueada até existir fluxo externo de aprovação humana e testes reais.**
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

## Consultas disponíveis (etapa 4)

Todas exigem `Authorization: Bearer <Firebase ID token>` válido, e-mail verificado,
provedor `google.com` e membro ativo em `comissao_acessos`:

- `GET /api/plans` — planos da Comissão.
- `GET /api/buckets` — colunas dos quadros.
- `GET /api/tasks` — demandas e suas propriedades.
- `GET /api/events` — eventos internos salvos no Firestore.
- `GET /api/routines` — rotinas legadas.
- `GET /api/activity` — histórico de atividades.

Todos aceitam `?pageSize=25&pageToken=...`. Retornam `items`, `pageSize`,
`nextPageToken` e `hasMore`. Calendários públicos iCal são carregados fora
do Firestore pelo Planner e **não são incluídos** neste conjunto de consultas.

**Sem alterações em produção:** nenhuma rota é acessível via MCP ou pelas IAs
até concluirmos OAuth e publicarmos um Worker revisado.

**Ainda faltam:** limites de requisições por pessoa, testes com sessões reais,
relatórios agregados por data/status e revisão dos custos de leituras no Firebase.

## Criação (etapa 5, bloqueada até a etapa 6)

A API de prévia aceita apenas planos comuns (`kind: project|continuous`), buckets
e demandas, respeitando as regras existentes do Firebase. Recorrências, transferência
de responsável de plano e importação de dados históricos são intencionalmente
excluídos por enquanto.

### Prévia (não grava)

`POST /api/preview/plans` ou `/api/preview/buckets` ou `/api/preview/tasks`:

```json
{
  "draft": {
    "name": "Culto de Ação de Graças",
    "kind": "project",
    "dueDate": "2026-11-26"
  },
  "idempotencyKey": "pedido-culto-acao-gracas-2026"
}
```

Exige token Firebase da própria conta Google no cabeçalho Authorization. Retorna
rascunho normalizado, digest SHA-256 e `requiresHumanApproval: true`; jamais grava.

### Criação (proibida sem confirmação independente)

`POST /api/create/plans` / `/api/create/buckets` / `/api/create/tasks`
usa o **mesmo** rascunho e idempotencyKey, acrescidos do campo `approval`.

O servidor exige `approval` assinado por componente **independente da IA**.
O recibo comprova identidade Firebase do usuário, categoria, conteúdo exato,
idempotencyKey e prazo de validade curto (até 10 minutos).

**Não existe atualmente endpoint que emita esse recibo**: a autenticação do
usuário e o clique de confirmação na interface confiável serão implementados
nas próximas etapas. Não confundir `confirmed: true` enviado pela IA com
aprovação humana. Não configurar `APPROVAL_SECRET` nem ativar criação sem
implementar e testar esse fluxo.

Cada gravação futura deve ocorrer através de **um commit atômico Firestore REST**
com o token do usuário, adicionando documento e entrada do histórico da Comissão
juntos, ambos com condição de `exists: false`. IDs determinísticos impedem duplicatas
por reutilização da mesma idempotencyKey; conflitos retornam HTTP 409.

O servidor fixa `createdBy`, `updatedBy`, versão, datas de criação e atualização;
as demandas nascem `todo`, checklists `done: false`. Esses campos não podem
ser falsificados no rascunho. As regras existentes continuam sendo validadas
pelo Firestore porque a requisição usa o token do próprio integrante.

### Limitações

- Ainda não há forma de o ChatGPT/Claude/Gemini passar uma autorização de usuário
  ao Worker; o fluxo OAuth/MCP e a tela de confirmação ficam para a etapa 6.
- Não foram executados commits em Firebase de produção.
- Regras atuais de plano não suportam `ownerEmail`, `ownerName` e
  `kind: recurring`; a API não envia esses campos.
- Unicidade por nome de plano e limitações de custo/abuso exigem testes e
  decisões adicionais antes de habilitar a escrita.
- Toda publicação dependerá de revisão explícita; este PR continua rascunho.
