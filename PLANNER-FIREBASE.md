# Planner da Comissão — ativação Firebase e Google Agenda

O Planner usa o mesmo projeto Firebase `repertorio-ipcvt`, o mesmo aplicativo
nomeado `ipcvt-comissao` e a mesma autorização `comissao_acessos` já utilizada
pelo Portal da Comissão. O usuário precisa entrar pelo Google, possuir e-mail
verificado e ter `ativo: true` nessa coleção. Responsáveis podem ser indicados por nome, e-mail ou ambos. Atribuir alguém a uma tarefa não
concede acesso ao portal: a coordenação continua autorizando os e-mails pela
Comissão.

## Publicação do código e autorização dos dados são etapas distintas

O código do site não publica regras do Firebase. A nova ferramenta só deve ser
considerada liberada depois da publicação e verificação das regras abaixo.
Enquanto o caminho `comissao_planner` estiver excluído da regra legada e sem o
novo bloco, o Firestore negará acesso; o Planner mostrará essa condição sem
usar dados de demonstração ou fingir que salvou.

1. Guarde uma cópia das regras atualmente publicadas no Firebase.
2. Compare-as com a versão integrada em [VAQUINHAS-FIREBASE.md](VAQUINHAS-FIREBASE.md).
3. Confirme que o `match /{colecao}/{documento=**}` permissivo mantém a condição
   `&& colecao != 'comissao_planner'`. Nenhuma outra regra abrangente pode
   liberar esse caminho. As regras Firestore se combinam por **OU**: adicionar
   um bloco restritivo não fecha um caminho já permitido por outro bloco.
4. Insira o **bloco aditivo completo** desta página dentro de
   `match /databases/{database}/documents`, no mesmo nível dos outros helpers
   e matches. Os nomes `plnr*` evitam colisão com os helpers atuais.
5. Preserve os matches existentes de Comissão, Vaquinhas, Escala e demais
   ferramentas. **Não substitua o conjunto de produção por
   `planner-firestore.rules`**: esse arquivo é uma fixture isolada para testes
   de emulador, sem as regras das outras ferramentas.
6. Publique as regras integradas e realize os testes de acesso descritos abaixo.

## Dados e permissões

Os documentos ficam em `comissao_planner/main/{colecao}/{id}`:

- `plans`: planos contínuos ou projetos; `deleted: true` arquiva um plano.
- `buckets`: agrupamentos de um plano.
- `tasks`: demandas com equipe, responsáveis, datas, checklist, dependências e
  vínculo opcional com um evento ou rotina. A exclusão lógica preserva a
  identidade das ocorrências geradas, evitando que sejam recriadas pelo modelo.
- `events`: eventos manuais ou importados do Google; `deleted: true` oculta um evento preservando seus vínculos e impede seu reaparecimento na próxima importação.
- `routines`: modelos de recorrência semanal.

Membros ativos podem criar e editar o trabalho interno. Apenas administradores
com `perfil: 'admin'` em `comissao_acessos` podem criar, alterar ou remover
registros de eventos cuja origem seja Google. Não existe acesso especial
baseado apenas em um endereço de e-mail: o membro também precisa estar ativo.

Cada documento tem `version`, `createdBy`, `createdAt`, `updatedBy` e
`updatedAt`. O salvamento usa transação e versão esperada. Uma edição antiga é
recusada para que o usuário reveja a versão atual, em vez de sobrescrever
silenciosamente a edição de outra pessoa. Os dados de cada tarefa são salvos
separadamente; não se grava todo o quadro em um único documento.

Os limites iniciais por demanda são 10 responsáveis, 20 itens de checklist e
20 dependências. Títulos de tarefas/rotinas têm até 160 caracteres, nomes de
planos/buckets/equipes até 120 e descrições até 10.000. O cliente valida datas
civis, ciclos de dependência e a estrutura de cada responsável, item de checklist
e dependência. As regras validam os tipos e limites das listas, os demais campos,
a ordem das datas e as relações com plano/bucket/evento. O Firestore não oferece
um tipo genérico para itens de listas; validar todos os índices junto às outras
regras ultrapassa seu orçamento de expressões. Por isso, conteúdos internos dessas
listas são validados no store e os snapshots são normalizados defensivamente.
Esses conteúdos não concedem permissões: a autorização depende somente da conta
Google verificada e do registro ativo da Comissão. A exclusão de um plano é lógica,
preservando o histórico. A verificação de bucket em uso pelo cliente é uma
ajuda operacional; as regras não implementam contadores de referências.

## Bloco aditivo de regras

Copie apenas o conteúdo do bloco a seguir para dentro do match de documentos
já existente. Ele não inclui wrapper, wildcard permissivo ou alterações nas
regras das demais ferramentas.

