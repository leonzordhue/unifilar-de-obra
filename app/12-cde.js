/* Pacote CDE e acervo local de tracado.

   CDE e o ambiente comum de dados: a pasta unica onde a obra inteira vive, e de onde
   projetista, fiscal e contratada leem a MESMA versao. A plataforma nao e o CDE — ela emite
   para ele. Um pacote que chega la sem dizer de onde saiu cada numero e papel solto, entao o
   `LEIA-ME.txt` declara procedencia, inclusive a do KM 0 e a divergencia entre a extensao do
   acervo e a do cadastro.

   O pacote e um `.zip` montado com o JSZip que ja esta em `bibliotecas/`. Vai georreferenciado
   (GeoJSON e KML), tabulado (CSV) e reabrivel (o proprio projeto), porque cada um desses e
   lido por uma ferramenta diferente do escritorio e ninguem deveria ter de converter nada.

   O acervo local resolve o «sem depender de TI»: um KMZ carregado pode ficar guardado no
   navegador e aparecer numa quarta origem de tracado, sem regerar JSON e sem pedir nada a
   ninguem. */

/* ---------------------------------------------------------------- acervo local */
const CHAVE_ACERVO_LOCAL = 'controle-obra-unifilar-acervo-local-v1';

function acervoLocal(){
  try { return JSON.parse(localStorage.getItem(CHAVE_ACERVO_LOCAL) || '[]'); }
  catch (e){ return []; }
}
function gravaAcervoLocal(lista){
  try {
    localStorage.setItem(CHAVE_ACERVO_LOCAL, JSON.stringify(lista));
    return true;
  } catch (e){
    alert('O navegador recusou guardar o traçado por falta de espaço. Salve o projeto em '
        + 'arquivo — o traçado vai dentro dele.');
    return false;
  }
}

/** Guarda o eixo carregado de arquivo no acervo do navegador. */
function guardaNoAcervoLocal(){
  if (!S.eixo || !S.segs.length){ alert('Carregue um traçado antes de guardar.'); return; }
  const sug = S.eixo.nome || 'Traçado';
  const nome = (prompt('Nome do traçado no acervo local:', sug) || '').trim();
  if (!nome) return;
  const lista = acervoLocal();
  const igual = lista.findIndex(x => x.nome.toUpperCase() === nome.toUpperCase());
  if (igual >= 0 && !confirm(`Já existe «${lista[igual].nome}» no acervo local. Substituir?`))
    return;
  const item = {
    tipo: 'local', id: nome, nome,
    km_geometria: +S.segs.reduce((a, s) => a + s.ext, 0).toFixed(3),
    km_cadastro: S.eixo.km_cadastro || 0,
    inicio: S.eixo.inicio || '', fim: S.eixo.fim || '',
    // sentido indefinido: arquivo do usuário não carrega essa informação, e fingir que
    // carrega esconderia justamente o que precisa ser conferido no croqui
    sentido: {metodo: 'indefinido'},
    saltos_km: (S.eixo.meta && S.eixo.meta.saltos_km) || [],
    partes: S.eixo.linhas.length,
    origem: (S.eixo.arquivo || 'arquivo do usuário'),
    guardado_em: new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}),
    linhas: S.eixo.linhas
  };
  if (igual >= 0) lista[igual] = item; else lista.push(item);
  if (!gravaAcervoLocal(lista)) return;
  alert(`«${nome}» guardado no acervo local. Aparece na origem «Acervo local».`);
  pintaAcervo();
}

function removeDoAcervoLocal(nome){
  const lista = acervoLocal().filter(x => x.nome !== nome);
  gravaAcervoLocal(lista);
  pintaAcervo();
}

/* ---------------------------------------------------------------- pacote CDE */
const pad = (n, c = 4) => String(n).padStart(c, '0');
const seguro = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'obra';

