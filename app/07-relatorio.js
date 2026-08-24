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
    alvo.innerHTML = S.carregando
      ? `<div class="aviso"><b>${esc(S.carregando)}</b></div>`
      : '<div class="aviso"><b>Nada a relatar.</b> Escolha um eixo e marque serviços.</div>';
    return;
  }
  // O RELATÓRIO SEM MAPA ERA UMA CORRIDA, e o cliente caiu nela em 23/08. O croqui é montado
  // em segundo plano quando o eixo carrega (03-acervo.js) e demora alguns segundos: quem abre
  // «Relatório» antes disso recebia o documento SEM a seção «Localização do trecho» — e ela
  // nunca aparecia depois, porque ficar pronto não repintava nada. Reproduzido: relatório
  // aberto 1,2 s após o eixo → 0 imagem; 7 s após → 1 imagem. O mesmo documento, dois
  // conteúdos, decididos por quanto a pessoa demorou a clicar.
  //
  // Agora o relatório PEDE o croqui, como o pacote CDE e o «Baixar PNG» já faziam, e se
  // repinta quando ele chega. `pedindoCroqui` impede a segunda chamada de disparar outra
  // geração enquanto a primeira corre.
  if (!S.croqui && typeof geraCroqui === 'function' && !pintaRel.pedindoCroqui){
    pintaRel.pedindoCroqui = true;
    geraCroqui().then(c => {
      pintaRel.pedindoCroqui = false;
      if (!c) return;
      S.croqui = c;
      if (S.vista === 'rel') pintaRel();
    }).catch(() => { pintaRel.pedindoCroqui = false; });
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
    <div class="meta"><b>Origem da quilometragem:</b> ${textoSentido(S.eixo)
      .replace(/<b>|<\/b>/g, '')}</div>
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

    ${(() => {
      // AVISO DE TRECHO PLANEJADO: fica, e é o único que sobrou das antigas «Notas técnicas».
      // Ele não é nota de método — é fato sobre o trecho que está sendo relatado: naqueles
      // quilômetros não há pista implantada, e o serviço lançado ali é de implantação, não de
      // recuperação. Quem instrui processo precisa disso; do resto, não precisava.
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
  const cab = ['SERVICO', 'FORA_DO_CATALOGO', 'DATA_ULTIMO_LANCAMENTO',
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
    out.push([l.svc, fora, dt, r.C, r.E, r.S, r.P, r.NA,
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
  // O VIÉS DA CONTAGEM CONTINUA DECLARADO, em uma linha. As «Notas técnicas» saíram do
  // relatório por ordem do cliente em 24/08, e dentro delas ia esta frase — que não é nota de
  // método: é o aviso de que num recorte quebrado (KM 12,5 a 18,3) as duas pontas contam 1
  // cada, e o percentual fica otimista em relação à extensão medida em campo. Tirar a seção
  // é ordem; esconder o viés de um número que instrui medição não é, e ele volta aqui, colado
  // ao quadro que o produz.
  const parciais = segsNoTrecho().filter(sg => kmNoTrecho(sg) < sg.ext - 1e-6);
  const nota = parciais.length
    ? ` · ${parciais.length} quilômetro(s) das pontas entram parcialmente e contam 1 cada:
        o percentual é otimista em relação à extensão de campo`
    : '';
  return `<div class="meta"><b>CONTROLE DA OBRA</b> · trecho ${faixaTrecho} ·
      ${fmt(totalKm, 0)} quilômetro(s) de controle · quilômetros contados, um por linha, como
      na planilha da equipe${nota}</div>
    <table><thead><tr>
      <th class="t">Serviço</th><th>Total (km)</th><th>Sem planejamento</th>
      <th>Saldo planejado</th><th>Em andamento</th><th>Paralisado</th>
      <th>Realizado</th><th>%</th></tr></thead><tbody>${
    q.map(x => `<tr><td class="t">${esc(x.svc)}</td>
      <td>${fmt(totalKm, 0)}</td><td>${km(x.S)}</td><td>${km(x.P)}</td>
      <td>${km(x.E)}</td><td>${km(x.PA)}</td><td><b>${km(x.C)}</b></td>
      <td><b>${pct(x.C, totalKm)}</b></td></tr>`).join('')}
    <tr><td class="t"><b>Total</b><span style="font-weight:400;color:#5A6B7B"> · ${
        q.length} serviço(s) × ${fmt(totalKm, 0)} km</span></td>
      <td><b>${fmt(totalKm * q.length, 0)}</b><span style="font-weight:400;color:#5A6B7B">
        km de controle</span></td>
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
