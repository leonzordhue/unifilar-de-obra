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
    ${(() => {
      // O RELATÓRIO CONTA QUILÔMETRO, como a tela e como a planilha da casa.
      //
      // Até 23/08 esta tabela contava POSIÇÃO — serviço × lado × quilômetro — e dizia «3.228
      // posições» onde a obra tem 269 quilômetros. Os dois percentuais batiam por acidente:
      // neste projeto os dois lados andam sempre juntos, e a proporção se mantinha. No dia em
      // que um lado andasse sem o outro — que é para isso que o lado existe — o documento que
      // instrui processo diria um número e a tela diria outro. Achado do HAL9000, medido.
      //
      // A contagem por posição não sumiu: virou a última linha, declarada como detalhe de
      // lançamento, que é o que ela é.
      const q = typeof quadroObra === 'function' ? quadroObra() : [];
      const soma = k => q.reduce((a, x) => a + x[k], 0);
      const kmTot = soma('trechos'), kmNA = soma('NA');
      const aplic = kmTot - kmNA;
      const pctKm = aplic > 0 ? soma('C') / aplic : 0;
      return `<table><thead><tr><th>Indicador</th><th>Valor</th></tr></thead><tbody>
        <tr><td>Quilômetros de controle (serviço × quilômetro)</td><td>${kmTot}</td></tr>
        <tr><td>Quilômetros aplicáveis</td><td>${aplic}</td></tr>
        <tr><td>Quilômetros concluídos</td><td>${soma('C')}</td></tr>
        <tr><td>Quilômetros em andamento</td><td>${soma('E')}</td></tr>
        <tr><td>Quilômetros paralisados</td><td>${soma('PA')}</td></tr>
        <tr><td>Quilômetros sem planejamento</td><td>${soma('S')}</td></tr>
        <tr><td><b>Avanço físico do trecho</b></td><td><b>${fmt(pctKm * 100, 2)}%</b></td></tr>
        <tr><td class="t" style="color:var(--texto2)">Posições de lançamento
          (serviço × lado × quilômetro), o detalhe em que a obra é lançada</td>
          <td style="color:var(--texto2)">${linhas.length * segs.length}</td></tr>
      </tbody></table>`;
    })()}

    <h2>${S.croqui ? '3' : '2'}. Controle da obra — situação por serviço</h2>
    ${controleDaObra()}
    ${tabelaQuadroObra()}
    ${typeof graficoQuadroObra === 'function' ? graficoQuadroObra() : ''}
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
    ${(() => {
      // O avanço passou a contar quilômetros, como a planilha da casa: cada quilômetro vale 1,
      // inclusive a ponta de um recorte que começa ou termina no meio de um. Onde isso muda o
      // número, o documento diz — percentual de fiscalização não pode ter viés escondido.
      const segs = segsNoTrecho();
      const parciais = segs.filter(sg => kmNoTrecho(sg) < sg.ext - 1e-6);
      if (!parciais.length) return '';
      const somaParcial = parciais.reduce((a, sg) => a + kmNoTrecho(sg), 0);
      return `<div class="meta"><b>Base do avanço:</b> o percentual conta quilômetros — cada
        quilômetro do trecho vale 1, como na planilha de controle da casa. ${parciais.length}
        quilômetro(s) deste recorte entram parcialmente (${fmt(somaParcial, 3)} km de
        ${fmt(parciais.reduce((a, sg) => a + sg.ext, 0), 3)} km) e mesmo assim contam 1 cada:
        nesses casos o percentual é otimista em relação à extensão medida em campo. A extensão
        real de cada faixa está no <code>06-faixas.csv</code> do pacote CDE.</div>`;
    })()}
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
/** O TEXTO do CSV, separado do download: o pacote CDE precisa do mesmo conteúdo, e duas
    versões da mesma conta divergem no dia em que uma for corrigida e a outra não. */
