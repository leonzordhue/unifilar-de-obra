/* Mapa Leaflet: camadas de fundo e desenho do eixo por quilometro. */
/* ---------------------------------------------------------------- mapa */
// Fundo de satélite: Esri World Imagery. Os tiles do Google não têm API pública para uso
// em aplicação própria e o acesso direto contraria os termos de uso; o Esri World Imagery
// tem resolução equivalente na Amazônia e uso permitido com atribuição.
const TILE_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATRIB_SAT = 'Imagem: Esri World Imagery · Maxar, Earthstar Geographics';
function iniMapa(){
  S.mapa = L.map('mapa', {preferCanvas: true}).setView([-3.4, -62.5], 6);
  const sat = L.tileLayer(TILE_SAT, {maxZoom: 19, attribution: ATRIB_SAT});
  const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom: 19, attribution: '© OpenStreetMap'});
  sat.addTo(S.mapa);
  L.control.layers({'Satélite': sat, 'Ruas': ruas}, null, {position: 'topright'}).addTo(S.mapa);
  S.camadas = L.layerGroup().addTo(S.mapa);
  ctrlCriterio();
}
// Sobreposição, e não continência: o quilômetro entra no trecho se qualquer parte dele
// está dentro. Exigir o quilômetro inteiro fazia quem digita KM 12,5–18,3 perder as duas
// pontas da obra — 5 km medidos onde havia 5,8, e as pontas sem poder receber lançamento.
// Com trecho em número inteiro o resultado é o mesmo de antes.
const dentroTrecho = sg => sg.fim > S.kmIni + 1e-9 && sg.ini < S.kmFim - 1e-9;
// Quanto do quilômetro está DENTRO do trecho. É esta a extensão que se mede e se fatura:
// no segmento 12–13 de um trecho que começa em 12,5, meio quilômetro é obra e meio não é.
const kmNoTrecho = sg => Math.max(0, Math.min(sg.fim, S.kmFim) - Math.max(sg.ini, S.kmIni));
function pctSeg(id){
  const linhas = linhasMatriz();
  if (!linhas.length) return null;
  let c = 0, val = 0;
  linhas.forEach(l => {
    const v = S.dados[chave(l, id)];
    if (v === 'NA') return;
    val++; if (v === 'C') c++;
  });
  return val ? c / val : null;
}
const corPct = p => p === null ? '#8E9AA6' : (p >= 0.999 ? '#2E9E5B' : (p > 0 ? '#F0A32B' : '#4A7FB5'));

/* ------------------------------------------------- critério de cor do eixo */
// O mesmo traçado responde a perguntas diferentes: onde está cada frente de trabalho, quanto
// já se executou, o que passou no ensaio e onde ainda falta ensaiar. Trocar de critério é
// trocar de pergunta — e o semáforo é o `corConformidade()` da plataforma inteira, para que
// verde no mapa e verde no painel queiram dizer a mesma coisa.
const CRITERIOS = [
  {id: 'servico',      nome: 'Serviço lançado'},
  {id: 'avanco',       nome: 'Avanço físico'},
  {id: 'conformidade', nome: 'Conformidade dos ensaios'},
  {id: 'ensaios',      nome: 'Ensaios executados'}
];
let criterioMapa = 'servico';

