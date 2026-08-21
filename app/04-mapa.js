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
}
const dentroTrecho = sg => sg.ini >= S.kmIni - 1e-9 && sg.fim <= S.kmFim + 1e-9;
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
    const ln = L.polyline(latlng, {
      color: dentro ? corPct(p) : '#B8C2CC',
      weight: dentro ? 6 : 3, opacity: dentro ? .92 : .6
    }).addTo(S.camadas);
    ln.bindTooltip(`${rotuloSeg(sg)} · ${fmt(sg.ext, 3)} km`
      + (p === null ? '' : ` · ${fmt(p * 100, 0)}% concluído`), {sticky: true});
    ln.on('click', () => { mostra('matriz'); setTimeout(() => marcaColuna(sg.id), 80); });
  });
  if (todos.length) S.mapa.fitBounds(L.latLngBounds(todos), {padding: [24, 24]});
}
