/* Croqui: composicao do tracado sobre imagem de satelite em canvas. */
/* ---------------------------------------------------------------- croqui
   Imagem do traçado sobre o satélite, montada em canvas.

   Por que em canvas e não uma captura do mapa: a imagem precisa entrar no relatório e ser
   baixada como arquivo, e capturar a tela do Leaflet dependeria de biblioteca extra e de os
   tiles permitirem leitura pelo canvas. Aqui os tiles são buscados com `crossOrigin`, o
   traçado é projetado por conta própria em Web Mercator e a composição fica sob controle:
   escala, marcação de quilômetro e legenda entram no mesmo desenho.

   Se o tile não vier — sem internet, ou bloqueado —, a imagem sai com fundo neutro em vez
   de falhar: o croqui perde a foto, não o traçado. */
const TAM_TILE = 256;
const lon2x = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
const lat2y = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
};
const x2lon = x => x * 360 - 180;
const y2lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
// Faixa de proporção aceitável para a imagem. Fora dela o recorte é alargado no eixo que
// falta — nunca comprimido: comprimir mentiria sobre a escala.
const PROP_MIN = 1.15, PROP_MAX = 2.60;
function ajustaProporcao(lo1, la1, lo2, la2){
  let x1 = lon2x(lo1, 0), x2 = lon2x(lo2, 0);
  let y1 = lat2y(la2, 0), y2 = lat2y(la1, 0);        // y cresce para o sul
  const larga = f => { const c = (x1 + x2) / 2, m = (y2 - y1) * f / 2; x1 = c - m; x2 = c + m; };
  const alta = f => { const c = (y1 + y2) / 2, m = (x2 - x1) / f / 2; y1 = c - m; y2 = c + m; };
  const p = (x2 - x1) / (y2 - y1);
  if (p < PROP_MIN) larga(PROP_MIN);
  else if (p > PROP_MAX) alta(PROP_MAX);
  return [x2lon(x1), y2lat(y2), x2lon(x2), y2lat(y1)];
}
function carregaTile(url){
  return new Promise(res => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}
async function geraCroqui(largura = 1500, altura = 900){
  if (!S.eixo || !S.segs.length) return null;
  // enquadra o trecho em obra; se nenhum estiver definido, o eixo inteiro
  const noTrecho = S.segs.filter(dentroTrecho);
  const enquadra = noTrecho.length ? noTrecho : S.segs;
  let lo1 = 180, lo2 = -180, la1 = 90, la2 = -90;
  enquadra.forEach(sg => sg.pts.forEach(p => {
    lo1 = Math.min(lo1, p[0]); lo2 = Math.max(lo2, p[0]);
    la1 = Math.min(la1, p[1]); la2 = Math.max(la2, p[1]);
  }));
  const mg = 0.10;                                  // folga de 10% no enquadramento
  const dl = (lo2 - lo1) || 0.01, dla = (la2 - la1) || 0.01;
  lo1 -= dl * mg; lo2 += dl * mg; la1 -= dla * mg; la2 += dla * mg;
  [lo1, la1, lo2, la2] = ajustaProporcao(lo1, la1, lo2, la2);

  // maior zoom cujo recorte ainda cabe na imagem pedida
  let z = 18;
  for (; z > 2; z--){
    const w = (lon2x(lo2, z) - lon2x(lo1, z)) * TAM_TILE;
    const h = (lat2y(la1, z) - lat2y(la2, z)) * TAM_TILE;
    if (w <= largura && h <= altura) break;
  }
  const px0 = lon2x(lo1, z) * TAM_TILE, py0 = lat2y(la2, z) * TAM_TILE;
  const lp = (lon2x(lo2, z) - lon2x(lo1, z)) * TAM_TILE;
  const ap = (lat2y(la1, z) - lat2y(la2, z)) * TAM_TILE;
  const W = Math.max(320, Math.round(lp)), H = Math.max(240, Math.round(ap)) + 46;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#1B2A38'; g.fillRect(0, 0, W, H);

  // tiles do recorte
  const tx1 = Math.floor(px0 / TAM_TILE), tx2 = Math.floor((px0 + lp) / TAM_TILE);
  const ty1 = Math.floor(py0 / TAM_TILE), ty2 = Math.floor((py0 + ap) / TAM_TILE);
  const nTiles = (tx2 - tx1 + 1) * (ty2 - ty1 + 1);
  let vieram = 0;
  if (nTiles <= 240){
    const pedidos = [];
    for (let tx = tx1; tx <= tx2; tx++)
      for (let ty = ty1; ty <= ty2; ty++)
        pedidos.push({tx, ty, url: TILE_SAT.replace('{z}', z).replace('{y}', ty).replace('{x}', tx)});
    const imgs = await Promise.all(pedidos.map(t => carregaTile(t.url)));
    imgs.forEach((im, i) => {
      if (!im) return;
      vieram++;
      const t = pedidos[i];
      g.drawImage(im, Math.round(t.tx * TAM_TILE - px0), Math.round(t.ty * TAM_TILE - py0),
                  TAM_TILE, TAM_TILE);
    });
  }
  const proj = p => [lon2x(p[0], z) * TAM_TILE - px0, lat2y(p[1], z) * TAM_TILE - py0];

  // traçado: contorno escuro por baixo, cor do estado por cima
  const desenha = (larg, cor, filtro) => {
    S.segs.forEach(sg => {
      if (filtro && !filtro(sg)) return;
      g.beginPath();
      sg.pts.forEach((p, i) => {
        const q = proj(p);
        i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]);
      });
      g.lineWidth = larg; g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = typeof cor === 'function' ? cor(sg) : cor;
      g.stroke();
    });
  };
  // fora do trecho: linha fina e clara, só para dar contexto de onde a obra está no eixo
  desenha(5, 'rgba(0,0,0,.40)', sg => !dentroTrecho(sg));
  desenha(2.4, 'rgba(255,255,255,.62)', sg => !dentroTrecho(sg));
  desenha(9, 'rgba(0,0,0,.60)', dentroTrecho);
  // Mesmo critério de cor do mapa: escolher «Conformidade» na tela e imprimir um croqui
  // pintado por avanço seria a plataforma se contradizer dentro do mesmo relatório.
  desenha(5, sg => typeof corCriterio === 'function' ? corCriterio(sg, true)
                 : corPct(pctSeg(sg.id)), dentroTrecho);

  const yb = H - 46;                       // topo da faixa de rodapé
  // marcação de quilômetro: ponto e rótulo a cada 10 km e nas pontas
  g.font = '600 11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  // o passo acompanha o que está enquadrado: num trecho de 27 km, marcar de 20 em 20 km
  // deixaria dois rótulos na imagem inteira
  const n = enquadra.length;
  const passo = n > 160 ? 20 : (n > 80 ? 10 : (n > 30 ? 5 : (n > 12 ? 2 : 1)));
  S.segs.forEach((sg, i) => {
    const pontaEixo = i === 0 || i === S.segs.length - 1;
    const pontaTrecho = enquadra.length && (sg === enquadra[0] || sg === enquadra[n - 1]);
    const marcar = pontaEixo || pontaTrecho || (dentroTrecho(sg) && Math.round(sg.ini) % passo === 0);
    if (!marcar) return;
    const q = proj(sg.pts[0]);
    g.beginPath(); g.arc(q[0], q[1], 3.6, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = '#16324F'; g.stroke();
    const rot = S.ref === 'est' ? 'E ' + fmt(estacaDe(sg.ini), 0) : 'km ' + fmt(sg.ini, 0);
    const w = g.measureText(rot).width + 8;
    // à direita não cabe? o rótulo vai para a esquerda do ponto; e o y é preso à moldura
    const dir = q[0] + 6 + w <= W - 6;
    const rx = dir ? q[0] + 6 : q[0] - 6 - w;
    const ry = Math.min(Math.max(q[1], 10), yb - 10);
    g.fillStyle = 'rgba(22,50,79,.86)';
    g.fillRect(Math.max(2, rx), ry - 8, w, 16);
    g.fillStyle = '#fff';
    g.fillText(rot, Math.max(2, rx) + 4, ry);
  });

  // o resumo entra DEPOIS dos marcos de quilômetro, senão eles passam por cima
  desenhaResumoCroqui(g, W, yb);

  // faixa de rodapé: identificação, escala e crédito
  g.fillStyle = 'rgba(22,50,79,.94)'; g.fillRect(0, yb, W, 46);
  g.fillStyle = '#fff'; g.font = '700 13px system-ui, sans-serif';
  g.fillText((S.obra || S.eixo.nome).slice(0, 92), 12, yb + 15);
  g.font = '400 11px system-ui, sans-serif'; g.fillStyle = '#CFE0F2';
  const kmTot = S.segs.reduce((a, x) => a + x.ext, 0);
  // O critério de cor entra na própria legenda: numa segunda linha, ele caía por cima
  // desta. Quem lê o croqui impresso precisa saber o que a cor significa.
  const crit = typeof CRITERIOS !== 'undefined'
    ? (CRITERIOS.find(c => c.id === criterioMapa) || {}).nome : '';
  const cred = vieram ? ATRIB_SAT : 'imagem de satélite indisponível — traçado sobre fundo neutro';
  // As duas legendas dividem a mesma linha; a da esquerda é aparada pelo que sobra, porque
  // numa imagem estreita ela avançava por cima do crédito da imagem.
  const espaco = W - 24 - g.measureText(cred).width - 14;
  const base = `${S.eixo.nome} · ${fmt(kmTot, 1)} km · trecho em obra km ${fmt(S.kmIni, 0)} a `
    + `${fmt(S.kmFim, 0)} · ${new Date().toLocaleDateString('pt-BR')}`;
  // Numa imagem estreita, o critério sai inteiro em vez de sair cortado no meio da palavra:
  // identificação do eixo e do trecho é o que não pode faltar.
  let leg = base + (crit ? ` · cor: ${crit.toLowerCase()}` : '');
  if (g.measureText(leg).width > espaco) leg = base;
  while (leg.length > 12 && g.measureText(leg + '…').width > espaco) leg = leg.slice(0, -2);
  if (leg !== base && leg !== base + (crit ? ` · cor: ${crit.toLowerCase()}` : '')) leg += '…';
  g.fillText(leg, 12, yb + 32);
  g.textAlign = 'right';
  g.fillText(cred, W - 12, yb + 32);
  g.fillText('SEINFRA/AM — Departamento de Mobilidade', W - 12, yb + 15);
  g.textAlign = 'left';

  // escala gráfica
  const mPorPx = 156543.03392 * Math.cos((la1 + la2) / 2 * Math.PI / 180) / Math.pow(2, z);
  const alvoPx = 130;
  const opcoes = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  let escKm = opcoes.find(v => v * 1000 / mPorPx >= alvoPx) || 500;
  const escPx = escKm * 1000 / mPorPx;
  const x0 = 12, y0 = yb - 16;
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x0 - 4, y0 - 13, escPx + 46, 22);
  g.strokeStyle = '#16324F'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + escPx, y0);
  g.moveTo(x0, y0 - 4); g.lineTo(x0, y0 + 4);
  g.moveTo(x0 + escPx, y0 - 4); g.lineTo(x0 + escPx, y0 + 4); g.stroke();
  g.fillStyle = '#16324F'; g.font = '600 11px system-ui, sans-serif';
  g.fillText(`${escKm} km`, x0 + escPx + 6, y0);

  return {url: cv.toDataURL('image/png'), largura: W, altura: H, zoom: z,
          tiles: vieram, tilesPedidos: nTiles};
}
async function pintaCroqui(){
  const alvo = $('#vCroqui');
  if (!S.eixo){
    alvo.innerHTML = '<div class="aviso"><b>Nada a desenhar.</b> Escolha um eixo na lateral.</div>';
    return;
  }
  if (!S.croqui){
    alvo.innerHTML = '<div class="croqui"><div class="st">montando a imagem do traçado…</div></div>';
    S.croqui = await geraCroqui();
  }
  const c = S.croqui;
  if (!c){ alvo.innerHTML = '<div class="aviso">Não foi possível montar a imagem.</div>'; return; }
  alvo.innerHTML = `<div class="croqui"><div class="cx">
      <div class="barraf">
        <button class="mini" id="btCroquiRef">Atualizar imagem</button>
        <button class="mini" id="btCroquiBaixa">Baixar PNG</button>
        <span class="st">${c.largura} × ${c.altura} px · nível de zoom ${c.zoom} · ${
          c.tiles ? c.tiles + ' de ' + c.tilesPedidos + ' quadros de imagem'
                  : 'sem imagem de satélite (offline)'}</span>
      </div>
      <img src="${c.url}" alt="Croqui do traçado">
    </div></div>`;
  $('#btCroquiRef').onclick = async () => { S.croqui = null; await pintaCroqui(); };
  $('#btCroquiBaixa').onclick = () => {
    const a = document.createElement('a');
    a.href = c.url;
    a.download = `croqui-${(S.obra || S.eixo.nome).replace(/[^\w\-]+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  };
}


/* ---------------------------------------------------------------- resumo no croqui */
/** Tabela de resumo por serviço, desenhada no próprio croqui.

    A imagem circula sozinha — colada num ofício, impressa, mandada por aplicativo. Sem o
    resumo ela diz onde é a obra e não diz como ela está.

    A forma é a da planilha do escritório: número em coluna, com a célula pintada na cor da
    situação. A primeira versão usava barra empilhada e ficava ilegível — serviço presente em
    um quinto dos quilômetros dava um risco de três pixels.

    Só entra quando cabe. Numa imagem estreita cobriria o traçado, e o croqui perderia a
    função de situar a pessoa no local. */
function desenhaResumoCroqui(g, W, yb){
  if (typeof quadroObra !== 'function') return;
  const q = quadroObra().filter(x => x.C + x.E + x.PA + x.S > 0.001)
    .sort((a, b) => b.C - a.C);
  if (!q.length) return;
  const COL = [
    {cod: 'C',  rot: 'Concl.', k: 'C'},
    {cod: 'E',  rot: 'Em and.', k: 'E'},
    {cod: 'PA', rot: 'Paral.', k: 'PA'},
    {cod: '',   rot: 'Prev.', k: 'P'}
  ];
  const LSVC = 132, LCOL = 44, LPCT = 40, LARG = LSVC + COL.length * LCOL + LPCT + 20;
  const LINHA = 15, CAB = 30;
  const cabem = Math.max(0, Math.floor((yb - 26 - CAB - LINHA) / LINHA));
  if (W < 560 || cabem < 3) return;
  const mostra = q.slice(0, Math.min(cabem, 10));
  const resto = q.length - mostra.length;
  const alt = CAB + (mostra.length + 1) * LINHA + (resto ? LINHA : 0) + 6;
  const x0 = W - LARG - 12, y0 = yb - alt - 12;

  g.save();
  g.fillStyle = 'rgba(255,255,255,.95)';
  g.strokeStyle = 'rgba(22,50,79,.6)';
  g.lineWidth = 1;
  g.beginPath(); g.rect(x0, y0, LARG, alt); g.fill(); g.stroke();

  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = '#16324F';
  g.font = '700 10.5px system-ui, sans-serif';
  g.fillText('RESUMO POR SERVIÇO — QUILÔMETRO', x0 + 8, y0 + 11);

  // cabeçalho das colunas, pintado como na planilha
  const yc = y0 + CAB - 8;
  g.font = '600 9px system-ui, sans-serif';
  COL.forEach((c, k) => {
    const x = x0 + 8 + LSVC + k * LCOL;
    if (c.cod){
      g.fillStyle = corStatus(c.cod);
      g.fillRect(x, yc - 6, LCOL - 2, 12);
      g.fillStyle = txtStatus(c.cod);
    } else {
      g.fillStyle = '#5A6B7B';
    }
    g.textAlign = 'center';
    g.fillText(c.rot, x + (LCOL - 2) / 2, yc);
  });
  // A planilha do escritório mede porcentagem sobre o CONTRATADO. Com espaço para uma
  // coluna só, é essa que aparece — e o cabeçalho diz qual das duas está na tela, senão o
  // número fica ambíguo entre «andou do trecho» e «falta entregar».
  const usaContrato = q.some(x => x.contratado);
  g.textAlign = 'right';
  g.fillStyle = '#5A6B7B';
  g.fillText(usaContrato ? '% contr.' : '% trecho', x0 + LARG - 10, yc);

  const num = v => v > 0.001 ? fmt(v, v < 10 ? 1 : 0) : '';
  mostra.forEach((x, i) => {
    const y = y0 + CAB + i * LINHA + LINHA / 2;
    g.textAlign = 'left';
    g.fillStyle = '#1F2933';
    g.font = '9.5px system-ui, sans-serif';
    let nome = x.svc;
    while (nome.length > 4 && g.measureText(nome).width > LSVC - 6) nome = nome.slice(0, -2);
    if (nome !== x.svc) nome = nome.slice(0, -1) + '…';
    g.fillText(nome, x0 + 8, y);
    COL.forEach((c, k) => {
      const xx = x0 + 8 + LSVC + k * LCOL, v = x[c.k];
      if (v > 0.001 && c.cod){
        g.fillStyle = corStatus(c.cod);
        g.fillRect(xx, y - 6, LCOL - 2, 12);
        g.fillStyle = txtStatus(c.cod);
      } else {
        g.fillStyle = '#5A6B7B';
      }
      g.textAlign = 'center';
      g.font = '9.5px system-ui, sans-serif';
      g.fillText(num(v), xx + (LCOL - 2) / 2, y);
    });
    g.textAlign = 'right';
    g.fillStyle = '#16324F';
    g.font = '600 9.5px system-ui, sans-serif';
    const pv = usaContrato ? x.pctContrato : x.pctTrecho;
    if (x.excedeContrato) g.fillStyle = '#B0413E';
    g.fillText(pv == null ? '—' : fmt(100 * pv, 0) + '%', x0 + LARG - 10, y);
    g.fillStyle = '#16324F';
  });

  // linha de total, como na planilha
  const yt = y0 + CAB + mostra.length * LINHA + LINHA / 2;
  const soma = k => q.reduce((a, x) => a + x[k], 0);
  const totTrecho = q.reduce((a, x) => a + x.kmTrecho, 0);
  g.strokeStyle = 'rgba(22,50,79,.3)';
  g.beginPath(); g.moveTo(x0 + 6, yt - 8); g.lineTo(x0 + LARG - 6, yt - 8); g.stroke();
  g.textAlign = 'left';
  g.fillStyle = '#16324F';
  g.font = '700 9.5px system-ui, sans-serif';
  g.fillText('TOTAL', x0 + 8, yt);
  COL.forEach((c, k) => {
    g.textAlign = 'center';
    g.fillText(num(soma(c.k)), x0 + 8 + LSVC + k * LCOL + (LCOL - 2) / 2, yt);
  });
  g.textAlign = 'right';
  const totCt = q.reduce((a, x) => a + (x.contratado || 0), 0);
  const den = usaContrato ? totCt : totTrecho;
  g.fillText(den > 0 ? fmt(100 * soma('C') / den, 0) + '%' : '—', x0 + LARG - 10, yt);

  if (resto){
    const y = yt + LINHA;
    g.textAlign = 'left';
    g.fillStyle = '#5A6B7B';
    g.font = 'italic 9px system-ui, sans-serif';
    g.fillText(`e mais ${resto} serviço(s) — ver o relatório`, x0 + 8, y);
  }
  g.restore();
}
