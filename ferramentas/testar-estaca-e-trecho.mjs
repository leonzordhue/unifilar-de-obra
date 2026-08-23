/* J4 — estaqueamento, recorte de trecho e sobra do último quilômetro.

   Estas três coisas decidem QUANTO de obra a plataforma diz que existe. Erro
   aqui não quebra nada: produz número plausível e errado, que é o que vai para a
   medição.

   As funções são as do produto — `segmentar`, `estacaDe`, `dentroTrecho`,
   `segsNoTrecho`, `resumoLinha`, carregadas de `app/*.js`. Reimplementar a
   fórmula aqui seria testar a minha cópia da conta, não a conta.

   Uso: node ferramentas/testar-estaca-e-trecho.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

let falhas = 0;
const erro = (m, e = '') => { console.log('  FALHOU ' + m + (e ? '  -> ' + e : '')); falhas++; };
const ok = (m, e = '') => console.log('  OK     ' + m + (e ? '  -> ' + e : ''));
const nota = (m) => console.log('         ' + m);

/* ---- carrega os módulos do produto num escopo só ----------------------- */
const alvo = elem => ({
  value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, querySelector: () => alvo(), querySelectorAll: () => [],
  appendChild() {}, closest: () => alvo(), getContext: () => ({}),
  options: [], children: [], id: elem || '',
});
const ctx = {
  document: { querySelector: () => alvo(), querySelectorAll: () => [],
    getElementById: () => alvo(), createElement: () => alvo(),
    body: alvo('body'), addEventListener() {} },
  window: { addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } },
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: '' }, navigator: { userAgent: 'node' },
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, requestAnimationFrame: f => f(0),
  L: Object.assign(function () { return {}; }, { map: () => ({}), tileLayer: () => ({}) }),
  fetch: async () => ({ ok: true, json: async () => ({ itens: [] }) }),
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['00-estado.js', '01-motor.js', '04-mapa.js', '06-matriz.js',
                 '11-painel.js', '13-faixa.js', '15-contrato.js']) {
  const p = path.join(RAIZ, 'app', f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: 'app/' + f });
}
// `const S = ...` no topo de um script classico fica no escopo LEXICAL do
// contexto, nao vira propriedade do objeto de contexto — por isso `ctx.S` e'
// undefined. Um script extra, rodado no MESMO contexto, ve esses bindings e os
// copia para fora. (Mesmo detalhe que me pegou no Divisor de Descontos.)
vm.runInContext(
  'globalThis.__X = {S, segmentar, estacaDe, dentroTrecho, kmNoTrecho,' +
  ' segsNoTrecho, resumoLinha, chave, EST_M, geod, extKm,' +
  ' quadroObra, avancoEm};', ctx, { filename: 'ponte.js' });
const { S, segmentar, estacaDe, dentroTrecho, kmNoTrecho, segsNoTrecho,
        resumoLinha, chave, EST_M, geod, extKm, quadroObra, avancoEm } = ctx.__X;

/* ---- eixo sintético: reta no equador, comprimento controlado ----------- */
// 1 grau de longitude no equador ~ 111,3195 km. Uma reta em lat 0 dá o
// comprimento que se quer sem depender do acervo.
function reta(km) {
  // Ajusta o comprimento em graus usando o proprio geod do produto, em vez de
  // confiar numa constante de km-por-grau: assim a reta tem o comprimento pedido
  // segundo a mesma geodesia que a plataforma usa para medir.
  let grau = km / 111.3194907932736;
  for (let i = 0; i < 4; i++) {
    const medido = geod([0, 0], [grau, 0]) / 1000;
    if (medido <= 0) break;
    grau *= km / medido;
  }
  return [[[0, 0], [grau, 0]]];
}

console.log('\n1. ESTAQUEAMENTO — 1 estaca = ' + EST_M + ' m');
{
  S.estOff = 0; S.ref = 'est';
  const casos = [[0, 0], [1, 50], [2, 100], [12, 600], [0.5, 25], [13.4, 670]];
  let bom = true;
  for (const [km, esp] of casos) {
    const v = estacaDe(km);
    if (Math.abs(v - esp) > 1e-6) { erro(`km ${km} deveria dar estaca ${esp}`, String(v)); bom = false; }
  }
  if (bom) ok('km → estaca', casos.map(([k, e]) => `${k}→${e}`).join('  '));

  S.estOff = 1200;
  const d = estacaDe(1) - estacaDe(0);
  if (Math.abs(estacaDe(0) - 1200) > 1e-6) erro('estaca inicial não desloca a origem', String(estacaDe(0)));
  else if (Math.abs(d - 50) > 1e-6) erro('deslocamento muda o passo da estaca', String(d));
  else ok('estaca inicial desloca sem mudar o passo', `E0=${estacaDe(0)}  passo=${d}`);
  S.estOff = 0;
}

