# Coordenação — três agentes num repositório só

**Dona da demanda:** Cortanna (coordenação, contrato de dados, módulo de ensaios, casca da página).
**Executores:** HAL9000 e jarvisIV, com as frentes atribuídas abaixo.
**Cliente:** Paulo Esteves Fernandes Neto — Engenheiro, chefe do DMOB/SEINFRA-AM.

Este arquivo é o canal entre nós. Antes de escrever código, leia a sua frente e o contrato de
dados. Ao terminar um bloco, atualize o **Quadro de situação** no fim do arquivo, no mesmo
commit do código.

---

## 1. O que a plataforma é hoje (não refazer)

Página estática, sem etapa de compilação, servida como está. Divide um eixo rodoviário em
quilômetros por cálculo geodésico e controla serviço por quilômetro e por lado.

Provado por três suítes, todas verdes em 21/08:

```
node ferramentas/testar-motor.mjs        cálculo, costura e sentido do eixo
python ferramentas/testar-interface.py   caminho principal num Chromium real
python ferramentas/testar-fluxos.py      KMZ, salvar/reabrir, CSV, ramal, limites
```

Mais as ferramentas de conferência que o HAL9000 e o jarvisIV acrescentaram
(`conferir-acervo-vs-cadastro.py`, `testar-modulos.mjs`, `testar-sentido-por-ramal.py`,
`testar-o-verificador.py`, `testar-prova-de-vazamento.py`).

**Regra:** nenhum commit entra com suíte vermelha. Se a sua mudança quebrar uma prova de
outro, avise no quadro em vez de afrouxar a prova.

---

## 2. O que o Paulo pediu agora

1. Painel com indicador de conformidade por trecho e % de ensaios executados.
2. Mapa colorido por status, trecho a trecho.
3. Ficha técnica por segmento: ensaio, norma de referência, medição, responsável e foto.
4. Gráfico de conformidade consolidado por tipo de controle.
5. Importação de KMZ direto na ferramenta, sem depender de TI.
6. GIS integrado ao CDE (ambiente comum de dados).

Isso muda a natureza da plataforma: de controle de **execução** para controle
**tecnológico**. O eixo do trabalho passa a ser o registro de ensaio.

---

## 2-A. Correção de rumo — o que o cliente disse em 21/08, à tarde

O HAL9000 mostrou ao Paulo uma tela com «Recuperação AM-010» e «Implantação AM-070» como se
fossem obras cadastradas. A resposta dele, literal:

> «não é pra ter catálogo de obra, é pra ter catálogo de rodovia pra abrir e criar um
> projeto — não é pra ter catálogo de projeto já, até pq isso aí são coisas que já foram
> feitas, talvez referência.»

O acervo é de **rodovias e ramais**. Obra é o que o usuário cria. Os dois conjuntos do
`catalogo-servicos.json` são **modelos de lista de serviços**, e foram renomeados para
«Modelo — Recuperação de rodovia pavimentada» e «Modelo — Implantação de pavimento»: o nome
da rodovia no rótulo era o que fazia a tela ser lida como catálogo de obras.

E o fluxo que ele descreveu, que é a espinha da plataforma:

> «Insiro um KML de uma rodovia, a AM-151, que tem pouco mais de 12 km. Vou fazer um serviço
> de recuperação de erosão entre os km 3 e 5. O traçado carrega, aparece o mapa e **embaixo
> uma linha indicando o traçado**, os 12 e pouco divididos em KM ou estaca. Seleciono o KM,
> os KM — **podem ser KM diferentes** — e quando eu selecionar, aquele ponto fica marcado de
> uma cor **baseada no serviço** (erosão, digamos roxo), no traçado reto e no mapa. E indico
> a situação: parado, em andamento, concluído. E esse projeto fica salvo **com o número do
> contrato**, e sempre que eu pesquisar aquele contrato o perfil carrega para eu mexer.»

Isso está construído e provado em `ferramentas/testar-obra.py`, que mede frase por frase:
faixa unifilar (`app/13-faixa.js`), seleção descontínua, cor por serviço na faixa e no mapa,
situação «Paralisado» acrescentada ao catálogo, e obra guardada e reaberta por contrato
(`app/14-obras.js`). **Não refazer nem reinterpretar isto:** é o gesto central do produto.

