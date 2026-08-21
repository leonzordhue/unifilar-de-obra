/* J3 — prova de CARGA dos módulos.

   As outras provas medem se a plataforma calcula certo e se os fluxos operam.
   Esta mede uma coisa antes disso: se o código chega a rodar.

   Por que ela existe. Dez arquivos carregados por `<script>` em sequência, sem
   empacotador, compartilham um único escopo global. Isso quebra de quatro modos
   que nenhuma prova de fluxo pega de forma confiável:

     1. `const`/`let` no topo de um módulo entram na TDZ do escopo do script. Um
        módulo que EXECUTA algo no carregamento usando símbolo declarado com
        `const` num módulo POSTERIOR lança ReferenceError — e o `<script>` morre.
     2. Símbolo que sumiu no corte: o refactor moveu função de lugar e alguém
        ficou chamando o nome antigo.
     3. Ordem de `<script>` trocada no index.html.
     4. Caractere de controle LITERAL no fonte. O HTML5 obriga o parser a trocar
        U+0000 por U+FFFD, então o navegador compila algo diferente do arquivo.
        Node e Python leem o arquivo direto e não reproduzem.

   O item 4 não é hipótese: derrubou a plataforma do Divisor de Descontos em
   21/08/2026. Um U+0000 dentro de classe de caracteres de regex inverteu a faixa,
   invalidou a regex e, com `'use strict'`, matou o `<script>` inteiro. A página
   renderizava bonita, as libs de CDN carregavam, e nada funcionava. O gate estava
   verde porque compilava só metade do arquivo.

   Uso: node ferramentas/testar-modulos.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

let falhas = 0;
const erro = (m) => { console.log('  FALHOU  ' + m); falhas++; };
const ok = (m) => console.log('  OK    ' + m);
const nota = (m) => console.log('        ' + m);

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/* ---------------------------------------------------------------- 1. ordem */
console.log('\n1. ORDEM DE CARGA NO index.html');
const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
const mods = srcs.filter(s => s.startsWith('app/'));
const libs = srcs.filter(s => !s.startsWith('app/'));

const noDisco = fs.readdirSync(path.join(RAIZ, 'app'))
  .filter(f => f.endsWith('.js')).sort();

if (!mods.length) erro('nenhum módulo app/ referenciado no index.html');
else ok(`${mods.length} módulo(s) e ${libs.length} biblioteca(s) declarados`);

const faltaNoHtml = noDisco.filter(f => !mods.includes('app/' + f));
const faltaNoDisco = mods.filter(m => !fs.existsSync(path.join(RAIZ, m)));
if (faltaNoHtml.length)
  erro(`arquivo em app/ que o index.html NÃO carrega: ${faltaNoHtml.join(', ')}`);
else ok('todo arquivo de app/ é carregado');
if (faltaNoDisco.length)
  erro(`index.html carrega arquivo que não existe: ${faltaNoDisco.join(', ')}`);
else ok('todo <script> aponta para arquivo existente');

const ordenado = [...mods].sort();
if (mods.join('|') !== ordenado.join('|'))
  erro('ordem dos <script> não é a ordem numérica dos nomes:\n' +
       '        no html: ' + mods.join(' ') + '\n' +
       '        esperado: ' + ordenado.join(' '));
else ok('ordem dos <script> é a ordem numérica dos módulos');

for (const l of libs) {
  if (/^https?:/.test(l)) erro(`biblioteca vindo de fora: ${l} — quebra o uso sem internet`);
}
if (!libs.some(l => /^https?:/.test(l)))
  ok(`nenhuma biblioteca em CDN (${libs.length} servida(s) da pasta)`);

/* ------------------------------------------------- 2. caractere de controle */
console.log('\n2. CARACTERE DE CONTROLE LITERAL NO FONTE');
const arquivos = [['index.html', html],
  ...mods.map(m => [m, fs.readFileSync(path.join(RAIZ, m), 'utf8')])];
let sujos = 0;
for (const [nome, txt] of arquivos) {
  txt.split('\n').forEach((linha, i) => {
    [...linha].forEach((ch, col) => {
      const o = ch.codePointAt(0);
      if ((o < 0x20 && ch !== '\t') || o === 0x7F || (o >= 0x80 && o <= 0x9F)
          || o === 0xFFFD) {
        erro(`${nome}:${i + 1}:${col} U+${o.toString(16).toUpperCase().padStart(4, '0')} ` +
             `literal — o navegador compila outra coisa`);
        sujos++;
      }
    });
  });
}
if (!sujos) ok(`nenhum caractere de controle nos ${arquivos.length} arquivos`);

/* ---------------------------------------- 3. executa como o navegador executa */
console.log('\n3. CARGA REAL — os dez módulos no mesmo escopo, na ordem do html');

