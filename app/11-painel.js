/* Painel de conformidade: cartoes, tabela por faixa de quilometros e grafico por tipo de
   controle.

   Este modulo NAO calcula conformidade: pede a `resumoEnsaios` e `resumoPorGrupo`
   (app/10-ensaios.js, contrato do COORDENACAO.md item 4). Dois calculos do mesmo numero em
   telas diferentes e defeito, nao redundancia.

   Regra que atravessa o arquivo inteiro: percentual `null` e AUSENCIA DE BASE, e nao zero
   por cento. Quilometro que ninguem mandou ensaiar sai cinza e escrito «sem base» — pintar
   de vermelho o que nao foi pedido e informacao falsa dentro de fiscalizacao de contrato. */

registraAba({id: 'painel', titulo: 'Painel', ordem: 15, pinta: () => pintaPainel()});

const FAIXAS_KM = [1, 5, 10, 20];
let faixaKm = 10;

/* ---------------------------------------------------------------- agregação */
/** Divide os quilometros do trecho em obra em blocos de `km`, na ordem do eixo. */
function faixasPainel(km){
  const segs = segsNoTrecho();
  if (!segs.length) return [];
  const out = [];
  let atual = null;
  segs.forEach(sg => {
    const bloco = Math.floor(sg.ini / km);
    if (!atual || atual.bloco !== bloco){
      atual = {bloco, ini: sg.ini, fim: sg.fim, ids: [], ext: 0};
      out.push(atual);
    }
    atual.fim = sg.fim;
    atual.ids.push(sg.id);
    atual.ext += sg.ext;
  });
  return out;
}

/** Avanço físico dos serviços nestes quilômetros: só «Concluído» conta, «N/A» sai do
    denominador — a mesma conta do `resumoLinha`, aplicada a um recorte de segmentos.

    Ponderado por EXTENSÃO, não por contagem de célula: o último segmento do eixo pode ter
    0,4 km e não pode pesar como um quilômetro inteiro. Usa `kmNoTrecho`, que também recorta
    o segmento parcial nas pontas do trecho em obra — a mesma base do resumo e do relatório,
    para a plataforma não apresentar dois avanços diferentes da mesma obra. */
function avancoEm(ids){
  const set = new Set(ids), r = {C: 0, val: 0, kmC: 0, kmVal: 0};
  const segs = S.segs.filter(sg => set.has(sg.id));
  linhasMatriz().forEach(l => segs.forEach(sg => {
    const v = S.dados[chave(l, sg.id)] || '';
    if (v === 'NA') return;
    const km = kmNoTrecho(sg);
    r.val++; r.kmVal += km;
    if (v === 'C'){ r.C++; r.kmC += km; }
  }));
  r.pct = r.kmVal > 0 ? r.kmC / r.kmVal : null;
  return r;
}

const pct = v => v == null ? '—' : fmt(v * 100, 1) + '%';
const semaforo = v =>
  `<span title="${v == null ? 'sem base para calcular' : pct(v)}" style="display:inline-block;
    width:12px;height:12px;border-radius:50%;background:${corConformidade(v)}"></span>`;

/** Não conformidades ainda sem reensaio conforme no mesmo quilômetro e mesmo ensaio.

    «Posterior» é por data e, na mesma data, pela ordem de lançamento (o `id` é sequencial).
    Sem o desempate, um ensaio conforme lançado ANTES da reprovação fecharia a não
    conformidade que veio depois dele — bastaria ter passado uma vez no mesmo dia para o
    quilômetro parecer regularizado. */
const seqReg = r => +String(r.id || '').replace(/\D/g, '') || 0;
const depoisDe = (o, r) => (o.data || '') > (r.data || '')
  || ((o.data || '') === (r.data || '') && seqReg(o) > seqReg(r));
function naoConformidadesAbertas(ids){
  const set = new Set(ids);
  const regs = S.reg.filter(r => set.has(r.seg));
  return regs.filter(r => {
    if (conforme(r) !== false) return false;
    return !regs.some(o => o.seg === r.seg && o.cod === r.cod && conforme(o) === true
                           && depoisDe(o, r));
  });
}

