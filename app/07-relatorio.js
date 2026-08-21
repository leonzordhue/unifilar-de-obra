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
  // Rodapé do documento impresso, pedido pelo HAL9000 em `estilo/impressao.css`: repetido
  // em toda página pelo `position:fixed`, é o que torna a folha solta rastreável ao contrato.
  // Numeração «página X de Y» não entra: o Chromium não implementa contador de página fora
  // das margin boxes do @page, e número de página errado é pior que nenhum.
  const rodapeImp = [S.contrato && 'Contrato ' + esc(S.contrato),
                     esc((S.obra || S.eixo.nome || '').slice(0, 80)),
                     'emitido em ' + new Date().toLocaleDateString('pt-BR')]
    .filter(Boolean).join(' · ');
  // O texto vai TAMBÉM como propriedade CSS: um `div` com `position:fixed` aninhado no
  // fragmento paginado do Chromium não se repete em toda página (medido pela prova de
  // impressão do HAL9000: faltava nas seis primeiras), mas conteúdo gerado se repete — é
  // como o rodapé institucional dele já funciona. A folha de impressão lê `--rodape-obra`.
  // Apóstrofo, aspas e barra invertida sairiam do valor CSS e quebrariam o atributo;
  // trocados por espaço sem regex, que é o que já me mordeu ao escrever este arquivo.
  const rodapeCss = [34, 39, 92].reduce(
    (t, c) => t.split(String.fromCharCode(c)).join(' '), rodapeImp);
  alvo.innerHTML = `<div class="rel" style="--rodape-obra:'${rodapeCss}'">
    <div id="rodapeImpressao">${rodapeImp}</div>
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

    ${blocoContratoRel() ? `<div class="meta"><b>Identificação do contrato</b></div>
      ${blocoContratoRel()}` : ''}

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
    ${tabelaQuadroObra()}
    <div class="meta">Abaixo, o mesmo controle contado em posições — serviço, lado e
      quilômetro —, que é a unidade de lançamento da plataforma.</div>
    <table><thead><tr><th>Serviço</th><th>Lado</th><th>Concl.</th><th>Em and.</th>
      <th>Sem plan.</th><th>Previsto</th><th>N/A</th><th>% exec.</th></tr></thead><tbody>${
      linhas.map(l => {const r = resumoLinha(l);
        return `<tr><td>${esc(l.svc)}</td><td>${esc(l.lado)}</td><td>${r.C}</td><td>${r.E}</td>
          <td>${r.S}</td><td>${r.P}</td><td>${r.NA}</td>
          <td>${r.pct == null ? '—' : fmt(100 * r.pct, 1) + '%'}</td></tr>`;}).join('')}
    </tbody></table>

    <h2>${S.croqui ? '4' : '3'}. Detalhamento por faixa</h2>
    ${secaoFaixas(linhas)}

    ${secaoEnsaios(segs)}

    <h2>${(S.croqui ? 5 : 4) + (S.reg.length ? 1 : 0)}. Notas técnicas</h2>
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
      r.pct == null ? '' : (100 * r.pct).toFixed(1).replace('.', ','),
      ...segs.map(sg => nomeStatus(S.dados[chave(l, sg.id)] || ''))].join(sep));
  });
  const nome = `controle-obra-${(S.obra || S.eixo.nome).replace(/[^\w\-]+/g, '-').toLowerCase()}.csv`;
  baixa(new Blob(['﻿' + out.join('\r\n')], {type: 'text/csv;charset=utf-8'}), nome);
}


/* ---------------------------------------------------------------- controle tecnológico */
/** Seção de ensaios do relatório. Sai vazia quando não há ensaio lançado: seção com «nenhum
    registro» num relatório de medição só ocupa página. */
function secaoEnsaios(segs){
  if (!S.reg.length) return '';
  const ids = segs.map(s => s.id);
  const dentro = new Set(ids);
  const rs = resumoEnsaios(ids);
  const grupos = resumoPorGrupo(ids).filter(g => g.executados || g.previstos);
  const regs = S.reg.filter(r => dentro.has(r.seg))
    .sort((a, b) => a.seg - b.seg || a.cod.localeCompare(b.cod, 'pt-BR'));
  const fora = S.reg.length - regs.length;
  const pct = v => v == null ? '—' : fmt(100 * v, 1) + '%';
  const seg = id => {
    const sg = S.segs.find(x => x.id === id);
    return sg ? rotuloSeg(sg) : '—';
  };
  const pendentes = [...new Set(regs.map(r => r.cod))]
    .map(ensaioDe).filter(e => e && !e.confirmado).length;

  return `
    <h2>${S.croqui ? 5 : 4}. Controle tecnológico</h2>
    <table><thead><tr><th>Indicador</th><th>Valor</th></tr></thead><tbody>
      <tr><td>Ensaios lançados no trecho</td><td>${regs.length}</td></tr>
      <tr><td>Previstos pela frequência das normas</td><td>${
        rs.previstos == null ? 'sem base' : fmt(rs.previstos, 0)}</td></tr>
      <tr><td>Executado sobre o previsto</td><td>${pct(rs.pctExecutado)}</td></tr>
      <tr><td>Conformes</td><td>${rs.conformes}</td></tr>
      <tr><td>Não conformes</td><td>${rs.naoConformes}</td></tr>
      <tr><td>Sem critério numérico para julgar</td><td>${rs.semCriterio}</td></tr>
      <tr><td><b>Conformidade</b></td><td><b>${pct(rs.pctConformidade)}</b></td></tr>
    </tbody></table>

    ${grupos.length ? `<table><thead><tr><th class="t">Tipo de controle</th><th>Previstos</th>
      <th>Executados</th><th>Conformes</th><th>Não conformes</th>
      <th>Conformidade</th></tr></thead><tbody>${grupos.map(g => `<tr>
        <td>${esc(g.grupo)}</td>
        <td>${g.previstos ? fmt(g.previstos, 0) : '—'}</td>
        <td>${g.executados}</td>
        <td>${g.conformes}</td>
        <td>${g.naoConformes}</td>
        <td>${pct(g.pct)}</td></tr>`).join('')}</tbody></table>` : ''}

    <table><thead><tr><th>Trecho</th><th class="t">Ensaio</th><th class="t">Norma</th>
      <th>Medição</th><th>Critério</th><th class="t">Resultado</th>
      <th class="t">Data e responsável</th><th>Foto</th></tr></thead><tbody>${regs.map(r => {
      const e = ensaioDe(r.cod) || {nome: r.cod, unidade: '', norma_metodo: {}};
      const nm = e.norma_metodo || {};
      const lim = [r.lim_min != null ? '≥ ' + fmt(r.lim_min, 2) : '',
                   r.lim_max != null ? '≤ ' + fmt(r.lim_max, 2) : ''].filter(Boolean).join(' e ');
      return `<tr>
        <td>${esc(seg(r.seg))}</td>
        <td class="t">${esc(e.nome)}</td>
        <td class="t">${nm.codigo ? esc(nm.codigo) : '<i>pendente</i>'}</td>
        <td>${r.valor != null ? fmt(r.valor, 2) : '—'} ${esc(e.unidade || '')}</td>
        <td>${lim || 'do projeto'}</td>
        <td class="t">${esc(textoConforme(r))}</td>
        <td class="t">${esc(r.data)}${r.resp ? ' · ' + esc(r.resp) : ''}</td>
        <td>${r.foto && S.fotos[r.foto]
          ? `<img src="${S.fotos[r.foto]}" style="width:64px;height:46px;object-fit:cover;border:1px solid #D4DBE2;border-radius:3px">`
          : '—'}</td></tr>`;
    }).join('')}</tbody></table>

    ${fora ? `<div class="meta">${fora} ensaio(s) lançado(s) fora do trecho em obra não
      entram neste quadro.</div>` : ''}
    ${pendentes ? `<div class="meta"><b>Norma de referência pendente de confirmação em
      ${pendentes} ensaio(s) deste relatório.</b> O catálogo da plataforma só exibe código de
      norma conferido na fonte; onde está «pendente», a norma aplicável deve ser informada
      pela fiscalização antes do uso do quadro em medição.</div>` : ''}
    <div class="meta">O critério de aceitação registrado é o que vigorava no aceite de cada
      ensaio, copiado para dentro do registro: alteração posterior do catálogo não reprova,
      retroativamente, ensaio já aceito.</div>`;
}


/* ---------------------------------------------------------------- detalhamento por faixa */
const LIMITE_FAIXAS = 40;      // por serviço e lado; acima disto o corte é declarado

/** Detalhamento por faixa, enxugado sem esconder nada.

    Na AM-010 importada, o relatório saía com 48 páginas: cada serviço rendia uma tabela com
    uma linha por faixa contígua, e com as frentes alternando quilômetro a quilômetro isso dá
    centenas de linhas. Relatório que ninguém imprime não é relatório. */
function secaoFaixas(linhas){
  const blocos = [];
  let totalFaixas = 0, semVariacao = 0, cortadas = 0;
  linhas.forEach(l => {
    const fx = faixasDe(l);
    totalFaixas += fx.length;
    // serviço inteiro numa só situação: o quadro por serviço já diz isso, e a tabela de uma
    // linha só ocupa página sem informar
    if (fx.length <= 1){ semVariacao++; return; }
    const mostra = fx.slice(0, LIMITE_FAIXAS);
    const resto = fx.length - mostra.length;
    if (resto > 0) cortadas += resto;
    blocos.push(`<table><thead>
        <tr><th colspan="3" class="t">${esc(l.svc)} — ${esc(l.lado)}
          <span style="font-weight:400">· ${fx.length} faixa(s)</span></th></tr>
        <tr><th class="t">Faixa</th><th>Extensão</th><th class="t">Situação</th></tr></thead>
      <tbody>${mostra.map(f => `<tr><td class="t">${S.ref === 'est'
            ? `E ${fmt(estacaDe(f.ini), 0)} a E ${fmt(estacaDe(f.fim), 0)}`
            : `KM ${fmt(f.ini, 0)} ao KM ${fmt(f.fim, 0)}`}</td>
          <td>${fmt(f.fim - f.ini, 3)} km</td>
          <td class="t">${nomeStatus(f.v)}</td></tr>`).join('')}
        ${resto > 0 ? `<tr><td colspan="3" class="t"><b>Mais ${resto} faixa(s)</b> deste
          serviço não estão listadas aqui, a partir do KM ${fmt(mostra[mostra.length - 1].fim, 0)}.
          A relação completa está no CSV exportado.</td></tr>` : ''}
      </tbody></table>`);
  });
  const nota = [];
  nota.push(`${totalFaixas} faixa(s) contígua(s) no trecho`);
  if (semVariacao) nota.push(`${semVariacao} linha(s) de controle sem variação de situação, `
    + 'omitida(s) — o quadro por serviço acima já as resume');
  if (cortadas) nota.push(`${cortadas} faixa(s) além do limite de ${LIMITE_FAIXAS} por `
    + 'serviço, declaradas em cada tabela');
  return (blocos.length
    ? `<div class="meta">${nota.join(' · ')}.</div>` + blocos.join('')
    : '<div class="meta">Nenhum serviço tem variação de situação ao longo do trecho: o '
      + 'quadro por serviço acima já traz o quadro completo.</div>');
}