```javascript
function plnrGoogle() {
  return request.auth != null
    && request.auth.token.email_verified == true
    && request.auth.token.firebase.sign_in_provider == 'google.com';
}
function plnrEmail() { return request.auth.token.email.lower(); }
function plnrMember() {
  return plnrGoogle()
    && exists(/databases/$(database)/documents/comissao_acessos/$(plnrEmail()))
    && get(/databases/$(database)/documents/comissao_acessos/$(plnrEmail())).data.ativo == true;
}
function plnrAdmin() {
  return plnrMember()
    && get(/databases/$(database)/documents/comissao_acessos/$(plnrEmail())).data.perfil == 'admin';
}
function plnrText(value, max) { return value is string && value.size() <= max; }
function plnrId(value) {
  return value is string && value.size() > 0 && value.size() <= 200 && !value.matches('.*[/].*');
}
function plnrDate(value) {
  return value is string && (value == '' || value.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));
}
function plnrPriority(value) { return value in ['low', 'normal', 'high', 'urgent']; }
function plnrMeta(d) {
  return d.keys().hasAll(['version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'])
    && d.version is int && d.version > 0
    && d.createdAt is timestamp && d.updatedAt is timestamp
    && plnrText(d.createdBy, 254) && d.updatedBy == plnrEmail()
    && d.updatedAt == request.time;
}
function plnrCreate(d) {
  return plnrMeta(d) && d.version == 1 && d.createdAt == request.time && d.createdBy == plnrEmail();
}
function plnrUpdate(d) {
  return plnrMeta(d) && d.version == resource.data.version + 1
    && d.createdAt == resource.data.createdAt && d.createdBy == resource.data.createdBy;
}
function plnrPlanRef(id) {
  return plnrId(id)
    && exists(/databases/$(database)/documents/comissao_planner/main/plans/$(id))
    && get(/databases/$(database)/documents/comissao_planner/main/plans/$(id)).data.get('deleted', false) == false;
}
function plnrBucketRef(id, planId) {
  return id == '' || (plnrId(id)
    && exists(/databases/$(database)/documents/comissao_planner/main/buckets/$(id))
    && get(/databases/$(database)/documents/comissao_planner/main/buckets/$(id)).data.planId == planId
    && get(/databases/$(database)/documents/comissao_planner/main/buckets/$(id)).data.get('deleted', false) == false);
}
function plnrEventRef(id) {
  return id == '' || (plnrId(id)
    && exists(/databases/$(database)/documents/comissao_planner/main/events/$(id)));
}
// Firestore has no generic list-item type validation or loops. Keep the
// rules expression budget predictable; the store validates each item and
// normalizes read snapshots. List contents never confer authorization.
function plnrAssignees(items) { return items is list && items.size() <= 10; }
function plnrChecklist(items) { return items is list && items.size() <= 20; }
function plnrDependencies(items) { return items is list && items.size() <= 20; }
function plnrPlan(d) {
  return d.keys().hasOnly(['name', 'kind', 'description', 'startDate', 'dueDate', 'deleted', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'])
    && d.keys().hasAll(['name', 'kind', 'description', 'startDate', 'dueDate', 'deleted'])
    && plnrText(d.name, 120) && d.name.size() > 0
    && d.kind in ['continuous', 'project'] && plnrText(d.description, 5000)
    && plnrDate(d.startDate) && plnrDate(d.dueDate)
    && (d.startDate == '' || d.dueDate == '' || d.startDate <= d.dueDate) && d.deleted is bool;
}
function plnrBucket(d) {
  return d.keys().hasOnly(['planId', 'name', 'order', 'deleted', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'])
    && d.keys().hasAll(['planId', 'name', 'order', 'deleted'])
    && plnrPlanRef(d.planId) && plnrText(d.name, 120) && d.name.size() > 0
    && d.order is int && d.order >= 0 && d.order <= 10000 && d.deleted is bool;
}
function plnrTask(d) {
  return d.keys().hasOnly([
      'planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'startDate', 'dueDate',
      'status', 'priority', 'checklist', 'dependencyIds', 'eventId', 'dateMode', 'dueOffsetDays',
      'startOffsetDays', 'routineId', 'cycleKey', 'templateKey', 'sourceTaskId', 'recurrenceId',
      'recurrence', 'reviewRequired', 'reviewReason', 'deleted',
      'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ])
    && d.keys().hasAll(['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'startDate', 'dueDate', 'status', 'priority', 'checklist', 'dependencyIds', 'eventId', 'dateMode', 'dueOffsetDays', 'deleted'])
    && plnrPlanRef(d.planId) && plnrBucketRef(d.bucketId, d.planId)
    && plnrText(d.title, 160) && d.title.size() > 0 && plnrText(d.description, 10000)
    && plnrText(d.team, 120) && plnrAssignees(d.assignees)
    && plnrDate(d.startDate) && plnrDate(d.dueDate)
    && (d.startDate == '' || d.dueDate == '' || d.startDate <= d.dueDate)
    && d.status in ['todo', 'doing', 'done'] && plnrPriority(d.priority)
    && plnrChecklist(d.checklist) && plnrDependencies(d.dependencyIds)
    && plnrEventRef(d.eventId) && d.dateMode in ['manual', 'event']
    && (d.dateMode != 'event' || (d.eventId != '' && d.dueOffsetDays is int))
    && (d.dueOffsetDays == null || (d.dueOffsetDays is int && d.dueOffsetDays >= -366 && d.dueOffsetDays <= 366))
    && (d.get('startOffsetDays', null) == null || (d.startOffsetDays is int && d.startOffsetDays >= -366 && d.startOffsetDays <= 366))
    && plnrText(d.get('routineId', ''), 200) && plnrDate(d.get('cycleKey', ''))
    && plnrText(d.get('templateKey', ''), 200) && plnrText(d.get('sourceTaskId', ''), 200)
    && plnrText(d.get('recurrenceId', ''), 200)
    && d.get('reviewRequired', false) is bool && plnrText(d.get('reviewReason', ''), 500)
    && d.deleted is bool
    && (d.get('recurrence', null) == null || (d.recurrence is map
      && d.recurrence.keys().hasOnly(['frequency', 'weekday'])
      && d.recurrence.frequency == 'weekly'
      && d.recurrence.weekday is int && d.recurrence.weekday >= 0 && d.recurrence.weekday <= 6));
}
function plnrOriginalTime(t) {
  return t == null || (t is map && t.keys().hasOnly(['date', 'dateTime', 'timeZone'])
    && plnrDate(t.get('date', '')) && plnrText(t.get('dateTime', ''), 50) && plnrText(t.get('timeZone', ''), 100));
}
function plnrEvent(d) {
  return d.keys().hasOnly([
      'source', 'sourceCalendarId', 'sourceEventId', 'sourceKey', 'title', 'description', 'location',
      'startDate', 'endDate', 'startAt', 'endAt', 'allDay', 'timeZone', 'status', 'htmlLink',
      'calendarName', 'sourceUpdatedAt', 'recurringEventId', 'originalStartTime', 'deleted',
      'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'
    ])
    && d.keys().hasAll(['source', 'title', 'description', 'startDate', 'endDate', 'allDay', 'status', 'deleted'])
    && d.source in ['manual', 'google'] && d.status in ['confirmed', 'tentative', 'cancelled']
    && plnrText(d.title, 500) && (d.title.size() > 0 || d.status == 'cancelled')
    && plnrText(d.description, 10000) && plnrText(d.get('location', ''), 1000)
    && plnrDate(d.startDate) && plnrDate(d.endDate)
    && (d.startDate == '' || d.endDate == '' || d.startDate <= d.endDate) && d.allDay is bool && d.deleted is bool
    && (d.get('startAt', null) == null || plnrText(d.startAt, 50))
    && (d.get('endAt', null) == null || plnrText(d.endAt, 50))
    && plnrText(d.get('timeZone', ''), 100) && plnrText(d.get('htmlLink', ''), 2000)
    && plnrText(d.get('calendarName', ''), 500) && plnrText(d.get('sourceUpdatedAt', ''), 50)
    && plnrText(d.get('recurringEventId', ''), 1024) && plnrOriginalTime(d.get('originalStartTime', null))
    && (d.source != 'google' || (plnrText(d.sourceCalendarId, 1024) && d.sourceCalendarId.size() > 0
      && plnrText(d.sourceEventId, 1024) && d.sourceEventId.size() > 0 && plnrText(d.sourceKey, 2200)));
}
function plnrRoutine(d) {
  return d.keys().hasOnly(['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'weekday', 'priority', 'active', 'startDate', 'checklist', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'])
    && d.keys().hasAll(['planId', 'bucketId', 'title', 'description', 'team', 'assignees', 'weekday', 'priority', 'active', 'startDate'])
    && plnrPlanRef(d.planId) && plnrBucketRef(d.bucketId, d.planId)
    && plnrText(d.title, 160) && d.title.size() > 0 && plnrText(d.description, 10000)
    && plnrText(d.team, 120) && plnrAssignees(d.assignees)
    && d.weekday is int && d.weekday >= 0 && d.weekday <= 6
    && plnrPriority(d.priority) && d.active is bool && plnrDate(d.startDate)
    && plnrChecklist(d.get('checklist', []));
}
function plnrValid(kind, d) {
  return (kind == 'plans' && plnrPlan(d)) || (kind == 'buckets' && plnrBucket(d))
    || (kind == 'tasks' && plnrTask(d)) || (kind == 'events' && plnrEvent(d))
    || (kind == 'routines' && plnrRoutine(d));
}
match /comissao_planner/main/{kind}/{id} {
  allow read: if plnrMember() && kind in ['plans', 'buckets', 'tasks', 'events', 'routines'];
  allow create: if plnrMember() && plnrId(id) && plnrCreate(request.resource.data)
    && plnrValid(kind, request.resource.data)
    && (kind != 'events' || request.resource.data.source != 'google' || plnrAdmin());
  allow update: if plnrMember() && plnrUpdate(request.resource.data)
    && plnrValid(kind, request.resource.data)
    && (kind != 'events' || (request.resource.data.source == resource.data.source
      && (resource.data.source != 'google' || (plnrAdmin()
        && request.resource.data.sourceCalendarId == resource.data.sourceCalendarId
        && request.resource.data.sourceEventId == resource.data.sourceEventId
        && request.resource.data.sourceKey == resource.data.sourceKey))));
  // Plans are archived through a versioned update; their history stays intact.
  allow delete: if plnrMember() && kind in ['buckets', 'tasks', 'events', 'routines']
    && (kind != 'events' || resource.data.source != 'google' || plnrAdmin());
}
```

