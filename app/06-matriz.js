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
  const r = {C: 0, E: 0, PA: 0, S: 0, NA: 0, P: 0, val: 0, total: 0,
             kmC: 0, kmVal: 0, kmTotal: 0};
  segsNoTrecho().forEach(sg => {
    const v = S.dados[chave(l, sg.id)] || '';
    const km = kmNoTrecho(sg);
    r.total++; r.kmTotal += km;
    if (v === 'NA'){ r.NA++; return; }
    r.val++; r.kmVal += km;
    if (v === 'C'){ r.C++; r.kmC += km; }
    // PARALISADO TEM DE SER CONTADO COMO PARALISADO. Até 23/08 o `else` final engolia o
    // `PA`: cinco quilômetros com dois parados saíam da grade como «3 previstos» e do quadro
    // logo abaixo como «2 paralisados + 1 previsto». Obra que parou virando obra que vai
    // acontecer é paralisação sumindo do resumo — achado do jarvisIV, medido.
    else if (v === 'E') r.E++; else if (v === 'PA') r.PA++;
    else if (v === 'S') r.S++; else r.P++;
  });
  // ACOMPANHAMENTO CONTA QUILÔMETRO, NÃO EXTENSÃO. A equipe do cliente trabalha numa
  // planilha de uma linha por quilômetro, e conta linhas: «257 km concluídos» são 257
  // quadradinhos. Somar extensão fazia o último quilômetro do eixo — que tem a sobra, 0,062
  // km na AM-010 — devolver 256,06 onde a planilha deles diz 257, e foi essa diferença que
  // o cliente leu como «ele acha que tem mais km do que eu marquei».
  // A extensão continua aqui em `kmC`/`kmVal`: ela vale para geodésia, croqui e medição —
  // medição que, por ordem do cliente, é outro projeto.
  r.pct = r.val > 0 ? r.C / r.val : null;
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
  // A legenda mora na faixa, que está na outra aba: quem pinta na grade via cor sem tabela
  // de cor. Entra aqui como linha discreta em cima da planilha — sem controle novo, só a
  // leitura do que cada cor quer dizer.
  let h = '<div class="legGrade">' + S.cat.status.map(st =>
      `<span><i style="background:${st.cor}"></i>${esc(st.nome)}</span>`).join('')
    + '<span><i class="hachura"></i>fora do trecho em obra</span>'
    // a instrução do gesto mora junto do gesto: esta frase vivia na vista do mapa, onde
    // não há grade desde que as abas viraram três
    + '<span class="comoPinta">clique gira o estado · arraste repete · shift+clique '
    + 'preenche a faixa · botão direito limpa</span></div>';
  h += '<div class="wrapmat"><table class="mat"><thead><tr><th class="sv">Serviço / lado</th>'
    + '<th class="g" title="Quilômetros concluídos (contagem)">C</th><th class="g" title="Em andamento">E</th>'
    + '<th class="g" title="Paralisado">PA</th>'
    + '<th class="g" title="Sem planejamento">S</th><th class="g" title="Não se aplica">NA</th>'
    + '<th class="g" title="Percentual executado">%</th>';
  // Marca a cada 10 km: numa grade de 269 colunas iguais, o olho perde o lugar entre uma
  // coluna e outra. A régua de 10 em 10 é o que a planilha da casa faz com borda mais grossa,
  // e é o que permite dizer «estou no km 130» sem contar coluna por coluna.
  const marco = sg => Math.abs(sg.ini / 10 - Math.round(sg.ini / 10)) < 1e-6;
  segs.forEach(sg => {
    // «KM 12» e não «12»: o número nu no cabeçalho é o que fez o cliente ler posição como
    // quantidade. Aqui ele é sempre posição, e a quantidade só aparece nas colunas de resumo.
    h += `<th class="${marco(sg) ? 'm10' : ''}"${dentroTrecho(sg) ? '' : ' style="opacity:.45"'
      } title="${esc(rotuloSeg(sg))} · ${fmt(sg.ext, 3)} km">${
      S.ref === 'est' ? 'E&nbsp;' : 'KM&nbsp;'}${rotuloCurto(sg)}</th>`;
  });
  h += '</tr></thead><tbody>';
  let grp = null;
  linhas.forEach((l, i) => {
    if (l.grupo !== grp){
      grp = l.grupo;
      h += `<tr class="gr"><th class="sv">${esc(grp)}</th>`
        + `<td colspan="${6 + segs.length}"></td></tr>`;
    }
    const r = resumoLinha(l);
    h += `<tr><th class="sv"><span class="lado">${esc(l.lado)}</span>${esc(l.svc)}</th>`
      + `<td>${r.C || ''}</td><td>${r.E || ''}</td><td>${r.PA || ''}</td>`
      + `<td>${r.S || ''}</td><td>${r.NA || ''}</td>`
      + `<td><b>${r.pct == null ? '—' : fmt(100 * r.pct, 0) + '%'}</b></td>`;
    segs.forEach(sg => {
      if (!dentroTrecho(sg)){ h += '<td class="fora"></td>'; return; }
      const v = S.dados[chave(l, sg.id)] || '';
      h += `<td class="cel${marco(sg) ? ' m10' : ''}" data-l="${i}" data-id="${sg.id}"
        style="${v ? 'background:' + corStatus(v) + ';color:' + txtStatus(v) : 'color:transparent'}"
        title="${esc(l.svc)} · ${esc(l.lado)} · ${esc(rotuloSeg(sg))}">${v}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody><tfoot><tr><th class="sv">% concluído neste quilômetro</th><td colspan="6"></td>';
  segs.forEach(sg => {
    const p = dentroTrecho(sg) ? pctSeg(sg.id) : null;
    h += `<td class="${marco(sg) ? 'm10' : ''}">${p === null ? '' : fmt(p * 100, 0)}</td>`;
  });
  h += '</tr></tfoot></table></div>';
  alvo.innerHTML = h;
  // Na vista «Controle» o quadro da obra abre junto com a planilha, e tem de ser repintado
  // com ela — senão o número de cima envelhece enquanto a matriz embaixo está fresca, que é
  // o pior tipo de tela: duas verdades ao mesmo tempo.
  if (typeof juntaVistas === 'function') juntaVistas();
  // NAVEGAR 269 COLUNAS: a grade abre no quilômetro que a pessoa marcou na faixa ou no mapa,
  // em vez de sempre no KM 0. `marcaColuna()` existia desde o refactor e não era chamada por
  // ninguém — o manual prometia «clicar num quilômetro no mapa leva à coluna correspondente»
  // e a promessa estava morta. A coluna de serviço é `sticky`, então rolar para o km 130 não
  // custa perder de vista qual serviço se está lançando.
  if (S.sel && S.sel.size) marcaColuna([...S.sel][0]);
  // ARRASTO NA GRADE — a planilha se pinta arrastando, e é o gesto que o cliente pediu
  // («as pinturas já era pra ser feita por quadradinhos como se fosse uma planilha»).
  //
  // Não é modo novo nem tela nova: o clique continua fazendo o que fazia, e o arrasto REPETE
  // nas células seguintes o valor que o clique acabou de aplicar — a mesma regra do shift,
  // que já existia. Quem lança 40 km deixa de dar 40 cliques.
  //
  // O padrão de ponteiro é o da faixa (`13-faixa.js`): `elementFromPoint` + captura, para
  // dedo, caneta e mouse entrarem pelo mesmo caminho. Reusar o padrão em vez de inventar o
  // segundo é o que impede a plataforma de ter dois jeitos de arrastar.
  //
  // Só mouse e caneta: no toque, arrastar é como se rola a tabela de 269 colunas, e roubar
  // esse gesto deixaria a matriz presa no tablet. No toque valem o toque na célula, o
  // «Selecionar o trecho» e a faixa — que é onde a seleção em lote já mora.
  const celDe = ev => {
    const e = document.elementFromPoint(ev.clientX, ev.clientY);
    return e && e.classList && e.classList.contains('cel') ? e : null;
  };
  let pintando = false, ultimoTd = null;
  const repete = td => {
    if (!td || td === ultimoTd) return;
    ultimoTd = td;
    const idx = +td.dataset.l, id = +td.dataset.id, l = linhas[idx];
    if (!l || !S.ultimo || S.ultimo.v == null) return;
    if ((S.dados[chave(l, id)] || '') === S.ultimo.v) return;
    marcaKm(l, id, S.ultimo.v);
    atualizaCelulas(alvo, linhas, idx, l, segs, [id]);
    if (S.vista !== 'matriz') render();
    salvaLocal();
  };
  alvo.onpointerdown = ev => {
    if (ev.pointerType === 'touch' || ev.button) return;
    const td = celDe(ev);
    if (!td) return;
    // o clique que vem depois deste ponteiro não pode repetir o gesto e girar o estado duas
    // vezes; o clique programático das provas não passa por aqui e continua valendo
    td.dataset.ponteiro = '1';
    td.onclick(ev);
    pintando = true; ultimoTd = td;
    if (alvo.setPointerCapture) try { alvo.setPointerCapture(ev.pointerId); } catch (e){}
  };
  alvo.onpointermove = ev => { if (pintando) repete(celDe(ev)); };
  const soltaGrade = () => { pintando = false; ultimoTd = null; };
  alvo.onpointerup = soltaGrade;
  document.addEventListener('pointerup', soltaGrade);

  // LIMPAR EM UM GESTO. Com seis estados no giro, voltar uma celula a vazio custa ate cinco
  // cliques — e cinco cliques para desfazer e o que faz a pessoa desistir do estado certo e
  // deixar o errado, que e o dado mentindo por conveniencia. O botao direito limpa. Nao ocupa
  // alvo novo na tela, nao concorre com o toque em campo (onde se usa a barra e a selecao), e
  // o custo de descobrir e uma linha na legenda da grade. Levantado pelo jarvisIV ao entrar o
  // «Paralisado» no ciclo.
  alvo.querySelectorAll('td.cel').forEach(td => td.oncontextmenu = ev => {
    ev.preventDefault();
    const idx = +td.dataset.l, id = +td.dataset.id;
    marcaKm(linhas[idx], id, '');
    S.ultimo = {l: idx, id, v: ''};
    atualizaCelulas(alvo, linhas, idx, linhas[idx], segs, [id]);
  });

  alvo.querySelectorAll('td.cel').forEach(td => td.onclick = ev => {
    if (td.dataset.ponteiro && ev.type === 'click'){ delete td.dataset.ponteiro; return; }
    const idx = +td.dataset.l, id = +td.dataset.id, l = linhas[idx];
    const alterados = [];
    if (ev.shiftKey && S.ultimo && S.ultimo.l === idx){
      const a = Math.min(S.ultimo.id, id), b = Math.max(S.ultimo.id, id);
      segsNoTrecho().forEach(sg => {
        if (sg.id >= a && sg.id <= b){
          marcaKm(l, sg.id, S.ultimo.v);
          alterados.push(sg.id);
        }
      });
    } else {
      alterados.push(id);
      const k = chave(l, id);
      const prox = CICLO[(CICLO.indexOf(S.dados[k] || '') + 1) % CICLO.length];
      marcaKm(l, id, prox);
      S.ultimo = {l: idx, id, v: prox};
    }
    // MEDIDO ANTES DE MEXER, na AM-010 (269 km × 22 linhas = 5.918 células):
    //   pintaMatriz() ................ 313 ms (mediana de 7)
    //   clique → repintura ........... 246 ms
    //   linhasMatriz()+resumoLinha() ... 2 ms
    // O custo não está na conta — está em remontar o HTML das 5.918 células a cada clique.
    // Então o clique passa a repintar SÓ o que mudou: a célula (ou a faixa do shift), os
    // totais daquela linha e a coluna do rodapé. As outras vistas continuam pelo `render()`
    // completo, que é o certo: elas não são refeitas a cada toque.
    atualizaCelulas(alvo, linhas, idx, l, segs, alterados);
    if (S.vista !== 'matriz') render();
    salvaLocal();
  });
}
/** Repinta só as células alteradas, o resumo da linha e o rodapé das colunas tocadas. */
function atualizaCelulas(alvo, linhas, idx, l, segs, ids){
  ids.forEach(id => {
    const td = alvo.querySelector(`td.cel[data-l="${idx}"][data-id="${id}"]`);
    if (!td) return;
    const v = S.dados[chave(l, id)] || '';
    td.textContent = v;
    // sem lançamento, o fundo volta a ser o da folha de estilo — é o que deixa a zebra da
    // grade aparecer. Fixar '#fff' aqui apagava a zebra a cada célula tocada.
    td.style.background = v ? corStatus(v) : '';
    td.style.color = v ? txtStatus(v) : 'transparent';
  });
  const tr = alvo.querySelector(`td.cel[data-l="${idx}"]`);
  if (tr && tr.parentElement){
    const r = resumoLinha(l), tds = tr.parentElement.querySelectorAll('td');
    if (tds.length >= 6){
      tds[0].textContent = r.C || '';
      tds[1].textContent = r.E || '';
      tds[2].textContent = r.PA || '';
      tds[3].textContent = r.S || '';
      tds[4].textContent = r.NA || '';
      tds[5].innerHTML = `<b>${r.pct == null ? '—' : fmt(100 * r.pct, 0) + '%'}</b>`;
    }
  }
  // O rodapé começa com um `td` de colspan 6, que ocupa as colunas de contagem: a primeira
  // coluna de quilômetro é `pe[1]`, não `pe[0]`. Escrever em `pe[col]` jogava o percentual do
  // primeiro quilômetro no espaçador e deslocava todos os outros uma coluna à esquerda — a
  // repintura parcial mostrava o número do vizinho. Achado pelo bloco 12 do
  // `testar-fluxos.py`, que compara a repintura parcial com a completa.
  const pe = alvo.querySelectorAll('tfoot td');
  ids.forEach(id => {
    const col = segs.findIndex(sg => sg.id === id);
    if (col >= 0 && pe[col + 1]){
      const p = pctSeg(id);
      pe[col + 1].textContent = p === null ? '' : fmt(p * 100, 0);
    }
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
