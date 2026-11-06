# Acesso Google à Comissão IPCVT

> **Documento histórico — não publique as regras desta página.**
> A versão integrada e atualizada para Comissão, Vaquinhas e cadastro central
> de autorizações está em [VAQUINHAS-FIREBASE.md](VAQUINHAS-FIREBASE.md).
> Somente Hudson pode administrar autorizações, e o controle real depende
> de publicar as regras integradas no Firestore.

O painel `comissao.html` utiliza Firebase Authentication (Google) e a coleção
`comissao_acessos` do Cloud Firestore. Senhas e listas de autorização **não**
ficam gravadas no código público do GitHub Pages.

## Ativação inicial (uma vez)

1. Abra o projeto Firebase `repertorio-ipcvt`.
2. Em **Authentication > Sign-in method**, habilite **Google**.
3. Em **Authentication > Settings > Authorized domains**, confirme que
   `nucleoipcvt.github.io` está autorizado.
4. Em **Firestore Database > Rules**, guarde uma cópia das regras atuais e
   use a versão completa abaixo, preparada a partir das regras que estavam em
   produção em 06/11/2026. O acesso dos outros aplicativos é mantido, mas a
   coleção da Comissão fica fora da regra geral permissiva.
5. No **Firestore Database > Data**, crie a coleção `comissao_acessos`.
   O primeiro documento deve ter o ID `hudsonamorim08@gmail.com`. Campos:
   - `email` (string): `hudsonamorim08@gmail.com`
   - `nome` (string): `Hudson`
   - `perfil` (string): `admin`
   - `ativo` (boolean): `true`
6. Após entrar no painel, esse administrador poderá autorizar, suspender e
   reativar outros e-mails diretamente na área **Gerenciar acessos**.

## Regras completas preparadas a partir das regras atuais

Não acrescente apenas um `match /comissao_acessos/{email}` à regra geral
anterior: o antigo `match /{document=**}` continuaria liberando o acesso a
qualquer pessoa autenticada, mesmo anonimamente. A nova regra genérica usa
`/{colecao}/{documento=**}` para deixar de fora `comissao_acessos` e a futura
`comissao_planner`, preservando o comportamento das demais coleções.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Mantido para compatibilidade com o aplicativo existente.
    match /app_ipcvt/planner_dados {
      allow read, write: if true;
    }

    function comissaoGoogle() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }

    function comissaoEmail() {
      return request.auth.token.email.lower();
    }

    function comissaoMember() {
      return comissaoGoogle()
        && exists(/databases/$(database)/documents/comissao_acessos/$(comissaoEmail()))
        && get(/databases/$(database)/documents/comissao_acessos/$(comissaoEmail())).data.ativo == true;
    }

    function comissaoAdmin() {
      return comissaoMember()
        && get(/databases/$(database)/documents/comissao_acessos/$(comissaoEmail())).data.perfil == 'admin';
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

    // Preserva as coleções existentes e isola os dados da Comissão.
    match /{colecao}/{documento=**} {
      allow read, write: if request.auth != null
        && colecao != 'comissao_acessos'
        && colecao != 'comissao_planner';
    }
  }
}
```

**Importante:** A regra antiga `/app_ipcvt/planner_dados` ainda permite acesso
público; foi preservada para não interromper aplicativos existentes. A regra
geral antiga também é permissiva para usuários anônimos nas outras coleções.
Essas permissões merecem auditoria própria mais adiante.

O painel permite apenas a entrada dos membros autorizados,
mas links de ferramentas externas podem continuar públicos. Quando o Planner
da Comissão for desenvolvido, suas próprias coleções terão regras de acesso
baseadas em `comissaoMember()` e permissões por tarefa/responsável.

**Antes da liberação final:** testar (1) Google autorizado e membro ativo,
(2) Google não autorizado, (3) usuário suspenso, (4) administrador adicionando
um membro e (5) leitura/escrita direta indevida via Firestore bloqueada.
