/* Matriz de controle, resumo e exportacao em CSV. */
/* ---------------------------------------------------------------- rótulos */
const estacaDe = km => Math.round(((km * 1000) / EST_M + (+S.estOff || 0)) * 100) / 100;
const rotuloSeg = sg => S.ref === 'est'
  ? `E ${fmt(estacaDe(sg.ini), 0)} a E ${fmt(estacaDe(sg.fim), 0)}`
  : `KM ${fmt(sg.ini, 0)} – ${fmt(sg.fim, 0)}`;
const rotuloCurto = sg => S.ref === 'est' ? fmt(estacaDe(sg.ini), 0)
  : (Math.abs(sg.ini - Math.round(sg.ini)) < 1e-6 ? fmt(sg.ini, 0) : fmt(sg.ini, 1));

/* ---------------------------------------------------------------- matriz */
// O catalogo entra na chave: BASE na recuperacao e BASE na implantacao tem o mesmo nome e
// sao obras diferentes — sem isto a marcacao de uma aparece na outra, e o relatorio
// declara avanco que ninguem executou.
const chave = (l, id) => `${S.catId}|${l.svc}|${l.lado}|${id}`;
function linhasMatriz(){
  const out = [];
  S.svc.filter(s => s.on).forEach(s => s.lados.forEach(ld =>
    out.push({svc: s.nome, lado: ld, grupo: s.grupo, unidade: s.unidade})));
  return out;
}
const segsNoTrecho = () => S.segs.filter(dentroTrecho);
// Contagem e extensão andam juntas, e não são a mesma coisa: o relatório fala de
// «posições de controle», que se contam, e de avanço físico, que se mede em quilômetro.
// O último quilômetro de um eixo costuma ter menos de 1 km, e num trecho curto de obra
// contar célula em vez de extensão distorce o avanço em pontos percentuais inteiros.
function resumoLinha(l){
  const r = {C: 0, E: 0, S: 0, NA: 0, P: 0, val: 0, total: 0,
             kmC: 0, kmVal: 0, kmTotal: 0};
  segsNoTrecho().forEach(sg => {
    const v = S.dados[chave(l, sg.id)] || '';
    const km = kmNoTrecho(sg);
    r.total++; r.kmTotal += km;
    if (v === 'NA'){ r.NA++; return; }
    r.val++; r.kmVal += km;
    if (v === 'C'){ r.C++; r.kmC += km; }
    else if (v === 'E') r.E++; else if (v === 'S') r.S++; else r.P++;
  });
  r.pct = r.kmVal > 0 ? r.kmC / r.kmVal : null;
  return r;
}
function pintaMatriz(){
  const alvo = $('#vMatriz'), linhas = linhasMatriz();
  if (!S.eixo || !linhas.length){
    alvo.innerHTML = `<div class="aviso"><b>Nada a exibir.</b> ${
      !S.eixo ? 'Escolha um eixo na lateral.' : 'Marque ao menos um serviço na lateral.'}</div>`;
    return;
  }
  const segs = S.segs;
  let h = '<div class="wrapmat"><table class="mat"><thead><tr><th class="sv">Serviço / lado</th>'
    + '<th class="g" title="Quilômetros concluídos">C</th><th class="g" title="Em andamento">E</th>'
    + '<th class="g" title="Sem planejamento">S</th><th class="g" title="Não se aplica">NA</th>'
    + '<th class="g" title="Percentual executado">%</th>';
  segs.forEach(sg => {
    h += `<th${dentroTrecho(sg) ? '' : ' style="opacity:.45"'} title="${esc(rotuloSeg(sg))} · ${fmt(sg.ext, 3)} km">${rotuloCurto(sg)}</th>`;
  });
  h += '</tr></thead><tbody>';
  let grp = null;
  linhas.forEach((l, i) => {
    if (l.grupo !== grp){
      grp = l.grupo;
      h += `<tr class="gr"><th class="sv">${esc(grp)}</th>`
        + `<td colspan="${5 + segs.length}"></td></tr>`;
    }
    const r = resumoLinha(l);
    h += `<tr><th class="sv"><span class="lado">${esc(l.lado)}</span>${esc(l.svc)}</th>`
      + `<td>${r.C || ''}</td><td>${r.E || ''}</td><td>${r.S || ''}</td><td>${r.NA || ''}</td>`
      + `<td><b>${r.pct == null ? '—' : fmt(100 * r.pct, 0) + '%'}</b></td>`;
    segs.forEach(sg => {
      if (!dentroTrecho(sg)){ h += '<td class="fora"></td>'; return; }
      const v = S.dados[chave(l, sg.id)] || '';
      h += `<td class="cel" data-l="${i}" data-id="${sg.id}"
        style="background:${v ? corStatus(v) : '#fff'};color:${v ? txtStatus(v) : 'transparent'}"
        title="${esc(l.svc)} · ${esc(l.lado)} · ${esc(rotuloSeg(sg))}">${v}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody><tfoot><tr><th class="sv">% concluído no quilômetro</th><td colspan="5"></td>';
  segs.forEach(sg => {
    const p = dentroTrecho(sg) ? pctSeg(sg.id) : null;
    h += `<td>${p === null ? '' : fmt(p * 100, 0)}</td>`;
  });
  h += '</tr></tfoot></table></div>';
  alvo.innerHTML = h;
  alvo.querySelectorAll('td.cel').forEach(td => td.onclick = ev => {
    const idx = +td.dataset.l, id = +td.dataset.id, l = linhas[idx];
    if (ev.shiftKey && S.ultimo && S.ultimo.l === idx){
      const a = Math.min(S.ultimo.id, id), b = Math.max(S.ultimo.id, id);
      segsNoTrecho().forEach(sg => {
        if (sg.id >= a && sg.id <= b){
          if (S.ultimo.v) S.dados[chave(l, sg.id)] = S.ultimo.v;
          else delete S.dados[chave(l, sg.id)];
        }
      });
    } else {
      const k = chave(l, id);
      const prox = CICLO[(CICLO.indexOf(S.dados[k] || '') + 1) % CICLO.length];
      if (prox) S.dados[k] = prox; else delete S.dados[k];
      S.ultimo = {l: idx, id, v: prox};
    }
    render(); salvaLocal();
  });
}
function marcaColuna(id){
  const cel = $('#vMatriz').querySelector(`td.cel[data-id="${id}"]`);
  if (cel) cel.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'smooth'});
}

/* ---------------------------------------------------------------- resumo */
const card = (rot, val, sub) =>
  `<div class="card"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub || ''}</div></div>`;
function totais(){
  const t = {C: 0, E: 0, S: 0, NA: 0, P: 0, val: 0, kmC: 0, kmVal: 0};
  linhasMatriz().forEach(l => {
    const r = resumoLinha(l);
    t.C += r.C; t.E += r.E; t.S += r.S; t.NA += r.NA; t.P += r.P; t.val += r.val;
    t.kmC += r.kmC; t.kmVal += r.kmVal;
  });
  // avanço físico é medido em quilômetro, não em número de células
  t.pct = t.kmVal > 0 ? t.kmC / t.kmVal : 0;
  return t;
}
function pintaResumo(){
  const alvo = $('#vResumo'), linhas = linhasMatriz();
  if (!S.eixo || !linhas.length){
    alvo.innerHTML = '<div class="aviso"><b>Nada a resumir.</b> Escolha um eixo e marque serviços.</div>';
    return;
  }
  const segs = segsNoTrecho(), t = totais();
  // recortada: o quilômetro da ponta entra pelo pedaço que está no trecho
  const kmTr = segs.reduce((a, s) => a + kmNoTrecho(s), 0);
  const tipo = S.eixo.tipo === 'rodovia' ? 'Rodovia estadual'
    : (S.eixo.tipo === 'ramal' ? 'Ramal' : 'Traçado carregado');
  alvo.innerHTML = `<div class="cards">
      ${card('Eixo', esc(S.eixo.nome), tipo)}
      ${card('Trecho em obra', `KM ${fmt(S.kmIni, 0)} – ${fmt(S.kmFim, 0)}`, `${fmt(kmTr, 3)} km · ${segs.length} quilômetro(s)`)}
      ${card('Linhas de controle', linhas.length, `${S.svc.filter(s => s.on).length} serviço(s) × lados`)}
      ${card('Avanço físico', fmt(t.pct * 100, 1) + '%', `${t.C} de ${t.val} posições concluídas`)}
      ${card('Em andamento', t.E, 'posições')}
      ${card('Sem planejamento', t.S, 'posições')}
    </div>
    <table class="res"><thead><tr><th>Serviço</th><th>Lado</th><th>Concluído</th>
      <th>Em andam.</th><th>Sem plan.</th><th>Previsto</th><th>N/A</th><th>% exec.</th>
      <th style="width:130px">Avanço</th></tr></thead><tbody>${
      linhas.map(l => {
        const r = resumoLinha(l), p = r.pct == null ? 0 : r.pct;
        return `<tr><td>${esc(l.svc)}</td><td>${esc(l.lado)}</td><td>${r.C}</td><td>${r.E}</td>
          <td>${r.S}</td><td>${r.P}</td><td>${r.NA}</td>
          <td><b>${r.pct == null ? '—' : fmt(p * 100, 1) + '%'}</b></td>
          <td><div class="barra"><i style="width:${(p * 100).toFixed(1)}%"></i></div></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>TOTAL</td><td>—</td><td>${t.C}</td><td>${t.E}</td><td>${t.S}</td>
        <td>${t.P}</td><td>${t.NA}</td><td>${fmt(t.pct * 100, 1)}%</td><td></td></tr></tfoot>
    </table>`;
}
