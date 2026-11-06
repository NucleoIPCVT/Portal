# Vaquinhas IPCVT — regras para acesso Google e dados privados

**Não publique regras isoladas por cima de um `match /{document=**}` permissivo.**
As regras abaixo substituem o conjunto inteiro preparado para a Comissão,
preservando os aplicativos legados. Faça uma cópia do texto que está em produção
antes de substituí-lo.

## Ordem segura da atualização

1. Publicar o código novo da Vaquinha no GitHub Pages.
2. Entrar uma vez pelo Google com o administrador inicial `hudsonamorim08@gmail.com`.
   Isso cria `app_ipcvt/interas_publicas`, com um resumo dos dados existentes,
   sem nomes nem valores individuais. **Confira os cartões antes de prosseguir.**
3. Em **Firebase > Firestore Database > Rules**, publicar as regras completas abaixo.
   Essa etapa é indispensável para proteger os documentos antigos e os novos.
4. Testar em uma janela anônima: a lista pública abre; leitura direta de
   `app_ipcvt/interas_dados` e de `interas_contribuicoes` é negada.
5. Dentro de Vaquinhas, o administrador da Comissão cadastra os e-mails dos
   outros gestores. Cada pessoa faz login no Google com sua própria conta.

O WhatsApp é informado em cada vaquinha financeira. O botão abre uma conversa
com a mensagem pronta; o contribuinte precisa anexar o arquivo manualmente.
O comprovante não é enviado nem guardado no Firebase.

## Regras completas

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function googleLogin() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.firebase.sign_in_provider == 'google.com';
    }

    function emailGoogle() {
      return request.auth.token.email.lower();
    }

    function comissaoMember() {
      return googleLogin()
        && exists(/databases/$(database)/documents/comissao_acessos/$(emailGoogle()))
        && get(/databases/$(database)/documents/comissao_acessos/$(emailGoogle())).data.ativo == true;
    }

    function comissaoAdmin() {
      return comissaoMember()
        && get(/databases/$(database)/documents/comissao_acessos/$(emailGoogle())).data.perfil == 'admin';
    }

    function gestorVaquinhas() {
      return googleLogin() && (
        (emailGoogle() == 'hudsonamorim08@gmail.com' && comissaoAdmin())
        || (
          exists(/databases/$(database)/documents/vaquinhas_acessos/$(emailGoogle()))
          && get(/databases/$(database)/documents/vaquinhas_acessos/$(emailGoogle())).data.ativo == true
        )
      );
    }

    match /comissao_acessos/{email} {
      allow get: if googleLogin()
        && (email == emailGoogle() || comissaoAdmin());
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

    match /vaquinhas_acessos/{email} {
      allow get: if googleLogin()
        && (email == emailGoogle() || comissaoAdmin());
      allow list: if comissaoAdmin();
      allow create, update: if comissaoAdmin()
        && request.resource.data.email == email
        && request.resource.data.ativo is bool
        && request.resource.data.keys().hasOnly([
          'email', 'ativo', 'atualizadoPor', 'atualizadoEm'
        ]);
      allow delete: if false;
    }

    match /interas_contribuicoes/{id} {
      // Os visitantes apenas registram contribuições PENDENTES.
      allow create: if request.resource.data.keys().hasOnly([
          'campaignId', 'name', 'type', 'status', 'createdAt',
          'amount', 'quantity', 'itemId', 'itemName'
        ])
        && request.resource.data.keys().hasAll([
          'campaignId', 'name', 'type', 'status', 'createdAt'
        ])
        && request.resource.data.status == 'pending'
        && request.resource.data.type in ['finance', 'item']
        && request.resource.data.campaignId is string
        && request.resource.data.campaignId.size() <= 40
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 120
        && request.resource.data.createdAt == request.time
        && (request.resource.data.type != 'finance'
          || (request.resource.data.amount is number
            && request.resource.data.amount > 0
            && request.resource.data.amount <= 1000000))
        && (request.resource.data.type != 'item'
          || (request.resource.data.quantity is number
            && request.resource.data.quantity >= 1
            && request.resource.data.quantity <= 1000
            && request.resource.data.itemName is string
            && request.resource.data.itemName.size() <= 200));

      allow get, list: if gestorVaquinhas();
      allow update: if gestorVaquinhas()
        && resource.data.status == 'pending'
        && request.resource.data.status in ['approved', 'rejected']
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'status', 'reviewedBy', 'reviewedAt'
        ]);
      allow delete: if false;
    }

    match /app_ipcvt/{documento} {
      // Mantido como na versão anterior até a atualização do Planejamento Tático.
      allow read, write: if documento == 'planner_dados';
      // Somente dados sanitizados são públicos.
      allow read: if documento == 'interas_publicas';
      allow write: if documento == 'interas_publicas' && gestorVaquinhas();
      // Arrecadações completas e controle de pagamentos são privados.
      allow read, write: if (
        documento == 'interas_dados'
        || documento.matches('controle_intera_.*')
      ) && gestorVaquinhas();
      // Compatibilidade com a Escala Geral e os outros aplicativos legados.
      allow read, write: if request.auth != null
        && documento != 'interas_publicas'
        && documento != 'interas_dados'
        && documento != 'planner_dados'
        && !documento.matches('controle_intera_.*');
    }

    // As coleções sensíveis nunca entram na regra legada permissiva.
    match /{colecao}/{documento=**} {
      allow read, write: if request.auth != null
        && colecao != 'app_ipcvt'
        && colecao != 'comissao_acessos'
        && colecao != 'vaquinhas_acessos'
        && colecao != 'interas_contribuicoes'
        && colecao != 'comissao_planner';
    }
  }
}
```

## Testes obrigatórios antes de considerar concluído

- Visitante: lista e resumo públicos, sem nomes ou valores individuais.
- Visitante: contribuição criada como pendente, sem alterar total.
- Visitante: documentos privados e fila de aprovação retornam permission-denied.
- Gestor: Google já autenticado na Comissão é reconhecido, sem repetir login.
- Gestor: ✓ atualiza total e contador; ✕ mantém total inalterado.
- Private: cartão não revela título nem descrição e exige gestor autenticado.
- Legado: vaquinhas e pagamentos antigos continuam íntegros.
- Cadastro de gestores: só administrador da Comissão consegue autorizar e-mail.
