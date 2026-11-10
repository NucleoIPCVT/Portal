# Planner da Comissão IPCVT

Abra `planner.html` pelo cartão Planner no Portal da Comissão. O acesso usa a
mesma conta Google autorizada em `comissao_acessos`. Antes do uso em produção,
siga a ativação em [PLANNER-FIREBASE.md](PLANNER-FIREBASE.md).

## Organizar o trabalho

1. Comece pela visão **Eventos**, que reúne a agenda oficial, e use **Ver demandas**
   para abrir o quadro do evento. Crie um plano contínuo, como **Cultos e Rotinas**,
   ou um projeto com prazo, como **Podcast** e **Kits de Voz**, quando precisar
   organizar outra frente. Configure as colunas (buckets) no formulário do plano.
2. Use **Nova demanda** ou **Adicionar demanda** em uma coluna para criar uma
   tarefa. Na visão filtrada por evento, a nova demanda herda o vínculo com esse
   evento; ao criar pela coluna, também preserva o plano e a coluna escolhidos.
   O formulário permite conferir e alterar o vínculo antes de salvar.
3. Abra qualquer cartão para editar ou excluir. No quadro, arraste entre
   colunas do mesmo plano; no calendário, arraste para alterar a data.
   O formulário também permite fazer essas alterações com teclado ou celular.
4. Use os filtros de plano, equipe, pessoa, evento e status para cruzar os
   trabalhos. **Meu dia** e o filtro de demandas pessoais usam o e-mail da conta
   conectada.

No editor, adicione responsáveis por nome ou e-mail e remova-os pelos cartões
compactos. As sugestões aproveitam pessoas já presentes nas tarefas e a conta
conectada; atribuir alguém não concede acesso ao Portal. O checklist permite
adicionar, editar, concluir e remover itens diretamente, sem códigos de texto.
Em **Mais opções**, selecione dependências por caixas de seleção e configure
equipe ou prazo relativo. Ao salvar, um responsável ou item do checklist ainda
digitado no campo de adição é incluído se for válido; erros pedem correção antes
de salvar. Permanecem os limites de 10 responsáveis, 20 itens e 20 dependências.

As visões Eventos, Meu dia, Quadro, Lista, Calendário, Gantt e Resumo consultam
os mesmos dados.
O calendário tem mês/semana e uma lista de demandas sem data. O Gantt mostra
início/término e as dependências; não recalcula automaticamente todo o projeto.
Use a descrição da demanda para orientações e links de arquivos.

## Eventos e rotinas

Use **+ Demanda** no cartão do evento para criar uma tarefa manual vinculada.
Também é possível abrir um evento pelo Calendário e criar a demanda a partir
dele. Defina título, responsáveis, início e prazo conforme o trabalho necessário.
Os prazos são manuais por padrão: vincular o evento não preenche uma antecedência
automática. Para organizar uma cantata meses antes, basta escolher essas datas
na própria demanda. Se desejar um prazo relativo, configure-o em **Mais opções**.

A geração de demandas por modelos de preparação foi retirada da interface.
As tarefas já criadas por esses modelos continuam disponíveis, com seus vínculos,
prazos e histórico. As funções históricas de modelos em `planner-core.js` foram
preservadas por compatibilidade; elas não geram novas tarefas pela interface.

Para trabalho avulso, use **+ Demanda independente**, acima dos cartões da visão
Eventos, ou escolha **Demanda independente (sem evento)** no editor.
Essa opção cria uma tarefa sem vínculo mesmo quando outra visão está filtrada
por um evento.

Mudanças na agenda oficial preservam as demandas; prazos relativos divergentes
ficam sinalizados para **Revisar prazo**. Na importação administrativa de outras
agendas, prazos relativos podem acompanhar remarcações quando a tarefa continua
não iniciada, sem checklist executado e com o prazo derivado original. As demais
situações exigem revisão. Cancelamentos do Google preservam o andamento e o
histórico das demandas.

Em **Rotinas**, cadastre uma demanda independente com frequência semanal.
Salvar a rotina gera as próximas quatro semanas. O botão de geração acrescenta
apenas semanas ainda sem ocorrência. Alterar o modelo preserva ocorrências já
criadas; excluir a rotina interrompe novas gerações. Demandas excluídas não são
recriadas ao gerar a mesma semana. Para o repertório de um culto específico,
crie uma demanda manual vinculada ao evento correspondente.

Excluir uma demanda retira-a das visões ativas e mantém sua identificação para
evitar recriação por rotinas e modelos históricos. Arquivar um plano preserva
suas demandas e histórico.

## Google Agenda

A **Agenda IPCVT**, gerenciada na conta oficial da igreja, é o calendário de
referência do Planner. A integração é somente leitura: **Google Agenda → Planner**.
Criar ou editar demandas e eventos internos no Planner não altera o Google.

### Atualização automática

- Um fluxo do GitHub Actions está programado para consultar o iCal público a
  cada **5 minutos**
  (a execução pode atrasar por filas do GitHub). Ele gera `agenda-ipcvt.json`.
- Quando a chave da API pública está configurada, o Planner consulta diretamente
  o Google ao entrar e verifica atualizações a cada **2 minutos**. Se a consulta
  falhar, tenta a cópia de segurança em `agenda-ipcvt.json`. Sem acesso direto
  configurado, consulta a cópia a cada **5 minutos**. A verificação periódica
  ocorre enquanto a aba está visível. Os eventos oficiais surgem nas visões
  Eventos e Calendário e nas opções de vincular tarefas, sem importação manual.
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
node --test tests/planner*.test.mjs
```

Os testes de domínio cobrem datas, recorrências, deduplicação, dependências,
resumos, importação paginada e o contexto de criação de tarefas: herança de
evento/plano/coluna, criação independente explícita e exclusão de planos
arquivados da inferência. A integração de interface foi verificada no
Chromium em computador e celular com serviços simulados, sem acessar dados de
produção. As regras isoladas foram verificadas no emulador Firestore.
