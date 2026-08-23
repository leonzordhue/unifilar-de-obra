/* Painel de conformidade: cartoes, tabela por faixa de quilometros e grafico por tipo de
   controle.

   Este modulo NAO calcula conformidade: pede a `resumoEnsaios` e `resumoPorGrupo`
   (app/10-ensaios.js, contrato do COORDENACAO.md item 4). Dois calculos do mesmo numero em
   telas diferentes e defeito, nao redundancia.

   Regra que atravessa o arquivo inteiro: percentual `null` e AUSENCIA DE BASE, e nao zero
   por cento. Quilometro que ninguem mandou ensaiar sai cinza e escrito «sem base» — pintar
   de vermelho o que nao foi pedido e informacao falsa dentro de fiscalizacao de contrato. */

// O painel deixou de ser aba: ele abre junto com a matriz, na vista «Controle». O
// contêiner é criado aqui porque não há mais registro de aba para criá-lo.
//
// A GRADE VEM PRIMEIRO. Enquanto o painel abria por cima, a planilha de quadradinhos —
// que é o que o cliente pediu para pintar — começava a 1.779 px de rolagem, atrás de um
// painel de 1.684 px. Quem abre a obra tem de ver os quilômetros, não o resumo deles.
function caixaPainel(){
  let d = document.querySelector('#vPainel');
  if (!d){
    d = document.createElement('div');
    d.id = 'vPainel';
    d.className = 'hidden';
    const alvo = document.querySelector('#conteudo'), matriz = document.querySelector('#vMatriz');
    if (alvo) alvo.insertBefore(d, matriz ? matriz.nextSibling : null);
  }
  return d;
}

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
  // UM QUILÔMETRO CONTA UMA VEZ POR SERVIÇO, e os lados colapsam pelo estado menos avançado
  // — a regra mora em `estadoDoKm` (app/15-contrato.js) e é a mesma do quadro da obra.
  //
  // Até 23/08 este laço percorria `linhasMatriz()`, que é serviço × lado: o mesmo quilômetro
  // entrava duas vezes e o cartão dizia «616 de 3.228 quilômetros» num trecho de 269, com
  // 19,1% ao lado dos 24,4% do quadro. Duas contas do mesmo número em telas diferentes é
  // defeito, não redundância — por isso a regra é chamada daqui, nunca copiada.
  const svcs = S.svc.filter(s => s.on).map(s => s.nome);
  svcs.forEach(nome => segs.forEach(sg => {
    const v = estadoDoKm(nome, sg.id);
    if (v === 'NA') return;
    const km = kmNoTrecho(sg);
    r.val++; r.kmVal += km;
    if (v === 'C'){ r.C++; r.kmC += km; }
  }));
  // A extensão fica em `kmC`/`kmVal` para quem precisar dela — o croqui precisa; o
  // acompanhamento, não.
  r.pct = r.val > 0 ? r.C / r.val : null;
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
             `${av.C} de ${av.val} quilômetro(s) de serviço concluído(s) · trecho de ${
               segs.length} km`)}
      ${semCatalogo ? '' : card('Conformidade', pct(en.pctConformidade),
             en.pctConformidade == null ? 'nenhum ensaio com critério julgado'
               : `${en.conformes} conforme(s) de ${en.conformes + en.naoConformes} julgado(s)`)}
      ${semCatalogo ? '' : card('Ensaios executados',
             en.previstos == null ? String(en.executados) : pct(en.pctExecutado),
             en.previstos == null
               ? `${en.executados} lançado(s) · sem frequência no catálogo para prever`
               : `${en.executados} de ${fmt(en.previstos, 0)} previstos`)}
      ${semCatalogo ? '' : card('Não conformidades', abertas.length,
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
    ${graficoServicos()}
    ${graficoGrupos(ids)}`;

  $$('#vPainel button[data-faixa]').forEach(b => b.onclick = () => {
    faixaKm = +b.dataset.faixa;
    pintaPainel();
  });
}

function tabelaFaixas(){
  const temEns = catalogoEnsaios().length > 0;
  const fs = faixasPainel(faixaKm);
  if (!fs.length) return '<div class="aviso" style="margin:0 14px">Nenhum quilômetro no trecho em obra.</div>';
  return `<div style="padding:0 14px 16px"><table class="res">
    <thead><tr>
      <th>Faixa</th><th>Extensão</th><th>Avanço</th>${temEns ? `<th>Ensaios</th>
      <th>Previstos</th><th>% exec.</th><th>Conformes</th><th>Não conf.</th>
      <th>Conformidade</th><th></th>` : ''}
    </tr></thead><tbody>${fs.map(f => {
      const av = avancoEm(f.ids), en = resumoEnsaios(f.ids);
      return `<tr>
        <td><b>KM ${fmt(f.ini, 0)} – ${fmt(f.fim, 0)}</b></td>
        <td>${fmt(f.ext, 3)} km</td>
        <td>${pct(av.pct)}</td>
        ${temEns ? `<td>${en.executados}</td>
        <td>${en.previstos == null ? '—' : fmt(en.previstos, 0)}</td>
        <td>${pct(en.pctExecutado)}</td>
        <td>${en.conformes}</td>
        <td${en.naoConformes ? ' style="color:#D9534F;font-weight:700"' : ''}>${en.naoConformes}</td>
        <td><b>${pct(en.pctConformidade)}</b></td>
        <td>${semaforo(en.pctConformidade)}</td>` : ''}
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- gráfico */
/** Barras por tipo de controle, em SVG escrito à mão — sem biblioteca de gráfico: a
    plataforma serve tudo da própria pasta e abre sem internet. */
/** Avanço por serviço DENTRO DO TRECHO EM OBRA — quilômetros concluídos sobre os
    quilômetros do trecho. Foi «Avanço sobre o contratado» até 23/08: o cliente tirou a
    quantidade contratada desta fase («é pra organizar o andamento da obra e não fazer a
    medição»), e um gráfico de medição ao lado de um quadro sem medição dava duas respostas
    para «avanço de quê». A base agora é a mesma da matriz, do quadro e do croqui: uma só. */
function graficoServicos(){
  if (typeof quadroObra !== 'function') return '';
  const q = quadroObra().filter(x => x.pctTrecho != null);
  if (!q.length) return '';
  const L = 200, W = 620, H = 22, GAP = 8, TOPO = 34;
  const larg = W - L - 92;
  const alt = TOPO + q.length * (H + GAP) + 14;
  const barras = q.map((x, i) => {
    const y = TOPO + i * (H + GAP);
    const p = Math.max(0, Math.min(1, x.pctTrecho));
    return `
      <text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="11" fill="#3A4A5A">${esc(x.svc)}</text>
      <rect x="${L}" y="${y}" width="${larg}" height="${H}" rx="3" fill="#EEF2F6"/>
      <rect x="${L}" y="${y}" width="${(p * larg).toFixed(1)}" height="${H}" rx="3"
            fill="${x.cor || '#1F4E79'}"/>
      <text x="${L + larg + 8}" y="${y + 15}" font-size="11" fill="#1F2933">${
        fmt(x.pctTrecho * 100, 1)}%</text>
      <title>${esc(x.svc)}: ${fmt(x.C, 0)} de ${fmt(x.kmTrecho, 0)} quilômetro(s) do trecho</title>`;
  }).join('');
  return `<div style="padding:0 14px 18px">
    <svg viewBox="0 0 ${W} ${alt}" width="100%" height="${alt}" role="img"
         aria-label="Avanço por serviço no trecho em obra">
      <text x="14" y="18" font-size="13" font-weight="700" fill="#1F4E79">Avanço por serviço, no trecho</text>
      <line x1="${L}" y1="${TOPO - 6}" x2="${W - 92}" y2="${TOPO - 6}" stroke="#D4DBE2"/>
      ${barras}
    </svg>
    <div class="dica">Quilômetros concluídos ÷ quilômetros do trecho em obra. Mesma base do
      quadro acima — acompanhamento, não medição.</div>
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

/* ------------------------------------------------- três abas em vez de seis */
/* O Paulo abriu a plataforma e disse: «muito confuso, era pra ser algo simples». Medido:
   88 elementos interativos visíveis numa tela cujo trabalho é escolher a rodovia, marcar o
   quilômetro e dizer o serviço.

   O corte das abas é este, e a ordem é a do trabalho real:

     Obra ......... o mapa e a faixa — onde se lança
     Controle ..... o painel e a matriz juntos: o quadro em cima, a planilha embaixo
     Relatório .... o documento que vai para o processo

   Croqui, Resumo e Painel deixam de ser abas: o croqui é gerado de dentro do relatório, o
   painel passou a abrir junto com a matriz, e o resumo era a mesma informação do quadro da
   obra contada em posições em vez de quilômetros — duas telas para o mesmo número é o tipo
   de coisa que faz uma plataforma parecer difícil.

   Os botões antigos continuam no DOM, ocultos: as provas que os acionam por
   `element.click()` seguem funcionando, e desfazer isto é apagar esta seção. */
const ABAS_OCULTAS = ['croqui', 'resumo', 'painel'];
const ROTULOS = {mapa: 'Obra', matriz: 'Controle', rel: 'Relatório'};

function reorganizaAbas(){
  const barra = $('#abas');
  if (!barra || barra.dataset.simples) return;
  barra.dataset.simples = '1';
  caixaPainel();
  $$('#abas button[data-v]').forEach(b => {
    const v = b.dataset.v;
    if (ABAS_OCULTAS.includes(v)) b.style.display = 'none';
    if (ROTULOS[v]) b.textContent = ROTULOS[v];
    b.addEventListener('click', () => setTimeout(juntaVistas, 0));
  });
  agrupaExportacoes();
  juntaVistas();
}

/** Exportar CSV, Pacote CDE e Imprimir viram um menu só.

    São três saídas do mesmo trabalho e ficavam permanentemente na barra, ao lado das abas,
    competindo com o gesto principal. Agora ficam atrás de «Exportar», que é onde a pessoa
    procura quando quer sair com o resultado. Os botões continuam sendo os MESMOS nós — os
    ids, os eventos e as provas que os acionam por `element.click()` seguem valendo. */
function botaoCroquiPNG(){
  const b = document.createElement('button');
  b.className = 'mini';
  b.id = 'btCroquiPNG';
  b.textContent = 'Croqui em PNG';
  b.onclick = async () => {
    if (!S.eixo){ alert('Escolha um eixo antes de gerar o croqui.'); return; }
    const antes = b.textContent;
    b.textContent = 'montando a imagem…';
    b.disabled = true;
    try {
      if (!S.croqui && typeof geraCroqui === 'function') S.croqui = await geraCroqui();
      if (!S.croqui){ alert('Não foi possível montar a imagem do croqui.'); return; }
      const a = document.createElement('a');
      a.href = S.croqui.url;
      a.download = `croqui-${(S.obra || S.eixo.nome).replace(/[^\w\-]+/g, '-').toLowerCase()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } finally {
      b.textContent = antes;
      b.disabled = false;
    }
  };
  return b;
}
function agrupaExportacoes(){
  const barra = $('#abas');
  const alvos = ['#btCSV', '#btCDE', '#btImprimir'].map(x => $(x)).filter(Boolean);
  if (!barra || alvos.length < 2 || $('#menuExportar')) return;
  const caixa = document.createElement('div');
  caixa.id = 'menuExportar';
  caixa.style.cssText = 'position:absolute;right:10px;top:100%;z-index:60;background:#fff;'
    + 'border:1px solid #D4DBE2;border-radius:8px;padding:6px;display:none;'
    + 'box-shadow:0 8px 24px rgba(15,26,38,.16);min-width:190px';
  const bt = document.createElement('button');
  bt.className = 'mini';
  bt.id = 'btExportar';
  bt.textContent = 'Exportar ▾';
  bt.onclick = () => {
    const aberto = caixa.style.display === 'block';
    caixa.style.display = aberto ? 'none' : 'block';
  };
  document.addEventListener('click', ev => {
    if (!caixa.contains(ev.target) && ev.target !== bt) caixa.style.display = 'none';
  });
  // A Cortanna achou isto ao reescrever o manual: com a aba «Croqui» oculta, o gesto
  // «Baixar PNG» ficou sem porta. A imagem continuava no relatório e no pacote CDE — a
  // informação estava preservada —, mas o ARQUIVO que se anexa a ofício não tinha como ser
  // obtido. Ele volta aqui, ao lado das outras saídas, que é onde a pessoa procura.
  alvos.push(botaoCroquiPNG());
  alvos.forEach(b => {
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.textAlign = 'left';
    b.style.marginBottom = '4px';
    caixa.appendChild(b);
  });
  barra.style.position = 'relative';
  barra.appendChild(bt);
  barra.appendChild(caixa);
}

/** «Controle» mostra painel e matriz na mesma rolagem: o quadro da obra e a planilha. */
function juntaVistas(){
  const painel = caixaPainel(), matriz = $('#vMatriz');
  if (!painel || !matriz) return;
  if (S.vista === 'matriz'){
    if (!juntaVistas.dentro){ juntaVistas.dentro = true; pintaPainel(); juntaVistas.dentro = false; }
    painel.classList.remove('hidden');
    painel.style.borderTop = '1px solid #D4DBE2';
    // a ordem pode ter sido invertida por quem criou a matriz depois do painel
    if (painel.previousElementSibling !== matriz) matriz.after(painel);
  } else if (S.vista !== 'painel'){
    painel.classList.add('hidden');
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(reorganizaAbas, 0));
if (document.readyState !== 'loading') setTimeout(reorganizaAbas, 0);
