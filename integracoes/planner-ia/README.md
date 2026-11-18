# Integração IA · Planner IPCVT — etapa 2

Base **isolada** para um Cloudflare Worker. Este diretório não é importado pelo
Portal nem pelo Planner publicado, e não contém credenciais ou modificações nas
regras do Firebase.

## Situação atual

- `GET /health`: responde somente que a estrutura está preparada.
- Qualquer outra rota ou método: `404 not_found`.
- **Nenhuma leitura ou escrita no Firestore está implementada.**
- Não há autenticação, servidor MCP ou implantação em produção nesta etapa.
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

## Arquitetura prevista (a implementar)

1. Identificar cada pessoa via Google/Firebase Auth; verificar no **servidor** a
   autenticidade do token, expiração, emissor, público, e-mail verificado e provedor Google.
2. Verificar autorização ativa em `comissao_acessos/{email-minúsculo}`.
3. Usar acesso ao Firestore limitado ao usuário, sempre que possível; se uma
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

- Etapa 3: autenticação e autorização no servidor; testes de segurança.
- Etapa 4: consultas.
- Etapa 5: criação, com aprovação e idempotência.
- Etapa 6: MCP e integração com as IAs.