console.log('\n2. SOBRA DO ÚLTIMO QUILÔMETRO');
{
  // 10,4 km: dez segmentos de 1 km e um de 0,4
  const segs = segmentar(reta(10.4));
  const soma = segs.reduce((a, s) => a + s.ext, 0);
  const ult = segs[segs.length - 1];
  if (segs.length !== 11) erro('10,4 km deveria dar 11 segmentos', String(segs.length));
  else ok('10,4 km dá 11 segmentos', `${segs.length} segmentos`);
  if (Math.abs(soma - 10.4) > 0.002) erro('a soma dos segmentos perde a sobra', soma.toFixed(4));
  else ok('a soma dos segmentos fecha com o eixo', `${soma.toFixed(4)} km`);
  if (Math.abs(ult.ext - 0.4) > 0.002) erro('o último segmento não recebeu a sobra', ult.ext.toFixed(4));
  else ok('o último segmento é a sobra', `${ult.ext.toFixed(3)} km`);

  // sobra muito pequena não pode virar segmento fantasma nem desaparecer
  const s2 = segmentar(reta(3.00005));
  const soma2 = s2.reduce((a, s) => a + s.ext, 0);
  if (Math.abs(soma2 - 3.00005) > 0.002)
    erro('sobra de 5 cm não fecha', soma2.toFixed(5));
  else ok('sobra de 5 cm não vira segmento fantasma nem desaparece',
          `${s2.length} segmentos, ${soma2.toFixed(5)} km`);
}

console.log('\n3. RECORTE DE TRECHO — o que entra na conta');
{
  const segs = segmentar(reta(20));
  S.segs = segs; S.kmIni = 0; S.kmFim = 20;
  const todos = segsNoTrecho().length;
  ok('trecho igual ao eixo pega todos os segmentos', `${todos} de ${segs.length}`);

  // recorte em km REDONDO: o esperado é exato
  S.kmIni = 5; S.kmFim = 12;
  const redondo = segsNoTrecho();
  if (redondo.length !== 7) erro('km 5–12 deveria pegar 7 segmentos', String(redondo.length));
  else ok('recorte em km redondo pega o número exato', '7 segmentos = 7 km');

  // recorte em km QUEBRADO: aqui está a pergunta que vale dinheiro
  S.kmIni = 12.5; S.kmFim = 18.3;
  const quebrado = segsNoTrecho();
  const kmDeclarado = S.kmFim - S.kmIni;
  // a régua é a extensão RECORTADA: depois da correção, o quilômetro da ponta entra
  // pelo pedaço que está no trecho, e a extensão cheia dele não representa a obra
  const kmContado = quebrado.reduce((a, s) => a + kmNoTrecho(s), 0);
  nota(`obra declarada de KM ${S.kmIni} a ${S.kmFim} = ${kmDeclarado.toFixed(2)} km`);
  nota(`segmentos que entram na matriz: ${quebrado.length}` +
       (quebrado.length ? ` (de KM ${quebrado[0].ini} a KM ${quebrado[quebrado.length - 1].fim})` : ''));
  nota(`quilometragem contada: ${kmContado.toFixed(2)} km`);
  const perda = kmDeclarado - kmContado;
  if (Math.abs(perda) > 0.05) {
    erro(`o recorte perde ${perda.toFixed(2)} km da obra declarada`,
         'a extensão medida não fecha com o trecho declarado');
    nota('consequência: quem digita KM 12,5–18,3 mede 5 km, não 5,8 km. A ponta');
    nota('de cada extremo fica fora da matriz e não pode ser lançada.');
  } else {
    ok('o recorte conserva a quilometragem declarada', `${kmContado.toFixed(2)} km`);
  }
}

