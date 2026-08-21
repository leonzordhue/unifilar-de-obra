/* Prova do motor da plataforma, fora do navegador.
   Roda `app/01-motor.js` contra o acervo real, para que a divisão por quilômetro não
   dependa de conferência visual. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// O motor vive em `app/01-motor.js` e não toca em DOM: carrega-se o arquivo como está.
const motor = fs.readFileSync(path.join(RAIZ, 'app', '01-motor.js'), 'utf8');
const ctx = {console};
vm.createContext(ctx);
vm.runInContext(motor + 'globalThis.__M = {geod, extKm, segmentar, interp, costura};', ctx);
const M = ctx.__M;

const brl = (v, c = 3) => v.toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
let falhas = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FALHA'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!cond) falhas++;
};

console.log('1. VALIDAÇÃO DA GEODÉSIA');
const grau = M.geod([0, 0], [0, 1]) / 1000;
ok(Math.abs(grau - 110.574) < 0.01, '1 grau de latitude no equador = 110,574 km', `→ ${brl(grau)} km`);
const mao = M.geod([-60.0217, -3.1019], [-47.8825, -15.7942]) / 1000;
ok(Math.abs(mao - 1932) < 6, 'Manaus → Brasília ≈ 1.932 km', `→ ${brl(mao, 0)} km`);

console.log('\n2. SEGMENTAÇÃO — linha sintética de 10 km exatos');
// meridiano: 1 grau de latitude ≈ 110,574 km; 10 km ≈ 0,0904372 grau
const passo = 10 / (M.geod([0, 0], [0, 1]) / 1000);
const reta = [[0, 0], [0, passo]];
const sg = M.segmentar([reta]);
ok(sg.length === 10, 'gera 10 segmentos', `→ ${sg.length}`);
const somaReta = sg.reduce((a, s) => a + s.ext, 0);
ok(Math.abs(somaReta - 10) < 0.001, 'soma dos segmentos = 10 km', `→ ${brl(somaReta)} km`);
const desvio = Math.max(...sg.map(s => Math.abs(s.ext - 1)));
ok(desvio < 0.001, 'cada segmento mede 1 km', `→ desvio máximo ${brl(desvio * 1000, 1)} m`);
ok(sg[0].ini === 0 && sg[9].ini === 9, 'quilometragem sequencial de 0 a 9',
   `→ ${sg.map(s => s.ini).join(',')}`);

console.log('\n3. SEGMENTAÇÃO — acervo real');
const acv = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'acervo-rodovias-estaduais.json'), 'utf8'));
let piorDif = 0, piorNome = '';
for (const it of acv.itens){
  const s = M.segmentar(it.linhas);
  const soma = s.reduce((a, x) => a + x.ext, 0);
  const dif = Math.abs(soma - it.km_geometria);
  if (dif > piorDif){ piorDif = dif; piorNome = it.nome; }
  // um segmento nunca pode passar de 1 km
  const excede = s.filter(x => x.ext > 1.0005);
  if (excede.length) { console.log(`  FALHA ${it.nome}: ${excede.length} segmento(s) acima de 1 km`); falhas++; }
}
ok(piorDif < 0.01, 'soma dos segmentos = extensão do acervo em todas as rodovias',
   `→ pior diferença ${brl(piorDif * 1000, 1)} m (${piorNome})`);

const am010 = acv.itens.find(i => i.nome === 'AM-010');
const s10 = M.segmentar(am010.linhas);
console.log(`\n  AM-010: ${s10.length} segmentos · ${brl(s10.reduce((a, x) => a + x.ext, 0))} km` +
            ` · cadastro ${brl(am010.km_cadastro)} km · partes ${am010.partes}`);
ok(Math.abs(s10.reduce((a, x) => a + x.ext, 0) - am010.km_cadastro) / am010.km_cadastro < 0.05,
   'AM-010 dentro de 5% da extensão cadastrada');

console.log('\n4. DESCONTINUIDADE — o segmento se encerra na quebra');
const duas = [[[0, 0], [0, passo / 10]], [[1, 1], [1, 1 + passo / 10]]];  // duas partes de 1 km, distantes
const sd = M.segmentar(duas);
ok(sd.length === 2, 'duas partes separadas geram dois segmentos, sem emendar o vazio',
   `→ ${sd.length} segmento(s), ${brl(sd.reduce((a, s) => a + s.ext, 0))} km`);

console.log('\n5. RAMAIS — amostra de 60');
const ram = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados', 'acervo-ramais.json'), 'utf8'));
let difR = 0;
for (const it of ram.itens.slice(0, 60)){
  const s = M.segmentar(it.linhas);
  difR = Math.max(difR, Math.abs(s.reduce((a, x) => a + x.ext, 0) - it.km_geometria));
}
ok(difR < 0.01, 'soma dos segmentos = extensão do acervo nos ramais',
   `→ pior diferença ${brl(difR * 1000, 1)} m`);

console.log('\n6. COSTURA — o que chega de um KMZ do usuário');
// Um traçado de 4 km em quatro partes de 1 km, embaralhadas e algumas invertidas: é assim
// que um KMZ desenhado no Google Earth costuma sair.
const q = passo / 10;                                  // ~1 km em grau de latitude
const p1 = [[0, 0], [0, q]], p2 = [[0, q], [0, 2 * q]];
const p3 = [[0, 2 * q], [0, 3 * q]], p4 = [[0, 3 * q], [0, 4 * q]];
const rev = a => a.slice().reverse();
const emb = M.costura([rev(p3), p1, rev(p4), p2]);
ok(emb.cadeias.length === 1 && emb.saltos.length === 0,
   'partes embaralhadas e invertidas viram uma cadeia só',
   `→ ${emb.cadeias.length} cadeia(s), ${emb.saltos.length} salto(s)`);
const extEmb = M.extKm(emb.cadeias[0]);
ok(Math.abs(extEmb - 4) < 0.002, 'a extensão costurada é a soma das partes',
   `→ ${brl(extEmb)} km`);
const sEmb = M.segmentar(emb.cadeias);
ok(sEmb.length === 4 && Math.abs(sEmb.reduce((a, x) => a + x.ext, 0) - 4) < 0.002,
   'e a divisão por quilômetro sai correta', `→ ${sEmb.length} segmentos`);

// duas partes distantes: costurar somaria o vazio à obra
const longe = M.costura([p1, [[1, 1], [1, 1 + q]]]);
ok(longe.cadeias.length === 2 && longe.saltos.length === 1,
   'parte distante abre cadeia nova em vez de emendar o vazio',
   `→ salto de ${brl(longe.saltos[0], 1)} km declarado`);
ok(Math.abs(M.segmentar(longe.cadeias).reduce((a, x) => a + x.ext, 0) - 2) < 0.002,
   'o vazio não entra na extensão');

console.log('\n7. SENTIDO DO EIXO — de que lado está o KM 0');
// Uma rodovia partida ao meio ou virada do avesso passa em todas as provas de extensão e
// mesmo assim referencia todo lançamento no lugar errado. Aqui o KM 0 é conferido contra
// dado externo: a posição de Manaus e a geometria da rodovia em que cada ramal nasce.
ok(acv.itens.every(r => r.sentido && r.sentido.metodo),
   'toda rodovia declara como o sentido foi determinado');
const indef = acv.itens.filter(r => r.sentido.metodo === 'indefinido');
ok(indef.length <= 7, 'rodovias com sentido não verificável',
   `→ ${indef.length}: ${indef.map(r => r.nome).join(', ')}`);
ok(am010.partes === 1, 'AM-010 é uma cadeia só, e não dois pedaços',
   `→ ${am010.partes} parte(s)`);
const MAO = [-60.0217, -3.1019];
const p0 = am010.linhas[0][0];
const pN = am010.linhas[am010.linhas.length - 1].slice(-1)[0];
ok(M.geod(p0, MAO) < M.geod(pN, MAO),
   'AM-010 começa em Manaus (KM 0) e termina em Itacoatiara',
   `→ KM 0 a ${brl(M.geod(p0, MAO) / 1000, 1)} km de Manaus, ` +
   `fim a ${brl(M.geod(pN, MAO) / 1000, 1)} km`);

// cada ramal nasce na rodovia de referência: o KM 0 tem de ser a ponta do entroncamento
const porRod = new Map(acv.itens.map(r => [r.nome, r.linhas.flat()]));
const perto = (pt, vs) => vs.reduce((m, v) => Math.min(m, M.geod(pt, v)), Infinity);
let checados = 0, certos = 0;
for (const r of ram.itens){
  const vs = porRod.get(r.rodovia_ref);
  if (!vs) continue;
  const a = r.linhas[0][0], b = r.linhas[r.linhas.length - 1].slice(-1)[0];
  const da = perto(a, vs), db = perto(b, vs);
  if (Math.min(da, db) > 500 || Math.abs(da - db) < 200) continue;  // não amarra: não conta
  checados++;
  if (da < db) certos++;
}
ok(checados > 50 && certos / checados > 0.95,
   'ramais começam no entroncamento com a rodovia de referência',
   `→ ${certos} de ${checados} (${brl(100 * certos / checados, 1)}%)`);

console.log(`\n${falhas ? falhas + ' FALHA(S)' : 'TODAS AS PROVAS PASSARAM'}`);
process.exit(falhas ? 1 : 0);
