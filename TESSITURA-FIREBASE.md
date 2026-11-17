# Mapa Vocal IPCVT — primeira versão (17/11/2026)

Ferramenta da Comissão em `tessitura.html`, com cartão de acesso no `comissao.html`.
Mantém o tema claro/escuro e a barra superior `☀/☾ | |||`, com retorno à Comissão.

## Funcionalidades atuais

- Cadastra, edita, inativa e exclui cantores. Classificações: soprano, mezzo-soprano, contralto, tenor, barítono, baixo e não classificado.
- Separa **alcance máximo** (grave/aguda) de **tessitura confortável** (grave/aguda). Os quatro limites são opcionais no cadastro inicial, mas o alcance deve ter as duas notas para entrar nos cálculos.
- Com os dois extremos da **tessitura confortável**, apresenta um **naipe sugerido**. A pessoa pode clicar em "Usar [naipe]" para adotar a proposta. Não altera automaticamente classificações existentes; é uma indicação aproximada, não um diagnóstico vocal, e não considera timbre ou passaggi.
- A calculadora foi condensada: as duas notas principais ficam em destaque e o **tom original** aparece em um painel recolhível (opcional). A faixa superior tem ilustração artística de coro e piano em estilo aquarela.
- Organiza a lista por classificação e permite busca, filtro e exibição de inativos. A edição de cada cantor acontece **dentro da linha da tabela**, sem janelas popup.
- Na primeira abertura autorizada com acesso à nuvem, **importa automaticamente os nomes e naipes atuais** das funções Soprano/Contralto/Tenor do documento Firestore `app_ipcvt/escala_geral_dados`. O botão "Atualizar da Escala Geral" sincroniza novos cantores quando solicitado. O procedimento não preenche notas, não remove pessoas e preserva fichas já avaliadas. A gravação depende de permissões Firebase publicadas.
- Os limites vocais e as notas da melodia são escolhidos com **12 botões circulares por oitava**, iluminando a nota selecionada; a oitava é selecionada acima. O tom original também tem botões circulares.
- Recebe a nota mais grave e a mais aguda da melodia; o tom original é opcional. Com o tom original informado, devolve a tonalidade sugerida; sem ele, devolve o intervalo de transposição.
- Considera grupos completos ou apenas uma classificação, usando vozes ativas com alcance preenchido.
- Testa mudanças de -6 até +6 semitons. Para cada integrante, também testa a melodia em múltiplas oitavas, priorizando compatibilidade com a tessitura confortável e depois com o alcance máximo.
- Exibe quantos cantores podem cantar confortavelmente, quantos ficariam no limite, quantos estariam fora do alcance, alternativas e o posicionamento de cada voz.
- Salva as **fichas de alcance e conforto** na coleção `comissao_tessitura`, isolada e com regras de acesso próprias. A calculadora não guarda histórico de simulações nesta versão.

## Ativação do banco — etapa obrigatória

**As alterações feitas no GitHub Pages não publicam automaticamente regras do Cloud Firestore.**
Antes de compartilhar dados com o grupo:

1. No console Firebase do projeto `repertorio-ipcvt`, abra **Firestore Database > Rules**.
2. Faça uma cópia de segurança das regras atualmente publicadas.
3. Compare com o arquivo `firestore-regras-completas-2026-11-16.rules` atualizado (ou com `firestore-ipcvt-integrado.rules`) e publique a versão integrada **somente se for compatível com as demais regras já em produção**.
4. Confirme que a regra abrangente exclui `comissao_tessitura`. Criar apenas um `match /comissao_tessitura` sem a exclusão deixaria o cadastro acessível pela regra genérica.
5. Teste as permissões com uma conta Google autorizada, uma não autorizada e uma conta suspensa.

Sem essas regras, a ferramenta deverá mostrar uma mensagem de acesso à nuvem indisponível, com **Testar localmente**. Essa opção usa `localStorage`, não sincroniza com outras máquinas e não transfere os dados para o Firebase. Não use esse modo para cadastro definitivo.

## Limitações do cálculo

O método é uma heurística de transposição, **não uma determinação objetiva da tonalidade ideal**. Notas mais aguda e mais grave não informam duração, frequência, passaggio, fadiga, energia da música ou divisões de harmonia. O resultado presume que cada cantor pode realizar a mesma linha melódica em uma oitava adequada. Para peças com vozes independentes, a análise deve ser feita parte a parte.

**Nota de referência:** Dó4 (C4) = MIDI 60; por exemplo, Ré4 = 62, Lá4 = 69.

## Roteiro inicial de teste

1. Entrar em `comissao.html` com uma conta Google autorizada e abrir **Tessitura Vocal** no novo cartão.
2. Importar os cantores reais da Escala Geral; conferir nomes e classificações (sem notas presumidas).
3. Abrir a edição em linha de duas ou três pessoas e escolher as notas nos botões circulares com oitava. Testar também um cantor com a tessitura confortável em branco.
4. Informar o tom original e as notas grave/aguda da melodia; conferir a transposição, as alternativas e os resultados por cantor.
5. Alternar modo claro/escuro; pesquisar e filtrar a lista; testar num celular.
6. Verificar gravação na nuvem e recarregamento da página, após publicar as regras de acesso.
