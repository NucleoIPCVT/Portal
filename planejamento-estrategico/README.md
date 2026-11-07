# Planejamento Estratégico IPCVT

Esta pasta contém a edição estática da versão visual mais completa do quadro
de times que o Núcleo IPCVT utilizava em `nucleo-ipcvt-planner.vercel.app`,
capturada em 07/11/2026 e publicada no GitHub Pages do Portal. Todos os
recursos estáticos necessários foram copiados para `assets/`, sem dependência
da hospedagem do Vercel.

Recursos preservados: Time A/B/C, filtros por time e seção, arrastar nomes,
cadastro e edição de grupos/funções, anotações, zoom, desfazer/refazer,
importação de backup, PDF e sincronização pelo documento
`app_ipcvt/planner_dados` (campo `plannerV2`).

O arquivo `auth-gate.js` exige conta Google verificada e autorização em
`tatico_acessos/{email}` antes de carregar o quadro. O SDK do quadro é
integrado ao mesmo Firebase Auth em `assets/firebase-sdk-authenticated.js`,
permitindo que as regras do Firestore também verifiquem o login.

O arquivo principal em `assets/index-C8auUyjE.js` é uma cópia do build
publicado, com ajustes mecânicos somente no nome, no retorno ao Portal e na
inicialização do SDK autenticado. **O código-fonte React original dessa
versão não estava disponível no repositório de código antigo.** Para futuras
evoluções, recuperar o projeto-fonte atualizado é preferível a editar este
arquivo compilado.

As regras completas de segurança estão documentadas em
`../VAQUINHAS-FIREBASE.md` e precisam ser publicadas no console Firebase.
Não remova o campo `plannerV2` existente nem reinicialize o documento.