// O navegador troca U+0000 por U+FFFD ao fazer o parse do HTML. Aplicamos a
// mesma troca antes de compilar, para ver o que o V8 veria.
const trocaHtml = (s) => s.replace(/\u0000/g, '\uFFFD');

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const criado = new Map();
const nulos = new Set();

function elemento(id) {
  if (!criado.has(id)) {
    criado.set(id, {
      id, value: '', textContent: '', innerHTML: '', disabled: false,
      checked: false, dataset: {}, children: [], files: [], options: [],
      style: {}, _ouv: {}, width: 0, height: 0, offsetWidth: 800, offsetHeight: 600,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(e, f) { this._ouv[e] = f; },
      removeEventListener() {}, closest() { return elemento('_c'); },
      querySelector() { return elemento('_q'); }, querySelectorAll: () => [],
      appendChild() {}, insertBefore() {}, remove() {}, click() {}, focus() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      getContext: () => ({
        fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, save() {}, restore() {}, translate() {},
        rotate() {}, setLineDash() {}, fillText() {}, strokeText() {},
        measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }),
        getImageData: () => ({ data: [] }), putImageData() {},
      }),
      toDataURL: () => 'data:image/png;base64,',
      getBoundingClientRect: () => ({ width: 800, height: 600, top: 0, left: 0 }),
    });
  }
  return criado.get(id);
}

const doc = {
  querySelector(sel) {
    const m = /^#([A-Za-z0-9_:.-]+)$/.exec(sel);
    if (m) { if (!ids.has(m[1])) nulos.add(m[1]); return ids.has(m[1]) ? elemento(m[1]) : null; }
    return elemento('_' + sel);
  },
  querySelectorAll: () => [],
  getElementById(id) { if (!ids.has(id)) nulos.add(id); return ids.has(id) ? elemento(id) : null; },
  createElement: () => elemento('_novo_' + criado.size),
  createElementNS: () => elemento('_ns'),
  body: elemento('_body'), head: elemento('_head'),
  documentElement: elemento('_root'),
  addEventListener() {}, removeEventListener() {},
};

const L = () => {
  const enc = { addTo() { return this; }, setStyle() { return this; },
    on() { return this; }, remove() { return this; }, bindPopup() { return this; },
    getBounds: () => ({ isValid: () => true, pad() { return this; } }),
    setLatLngs() { return this; }, clearLayers() { return this; },
    addLayer() { return this; }, fitBounds() { return this; },
    setView() { return this; }, invalidateSize() { return this; },
    getZoom: () => 12, getCenter: () => ({ lat: -3, lng: -60 }),
    eachLayer() {}, removeLayer() {}, openPopup() { return this; } };
  return enc;
};
const Lstub = Object.assign(function () { return L(); }, {
  map: () => L(), tileLayer: () => L(), polyline: () => L(), marker: () => L(),
  circleMarker: () => L(), layerGroup: () => L(), featureGroup: () => L(),
  latLngBounds: () => ({ isValid: () => true, pad() { return this; },
    extend() { return this; }, getCenter: () => ({ lat: -3, lng: -60 }) }),
  latLng: (a, b) => ({ lat: a, lng: b }), divIcon: () => ({}), icon: () => ({}),
  control: { attribution: () => L(), scale: () => L() },
  DomUtil: { create: () => elemento('_dom') }, Browser: {},
});

const ctx = {
  document: doc,
  window: { addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    devicePixelRatio: 1, innerWidth: 1440, innerHeight: 900,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '', href: 'http://localhost/', origin: 'http://localhost' },
    requestAnimationFrame(f) { f(0); }, setTimeout, clearTimeout, alert() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: '', href: 'http://localhost/', origin: 'http://localhost' },
  navigator: { userAgent: 'node', language: 'pt-BR' },
  console: { log() {}, warn() {}, error() {}, info() {} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame(f) { f(0); },
  fetch: async () => ({ ok: true, json: async () => ({ itens: [] }),
    text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => ({}) }),
  Image: class { set src(_v) { if (this.onload) this.onload(); } },
  Blob: class {}, File: class {}, FileReader: class { readAsText() {} },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  XMLHttpRequest: class { open() {} send() {} },
  DOMParser: class { parseFromString() { return doc; } },
  JSZip: class { static loadAsync() { return Promise.resolve({ file: () => null,
    files: {} }); } },
  L: Lstub,
  alert() {}, confirm: () => true, prompt: () => null,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
};
ctx.globalThis = ctx; ctx.self = ctx; ctx.window.document = doc;
vm.createContext(ctx);