/** Uma feição por quilômetro, com o que a plataforma sabe daquele pedaço. */
function eixoGeoJSON(){
  return {
    type: 'FeatureCollection',
    name: (S.eixo && S.eixo.nome) || 'eixo',
    crs: {type: 'name', properties: {name: 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
    features: S.segs.map(sg => {
      const svcs = servicosNoSeg(sg.id);
      const rs = typeof resumoEnsaios === 'function' ? resumoEnsaios([sg.id]) : {};
      const p = pctSeg(sg.id);
      return {
        type: 'Feature',
        properties: {
          km_inicial: +sg.ini.toFixed(3), km_final: +sg.fim.toFixed(3),
          extensao_km: +sg.ext.toFixed(3),
          estaca_inicial: typeof estacaDe === 'function' ? estacaDe(sg.ini) : null,
          no_trecho: dentroTrecho(sg),
          km_no_trecho: +kmNoTrecho(sg).toFixed(3),
          avanco: p == null ? null : +(100 * p).toFixed(1),
          servicos: svcs.map(s => s.svc).join(' | '),
          situacoes: svcs.map(s => s.status.map(nomeStatus).join('/')).join(' | '),
          ensaios_executados: rs.executados || 0,
          ensaios_conformes: rs.conformes || 0,
          ensaios_nao_conformes: rs.naoConformes || 0,
          conformidade: rs.pctConformidade == null ? null
            : +(100 * rs.pctConformidade).toFixed(1)
        },
        geometry: {type: 'LineString', coordinates: sg.pts.map(q => [q[0], q[1]])}
      };
    })
  };
}

/** O mesmo eixo em KML, com a cor do quilômetro — é como o croqui aparece no Google Earth. */
function eixoKML(){
  const cor = sg => {
    const c = (typeof corCriterio === 'function' ? corCriterio(sg, dentroTrecho(sg))
                                                 : '#5B9BD5').replace('#', '');
    // KML usa aabbggrr, e não rrggbb
    return 'ff' + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2);
  };
  const estilos = [], marcas = [];
  S.segs.forEach((sg, i) => {
    estilos.push(`<Style id="e${i}"><LineStyle><color>${cor(sg)}</color>`
      + `<width>5</width></LineStyle></Style>`);
    const svcs = servicosNoSeg(sg.id);
    marcas.push(`<Placemark><name>${esc(rotuloSeg(sg))}</name>`
      + `<description>${esc(`${fmt(sg.ext, 3)} km`
        + (svcs.length ? ' · ' + svcs.map(s => s.svc + ' (' + s.status.map(nomeStatus).join('/') + ')').join(' · ')
                       : ' · sem lançamento'))}</description>`
      + `<styleUrl>#e${i}</styleUrl><LineString><tessellate>1</tessellate><coordinates>`
      + sg.pts.map(q => `${q[0]},${q[1]},0`).join(' ')
      + `</coordinates></LineString></Placemark>`);
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + `<name>${esc((S.obra || (S.eixo && S.eixo.nome) || 'obra'))}</name>`
    + estilos.join('') + marcas.join('') + '</Document></kml>';
}

/** A relação faixa a faixa, com início, fim e extensão em número.

    Nasce de uma auditoria do corte do relatório: as 38 páginas de tabela viraram um
    unifilar desenhado, e o rodapé passou a dizer que «a relação faixa a faixa, com início,
    fim e extensão de cada uma, sai completa no CSV exportado e no pacote CDE». Só que não
    saía: o `03-matriz-de-controle.csv` traz a situação por quilômetro, sem extensão, e a
    extensão estava só no GeoJSON, por quilômetro, exigindo juntar dois arquivos e emendar
    quilômetros de mesma situação para reconstruir a faixa.

    Promessa escrita no documento é promessa a cumprir, não a reinterpretar: este arquivo é
    a tabela removida, no lugar onde o rodapé manda procurar. */
function faixasCSV(){
  const sep = ';';
  const out = [['SERVICO', 'LADO', 'FORA_DO_CATALOGO', 'KM_INICIAL', 'KM_FINAL',
                'EXTENSAO_KM', 'SITUACAO', 'LANCADO_ATE'].join(sep)];
  const segs = segsNoTrecho();
  linhasMatriz().forEach(l => {
    const fora = (S.svc.find(s => s.nome === l.svc) || {}).foraCatalogo ? 'SIM' : '';
    faixasDe(l).forEach(f => {
      // LANCADO_ATE é a data MAIS RECENTE dos quilômetros da faixa: uma faixa de 12 km não
      // foi lançada num dia só, e uma coluna «DATA» fingiria que foi.
      const dentro = segs.filter(sg => sg.ini >= f.ini - 1e-9 && sg.fim <= f.fim + 1e-9);
      out.push([l.svc, l.lado, fora, fmt(f.ini, 3), fmt(f.fim, 3), fmt(f.fim - f.ini, 3),
                nomeStatus(f.v), ultimaData(dentro.map(sg => chave(l, sg.id)))].join(sep));
    });
  });
  return out.join('\r\n');
}

/** Um registro de ensaio por linha, com a norma e o critério que valeram no aceite. */
function ensaiosCSV(){
  const sep = ';';
  const cab = ['TRECHO', 'KM_INICIAL', 'KM_FINAL', 'ENSAIO', 'GRUPO', 'CAMADA',
    'NORMA_METODO', 'NORMA_ESPECIFICACAO', 'MEDICAO', 'UNIDADE', 'LIMITE_MIN',
    'LIMITE_MAX', 'RESULTADO', 'DATA', 'RESPONSAVEL', 'OBSERVACAO', 'FOTO'];
  const linhas = [cab.join(sep)];
  S.reg.slice().sort((a, b) => a.seg - b.seg).forEach((r, i) => {
    const e = ensaioDe(r.cod) || {};
    const sg = S.segs.find(x => x.id === r.seg) || {ini: 0, fim: 0};
    const nm = (e.norma_metodo || {}).codigo || 'pendente de confirmação';
    const ne = (e.norma_especificacao || {}).codigo || '';
    linhas.push([rotuloSeg(sg), fmt(sg.ini, 3), fmt(sg.fim, 3), e.nome || r.cod,
      e.grupo || '', e.camada || '', nm, ne,
      r.valor == null ? '' : fmt(r.valor, 3), e.unidade || '',
      r.lim_min == null ? '' : fmt(r.lim_min, 3),
      r.lim_max == null ? '' : fmt(r.lim_max, 3),
      textoConforme(r), r.data || '', r.resp || '',
      (r.obs || '').replace(/[;\r\n]+/g, ' '),
      r.foto && S.fotos[r.foto] ? nomeFoto(r, i) : (r.semFoto ? 'FOTO NAO COUBE' : '')].join(sep));
  });
  return linhas.join('\r\n');
}
const nomeFoto = (r, i) => `fotos/ensaio-${pad(i + 1)}-km${pad(Math.floor(
  (S.segs.find(x => x.id === r.seg) || {ini: 0}).ini), 3)}-${seguro(r.cod)}.jpg`;

function leiaMe(){
  const d = typeof dadosContrato === 'function' ? dadosContrato() : {};
  const st = (S.eixo && S.eixo.sentido) || {};
  const saltos = (S.eixo && S.eixo.meta && S.eixo.meta.saltos_km) || [];
  const geo = S.segs.reduce((a, s) => a + s.ext, 0);
  const cad = (S.eixo && S.eixo.km_cadastro) || 0;
  const pend = [...new Set(S.reg.map(r => r.cod))]
    .map(c => ensaioDe(c)).filter(e => e && !e.confirmado).length;
  const L = [];
  L.push('PACOTE PARA AMBIENTE COMUM DE DADOS — CDE');
  L.push('SICOR — Sistema de Controle de Obras Rodoviárias · SEINFRA/AM — DMOB');
  L.push('');
  L.push('IDENTIFICAÇÃO');
  L.push(`  Obra ................ ${S.obra || (S.eixo && S.eixo.nome) || '—'}`);
  L.push(`  Contrato ............ ${S.contrato || '—'}`);
  if (d.objeto) L.push(`  Objeto .............. ${d.objeto}`);
  if (d.valor) L.push(`  Valor ............... R$ ${fmt(d.valor, 2)}`);
  if (d.vigencia_contrato) L.push(`  Vigência do contrato  ${d.vigencia_contrato}`);
  if (d.vigencia_execucao) L.push(`  Vigência de execução  ${d.vigencia_execucao}`);
  L.push(`  Eixo ................ ${(S.eixo && S.eixo.nome) || '—'}`);
  L.push(`  Trecho em obra ...... KM ${fmt(S.kmIni, 3)} ao KM ${fmt(S.kmFim, 3)}`);
  L.push(`  Emitido em .......... ${new Date().toLocaleString('pt-BR')}`);
  L.push('');
  L.push('O QUE ESTÁ NESTE PACOTE');
  L.push('  LEIA-ME.txt ......... este arquivo');
  L.push('  projeto.json ........ reabre na própria plataforma, com tudo o que está aqui');
  L.push('  01-eixo.geojson ..... uma feição por quilômetro, com avanço, serviços e ensaios');
  L.push('  02-eixo.kml ......... o mesmo eixo colorido, para o Google Earth');
  L.push('  03-matriz-de-controle.csv .. serviço × lado × quilômetro');
  L.push('  04-ensaios.csv ...... um registro de ensaio por linha, com norma e critério');
  L.push('  06-faixas.csv ....... a relação faixa a faixa: início, fim, extensão e situação');
  L.push('  fotos/ .............. as fotos dos ensaios, nomeadas por quilômetro e ensaio');
  L.push('  05-croqui.png ....... o traçado sobre imagem de satélite, quando gerado');
  L.push('');
  const orfaos = S.svc.filter(s => s.on && s.foraCatalogo).map(s => s.nome);
  if (orfaos.length){
    L.push('SERVIÇO FORA DO CATÁLOGO DESTA OBRA');
    L.push('  Vieram do projeto aberto e não constam do catálogo escolhido. Contam no quadro');
    L.push('  e no relatório, e estão marcados com SIM na coluna FORA_DO_CATALOGO dos CSV:');
    orfaos.forEach(n => L.push('  - ' + n));
    L.push('');
  }
  L.push('DE ONDE SAIU CADA NÚMERO');
  L.push('  Extensão de cada quilômetro: cálculo geodésico sobre o traçado — fórmula inversa');
  L.push('  de Vincenty, elipsoide GRS-80. Não é comprimento planar, que em coordenadas');
  L.push('  geográficas não tem significado métrico.');
  L.push('');
  const orig = {
    'cadastro+ramais': 'ordem dos trechos no Sistema Rodoviário Estadual, conferida contra a '
      + 'amarração dos ramais',
    'ramais': 'amarração dos ramais que declaram em que KM da rodovia nascem',
    'cadastro': 'ordem dos trechos no Sistema Rodoviário Estadual',
    'entroncamento': 'localização, na geometria, do entroncamento que o cadastro dá como início',
    'ponto_inicio': 'ponto de início declarado no cadastro do ramal',
    'indefinido': 'NÃO VERIFICADA — traçado de trecho único, sem ramal amarrado e sem '
      + 'entroncamento localizável, ou arquivo carregado pelo usuário'
  }[st.metodo] || 'não declarada';
  L.push(`  Origem da quilometragem (KM 0): ${orig}.`);
  if (st.pontos >= 3)
    L.push(`  Conferida por ${st.pontos} amarrações, correlação ${fmt(st.correlacao, 3)}, `
         + `erro médio ${fmt(st.erro_medio_km, 2)} km.`);
  if (st.metodo === 'indefinido')
    L.push('  ATENÇÃO: confira no croqui de que lado está o KM 0 antes de usar este pacote.');
  L.push('');
  if (cad) L.push(`  Extensão: ${fmt(geo, 3)} km apurados na geometria contra ${fmt(cad, 3)} km`
    + ' de cadastro. A diferença é o desvio entre a geometria disponível e a extensão'
    + ' cadastrada; para medição contratual vale o número do cadastro.');
  if (saltos.length) L.push(`  Descontinuidade: ${saltos.length} interrupção(ões) no traçado`
    + ` (${saltos.map(v => fmt(v, 1) + ' km').join(', ')}). A quilometragem é contada sobre o`
    + ' traçado existente, sem somar os vazios.');
  L.push('');
  L.push('  Avanço: medido em quilômetro, e não em número de células. «% do trecho» diz onde');
  L.push('  a obra está no eixo; «% do contrato» diz quanto falta entregar, e só existe onde');
  L.push('  a quantidade contratada do serviço foi informada.');
  L.push('');
  if (S.reg.length){
    L.push(`  Ensaios: ${S.reg.length} registro(s). O critério de aceitação gravado em cada um`);
    L.push('  é o que vigorava no aceite; alteração posterior do catálogo não reprova ensaio');
    L.push('  já aceito.');
    if (pend) L.push(`  ATENÇÃO: ${pend} ensaio(s) deste pacote estão com a NORMA DE REFERÊNCIA`
      + ' PENDENTE de confirmação. Onde se lê «pendente de confirmação», a norma aplicável'
      + ' deve ser informada pela fiscalização antes do uso em medição.');
    L.push('');
  }
  L.push('  Imagem de satélite do croqui: Esri World Imagery · Maxar, Earthstar Geographics.');
  L.push('');
  L.push('COMO REABRIR');
  L.push('  Na plataforma, botão «Abrir» e escolha este .zip, ou o projeto.json de dentro dele.');
  return L.join('\n');
}

async function exportaCDE(){
  if (!S.eixo || !S.segs.length){
    alert('Escolha um eixo antes de exportar o pacote.'); return;
  }
  if (typeof JSZip === 'undefined'){
    alert('A biblioteca de compactação não carregou.'); return;
  }
  const bt = $('#btCDE');
  const antes = bt ? bt.textContent : '';
  if (bt){ bt.textContent = 'montando…'; bt.disabled = true; }
  try {
    const zip = new JSZip();
    zip.file('LEIA-ME.txt', leiaMe());
    zip.file('projeto.json', JSON.stringify(projetoAtual()));
    zip.file('01-eixo.geojson', JSON.stringify(eixoGeoJSON(), null, 1));
    zip.file('02-eixo.kml', eixoKML());
    zip.file('03-matriz-de-controle.csv', '﻿' + textoCSV());
    if (S.reg.length) zip.file('04-ensaios.csv', '﻿' + ensaiosCSV());
    zip.file('06-faixas.csv', '﻿' + faixasCSV());
    S.reg.slice().sort((a, b) => a.seg - b.seg).forEach((r, i) => {
      const d = r.foto && S.fotos[r.foto];
      if (d) zip.file(nomeFoto(r, i), d.split(',')[1], {base64: true});
    });
    if (!S.croqui) S.croqui = await geraCroqui();
    if (S.croqui && S.croqui.url)
      zip.file('05-croqui.png', S.croqui.url.split(',')[1], {base64: true});
    const blob = await zip.generateAsync({type: 'blob', compression: 'DEFLATE'});
    baixa(blob, `cde-${seguro(S.contrato || S.obra || S.eixo.nome)}-`
      + new Date().toISOString().slice(0, 10) + '.zip');
  } catch (e){
    alert('Não foi possível montar o pacote: ' + e.message);
  } finally {
    if (bt){ bt.textContent = antes; bt.disabled = false; }
  }
}

/** Reabre um projeto de dentro de um pacote CDE. */
async function abrePacoteCDE(file){
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const alvo = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('projeto.json'));
  if (!alvo) throw new Error('o pacote não tem projeto.json — não dá para reabrir.');
  return JSON.parse(await zip.files[alvo].async('string'));
}