## Google Agenda — leitura e atualização interativa

O botão **Conectar Google Agenda** pede os escopos apenas quando um
administrador decide usar a integração:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

A conexão reutiliza o provedor Google do Firebase por
`reauthenticateWithPopup`. O access token Google fica somente em memória e é
usado para consultas `GET` à Calendar API. Ele não é gravado em Firestore,
localStorage, GitHub ou logs. O ID token Firebase não substitui esse token.
O usuário precisa reconectar se a permissão ou o token expirar.

No Google Cloud do mesmo projeto:

1. Habilite **Google Calendar API**.
2. Confira a tela de consentimento OAuth e os dois escopos de leitura.
3. Confirme a origem real do Portal entre as origens autorizadas do cliente
   web já utilizado pelo Firebase; mantenha o domínio autorizado no Firebase
   Authentication.
4. Se o aplicativo estiver em modo de teste, inclua as contas que usarão a
   integração. Uma configuração pública pode exigir a verificação OAuth do
   Google conforme os escopos e o público escolhidos.
5. A conta conectada precisa ter acesso aos calendários compartilhados. Para
   aparecer na lista, a agenda também precisa estar adicionada à conta no
   Google Agenda. Acesso apenas de disponibilidade não fornece os detalhes
   necessários para importar compromissos.