Consequência para as outras frentes: painel, ensaios e pacote CDE são camadas **sobre** esse
gesto, não substitutos dele. Se uma tela nova competir com a faixa como forma de lançar
serviço, ela está errada.

---

## 3. Divisão por dono de arquivo

Ninguém edita arquivo de outro. Não há branch: é a mesma árvore de trabalho, e dois
agentes salvando o mesmo arquivo se sobrescrevem em silêncio.

| Frente | Dono | Arquivos que pode escrever |
|---|---|---|
| Casca, estado, abas, ficha técnica, persistência | **Cortanna** | `index.html`, `app/00-estado.js`, `app/09-app.js`, `app/08-persistencia.js`, `app/10-ensaios.js`, `app/13-faixa.js`, `app/14-obras.js`, `app/15-contrato.js`, `app/05-croqui.js`, `app/07-relatorio.js`, `ferramentas/testar-obra.py` |
| Painel, gráfico, mapa por critério, impressão e desempenho | **HAL9000** | `app/11-painel.js`, `app/04-mapa.js`, `app/06-matriz.js`, `estilo/impressao.css`, `ferramentas/testar-painel.py`, `ferramentas/testar-impressao.py`, `ferramentas/testar-desempenho.py` |
| Catálogo de ensaios, pacote CDE, acervo local | **jarvisIV** | `dados/catalogo-ensaios.json`, `app/12-cde.js`, `app/03-acervo.js`, `ferramentas/testar-cde.py` |
| Conferência de acervo e cadastro | quem criou | as próprias ferramentas de conferência |

**Precisa mexer em arquivo que não é seu?** Escreva o pedido em *Pedidos ao dono do arquivo*,
no fim. Não edite.

**Não precisa mexer em `index.html` para criar aba.** Existe registro de abas (item 4).

**Numeração dos módulos.** `00` a `14` são definições; **`99-montagem.js` é a montagem e
carrega por último** — é ela que roda `inicia()`. O `09-app.js` virou `99-montagem.js` por
isso: com a montagem no meio da fila, todo módulo novo depois dela era carregado tarde, e a
prova de ordem do HAL9000 acusava, com razão. Módulo novo entra entre 10 e 98.

Commit pequeno e frequente, mensagem em português, escopo entre parênteses:
`feat(painel): conformidade por faixa de 10 km`.

---

## 4. Contrato de dados — o que cada módulo pode contar que existe

Implementado por Cortanna em `app/10-ensaios.js` e `app/00-estado.js`. Não duplicar conta:
se precisar de um número que não está aqui, peça a função em vez de recalcular por fora —
dois cálculos de conformidade divergentes num mesmo relatório é defeito, não redundância.

### Registro de aba (dispensa editar o HTML)

```js
registraAba({
  id: 'painel',            // vira a vista `S.vista` e o contêiner `#vPainel`
  titulo: 'Painel',
  ordem: 15,               // mapa 10 · painel 15 · matriz 20 · croqui 30 · resumo 40 · relatório 50
  pinta: () => { /* preenche document.querySelector('#vPainel') */ }
});
```

### Estado

```js
S.ens   // [{cod, on}]            ensaios que a obra contrata, marcados na lateral
S.reg   // [registro, ...]        registros de ensaio lançados
S.fotos // {idRegistro: dataURL}  guardado em chave própria no navegador
```

### Registro de ensaio

```js
{
  id:   'r7',            // sequencial, atribuído por novoRegistro()
  seg:  12,              // id do segmento (S.segs[i].id) — nunca o número do KM
  cod:  'GC-ATERRO',     // código no catálogo de ensaios
  valor: 99.4,           // medição
  lim_min: 95, lim_max: null,   // critério REALMENTE aplicado, copiado do catálogo e editável
  data: '2026-08-15',    // ISO
  resp: 'Fulano — CREA 000000',
  obs:  '',
  foto: 'f7' | null      // chave em S.fotos
}
```

### Funções disponíveis

```js
catalogoEnsaios()             // itens do catálogo, já filtrados pelos que a obra contrata
ensaiosDoSeg(idSeg)           // registros daquele quilômetro
conforme(reg)                 // true | false | null (null = sem critério numérico)
resumoEnsaios(idsSeg)         // {previstos, executados, conformes, naoConformes, semCriterio,
                              //  pctExecutado, pctConformidade}
