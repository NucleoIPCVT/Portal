# Publicação da regra do histórico do Planner IPCVT

O código do Planner já consulta e registra atividades na coleção `comissao_planner/main/activity`. Este caminho é **novo** e precisa ser autorizado nas regras de segurança do Firebase Firestore.

O arquivo `planner-firestore.rules` do repositório é uma **referência para testes**, não substitui todas as regras integradas em produção. No Firebase Console, acesse **Firestore Database → Regras** e incorpore somente a função `plnrActivity` e o bloco `match /comissao_planner/main/activity/{id}` do arquivo de referência dentro de `match /databases/{database}/documents`.

As regras de produção já devem conter as funções de apoio `plnrMember`, `plnrEmail`, `plnrId`, `plnrText` e `plnrDate`. Preserve as regras dos outros sistemas da igreja. Publique as alterações no Firebase e verifique com uma conta autorizada da Comissão:

1. Abrir **Planner → Relatórios → Histórico**, confirmando que a consulta não mostra erro de permissão.
2. Criar uma demanda e depois alterar o prazo, verificando os dois registros de atividade.
3. Concluir e reabrir a demanda, verificando autoria, horário e ações.
4. Verificar que um usuário não autorizado não lê a coleção e que um usuário autorizado não consegue editar ou excluir eventos já registrados.

**Limitação:** o histórico só registra fatos ocorridos depois da publicação da funcionalidade e das regras. Datas antigas de conclusão não podem ser recuperadas automaticamente só com o status atual. A escrita de atividades é uma operação posterior ao salvamento da tarefa, preservando o uso do Planner se as regras ainda não estiverem publicadas; se ela falhar, essa alteração não entrará no histórico. Para auditoria estritamente transacional, migrar essa gravação a uma função de servidor.