A seleção de agendas é explícita: seus eventos importados serão visíveis aos
membros autorizados da Comissão. A integração não escreve nem exclui eventos
na agenda original. A importação consulta um intervalo, percorre todas as
páginas e identifica cada ocorrência por calendário + ID do evento; novas
consultas atualizam o registro existente. Ausência em uma consulta de intervalo
não é tratada como cancelamento. Cancelamentos explícitos do Google preservam
a identidade e os vínculos do evento.

Esta versão atualiza ao clicar com o Planner aberto. Não promete atualização
com a página fechada. Sincronização automática futura exige backend com fluxo
OAuth próprio para acesso offline, armazenamento de credenciais somente no
servidor e tratamento de renovação/revogação; isso não é fornecido pela sessão
Firebase persistida.

## Verificação de liberação

- Sem login: dados do Planner não podem ser lidos nem escritos diretamente.
- Google verificado sem autorização ou suspenso: leitura/escrita negadas.
- Membro ativo: criar plano, bucket e demanda, atribuir responsável, editar,
  concluir e excluir demanda; conferir a mesma tarefa em todas as visões.
- Suspender o membro em outra sessão: os dados e listeners devem ser limpos.
- Duas sessões editando a mesma versão: a segunda edição deve gerar conflito.
- Escrita com versão antiga, criador alterado, status inválido ou campos de
  token/segredo deve ser negada pelo Firestore.
- Membro comum: criação/alteração/exclusão de evento Google negada.
- Administrador: selecionar uma agenda permitida e importar suas ocorrências.
  Repetir a importação deve atualizar o registro, sem duplicar.
- Verificar evento de dia inteiro, recorrência remarcada, cancelamento e datas
  em `America/Sao_Paulo`.
- Confirmar que Comissão, Escala Geral, Vaquinhas e Planejamento Tático continuam
  com seus acessos anteriores após a integração das regras.

Referências: [Firebase Google Auth](https://firebase.google.com/docs/auth/web/google-signin),
[Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth),
[CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList),
[eventos recorrentes](https://developers.google.com/workspace/calendar/api/guides/recurringevents).