/* ---------------------------------------------------------------- pintura */
function pintaPainel(){
  const alvo = $('#vPainel');
  if (!alvo) return;
  if (!S.eixo){
    alvo.innerHTML = '<div class="aviso"><b>Nada a exibir.</b> Escolha um eixo na lateral.</div>';
    return;
  }
  const segs = segsNoTrecho(), ids = segs.map(s => s.id);
  // recortada: o quilômetro da ponta entra pelo pedaço que está no trecho
  const kmTr = segs.reduce((a, s) => a + kmNoTrecho(s), 0);
  const av = avancoEm(ids), en = resumoEnsaios(ids), abertas = naoConformidadesAbertas(ids);
  const semCatalogo = !catalogoEnsaios().length;

  alvo.innerHTML = `
    <div class="cards">
      ${card('Avanço físico', pct(av.pct),
             `${av.C} de ${av.val} posições · ponderado por extensão · ${fmt(kmTr, 1)} km`)}
      ${card('Conformidade', pct(en.pctConformidade),
             en.pctConformidade == null ? 'nenhum ensaio com critério julgado'
               : `${en.conformes} conforme(s) de ${en.conformes + en.naoConformes} julgado(s)`)}
      ${card('Ensaios executados', en.previstos == null ? String(en.executados) : pct(en.pctExecutado),
             en.previstos == null
               ? `${en.executados} lançado(s) · sem frequência no catálogo para prever`
               : `${en.executados} de ${fmt(en.previstos, 0)} previstos`)}
      ${card('Não conformidades', abertas.length,
             abertas.length ? 'em aberto, sem reensaio conforme' : 'nenhuma em aberto')}
    </div>
    ${semCatalogo ? `<div class="aviso" style="margin:0 14px 12px"><b>Nenhum ensaio
      contratado.</b> Marque os ensaios na lateral: sem eles o painel mostra avanço de
      serviço, mas não tem base para calcular conformidade nem previsão.</div>` : ''}
    ${en.previstos == null && !semCatalogo ? `<div class="dica" style="margin:0 14px 12px">Os
      ensaios contratados não têm frequência (<code>por_km</code>) preenchida no catálogo:
      o percentual de execução fica sem base e aparece como «—». Não é zero por cento.</div>` : ''}
    ${en.semCriterio ? `<div class="dica" style="margin:0 14px 12px">${en.semCriterio}
      registro(s) sem critério numérico não entram na conformidade — ficam declarados como
      «sem critério» na ficha do quilômetro.</div>` : ''}

    ${typeof tabelaQuadroObra === 'function' && tabelaQuadroObra()
      ? `<div style="padding:0 14px 16px">
          <div class="grEns" style="margin-top:0">Quadro da obra — por serviço, em quilômetro</div>
          ${tabelaQuadroObra()}</div>`
      : ''}
    <div style="padding:0 14px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="rot" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em">
        Faixa da tabela</span>
      ${FAIXAS_KM.map(k => `<button class="mini${k === faixaKm ? ' on' : ''}"
        data-faixa="${k}" style="${k === faixaKm ? 'font-weight:700' : ''}">${k} km</button>`).join('')}
    </div>
    ${tabelaFaixas()}
    ${graficoContrato()}
    ${graficoGrupos(ids)}`;

  $$('#vPainel button[data-faixa]').forEach(b => b.onclick = () => {
    faixaKm = +b.dataset.faixa;
    pintaPainel();
  });
}