function textoCSV(){
  const linhas = linhasMatriz(), segs = segsNoTrecho();
  const sep = ';';
  const cab = ['SERVICO', 'LADO', 'FORA_DO_CATALOGO', 'DATA_ULTIMO_LANCAMENTO',
    'CONCLUIDO', 'EM ANDAMENTO',
    'SEM PLANEJAMENTO', 'PREVISTO', 'NAO SE APLICA', '% EXECUTADO',
    ...segs.map(sg => (S.ref === 'est' ? 'E ' : 'KM ') + rotuloCurto(sg))];
  const out = [cab.join(sep)];
  linhas.forEach(l => {
    const r = resumoLinha(l);
    const fora = (S.svc.find(s => s.nome === l.svc) || {}).foraCatalogo ? 'SIM' : '';
    // a linha é serviço×lado ao longo de todos os quilômetros: a data que cabe aqui é a do
    // lançamento mais recente da linha. Vazio quer dizer «sem data», que é o projeto anterior
    // ao registro — nunca a data de quem exportou.
    const dt = ultimaData(segs.map(sg => chave(l, sg.id)));
    out.push([l.svc, l.lado, fora, dt, r.C, r.E, r.S, r.P, r.NA,
      r.pct == null ? '' : (100 * r.pct).toFixed(1).replace('.', ','),
      ...segs.map(sg => nomeStatus(S.dados[chave(l, sg.id)] || ''))].join(sep));
  });
  return out.join('\r\n');
}
function exportaCSV(){
  if (!S.eixo || !linhasMatriz().length){
    alert('Escolha um eixo e marque serviços antes de exportar.'); return;
  }
  const nome = `controle-obra-${(S.obra || S.eixo.nome).replace(/[^\w\-]+/g, '-').toLowerCase()}.csv`;
  baixa(new Blob(['﻿' + textoCSV()], {type: 'text/csv;charset=utf-8'}), nome);
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
          : r.semFoto ? 'foto não coube' : '—'}</td></tr>`;
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

/** O quadro no formato que a equipe já lê — a aba «CONTROLE DA OBRA» da planilha deles.

    A planilha `CAMADA DE KM AM-010.xlsx` traz, por serviço: TOTAL (KM), SEM PLANEJAMENTO,
    SALDO PLANEJADO, EM ANDAMENTO, REALIZADO e PORCENTAGEM. É a linguagem do escritório, e o
    relatório sai para as mesmas pessoas que leem aquela aba.

    Duas diferenças declaradas, porque copiar sem dizer seria pior:
    - `TOTAL` aqui é o **trecho em obra**, não a quantidade contratada. O cliente tirou a
      quantidade contratada da tela: «é pra gente organizar o andamento da obra e não fazer a
      medição no momento».
    - `SALDO PLANEJADO` é o que está previsto e ainda não foi executado — na planilha deles a
      coluna sai do planejamento do período, que a plataforma ainda não guarda. */
function controleDaObra(){
  if (typeof quadroObra !== 'function') return '';
  const q = quadroObra().filter(x => x.C + x.E + x.PA + x.S + x.P > 0);
  if (!q.length) return '';
  const km = v => v > 0 ? fmt(Math.round(v), 0) : '—';
  const soma = k => q.reduce((a, x) => a + (x[k] || 0), 0);
  const totalKm = segsNoTrecho().length;
  const pct = (c, t) => t > 0 ? fmt(100 * c / t, 1) + '%' : '—';
  // O QUADRO DIZ SOBRE QUE TRECHO ESTÁ FALANDO. Sem isto ele mostra número sem régua: a
  // mesma tabela serve o eixo inteiro e um recorte de 30 km, e foi por não declarar o recorte
  // que a erosão apareceu com 262,5% às 12h05 — o denominador era outro e ninguém via.
  const faixaTrecho = `KM ${fmt(S.kmIni, S.kmIni % 1 ? 1 : 0)}–${
    fmt(S.kmFim, S.kmFim % 1 ? 1 : 0)}`;
  return `<div class="meta"><b>CONTROLE DA OBRA</b> · trecho ${faixaTrecho} ·
      ${fmt(totalKm, 0)} quilômetro(s) de controle · quilômetros contados, um por linha, como
      na planilha da equipe</div>
    <table><thead><tr>
      <th class="t">Serviço</th><th>Total (km)</th><th>Sem planejamento</th>
      <th>Saldo planejado</th><th>Em andamento</th><th>Paralisado</th>
      <th>Realizado</th><th>%</th></tr></thead><tbody>${
    q.map(x => `<tr><td class="t">${esc(x.svc)}</td>
      <td>${fmt(totalKm, 0)}</td><td>${km(x.S)}</td><td>${km(x.P)}</td>
      <td>${km(x.E)}</td><td>${km(x.PA)}</td><td><b>${km(x.C)}</b></td>
      <td><b>${pct(x.C, totalKm)}</b></td></tr>`).join('')}
    <tr><td class="t"><b>Total</b></td><td><b>${fmt(totalKm * q.length, 0)}</b></td>
      <td><b>${km(soma('S'))}</b></td><td><b>${km(soma('P'))}</b></td>
      <td><b>${km(soma('E'))}</b></td><td><b>${km(soma('PA'))}</b></td>
      <td><b>${km(soma('C'))}</b></td>
      <td><b>${pct(soma('C'), totalKm * q.length)}</b></td></tr>
    </tbody></table>
    <div class="meta">Em quilômetros contados: cada quilômetro vale um, uma vez por serviço,
      pelo estado <b>menos avançado</b> entre os lados — com um lado pendente, o quilômetro
      ainda tem o que fazer. É a mesma regra da planilha de controle da equipe. <b>Total</b> é o trecho em obra (${fmt(totalKm, 0)} km), não a quantidade
      contratada: este relatório acompanha execução, não mede contrato.</div>`;
}

/** Detalhamento por faixa: um unifilar impresso, não 38 páginas de tabela.

    Medido no relatório da AM-010: 47 páginas, das quais **38 eram esta seção**. Com 22 linhas
    de controle e frentes alternando quilômetro a quilômetro, uma tabela de faixas por serviço
    vira centenas de linhas — e relatório que ninguém imprime não instrui medição nenhuma.

    A referência é a própria planilha da casa: uma linha por serviço, uma coluna por
    quilômetro, cor por situação. É isso que se desenha aqui, em SVG escrito à mão. O que se
    perde da tabela — o número exato de cada faixa — continua no CSV e no pacote CDE, e isso
    está declarado no rodapé da seção, não implícito. */
function secaoFaixas(linhas){
  const segs = segsNoTrecho();
  if (!linhas.length || !segs.length)
    return '<div class="meta">Nenhuma linha de controle no trecho.</div>';
  const ini = segs[0].ini, fim = segs[segs.length - 1].fim, ext = Math.max(0.001, fim - ini);
  const L = 236, W = 1000, H = 14, GAP = 3, TOPO = 26;
  const larg = W - L - 56;
  const x = km => L + ((km - ini) / ext) * larg;
  const alt = TOPO + linhas.length * (H + GAP) + 34;

  let grupo = null;
  const barras = linhas.map((l, i) => {
    const y = TOPO + i * (H + GAP);
    const faixas = faixasDe(l).map(f => {
      const x0 = x(f.ini), x1 = x(f.fim);
      const larguraFaixa = Math.max(0.6, x1 - x0);
      // A cor é a leitura rápida, mas ela some numa impressão em preto e branco — e o
      // relatório vai para processo, onde se imprime no que houver. Quando a faixa é larga
      // o bastante, a sigla do estado entra dentro dela e o desenho continua legível sem cor.
      const sigla = f.v && larguraFaixa >= 11
        ? `<text x="${(x0 + larguraFaixa / 2).toFixed(1)}" y="${y + 10.5}" font-size="8"
             text-anchor="middle" fill="${txtStatus(f.v)}">${esc(f.v)}</text>` : '';
      return `<rect x="${x0.toFixed(1)}" y="${y}" width="${larguraFaixa.toFixed(1)}"
        height="${H}" fill="${f.v ? corStatus(f.v) : '#F2F5F8'}"
        stroke="#fff" stroke-width="0.3"><title>${esc(l.svc)} · ${esc(l.lado)} · KM ${
        fmt(f.ini, 0)}–${fmt(f.fim, 0)} · ${esc(nomeStatus(f.v))}</title></rect>${sigla}`;
    }).join('');
    const r = resumoLinha(l);
    return `<text x="${L - 6}" y="${y + 10.5}" text-anchor="end" font-size="10.5" fill="#14202B"
              >${esc(l.svc)} · ${esc(l.lado)}</text>${faixas}
            <text x="${W - 50}" y="${y + 10.5}" font-size="10.5" fill="#14202B">${
              r.pct == null ? '—' : fmt(100 * r.pct, 0) + '%'}</text>`;
  }).join('');

  // régua de quilômetro: sem ela o desenho é bonito e ilegível
  const passo = ext > 200 ? 50 : (ext > 80 ? 20 : (ext > 30 ? 10 : 5));
  let regua = '';
  for (let k = Math.ceil(ini / passo) * passo; k <= fim; k += passo){
    regua += `<line x1="${x(k).toFixed(1)}" y1="${TOPO - 4}" x2="${x(k).toFixed(1)}"
        y2="${alt - 30}" stroke="#D4DBE2" stroke-width="0.4"/>
      <text x="${x(k).toFixed(1)}" y="${alt - 20}" font-size="8" text-anchor="middle"
        fill="#5A6B7B">${S.ref === 'est' ? 'E ' + fmt(estacaDe(k), 0) : fmt(k, 0)}</text>`;
  }
  const legenda = S.cat.status.map((st, i) =>
    `<rect x="${L + i * 120}" y="${alt - 13}" width="9" height="9" fill="${st.cor}"
       stroke="#B8C2CC" stroke-width="0.3"/>
     <text x="${L + i * 120 + 13}" y="${alt - 5}" font-size="8" fill="#14202B">${esc(st.nome)}</text>`).join('');

  const totalFaixas = linhas.reduce((a, l) => a + faixasDe(l).length, 0);
  return `<svg viewBox="0 0 ${W} ${alt}" width="100%" style="max-height:150mm" role="img"
      aria-label="Unifilar de situação por serviço ao longo do trecho">
      <text x="0" y="12" font-size="9.5" fill="#5A6B7B">Situação de cada serviço ao longo do
        trecho — ${S.ref === 'est' ? 'estaca' : 'quilômetro'} no eixo horizontal</text>
      ${regua}${barras}${legenda}
    </svg>
    <div class="meta">${linhas.length} linha(s) de controle · ${totalFaixas} faixa(s)
      contígua(s) no trecho. O desenho acima é o mesmo controle da planilha: uma linha por
      serviço e lado, situação por cor ao longo do eixo. <b>A relação faixa a faixa, com
      início, fim, extensão e situação de cada uma, sai completa no pacote CDE, no arquivo
      <code>06-faixas.csv</code></b>; o CSV da matriz traz a situação de cada serviço
      quilômetro a quilômetro. Não está resumida aqui: está onde se confere em número.</div>`;
}