/** Valor do critério naquele quilômetro. `null` é ausência de base — nunca zero. */
function valorCriterio(id){
  if (criterioMapa === 'avanco') return pctSeg(id);
  if (typeof resumoEnsaios !== 'function') return null;
  const r = resumoEnsaios([id]);
  return criterioMapa === 'conformidade' ? r.pctConformidade : r.pctExecutado;
}
function corCriterio(sg, dentro){
  if (!dentro) return '#B8C2CC';
  if (criterioMapa === 'servico'){
    const svcs = typeof servicosNoSeg === 'function' ? servicosNoSeg(sg.id) : [];
    return svcs.length ? svcs[0].cor : corPct(pctSeg(sg.id));
  }
  return typeof corConformidade === 'function'
    ? corConformidade(valorCriterio(sg.id)) : corPct(valorCriterio(sg.id));
}
function textoCriterio(sg){
  if (criterioMapa === 'servico') return '';
  const v = valorCriterio(sg.id);
  const rot = (CRITERIOS.find(c => c.id === criterioMapa) || {}).nome;
  // «Sem base» não é «zero»: quilômetro que ninguém mandou ensaiar não pode aparecer como
  // reprovado, e é por isso que o texto diz o motivo em vez de mostrar 0%.
  return `<br>${rot}: ` + (v == null
    ? (criterioMapa === 'avanco' ? 'sem serviço marcado' : 'sem base para calcular')
    : `<b>${fmt(v * 100, 1)}%</b>`);
}
function ctrlCriterio(){
  const c = L.control({position: 'topleft'});
  c.onAdd = () => {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    d.style.cssText = 'background:#fff;padding:3px 6px;font:12px system-ui;line-height:1.4;'
      + 'border-radius:6px';
    // Compacto de propósito: é um seletor de leitura do mapa, não um painel. Ocupava um
    // retângulo com título e legenda permanentes em cima do traçado — que é o que a pessoa
    // veio ver. A legenda só aparece quando há semáforo para explicar.
    d.innerHTML = `<select id="selCrit" title="Critério de cor do eixo"
        style="font:12px system-ui;max-width:190px;border:0;background:transparent">${
          CRITERIOS.map(x => `<option value="${x.id}">${x.nome}</option>`).join('')}</select>`
      + '<div id="legCrit" style="margin-top:4px"></div>';
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  c.addTo(S.mapa);
  const sel = document.querySelector('#selCrit');
  sel.value = criterioMapa;
  sel.onchange = () => { criterioMapa = sel.value; desenhaMapa(); };
}
function pintaLegendaCrit(){
  const alvo = document.querySelector('#legCrit');
  if (!alvo) return;
  if (criterioMapa === 'servico'){
    alvo.innerHTML = '';          // a cor do serviço já tem legenda na faixa, logo abaixo
    return;
  }
  const cor = v => typeof corConformidade === 'function' ? corConformidade(v) : corPct(v);
  const bolha = (v, t) => `<span style="display:inline-flex;align-items:center;gap:4px;
    margin-right:7px"><i style="width:10px;height:10px;border-radius:50%;background:${cor(v)};
    display:inline-block"></i>${t}</span>`;
  alvo.innerHTML = bolha(1, '≥95%') + bolha(0.9, '≥85%') + bolha(0.8, '≥70%') + bolha(0.2, '<70%')
    + '<br>' + bolha(null, 'sem base');
}
function desenhaMapa(){
  if (!S.mapa) iniMapa();
  S.camadas.clearLayers();
  if (!S.eixo) return;
  const todos = [];
  S.segs.forEach(sg => {
    const latlng = sg.pts.map(p => [p[1], p[0]]);
    todos.push.apply(todos, latlng);
    const dentro = dentroTrecho(sg);
    const p = dentro ? pctSeg(sg.id) : null;
    // Cor do SERVIÇO lançado, a mesma da faixa unifilar: é assim que o usuário reconhece,
    // no mapa, onde está cada frente de trabalho. Sem lançamento, o avanço do quilômetro.
    const svcs = typeof servicosNoSeg === 'function' ? servicosNoSeg(sg.id) : [];
    const sel = S.sel && S.sel.has(sg.id);
    const ln = L.polyline(latlng, {
      color: corCriterio(sg, dentro),
      weight: sel ? 10 : (dentro ? 6 : 3), opacity: dentro ? .92 : .6
    }).addTo(S.camadas);
    if (sel) L.polyline(latlng, {color: '#16324F', weight: 2, opacity: 1, dashArray: '4 4'})
      .addTo(S.camadas);
    ln.bindTooltip(`${rotuloSeg(sg)} · ${fmt(sg.ext, 3)} km`
      + (svcs.length ? '<br>' + svcs.map(s => esc(s.svc) + ' — '
          + s.status.map(nomeStatus).join(' / ')).join('<br>')
        : p === null ? '' : ` · ${fmt(p * 100, 0)}% concluído`)
      + textoCriterio(sg), {sticky: true});
    // Clicar no mapa seleciona o quilômetro, como na faixa: é o mesmo gesto, no outro
    // desenho do mesmo eixo.
    ln.on('click', () => {
      if (!S.sel) S.sel = new Set();
      if (S.sel.has(sg.id)) S.sel.delete(sg.id); else S.sel.add(sg.id);
      pintaFaixa();
    });
    ln.on('dblclick', () => abreFicha(sg.id));
  });
  // O enquadramento só se refaz quando o eixo muda: reenquadrar a cada lançamento tira o
  // mapa do lugar onde o usuário estava trabalhando.
  pintaLegendaCrit();
  if (todos.length && S.enquadrado !== S.eixo){
    S.mapa.fitBounds(L.latLngBounds(todos), {padding: [24, 24]});
    S.enquadrado = S.eixo;
  }
}