console.log('\n4. O AVANÇO É PONDERADO POR EXTENSÃO?');
{
  // eixo de 10,4 km: dez de 1 km e um de 0,4. Marcando SÓ a sobra, o avanço
  // real é 0,4/10,4 = 3,8%. Se o percentual contar célula, dá 1/11 = 9,1%.
  const segs = segmentar(reta(10.4));
  S.segs = segs; S.kmIni = 0; S.kmFim = 10.4;
  S.svc = [{ nome: 'BASE', on: true, lados: ['LD'] }];
  S.catId = 'recuperacao';
  S.dados = {};
  const linha = { svc: 'BASE', lado: 'LD' };
  const ult = segs[segs.length - 1];
  S.dados[chave(linha, ult.id)] = 'C';

  const r = resumoLinha(linha);
  // r.pct e' o numero que a plataforma mostra. Comparado com um calculo
  // independente feito aqui, em km — nao com uma recontagem de celula.
  const pctCelula = r.pct == null ? 0 : 100 * r.pct;
  const kmFeito = ult.ext;
  const kmTotal = segs.reduce((a, s) => a + s.ext, 0);
  const pctKm = 100 * kmFeito / kmTotal;

  nota(`marcado apenas o último segmento, de ${ult.ext.toFixed(3)} km`);
  nota(`percentual que a plataforma mostra:              ${pctCelula.toFixed(1)}%`);
  nota(`percentual por quilômetro (o avanço real):         ${pctKm.toFixed(1)}%`);
  nota(`diferença entre as duas bases:                  ${(pctCelula - pctKm).toFixed(1)} pontos`);

  // 23/08: a base do avanco passou a ser CONTAGEM, por decisao do HAL9000 -- a equipe do
  // cliente conta quadradinho, e somar extensao devolvia 256,06 onde a planilha diz 257.
  // Eu defendi extensao por causa do recorte fracionario do exemplo fundador (km 3 a 5 de
  // uma rodovia de 12) e perdi a discussao. A prova acompanha a decisao: guardar objecao
  // vencida como se fosse defeito tranca o commit de todos por teimosia.
  //
  // O que ela passa a guardar e' o que SOBROU de risco, e sao tres coisas:
  //   (a) os TRES lugares que mostram avanco usam a MESMA base -- matriz, painel e quadro.
  //       Duas bases convivendo sem guarda dura ate o proximo que mexer, e ai a plataforma
  //       mostra dois avancos da mesma obra;
  //   (b) a extensao continua recuperavel, para o croqui e para o dia da medicao;
  //   (c) o vies da contagem continua DECLARADO no relatorio. Declarado, e' escolha;
  //       apagado, vira defeito esperando auditoria.
  const porContagem = r.val > 0 ? r.C / r.val : null;
  if (Math.abs(pctCelula - 100 * porContagem) > 0.001) {
    erro('a matriz não está na base decidida (contagem)',
         `pct=${pctCelula.toFixed(1)}% vs contagem=${(100 * porContagem).toFixed(1)}%`);
  } else {
    ok('a matriz usa a base decidida: contagem de posições',
       `${pctCelula.toFixed(1)}%`);
  }

  const ids = segs.map(x => x.id);
  const av = avancoEm(ids);
  const pctPainel = av.val > 0 ? 100 * av.C / av.val : null;
  if (pctPainel == null || Math.abs(pctPainel - pctCelula) > 0.001) {
    erro('o painel mostra avanço em base diferente da matriz',
         `painel=${pctPainel == null ? '—' : pctPainel.toFixed(1) + '%'} vs matriz=${pctCelula.toFixed(1)}%`);
  } else {
    ok('o painel usa a mesma base da matriz', `${pctPainel.toFixed(1)}%`);
  }

  S.kmIni = 0; S.kmFim = 10.4;
  // o quadro pinta a linha com a cor do grupo do servico; sem catalogo carregado o
  // `corServico` estoura. Catalogo minimo, so para a cor ter onde procurar.
  S.cat = S.cat || { grupos: [], conjuntos: [{ id: 'recuperacao', nome: 'teste', servicos: [] }] };
  const q = (quadroObra() || []).find(x => x.svc === 'BASE');
  const pctQuadro = q && q.pctTrecho != null ? 100 * q.pctTrecho : null;
  if (pctQuadro == null || Math.abs(pctQuadro - pctCelula) > 0.001) {
    erro('o quadro da obra mostra avanço em base diferente da matriz',
         `quadro=${pctQuadro == null ? '—' : pctQuadro.toFixed(1) + '%'} vs matriz=${pctCelula.toFixed(1)}%`);
  } else {
    ok('o quadro da obra usa a mesma base', `${pctQuadro.toFixed(1)}%`);
  }

  // (c) a mitigacao tem de continuar existindo. Grep e' guarda fraca, mas pega o caso que
  // importa: alguem apagar a frase numa limpeza de relatorio e ninguem notar.
  const rel = fs.readFileSync(path.join(RAIZ, 'app', '07-relatorio.js'), 'utf8');
  if (!/entram parcialmente/.test(rel) || !/otimista/.test(rel)) {
    erro('o relatório parou de declarar o viés da contagem',
         'sem a frase «entram parcialmente … o percentual é otimista», o número volta a ' +
         'ter viés escondido — e viés escondido é defeito esperando auditoria');
  } else {
    ok('o relatório continua declarando o viés da contagem no recorte parcial');
  }

  // A prova protegia METADE do contrato: ela pegava «o percentual virou contagem» e nao
  // pegaria «a contagem virou extensao». Em 23/08 as duas bases passaram a conviver de
  // proposito -- contagem para o quadro, porque a equipe conta quadradinho; extensao para o
  // percentual, porque o recorte do cliente comeca no meio do quilometro. Convivencia sem
  // guarda dura ate o proximo que mexer, entao a guarda e' nos dois sentidos.
  const inteiro = n => Number.isInteger(n);
  if (!(inteiro(r.C) && inteiro(r.val) && inteiro(r.total) && r.C === 1 && r.val === 11)) {
    erro('a contagem de resumoLinha deixou de ser contagem de posições',
         `C=${r.C} val=${r.val} total=${r.total} — esperado C=1, val=11, inteiros. ` +
         'A equipe do cliente conta quadradinho: o último quilômetro do eixo é uma linha ' +
         'da planilha e vale 1, mesmo tendo 0,400 km.');
  } else {
    ok('a contagem é de posições, e inteira', `C=${r.C} de val=${r.val}`);
  }
  if (!(r.kmC > 0 && r.kmC < 1)) {
    erro('a extensão de resumoLinha deixou de ser extensão',
         `kmC=${r.kmC} — esperado ${ult.ext.toFixed(3)} km, a sobra do eixo`);
  } else {
    ok('a extensão continua disponível ao lado da contagem',
       `kmC=${r.kmC.toFixed(3)} km · kmVal=${r.kmVal.toFixed(3)} km`);
  }
}

