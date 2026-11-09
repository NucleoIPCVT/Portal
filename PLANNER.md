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

A **Agenda IPCVT**, gerenciada na conta oficial da igreja, é o calendário de
referência do Planner. A integração é somente leitura: **Google Agenda → Planner**.
Criar ou editar demandas e eventos internos no Planner não altera o Google.

### Atualização automática

- Um fluxo do GitHub Actions consulta o iCal público a cada **15 minutos**
  (a execução pode atrasar por filas do GitHub). Ele gera `agenda-ipcvt.json`.
- O Planner carrega esse arquivo ao entrar e verifica atualizações a cada
  **5 minutos** enquanto estiver aberto. Os eventos oficiais surgem diretamente
  nas visões Calendário e nas opções de vincular tarefas, sem importação manual.
- A campainha no cabeçalho destaca eventos **novos, alterados ou removidos**
  desde a última leitura daquele usuário no navegador. A primeira leitura
  estabelece a referência inicial, sem criar centenas de alertas antigos;
  abrir a campainha marca os alertas como lidos.
- Se o evento oficial for movido ou removido, as demandas associadas permanecem
  no Planner. Demandas com prazo relativo divergente recebem a indicação
  **Revisar prazo**, para conferência antes de qualquer ajuste. O Planner não
  escreve nenhum dado na agenda oficial.

### Configuração administrativa

No cabeçalho, somente administradores veem o ícone de **engrenagem**.
Em **Configurações do Planner**, é possível substituir o link público
de referência e salvar. O valor é validado e armazenado em
`comissao_planner/main/config/calendar` no Firestore. A automação do
GitHub lê a mesma configuração, de modo que a alteração vale para todos.
Até a primeira configuração gravada, prevalece o link da Agenda IPCVT
informado inicialmente.

**Pré-requisito:** publicar as regras atualizadas de
`firestore-ipcvt-integrado.rules` no Firebase. O arquivo no GitHub é
documentação do conjunto de regras, mas o push do repositório não altera
automaticamente o que está publicado no console do Firebase. Sem esse passo,
a tela de configuração pode informar falta de permissão e os links de eventos
oficiais nas novas demandas podem ser recusados. Consulte
[PLANNER-FIREBASE.md](PLANNER-FIREBASE.md).

O calendário deve estar compartilhado publicamente com detalhes dos eventos.
Não há necessidade de autorizar a conta Google pessoal dos integrantes.

A seção **Outras agendas Google (opcional)** mantém o fluxo OAuth anterior,
usado apenas quando a administração desejar importar outros calendários. Esse
fluxo continua manual e temporário, sem acesso de escrita ao Google.

## Validação

Com Node.js 22 ou superior:

```sh
node --test tests/planner-core.test.mjs tests/planner-google.test.mjs tests/planner-public.test.mjs
```

Os testes de domínio cobrem datas, recorrências, deduplicação, dependências,
resumos e importação paginada. A integração de interface foi verificada no
Chromium em computador e celular com serviços simulados, sem acessar dados de
produção. As regras isoladas foram verificadas no emulador Firestore.