function tabelaFaixas(){
  const fs = faixasPainel(faixaKm);
  if (!fs.length) return '<div class="aviso" style="margin:0 14px">Nenhum quilômetro no trecho em obra.</div>';
  return `<div style="padding:0 14px 16px"><table class="res">
    <thead><tr>
      <th>Faixa</th><th>Extensão</th><th>Avanço</th><th>Ensaios</th><th>Previstos</th>
      <th>% exec.</th><th>Conformes</th><th>Não conf.</th><th>Conformidade</th><th></th>
    </tr></thead><tbody>${fs.map(f => {
      const av = avancoEm(f.ids), en = resumoEnsaios(f.ids);
      return `<tr>
        <td><b>KM ${fmt(f.ini, 0)} – ${fmt(f.fim, 0)}</b></td>
        <td>${fmt(f.ext, 3)} km</td>
        <td>${pct(av.pct)}</td>
        <td>${en.executados}</td>
        <td>${en.previstos == null ? '—' : fmt(en.previstos, 0)}</td>
        <td>${pct(en.pctExecutado)}</td>
        <td>${en.conformes}</td>
        <td${en.naoConformes ? ' style="color:#D9534F;font-weight:700"' : ''}>${en.naoConformes}</td>
        <td><b>${pct(en.pctConformidade)}</b></td>
        <td>${semaforo(en.pctConformidade)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- gráfico */
/** Barras por tipo de controle, em SVG escrito à mão — sem biblioteca de gráfico: a
    plataforma serve tudo da própria pasta e abre sem internet. */
/** Avanço por serviço contra o contratado, quando a quantidade contratada foi informada.
    `pctContrato` vem de `quadroObra()` e é `null` quando ninguém informou o contratado —
    nesse caso o serviço simplesmente não entra neste gráfico, em vez de aparecer zerado. */
function graficoContrato(){
  if (typeof quadroObra !== 'function') return '';
  const q = quadroObra().filter(x => x.pctContrato != null);
  if (!q.length) return '';
  const L = 200, W = 620, H = 22, GAP = 8, TOPO = 34;
  const larg = W - L - 92;
  const alt = TOPO + q.length * (H + GAP) + 14;
  const barras = q.map((x, i) => {
    const y = TOPO + i * (H + GAP);
    const p = Math.max(0, Math.min(1, x.pctContrato));
    // acima de 100% do contratado a barra satura, e o número ao lado conta a verdade: o
    // escritório reporta execução além da quantidade contratada, e esconder isso seria
    // apagar justamente o que precisa de aditivo ou de explicação na medição.
    return `
      <text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="11" fill="#3A4A5A">${esc(x.svc)}</text>
      <rect x="${L}" y="${y}" width="${larg}" height="${H}" rx="3" fill="#EEF2F6"/>
      <rect x="${L}" y="${y}" width="${(p * larg).toFixed(1)}" height="${H}" rx="3"
            fill="${x.pctContrato > 1.001 ? '#8C6D3F' : (x.cor || '#1F4E79')}"/>
      <text x="${L + larg + 8}" y="${y + 15}" font-size="11" fill="#1F2933">${
        fmt(x.pctContrato * 100, 1)}%</text>
      <title>${esc(x.svc)}: ${fmt(x.C, 1)} km concluídos de ${fmt(x.contratado, 1)} km contratados</title>`;
  }).join('');
  return `<div style="padding:0 14px 18px">
    <svg viewBox="0 0 ${W} ${alt}" width="100%" height="${alt}" role="img"
         aria-label="Avanço por serviço sobre a quantidade contratada">
      <text x="14" y="18" font-size="13" font-weight="700" fill="#1F4E79">Avanço sobre o contratado</text>
      <line x1="${L}" y1="${TOPO - 6}" x2="${W - 92}" y2="${TOPO - 6}" stroke="#D4DBE2"/>
      ${barras}
    </svg>
    <div class="dica">Quilômetros concluídos ÷ quantidade contratada do serviço. Serviço sem
      quantidade contratada informada não entra aqui — é ausência de base, não zero.</div>
  </div>`;
}
function graficoGrupos(ids){
  const gs = resumoPorGrupo(ids).filter(g => g.executados || g.previstos);
  if (!gs.length) return '';
  const L = 168, W = 620, H = 26, GAP = 10, TOPO = 34;
  const larg = W - L - 92;
  const alt = TOPO + gs.length * (H + GAP) + 12;
  const barras = gs.map((g, i) => {
    const y = TOPO + i * (H + GAP);
    const j = g.conformes + g.naoConformes;
    const c = g.pct;
    const cheio = c == null ? 0 : Math.max(0, Math.min(1, c)) * larg;
    return `
      <text x="${L - 8}" y="${y + 17}" text-anchor="end" font-size="12" fill="#3A4A5A">${esc(g.grupo)}</text>
      <rect x="${L}" y="${y}" width="${larg}" height="${H}" rx="4" fill="#EEF2F6"/>
      ${c == null ? '' : `<rect x="${L}" y="${y}" width="${cheio.toFixed(1)}" height="${H}" rx="4"
        fill="${corConformidade(c)}"/>`}
      <text x="${L + larg + 8}" y="${y + 17}" font-size="12" fill="#1F2933">${
        c == null ? 'sem base' : fmt(c * 100, 1) + '%'}</text>
      <title>${esc(g.grupo)}: ${g.executados} ensaio(s), ${j} julgado(s), ${
        g.naoConformes} não conforme(s)</title>`;
  }).join('');
  return `<div style="padding:0 14px 18px">
    <svg viewBox="0 0 ${W} ${alt}" width="100%" height="${alt}" role="img"
         aria-label="Conformidade por tipo de controle">
      <text x="14" y="18" font-size="13" font-weight="700" fill="#1F4E79">Conformidade por tipo de controle</text>
      <line x1="${L}" y1="${TOPO - 6}" x2="${W - 92}" y2="${TOPO - 6}" stroke="#D4DBE2"/>
      ${barras}
    </svg>
    <div class="dica">Barra cinza cheia é ausência de julgamento, não reprovação: o tipo de
      controle sem ensaio julgado aparece como «sem base».</div>
  </div>`;
}