let quebrou = null;
for (const m of mods) {
  const fonte = trocaHtml(fs.readFileSync(path.join(RAIZ, m), 'utf8'));
  try {
    new vm.Script(fonte, { filename: m }).runInContext(ctx);
    ok(`${m} carregou`);
  } catch (e) {
    quebrou = m;
    erro(`${m} lançou no carregamento: ${e.name}: ${e.message}`);
    const linha = (e.stack || '').match(new RegExp(m.replace(/[/.]/g, '\\$&') + ':(\\d+)'));
    if (linha) {
      const src = fonte.split('\n');
      const n = +linha[1];
      for (let i = Math.max(0, n - 3); i < Math.min(src.length, n + 2); i++)
        nota((i === n - 1 ? '  >>> ' : '      ') + (i + 1) + ': ' + src[i]);
    }
    break;   // o navegador também pararia aqui
  }
}
if (!quebrou && mods.length) ok('os dez módulos carregam no mesmo escopo, na ordem do html');

/* ------------------------------------------------- 4. símbolo que não existe */
console.log('\n4. SÍMBOLO CHAMADO E NUNCA DEFINIDO');
if (quebrou) {
  nota('pulado: a carga parou em ' + quebrou);
} else {
  // Coleta declaração em QUALQUER profundidade, não só no topo do arquivo.
  //
  // A primeira versão só olhava `^(const|let|function...)` — declaração de topo —
  // e por isso acusou 15 símbolos que existem: `o`, `res`, `cor`, `proj` e
  // companhia são variáveis e parâmetros locais, e `async(` era `async (x) =>`,
  // que não é chamada nenhuma. Quinze falsos positivos num verificador é pior do
  // que verificador nenhum: ensina a ignorar a saída.
  // Texto de template aninhado: varredura com pilha, porque expressão regular fecha no
  // acento grave de dentro e deixa o resto do arquivo passar por código.
  const tiraTemplates = (t) => {
    let out = '', i = 0;
    const p = [];                       // topo: 'T' texto · 'E' expressão ${} · 'B' bloco {}
    const topo = () => p[p.length - 1];
    while (i < t.length){
      const c = t[i];
      if (topo() === 'T'){
        if (c === '\\'){ out += '  '; i += 2; continue; }
        if (c === '`'){ p.pop(); out += '`'; i++; continue; }
        if (c === '$' && t[i + 1] === '{'){ p.push('E'); out += '${'; i += 2; continue; }
        out += (c === '\n' ? '\n' : ' '); i++; continue;
      }
      if (c === '`'){ p.push('T'); out += '`'; i++; continue; }
      if ((topo() === 'E' || topo() === 'B') && c === '{'){ p.push('B'); out += c; i++; continue; }
      if ((topo() === 'B' || topo() === 'E') && c === '}'){ p.pop(); out += c; i++; continue; }
      out += c; i++;
    }
    return out;
  };
  // Varredura em UMA passada, da esquerda para a direita.
  //
  // A versão anterior aplicava um `replace` por tipo, em cadeia, e isso é
  // errado por construção: ela tirava comentários ANTES de tirar strings, então
  // o `//` de uma URL dentro de string — `'<kml xmlns="http://www.opengis...'`
  // no `12-cde.js` — era lido como início de comentário. A linha era cortada no
  // meio, sobrava um apóstrofo ímpar, e daí para frente todo o pareamento de
  // aspas se deslocava: o conteúdo de strings posteriores ficava exposto e
  // virava "chamada de função". Foi assim que apareceu um `DADOS()` que não
  // existe em lugar nenhum do código.
  //
  // Só uma varredura sequencial resolve, porque quem abre primeiro manda: dentro
  // de string, `//` é texto; dentro de comentário, aspas são texto.
  // Varredura com PILHA, porque template aninhado exige isso.
  //
  // A primeira tentativa tratava crase como aspa simples: andava até a próxima
  // crase e pronto. Não serve — este código monta HTML com template dentro de
  // interpolação (`${ `...` }`), e a crase de fechamento encontrada era a
  // errada. O texto do template escapava e caía na varredura de chamadas. Como
  // em português se escreve `ensaio(s)`, `julgado(s)`, `Ambos (...)`, cada
  // plural virava "função que ninguém declara": quatro falsos positivos.
  //
  // Aqui o texto do template é apagado, mas o conteúdo de `${...}` é tratado
  // como CÓDIGO — que é o que ele é. Assim a varredura ainda enxerga chamada
  // feita dentro de interpolação, em vez de ficar cega para ela.
  const limpaFonte = (t) => {
    const n = t.length;
    let out = '', i = 0;
    // pilha: 'tpl' = dentro do texto de um template; 'exp' = dentro de ${...}
    const pilha = [];
    const emTexto = () => pilha[pilha.length - 1] === 'tpl';

    while (i < n) {
      const c = t[i], d = t[i + 1];

      if (emTexto()) {
        if (c === '\\') { out += '  '; i += 2; continue; }
        if (c === '`') { pilha.pop(); out += '`'; i++; continue; }
        if (c === '$' && d === '{') { pilha.push('exp'); out += '  '; i += 2; continue; }
        out += (c === '\n' ? '\n' : ' ');   // preserva a linha, apaga o texto
        i++; continue;
      }

      // ---- estamos em código ----
      if (c === '/' && d === '*') {
        const f = t.indexOf('*/', i + 2);
        const bloco = t.slice(i, f < 0 ? n : f + 2);
        out += bloco.replace(/[^\n]/g, ' ');            // mantém as linhas
        i = f < 0 ? n : f + 2; continue;
      }
      if (c === '/' && d === '/') {
        const f = t.indexOf('\n', i);
        out += ' '.repeat((f < 0 ? n : f) - i);
        i = f < 0 ? n : f; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && t[j] !== c && t[j] !== '\n') j += (t[j] === '\\' ? 2 : 1);
        out += c + c + ' '.repeat(Math.max(0, j - i - 1));
        i = j + 1; continue;
      }
      if (c === '`') { pilha.push('tpl'); out += '`'; i++; continue; }
      if (c === '}' && pilha[pilha.length - 1] === 'exp') {
        pilha.pop(); out += ' '; i++; continue;
      }
      out += c; i++;
    }
    return out;
  };

  const declarados = new Set(['S', '$', '$$', 'arguments', 'this']);
  for (const m of mods) {
    const t = limpaFonte(fs.readFileSync(path.join(RAIZ, m), 'utf8'));
    // const/let/var/function/class em qualquer indentação
    for (const r of t.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g))
      declarados.add(r[1]);
    // desestruturação: const {a, b: c} = ...   e   const [x, y] = ...
    for (const r of t.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]+)[}\]]/g))
      r[1].split(',').forEach(x => {
        const n = x.trim().split(':').pop().trim().replace(/^\.\.\./, '')
          .split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n)) declarados.add(n);
      });
    // parâmetros: function f(a, b), (a, b) =>, a =>, method(a, b) {
    for (const r of t.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g))
      r[1].split(',').forEach(x => {
        const n = x.trim().split(':').pop().trim().replace(/^\.\.\./, '')
          .split('=')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n)) declarados.add(n);
      });
    for (const r of t.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g))
      declarados.add(r[1]);
    // catch (e) / for (const x of ...)
    for (const r of t.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g))
      declarados.add(r[1]);
  }

  const globais = new Set(Object.keys(ctx));
  // Palavras que a regex de chamada pega e que não são chamada de função.
  const naoChamada = new Set(['if', 'for', 'while', 'switch', 'catch', 'return',
    'typeof', 'function', 'new', 'await', 'async', 'do', 'else', 'in', 'of',
    'delete', 'void', 'instanceof', 'yield', 'throw', 'case', 'with']);
  const embutidos = new Set(['Math', 'JSON', 'Object', 'Array', 'String',
    'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set', 'WeakMap', 'RegExp',
    'Error', 'TypeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent', 'Intl', 'Symbol', 'BigInt',
    'structuredClone', 'Uint8Array', 'ArrayBuffer', 'TextDecoder', 'atob', 'btoa']);

  const ausentes = new Map();
  for (const m of mods) {
    const t = limpaFonte(fs.readFileSync(path.join(RAIZ, m), 'utf8'));
    // O lookbehind precisa barrar letra ACENTUADA, e nao so [\w]. `\w` e ASCII:
    // sem os acentuados, a palavra "quilometro(s)" -- escrita com o -- casava o
    // sufixo `metro(` como se fosse chamada de funcao, porque o caractere
    // anterior nao contava como letra. Era o ultimo falso positivo do passo 4.
    for (const r of t.matchAll(
        /(?<![.\w$À-ɏ])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = r[1];
      if (naoChamada.has(n) || declarados.has(n) || globais.has(n)
          || embutidos.has(n)) continue;
      if (!ausentes.has(n)) ausentes.set(n, m);
    }
  }
  if (ausentes.size) {
    for (const [n, m] of ausentes)
      erro(`${m}: chama \`${n}()\` e nenhum módulo declara esse nome`);
  } else ok('toda função chamada tem declaração em algum módulo');
}

/* --------------------------------------------------- 5. id que não existe */
console.log('\n5. id REFERENCIADO E AUSENTE DO index.html');
if (nulos.size) {
  erro('seletor devolveu null no carregamento: ' + [...nulos].join(', '));
} else ok('nenhum id ausente foi consultado durante a carga');

console.log('\n' + (falhas ? `RESULTADO: FALHOU — ${falhas} problema(s) de carga.`
                           : 'RESULTADO: OK — a plataforma carrega.'));
process.exit(falhas ? 1 : 0);