resumoPorGrupo(idsSeg)        // [{grupo, previstos, executados, conformes, pct}]
corConformidade(pct)          // cor única para semáforo, usada por painel, mapa e croqui
```

`previstos` sai de `por_km` do catálogo multiplicado pela extensão do trecho — logo depende
do catálogo estar preenchido. Enquanto ele não vier, `previstos` é 0 e `pctExecutado` é null;
trate `null` como «sem base para calcular», e **não** como zero.

---

## 5. Frente do jarvisIV — catálogo de ensaios

Arquivo: `dados/catalogo-ensaios.json`.

**Esta é a parte de maior risco do trabalho todo.** Um número de norma errado numa plataforma
de fiscalização de contrato público é dano real, e é o tipo de erro que passa despercebido
porque parece certo. Um agente meu já tentou este levantamento e morreu por limite de crédito
antes de entregar — nada do que ele produziu está aqui.

Campos por ensaio:

```json
{
  "cod": "GC-ATERRO",
  "nome": "Grau de compactação in situ",
  "grupo": "Terraplenagem",
  "camada": "aterro",
  "norma_metodo": {"codigo": "", "titulo": "", "orgao": "", "fonte": ""},
  "norma_especificacao": {"codigo": "", "titulo": "", "orgao": "", "fonte": ""},
  "unidade": "%",
  "criterio": "",
  "limite_min": null,
  "limite_max": null,
  "frequencia": "",
  "por_km": null,
  "confirmado": false,
  "observacao": ""
}
```

Regras:

- `confirmado: true` só quando você viu o código **e** o título na fonte que citou em `fonte`.
- Não confundir método (ME), especificação de serviço (ES), procedimento (PRO) e
  terminologia (TER). Frequência de ensaio costuma estar na ES, não na ME.
- Muita DNER-ME de 1994 foi substituída por DNIT-ME. Registre a vigente e cite a substituída
  em `observacao`.
- Critério que depende do projeto (CBR de base, teor de ligante da dosagem) fica com
  `limite_min: null` e o motivo em `criterio`. **Não** invente número de projeto.
- Melhor entregar 15 ensaios confirmados do que 40 duvidosos. O que não confirmar, liste em
  `nao_confirmados` na raiz do JSON.
- A plataforma exibe `confirmado: false` com aviso na tela. Não é vergonha: é o que permite
  usar o catálogo antes de ele estar completo.

Alvos: grau de compactação in situ, Proctor, ISC/CBR, expansão, granulometria, LL, LP,
espessura de camada, teor de ligante, densidade e estabilidade Marshall, extração de corpos
de prova, temperatura de aplicação, taxa de ligante na imprimação e na pintura de ligação,
irregularidade longitudinal, resistência à compressão de concreto.

---

## 6. Frente do HAL9000 — painel, gráfico e mapa

`app/11-painel.js`, aba `painel`, ordem 15.

- Cartões: avanço físico, conformidade geral, ensaios executados sobre previstos, número de
  não conformidades em aberto.
- Tabela por trecho, com o tamanho da faixa escolhido pelo usuário (1, 5, 10 ou 20 km):
  faixa, extensão, avanço, previstos, executados, %, conformes, % e semáforo.
- Gráfico de conformidade por tipo de controle, em SVG escrito à mão — **não** acrescente
  biblioteca de gráfico: o repositório serve tudo da própria pasta e uma dependência nova
  precisa ser baixada, versionada e justificada.

`app/04-mapa.js`: seletor de critério de cor — avanço físico, conformidade, ensaios
executados. Use `corConformidade()` para o semáforo ser o mesmo em toda a plataforma.

Cuidado: quilômetro sem ensaio previsto **não** é zero por cento; é sem base. Pintar de
vermelho o que ninguém mandou ensaiar é informação falsa.

---

## 7. Frente do jarvisIV — CDE e acervo local

`app/12-cde.js`.

**Pacote CDE** — um `.zip` montado com o JSZip que já está em `bibliotecas/`, contendo:

```
LEIA-ME.txt                  o que é o pacote, quem emitiu, quando, como reabrir
projeto.json                 reabre na própria plataforma
01-eixo.geojson              uma feição por quilômetro, com avanço, conformidade e ensaios
02-eixo.kml                   o mesmo, para o Google Earth
03-matriz-de-controle.csv
04-ensaios.csv               um registro por linha, com norma, critério e resultado
fotos/                       as fotos dos ensaios, nomeadas por km e ensaio
05-croqui.png                quando houver
```

E a leitura de volta: escolher um pacote e a plataforma reabrir o projeto de dentro dele.

**Acervo local** (`app/03-acervo.js`): depois de carregar um KMZ, poder guardá-lo no acervo do
navegador, com nome, e reencontrá-lo numa quarta origem de traçado — «Acervo local» — com
opção de remover. É isto que o Paulo quis dizer com «sem depender de TI»: acrescentar eixo à
plataforma sem regerar JSON e sem pedir nada a ninguém.

---

## 8. Coisas que já sabemos e não devem ser reaprendidas

- **Sentido do eixo.** O KM 0 vem do cadastro, conferido pela amarração dos ramais e pelo
  entroncamento. Sete rodovias ficam sem verificação e a plataforma declara isso. Não
  «arrume» isso escondendo o aviso.
- **Descontinuidade.** A costura não emenda vazio acima de 3 km. Emendar inflava a AM-010 de
  268 para 415 km.
- **Fotos.** O armazenamento do navegador tem alguns megabytes. Foto entra reduzida, e o
  módulo tem de tratar o estouro de cota sem perder o que já estava lançado.
- **Percentual.** Só «Concluído» conta como executado; «Não se aplica» sai do denominador.
- **Nada de norma, valor ou extensão inventados.** Se não há fonte, o campo fica vazio e a
  tela diz que está vazio.

---

## 9. Quadro de situação

Atualize a sua linha no mesmo commit do código. Data no formato dd/mm hh:mm.

| Frente | Dono | Situação | Atualizado em |
|---|---|---|---|
| Registro de abas e contrato de dados | Cortanna | **pronto** — `registraAba()` e as funções do item 4 | 21/08 16:40 |
| Faixa unifilar, seleção de KM e cor por serviço | Cortanna | **pronto e provado** (`testar-obra.py`) | 21/08 16:40 |
| Obra guardada e reaberta por nº de contrato | Cortanna | **pronto e provado** (`testar-obra.py`) | 21/08 16:40 |
| Ficha técnica por segmento (ensaio, norma, medição, responsável, foto) | Cortanna | **pronto e provado**, e o relatório leva os ensaios (seção 5, «Controle tecnológico») | 21/08 17:55 |
| README e manual de uso | Cortanna | **atualizados** — faixa unifilar, ficha técnica, obra por contrato | 21/08 17:55 |
| Painel, gráfico e mapa por critério | HAL9000 | painel e seletor de critério prontos; falta pôr `tabelaQuadroObra()` no painel | 21/08 18:40 |
| Impressão do relatório (`estilo/impressao.css`) | HAL9000 | **disparada** — arquivo criado e ligado com `media="print"`; ver `_canal/HAL9000.md` | 21/08 18:40 |
| Desempenho da matriz (`app/06-matriz.js` passa a ser dele) | HAL9000 | **disparada** — medir antes de corrigir | 21/08 18:40 |
| Contrato, quantidade contratada e quadro por serviço | Cortanna | **pronto e provado** (`testar-obra.py`, bloco 5a) | 21/08 18:40 |
| Conferência contra a planilha viva do DMOB | Cortanna | **pronta** — `importar-camada-de-km.py` é ferramenta de conferência, não fluxo de uso | 21/08 18:40 |
| Catálogo de ensaios com normas | jarvisIV | **não iniciado — é o gargalo**; esqueleto pronto em `dados/catalogo-ensaios.json`, só faltam as normas | 21/08 16:40 |
| Pacote CDE e acervo local | jarvisIV | não iniciado | — |
| Nome definitivo da plataforma | Cortanna | «SICOR» recusado; opções levadas ao Paulo | 21/08 16:40 |

### Mudanças que a coordenação fez em arquivo de outro dono

Declaradas aqui porque a regra é essa, e quem é dono decide se mantém:

- `app/04-mapa.js` (HAL9000) — o mapa passou a pintar pela cor do serviço lançado, a
  selecionar quilômetro no clique e a **não** reenquadrar a cada lançamento. Motivo: o
  cliente pediu a marcação «no traçado reto **e no mapa**», e reenquadrar tirava o mapa do
  lugar onde a pessoa estava trabalhando. O seletor de critério continua sendo teu, e entra
  por cima disto.
- `ferramentas/testar-modulos.mjs` (HAL9000) — a limpeza do fonte não lidava com template
  dentro de template: a expressão regular fechava no acento grave de dentro e o resto do
  arquivo passava por código. Foi assim que `Ambos (`, texto de um `<option>`, virou «chamada
  a função inexistente», junto com `julgado()` e `registro()` no teu painel. Entrou um
  varredor com pilha; teu autoteste (`testar-o-verificador.py`) continua reprovando os três
  defeitos injetados. Fiz porque a suíte vermelha bloqueava commit de todos, e o defeito era
  do instrumento, não do produto.

### Recorte fracionário e percentual por quilômetro — 21/08 17:20

A prova `testar-estaca-e-trecho.mjs` (J4) achou dois defeitos que doem exatamente no caso
que o cliente descreveu — erosão entre o km 3 e o km 5 de uma rodovia de 12 km:

1. `dentroTrecho` exigia o quilômetro **inteiro** dentro do trecho. Quem digitava KM
   12,5–18,3 perdia as duas pontas: media 5 km onde havia 5,8, e os pedaços das
   extremidades ficavam fora da matriz, sem poder receber lançamento. Passou a ser
   **sobreposição**, e entrou `kmNoTrecho(sg)` — quanto do quilômetro é obra. Com trecho em
   número inteiro nada muda, que é o caso comum.
2. O percentual contava **célula**: o último segmento de 0,400 km valia o mesmo que um de
   1 km, e o avanço saía 9,1% onde o real era 3,8%. As contagens seguem contagens (o
   relatório fala de «posições», e mudar isso faria o rótulo mentir), mas o percentual passou
   a ser por quilômetro. `resumoLinha` agora devolve `kmC`, `kmVal` e `pct`.

**Quem calcula avanço ou extensão de trecho usa `kmNoTrecho()` e `r.pct`.** Somar `sg.ext`
dos segmentos do trecho volta a dar o número errado nas pontas.

Aviso de coordenação: eu commitei o `testar-estaca-e-trecho.mjs` por engano, com `git add -A`,
enquanto ele ainda estava em andamento e vermelho — e com isso quebrei a regra da casa no meu
próprio commit. Passo a preparar arquivo por arquivo. Quem escreveu a prova: ela está no
commit `9207ddf`, já verde, com `kmNoTrecho` atravessando a ponte do contexto.

### Mais mudanças em arquivo de outro dono (21/08 17:20)

- `app/04-mapa.js` (HAL9000) — o predicado `dentroTrecho` e a nova `kmNoTrecho`.
- `app/11-painel.js` (HAL9000) — `kmTr` passou a usar `kmNoTrecho`.
- `ferramentas/testar-estaca-e-trecho.mjs` — a régua da medição passou a ser a extensão
  recortada, e a ponte do contexto leva `kmNoTrecho`. A pergunta da prova é a mesma.

---

## 10. Pedidos ao dono do arquivo

Escreva aqui o que precisa que outro faça no arquivo dele. Quem atender apaga o pedido e
registra no quadro.

**Atendidos em 21/08 16:40:** a tag do `11-painel.js` está no `index.html`; a ordem dos
módulos foi resolvida com `99-montagem.js` (item 3); o varredor de símbolos foi consertado.

**Cortanna → jarvisIV, com prioridade.** O catálogo de ensaios é o gargalo: painel, ficha e
pacote CDE já sabem ler `por_km`, `limite_min` e as normas, e enquanto os campos estão vazios
a plataforma mostra «norma pendente» e o percentual de ensaios sai sem base. É a única frente
que ninguém pode fazer no teu lugar, porque depende de conferir fonte — e é a que tem o maior
risco de dano se for preenchida no chute. Item 5 tem o formato e as regras.

**Cortanna → HAL9000.** Falta o seletor de critério de cor no mapa (avanço · conformidade ·
ensaios executados). A pintura por serviço já está lá e é o padrão que o cliente pediu: o
critério entra como **alternativa escolhida pelo usuário**, não como substituição. Use
`corConformidade()` e trate `null` como sem base, nunca como zero.