console.log('\n5. E QUANDO O SERVIÇO TEM DOIS LADOS? — o ponto cego que o HAL9000 achou à mão');
{
  // O bloco 4 usa um servico de UM lado, e com um lado so as tres contas coincidem
  // trivialmente: nao ha o que colapsar. Foi por isso que ele passou verde enquanto o painel
  // e o quadro divergiam de 19,1% para 24,4% no projeto real -- «3.228 quilometros» que eram
  // 12 linhas x 269 colunas, cada quilometro contado uma vez por lado.
  //
  // Prova que nao distingue as duas regras nao guarda nenhuma delas. O caso minimo que as
  // separa: um servico com DOIS lados em estados diferentes.
  const segs = segmentar(reta(4));
  S.segs = segs; S.kmIni = 0; S.kmFim = 4;
  S.svc = [{ nome: 'BASE', on: true, lados: ['LD', 'LE'] }];
  S.catId = 'recuperacao';
  S.cat = S.cat || { grupos: [], conjuntos: [{ id: 'recuperacao', nome: 'teste', servicos: [] }] };
  S.dados = {};
  S.dados[chave({ svc: 'BASE', lado: 'LD' }, segs[0].id)] = 'C';   // km 0: os dois lados
  S.dados[chave({ svc: 'BASE', lado: 'LE' }, segs[0].id)] = 'C';
  S.dados[chave({ svc: 'BASE', lado: 'LD' }, segs[1].id)] = 'C';   // km 1: só um lado

  const av = avancoEm(segs.map(x => x.id));
  const pctPainel = av.val > 0 ? 100 * av.C / av.val : null;
  const q = (quadroObra() || []).find(x => x.svc === 'BASE');
  const pctQuadro = q && q.pctTrecho != null ? 100 * q.pctTrecho : null;
  const txt = v => v == null ? '—' : v.toFixed(1) + '%';

  nota('4 km, 1 serviço, 2 lados. Concluído nos dois lados do km 0; só num lado do km 1.');
  nota('quilômetros realmente prontos: 1 de 4 = 25,0% — o km 1 tem um lado pendente');
  nota(`painel (avancoEm, lado a lado) .............. ${txt(pctPainel)}`);
  nota(`quadro (colapsa pelo lado menos avançado) ... ${txt(pctQuadro)}`);

  if (pctQuadro == null || Math.abs(pctQuadro - 25) > 0.001) {
    erro('o quadro deixou de colapsar os lados pelo estado menos avançado',
         `${txt(pctQuadro)} — esperado 25,0%: meio serviço não é serviço inteiro`);
  } else {
    ok('o quadro conta o quilômetro uma vez, pelo lado menos avançado', '25,0%');
  }
  if (pctPainel == null || Math.abs(pctPainel - pctQuadro) > 0.001) {
    erro('painel e quadro divergem quando o serviço tem dois lados',
         `painel=${txt(pctPainel)} vs quadro=${txt(pctQuadro)} — o painel conta célula ` +
         '(serviço × lado), e o mesmo quilômetro entra duas vezes');
    nota('achado do HAL9000 em 23/08, à mão, no projeto real: 19,1% no cartão contra');
    nota('24,4% no quadro, com «3.228 quilômetros» que eram 12 × 269 células.');
    nota('esta prova tinha ponto cego: o bloco 4 usa serviço de UM lado, e aí as duas');
    nota('regras coincidem por acidente. Uma prova que não distingue não guarda.');
  } else {
    ok('painel e quadro concordam também com dois lados', txt(pctPainel));
  }
}

console.log('\n' + (falhas ? `RESULTADO: ${falhas} achado(s) — ver acima.`
                           : 'RESULTADO: OK — estaca, sobra e recorte conferem.'));
process.exit(falhas ? 1 : 0);
