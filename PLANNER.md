# Planner da Comissão IPCVT

Abra `planner.html` pelo cartão Planner no Portal da Comissão. O acesso usa a
mesma conta Google autorizada em `comissao_acessos`. Antes do uso em produção,
siga a ativação em [PLANNER-FIREBASE.md](PLANNER-FIREBASE.md).

## Organizar o trabalho

1. Crie um plano contínuo para **Cultos e Rotinas**, ou um projeto com prazo
   como **Podcast** e **Kits de Voz**. Configure os buckets no formulário do plano.
2. Use **Nova demanda** para criar tarefas, atribuir pessoas por nome/e-mail,
   definir equipe, início, prazo, prioridade, checklist e dependências.
3. Abra qualquer cartão para editar ou excluir. No quadro, arraste entre
   buckets do mesmo plano; no calendário, arraste para alterar a data.
   O formulário também permite fazer essas alterações com teclado ou celular.
4. Use os filtros de plano, equipe, pessoa, evento e status para cruzar os
   trabalhos. **Minhas tarefas** usa o e-mail da conta conectada.

As visões Quadro, Lista, Calendário, Gantt e Resumo consultam os mesmos dados.
O calendário tem mês/semana e uma lista de demandas sem data. O Gantt mostra
início/término e as dependências; não recalcula automaticamente todo o projeto.
Use a descrição da demanda para orientações e links de arquivos.

## Eventos e rotinas

No Calendário, crie um evento manual ou abra um evento importado. Escolha um
plano e use **Gerar demandas de preparação** para banda, repertório, liturgia
e técnica. Depois personalize as demandas e atribua seus responsáveis.
Aplicar novamente o modelo não duplica as etapas existentes ou excluídas.

Os prazos relativos acompanham remarcações do evento somente quando a tarefa
continua não iniciada, sem checklist executado e com o prazo derivado original.
As outras ficam sinalizadas para **Revisar prazo**. Cancelamentos do Google
preservam o andamento e o histórico das demandas.

Em **Rotinas**, cadastre uma demanda independente com frequência semanal.
Salvar a rotina gera as próximas quatro semanas. O botão de geração acrescenta
apenas semanas ainda sem ocorrência. Alterar o modelo preserva ocorrências já
criadas; excluir a rotina interrompe novas gerações. Demandas excluídas não são
recriadas ao gerar a mesma semana. Para o repertório semanal ligado ao culto,
use a preparação do próprio evento, sem cadastrar uma rotina paralela.

Excluir uma demanda retira-a das visões ativas e mantém sua identificação para
evitar recriação por modelos. Arquivar um plano preserva suas demandas e histórico.

## Google Agenda

A **Agenda IPCVT** oficial é pública e já está cadastrada no Planner. O GitHub Actions
lê o iCal público da igreja periodicamente e gera `agenda-ipcvt.json` no repositório
`NucleoIPCVT/Portal`. Nenhum membro precisa conectar sua conta Google pessoal
para essa leitura. A agenda precisa estar configurada como pública, com detalhes
dos eventos visíveis.

Na aba **Google Agenda**, um administrador clica em **Atualizar eventos da Agenda
IPCVT** para importar as alterações da cópia pública do GitHub ao Firestore.
Os eventos ficam então disponíveis para a Comissão e podem ser vinculados às
demandas. Importações repetidas preservam os identificadores e não duplicam os
registros; registros ocultados manualmente não reaparecem. A atualização do
arquivo público é automática, mas a importação ao Planner ainda exige o clique
de um administrador.

Em **Outras agendas Google (opcional)**, o fluxo anterior com autorização OAuth
continua disponível para importar outras agendas compartilhadas com a conta
conectada. A sincronização desses calendários é **Google → Planner**, também
manual e limitada a um intervalo de até um ano. A conexão expira e deve ser
renovada quando necessário; o token permanece somente na memória da página.

As importações não escrevem nem excluem eventos na agenda original. Quando a
data de um evento importado muda, o Planner atualiza os prazos relativos das
demandas elegíveis ou sinaliza as demais para revisão.

## Validação

Com Node.js 22 ou superior:

```sh
node --test tests/planner-core.test.mjs tests/planner-google.test.mjs
```

Os testes de domínio cobrem datas, recorrências, deduplicação, dependências,
resumos e importação paginada. A integração de interface foi verificada no
Chromium em computador e celular com serviços simulados, sem acessar dados de
produção. As regras isoladas foram verificadas no emulador Firestore.
