/* Relatorio de controle de obra. */
/* ---------------------------------------------------------------- relatório */
function faixasDe(l){
  const out = [];
  let atual = null;
  segsNoTrecho().forEach(sg => {
    const v = S.dados[chave(l, sg.id)] || 'P';
    if (atual && atual.v === v && Math.abs(atual.fim - sg.ini) < 1e-9) atual.fim = sg.fim;
    else { if (atual) out.push(atual); atual = {v, ini: sg.ini, fim: sg.fim}; }
  });
  if (atual) out.push(atual);
  return out;
}
function pintaRel(){
  const alvo = $('#vRel'), linhas = linhasMatriz();
  if (!S.eixo || !linhas.length){
    alvo.innerHTML = '<div class="aviso"><b>Nada a relatar.</b> Escolha um eixo e marque serviços.</div>';
    return;
  }
  const segs = segsNoTrecho(), t = totais();
  // recortada: o quilômetro da ponta entra pelo pedaço que está no trecho
  const kmTr = segs.reduce((a, s) => a + kmNoTrecho(s), 0);
  const geoTot = S.segs.reduce((a, s) => a + s.ext, 0);
  const saltos = (S.eixo.meta && S.eixo.meta.saltos_km) || [];
  alvo.innerHTML = `<div class="rel">
    <h1>Relatório de controle de obra — unifilar</h1>
    <div class="meta"><b>Obra:</b> ${esc(S.obra || S.eixo.nome)}</div>
    <div class="meta"><b>Eixo:</b> ${esc(S.eixo.nome)} — ${
      S.eixo.tipo === 'rodovia' ? 'rodovia estadual' : (S.eixo.tipo === 'ramal' ? 'ramal' : 'traçado carregado')}</div>
    <div class="meta"><b>Trecho em obra:</b> KM ${fmt(S.kmIni, 0)} ao KM ${fmt(S.kmFim, 0)} — ${fmt(kmTr, 3)} km em ${segs.length} quilômetro(s) de controle${
      S.ref === 'est' ? ` · estaca ${fmt(estacaDe(S.kmIni), 0)} à ${fmt(estacaDe(S.kmFim), 0)}` : ''}</div>
    <div class="meta"><b>Emissão:</b> ${new Date().toLocaleDateString('pt-BR')} · SEINFRA/AM — Departamento de Mobilidade</div>

    ${S.croqui ? `<h2>1. Localização do trecho</h2>
      <img src="${S.croqui.url}" style="width:100%;max-width:100%;border:1px solid #D4DBE2;border-radius:6px">
      <div class="meta" style="margin-top:4px">Traçado sobre imagem de satélite. ${esc(ATRIB_SAT)}.</div>` : ''}

    <h2>${S.croqui ? '2' : '1'}. Avanço geral</h2>
    <table><thead><tr><th>Indicador</th><th>Valor</th></tr></thead><tbody>
      <tr><td>Posições de controle (serviço × lado × quilômetro)</td><td>${linhas.length * segs.length}</td></tr>
      <tr><td>Posições aplicáveis</td><td>${t.val}</td></tr>
      <tr><td>Posições concluídas</td><td>${t.C}</td></tr>
      <tr><td>Posições em andamento</td><td>${t.E}</td></tr>
      <tr><td>Posições sem planejamento</td><td>${t.S}</td></tr>
      <tr><td><b>Avanço físico do trecho</b></td><td><b>${fmt(t.pct * 100, 2)}%</b></td></tr>
    </tbody></table>

    <h2>${S.croqui ? '3' : '2'}. Situação por serviço</h2>
    <table><thead><tr><th>Serviço</th><th>Lado</th><th>Concl.</th><th>Em and.</th>
      <th>Sem plan.</th><th>Previsto</th><th>N/A</th><th>% exec.</th></tr></thead><tbody>${
      linhas.map(l => {const r = resumoLinha(l);
        return `<tr><td>${esc(l.svc)}</td><td>${esc(l.lado)}</td><td>${r.C}</td><td>${r.E}</td>
          <td>${r.S}</td><td>${r.P}</td><td>${r.NA}</td>
          <td>${r.pct == null ? '—' : fmt(100 * r.pct, 1) + '%'}</td></tr>`;}).join('')}
    </tbody></table>

    <h2>${S.croqui ? '4' : '3'}. Detalhamento por faixa</h2>
    ${linhas.map(l => `<table><thead>
        <tr><th colspan="3">${esc(l.svc)} — ${esc(l.lado)}</th></tr>
        <tr><th>Faixa</th><th>Extensão</th><th>Situação</th></tr></thead><tbody>${
        faixasDe(l).map(f => `<tr><td>${S.ref === 'est'
            ? `E ${fmt(estacaDe(f.ini), 0)} a E ${fmt(estacaDe(f.fim), 0)}`
            : `KM ${fmt(f.ini, 0)} ao KM ${fmt(f.fim, 0)}`}</td>
          <td>${fmt(f.fim - f.ini, 3)} km</td><td>${nomeStatus(f.v)}</td></tr>`).join('')
        }</tbody></table>`).join('')}

    <h2>${S.croqui ? '5' : '4'}. Notas técnicas</h2>
    <div class="meta">A extensão de cada quilômetro é apurada por cálculo geodésico sobre o
      traçado — fórmula inversa de Vincenty, elipsoide GRS-80 —, e não por comprimento planar,
      que em coordenadas geográficas não tem significado métrico. O último quilômetro do eixo
      pode ter extensão inferior a 1 km, correspondente ao resto do traçado.</div>
    ${S.eixo.km_cadastro ? `<div class="meta"><b>Extensão cadastrada:</b> ${fmt(S.eixo.km_cadastro, 3)} km ·
      <b>apurada na geometria:</b> ${fmt(geoTot, 3)} km.</div>` : ''}
    <div class="meta"><b>Catálogo de serviços:</b> ${esc(conjuntoAtual().nome)} — ${
      esc(conjuntoAtual().descricao)}</div>
    <div class="meta"><b>Origem da quilometragem:</b> ${textoSentido(S.eixo)
      .replace(/<b>|<\/b>/g, '')}</div>
    ${(() => {
      // Trecho planejado dentro do recorte: quem le o relatorio precisa saber que naqueles
      // quilometros nao ha pista implantada no cadastro — la nao se mede recuperacao.
      const pl = (S.eixo.faixas || []).filter(f => f.situacao === 'PLANEJADA')
        .map(f => ({ini: Math.max(f.km_ini, S.kmIni), fim: Math.min(f.km_fim, S.kmFim)}))
        .filter(f => f.fim - f.ini > 0.05);
      if (!pl.length) return '';
      const som = pl.reduce((a, f) => a + f.fim - f.ini, 0);
      return `<div class="meta"><b>Trecho planejado:</b> ${fmt(som, 1)} km do recorte estão em
        trecho que o cadastro registra como <b>planejado</b> (${pl.map(f =>
        `KM ${fmt(f.ini, 0)} ao KM ${fmt(f.fim, 0)}`).join(', ')}). Nesses quilômetros não há
        pista implantada: o serviço lançado ali é de implantação, não de recuperação.</div>`;
    })()}
    ${saltos.length ? `<div class="meta"><b>Descontinuidade no traçado:</b> o acervo registra
      ${saltos.length} interrupção(ões) neste eixo (${saltos.map(s => fmt(s, 1) + ' km').join(', ')}).
      A quilometragem é contada sobre o traçado existente, sem somar os vazios, e o segmento em
      curso se encerra em cada interrupção.</div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- exportação */
function baixa(blob, nome){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportaCSV(){
  const linhas = linhasMatriz(), segs = segsNoTrecho();
  if (!S.eixo || !linhas.length){
    alert('Escolha um eixo e marque serviços antes de exportar.'); return;
  }
  const sep = ';';
  const cab = ['SERVICO', 'LADO', 'CONCLUIDO', 'EM ANDAMENTO', 'SEM PLANEJAMENTO',
    'PREVISTO', 'NAO SE APLICA', '% EXECUTADO',
    ...segs.map(sg => (S.ref === 'est' ? 'E ' : 'KM ') + rotuloCurto(sg))];
  const out = [cab.join(sep)];
  linhas.forEach(l => {
    const r = resumoLinha(l);
    out.push([l.svc, l.lado, r.C, r.E, r.S, r.P, r.NA,
      r.val ? (100 * r.C / r.val).toFixed(1).replace('.', ',') : '',
      ...segs.map(sg => nomeStatus(S.dados[chave(l, sg.id)] || ''))].join(sep));
  });
  const nome = `controle-obra-${(S.obra || S.eixo.nome).replace(/[^\w\-]+/g, '-').toLowerCase()}.csv`;
  baixa(new Blob(['﻿' + out.join('\r\n')], {type: 'text/csv;charset=utf-8'}), nome);
}
