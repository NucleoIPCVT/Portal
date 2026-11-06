# Acesso Google à Comissão IPCVT

O painel `comissao.html` utiliza Firebase Authentication (Google) e a coleção
`comissao_acessos` do Cloud Firestore. Senhas e listas de autorização **não**
ficam gravadas no código público do GitHub Pages.

## Ativação inicial (uma vez)

1. Abra o projeto Firebase `repertorio-ipcvt`.
2. Em **Authentication > Sign-in method**, habilite **Google**.
3. Em **Authentication > Settings > Authorized domains**, confirme que
   `nucleoipcvt.github.io` está autorizado.
4. Em **Firestore Database > Rules**, integre as regras abaixo às regras
   já existentes. **Não substitua as regras atuais** sem verificar os outros
   aplicativos que usam o mesmo banco. Regras gerais que permitem escrita
   pública também devem ser removidas/restringidas: no Firestore, permissões
   de regras coincidentes são combinadas e uma regra ampla pode liberar o que
   a regra específica tenta bloquear.
5. No **Firestore Database > Data**, crie a coleção `comissao_acessos`.
   O primeiro documento deve ter como ID o Gmail do responsável, em
   minúsculas, por exemplo `nome@gmail.com`. Campos:
   - `email` (string): `nome@gmail.com`
   - `nome` (string): nome do responsável
   - `perfil` (string): `admin`
   - `ativo` (boolean): `true`
6. Após entrar no painel, esse administrador poderá autorizar, suspender e
   reativar outros e-mails diretamente na área **Gerenciar acessos**.

## Trecho para acrescentar às regras do Firestore

Dentro do bloco já existente `match /databases/{database}/documents { ... }`,
insira as funções e a regra abaixo. Verifique se não há outras regras amplas
que deem acesso à coleção `comissao_acessos`.

```javascript
function comissaoGoogle() {
  return request.auth != null
    && request.auth.token.email_verified == true
    && request.auth.token.firebase.sign_in_provider == 'google.com';
}

function comissaoEmail() {
  return request.auth.token.email.lower();
}

function comissaoAccessPath() {
  return /databases/$(database)/documents/comissao_acessos/$(comissaoEmail());
}

function comissaoMember() {
  return comissaoGoogle()
    && exists(comissaoAccessPath())
    && get(comissaoAccessPath()).data.ativo == true;
}

function comissaoAdmin() {
  return comissaoMember()
    && get(comissaoAccessPath()).data.perfil == 'admin';
}

match /comissao_acessos/{email} {
  allow get: if comissaoGoogle()
    && (email == comissaoEmail() || comissaoAdmin());
  allow list: if comissaoAdmin();

  allow create, update: if comissaoAdmin()
    && request.resource.data.email == email
    && request.resource.data.nome is string
    && request.resource.data.perfil in ['membro', 'admin']
    && request.resource.data.ativo is bool
    && request.resource.data.keys().hasOnly([
      'email', 'nome', 'perfil', 'ativo', 'atualizadoEm', 'atualizadoPor'
    ]);

  allow delete: if false;
}
```

**Importante:** O painel permite apenas a entrada dos membros autorizados,
mas links de ferramentas externas podem continuar públicos. Quando o Planner
da Comissão for desenvolvido, suas próprias coleções terão regras de acesso
baseadas em `comissaoMember()` e permissões por tarefa/responsável.

**Antes da liberação final:** testar (1) Google autorizado e membro ativo,
(2) Google não autorizado, (3) usuário suspenso, (4) administrador adicionando
um membro e (5) leitura/escrita direta indevida via Firestore bloqueada.
