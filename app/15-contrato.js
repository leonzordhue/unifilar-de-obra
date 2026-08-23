/* Contrato da obra e quadro de avanco por servico.

   Vem de estudar a planilha viva do DMOB (`11-CONTROLE AM-010`), que e referencia de
   construcao e nao fonte de dados: a plataforma tem de FAZER o que a planilha faz, com o
   usuario preenchendo — nao importar o que ja esta feito.

   O que a planilha ensinou, e que faltava aqui:

   1. A obra tem identidade contratual: objeto, numero, valor e duas vigencias (de contrato
      e de execucao, que nao coincidem). E isso que abre um relatorio de fiscalizacao.
   2. O avanco de cada servico e medido contra a QUANTIDADE CONTRATADA, nao contra a
      extensao do trecho. Remendo profundo com 175 km contratados numa obra de 250 km, com
      175 executados, esta 100% — nao 70%. As duas medidas aparecem lado a lado, porque a
      do trecho diz onde a obra esta e a do contrato diz quanto falta entregar. */

/* ---------------------------------------------------------------- estado */
const CAMPOS_CONTRATO = [
  {k: 'objeto', rot: 'Objeto', tipo: 'text', dica: 'como está no contrato'},
  {k: 'valor', rot: 'Valor (R$)', tipo: 'number', dica: ''},
  {k: 'vigencia_contrato', rot: 'Vigência do contrato', tipo: 'text', dica: 'ex.: 15/06/2022 a 16/05/2026'},
  {k: 'vigencia_execucao', rot: 'Vigência de execução', tipo: 'text', dica: ''}
];
const dadosContrato = () => (S.contratoDados || (S.contratoDados = {}));

/** Quilômetros contratados de um serviço. `null` é «não informado» — e não zero. */
function kmContratado(nome){
  const s = S.svc.find(x => x.nome === nome);
  const v = s && s.km_contratado;
  return v == null || !isFinite(v) || v <= 0 ? null : +v;
}

/* ---------------------------------------------------------------- lateral */
function pintaContrato(){
  const cx = $('#blocoContrato');
  if (!cx) return;
  const d = dadosContrato();
  const ligados = S.svc.filter(s => s.on);
  cx.innerHTML = `
    <details class="avancado">
      <summary>Objeto, valor e vigências</summary>
      <div class="campo">
      ${CAMPOS_CONTRATO.map(c => `<label class="rotCampo">${esc(c.rot)}
        <input type="${c.tipo}" ${c.tipo === 'number' ? 'step="any"' : ''} data-ct="${c.k}"
          value="${esc(d[c.k] == null ? '' : d[c.k])}"
          placeholder="${esc(c.dica)}"></label>`).join('')}
      </div>
    </details>
    </details>`;
  // A QUANTIDADE CONTRATADA SAIU DA TELA nesta rodada, por ordem do cliente: «é pra gente
  // organizar o andamento da obra e não fazer a medição no momento» — medição é outro
  // projeto. Saiu o campo de digitar, NÃO o dado: `km_contratado` continua vivo dentro de
  // cada serviço, viaja no projeto salvo, e o quadro e o relatório seguem mostrando
  // «% do contrato» para a obra que já tem o número. Apagar o dado de quem já digitou seria
  // perda de trabalho — e o dia em que a medição voltar, ela volta sobre o que existe.
  $$('#blocoContrato [data-ct]').forEach(i => i.oninput = () => {
    const v = i.value.trim();
    dadosContrato()[i.dataset.ct] = i.type === 'number' ? (v === '' ? null : +v) : v;
    salvaLocal();
  });
}

/* ---------------------------------------------------------------- quadro da obra */
/** Uma linha por serviço, em quilômetro, no formato que o escritório reporta: quanto está
    em cada situação, quanto foi executado e quanto isso representa do contratado. */
/** O estado de UM serviço em UM quilômetro, colapsando os lados pelo MENOS avançado.

    O serviço ocupa vários lados e o quilômetro conta UMA vez. Medido em 21/08, antes desta
    regra: limpeza lateral concluída no acostamento direito e prevista no esquerdo entrava
    como «1 km concluído» — meio serviço virava serviço inteiro num quadro que vai a medição.

    Menos avançado, e não média: «concluído» significa que não há mais nada a fazer ali, e com
    um lado pendente há. A média daria meio quilômetro concluído e meio previsto: número certo
    e leitura errada, porque ninguém saberia qual metade. «Não se aplica» não conta como
    atraso — um lado inaplicável não segura o quilômetro.

    Mora aqui sozinha, e não dentro do `quadroObra()`, porque o painel precisa da MESMA regra:
    o cartão «Avanço físico» contava serviço×lado e dizia 3.228 «quilômetros» onde há 269 —
    contava o mesmo quilômetro duas vezes, uma por lado, e a tela mostrava 19,1% ao lado dos
    24,4% do quadro. Duas contas do mesmo número em telas diferentes é o defeito que a casa
    proíbe; por isso extraída em vez de copiada. Pedida pelo HAL9000 em 23/08. */
const ORDEM_ESTADO = {C: 5, E: 4, PA: 3, S: 2, P: 1};
function estadoDoKm(nomeSvc, segId){
  const lados = (S.svc.find(s => s.nome === nomeSvc) || {lados: []}).lados || [];
  let pior = null, todosNA = lados.length > 0;
  lados.forEach(ld => {
    const v = S.dados[chave({svc: nomeSvc, lado: ld}, segId)] || 'P';
    if (v === 'NA') return;
    todosNA = false;
    if (pior === null || ORDEM_ESTADO[v] < ORDEM_ESTADO[pior]) pior = v;
  });
  return todosNA ? 'NA' : (pior === null ? 'P' : pior);
}

function quadroObra(){
  const segs = segsNoTrecho();
  const porSvc = new Map();
  S.svc.filter(s => s.on).forEach(s => porSvc.set(s.nome, {
    svc: s.nome, cor: corServico(s.nome), contratado: kmContratado(s.nome),
    foraCatalogo: !!s.foraCatalogo,
    // CONTAGEM: o quilômetro vale 1, como a linha vale 1 na planilha da casa. O KM 268 da
    // AM-010 tem 0,062 km de sobra e a equipe conta 257 concluídos; somando extensão saía
    // 256,06 — foi este número que o cliente chamou de «ele acha que tem mais km».
    C: 0, E: 0, PA: 0, S: 0, P: 0, NA: 0,
    // EXTENSÃO: guardada à parte, e é ela que sustenta percentual e medição. Contagem e
    // extensão nunca se derivam uma da outra: num recorte KM 12,5–18,3 as pontas valem meio
    // quilômetro cada, e contar célula ali inflou o avanço em 5 pontos numa medição de 21/08.
    km: {C: 0, E: 0, PA: 0, S: 0, P: 0, NA: 0}, trechos: 0, kmTrecho: 0
  }));
  porSvc.forEach((q, nome) => {
    segs.forEach(sg => {
      const km = kmNoTrecho(sg);
      q.kmTrecho += km;
      q.trechos += 1;
      const est = estadoDoKm(nome, sg.id);
      q[est] += 1;        // contagem, como a planilha
      q.km[est] += km;    // extensão, para o percentual e para o dia da medição
    });
  });
  return [...porSvc.values()].map(q => {
    q.kmC = q.km.C;
    // UMA BASE SÓ NA PLATAFORMA: o avanço do acompanhamento é contagem de quilômetros, como
    // na planilha da casa e como o `resumoLinha` da matriz passou a fazer por decisão do
    // coordenador em 23/08. Duas bases fariam a mesma obra mostrar dois avanços — matriz
    // dizendo 9% e quadro dizendo 4% — e é isso que destrói a confiança num relatório.
    // O preço está declarado nas notas técnicas: num recorte que começa ou termina no meio
    // de um quilômetro, a ponta conta 1 e o avanço sai otimista em relação à geodésia.
    q.pctTrecho = q.trechos > 0 ? q.C / q.trechos : null;
    // O contrato é medição, e medição é extensão: quilômetro contratado é quilômetro de
    // estrada, não posição de planilha. Aqui a base continua sendo `kmC`, de propósito.
    q.pctContrato = q.contratado ? q.km.C / q.contratado : null;
    // Executado acima do contratado não é avanço: ou a quantidade contratada está errada, ou
    // se lançou serviço fora do contrato. Medido na AM-010: 259 km lançados contra 175
    // contratados dariam «148%» impressos num quadro de medição, sem uma palavra.
    q.excedeContrato = q.pctContrato != null && q.pctContrato > 1.0005;
    return q;
  });
}

/** O quadro em HTML, usado no resumo e no relatório. */
function tabelaQuadroObra(){
  const q = quadroObra();
  if (!q.length) return '';
  // SEM AS COLUNAS DE CONTRATO nesta fase, por ordem do cliente: «é pra gente organizar o
  // andamento da obra e não fazer a medição no momento». Sem campo para digitar quantidade,
  // uma coluna «Contratado» e um «% do contrato» ficariam mostrando número que ninguém mais
  // atualiza — pior que não mostrar. O dado (`km_contratado`) continua guardado no projeto e
  // o cálculo (`pctContrato`) continua existindo: a medição volta noutro projeto, sobre o
  // que já existe.
  const num = v => v > 0 ? String(v) : '—';
  const pc = v => v == null ? '—' : fmt(100 * v, 1) + '%';
  const soma = k => q.reduce((a, x) => a + x[k], 0);
  // O cabeçalho colorido precisa de respiro: quatro etiquetas grudadas leem como planilha
  // exportada. Uma borda branca de 3 px separa sem inventar traço novo, e o número no meio
  // da célula é o que faz a coluna ser lida como coluna.
  const CAB = 'padding:5px 9px;border-left:3px solid #fff;text-align:center';
  const th = (cod, rot) => `<th style="${CAB};background:${corStatus(cod)};color:${
    txtStatus(cod)}">${rot}</th>`;
  // A célula com o quilômetro ganha o fundo da situação, na paleta do escritório. Zero fica
  // branca: senão o quadro vira mosaico e a cor deixa de destacar o que importa.
  const cel = (v, cod) => v > 0
    ? `<td style="background:${corStatus(cod)};color:${txtStatus(cod)};text-align:center">${
        num(v)}</td>`
    : '<td style="text-align:center">—</td>';
  return `<table><thead><tr><th class="t">Serviço</th>
      ${th('C', 'Concluído')}${th('E', 'Em and.')}${th('PA', 'Paralisado')}${th('S', 'Sem plan.')}
      <th style="${CAB}">Previsto</th>
      <th style="${CAB}">% do trecho</th></tr>
      <tr><th class="t" style="font-weight:400;font-size:10px">quilômetros contados</th>
      <th colspan="5" style="font-weight:400;font-size:10px;text-align:center">um quilômetro
        conta 1, como a linha da planilha</th>
      <th style="font-weight:400;font-size:10px;text-align:center">mesma base da matriz</th>
      </tr></thead><tbody>${
    q.map(x => `<tr><td class="t">${esc(x.svc)}${x.foraCatalogo
        ? ' <span style="font-size:9.5px;color:var(--ambar)">fora do catálogo</span>' : ''}</td>
      ${cel(x.C, 'C')}${cel(x.E, 'E')}${cel(x.PA, 'PA')}${cel(x.S, 'S')}${cel(x.P, '')}
      <td style="text-align:center">${pc(x.pctTrecho)}</td></tr>`).join('')}
    <tr><td class="t"><b>Total</b></td>
      <td style="text-align:center"><b>${num(soma('C'))}</b></td>
      <td style="text-align:center"><b>${num(soma('E'))}</b></td>
      <td style="text-align:center"><b>${num(soma('PA'))}</b></td>
      <td style="text-align:center"><b>${num(soma('S'))}</b></td>
      <td style="text-align:center"><b>${num(soma('P'))}</b></td>
      <td style="text-align:center"><b>${pc(soma('trechos') > 0
        ? soma('C') / soma('trechos') : null)}</b></td></tr>
    </tbody></table>
    <div class="meta">Quilômetros contados: um quilômetro conta 1 por serviço, pelo estado
      <b>menos avançado</b> entre os lados — com um lado pendente, o quilômetro ainda tem o
      que fazer. <b>% do trecho</b> é a mesma base da matriz e do painel.</div>`;
}

/** Cabeçalho de identificação do contrato, para o relatório. */
function blocoContratoRel(){
  const d = dadosContrato();
  const num = (S.contrato || '').trim();
  const linhas = [];
  if (num) linhas.push(['Contrato', num]);
  if (d.objeto) linhas.push(['Objeto', d.objeto]);
  if (d.valor) linhas.push(['Valor', 'R$ ' + fmt(d.valor, 2)]);
  if (d.vigencia_contrato) linhas.push(['Vigência do contrato', d.vigencia_contrato]);
  if (d.vigencia_execucao) linhas.push(['Vigência de execução', d.vigencia_execucao]);
  if (!linhas.length) return '';
  return `<table><tbody>${linhas.map(([a, b]) =>
    `<tr><td class="t">${esc(a)}</td><td class="t">${esc(b)}</td></tr>`).join('')}</tbody></table>`;
}


/* ---------------------------------------------------------------- gráfico para análise */
/** Barras empilhadas por serviço, em SVG escrito à mão.

    Sem biblioteca de gráfico: o repositório serve tudo da própria pasta, e dependência nova
    precisa ser baixada, versionada e justificada. SVG também sobrevive à impressão sem
    perder nitidez, o que um canvas não faz.

    O que o gráfico responde de longe, e a tabela não: qual frente está parada, qual está
    quase pronta, e qual passou do contratado — este último com o traço de referência. */
function graficoQuadroObra(){
  const q = quadroObra().filter(x => x.kmTrecho > 0.001);
  if (!q.length) return '';
  const temCt = q.some(x => x.contratado);
  // Previsto tem código 'P' no catálogo: buscar a cor por '' devolvia branco, a barra
  // desaparecia e as demais ficavam minúsculas contra a escala do trecho inteiro — o
  // gráfico deixava de comparar, que é a única coisa que ele existe para fazer.
  const ordem = [['C', 'C'], ['E', 'E'], ['PA', 'PA'], ['S', 'S'], ['P', 'P']];
  // a escala é o maior entre a extensão do trecho e o maior contratado: sem isso, um serviço
  // com contratado acima do trecho sairia com a barra estourando a área do desenho
  const esc = Math.max(...q.map(x => Math.max(x.kmTrecho, x.contratado || 0)));
  const LB = 15, GAP = 7, ESQ = 168, DIR = 62, TOPO = 26;
  const larg = 760, alt = TOPO + q.length * (LB + GAP) + 10;
  const px = km => (larg - ESQ - DIR) * km / (esc || 1);
  const linhas = q.map((x, i) => {
    const y = TOPO + i * (LB + GAP);
    let cx = ESQ, barras = '';
    ordem.forEach(([cod, ]) => {
      const v = x[cod];
      if (!v || v <= 0.001) return;
      const w = px(v);
      barras += `<rect x="${cx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${LB}"
        fill="${corStatus(cod)}"><title>${esc0(x.svc)} — ${esc0(nomeStatus(cod))}: ${fmt(v, 1)} km</title></rect>`;
      cx += w;
    });
    const ct = x.contratado ? `<line x1="${(ESQ + px(x.contratado)).toFixed(1)}" y1="${y - 2}"
      x2="${(ESQ + px(x.contratado)).toFixed(1)}" y2="${y + LB + 2}"
      stroke="#16324F" stroke-width="2" stroke-dasharray="3 2"><title>contratado: ${fmt(x.contratado, 0)} km</title></line>` : '';
    const pv = temCt && x.contratado ? x.pctContrato : x.pctTrecho;
    return `<text x="${ESQ - 6}" y="${y + LB / 2}" text-anchor="end" dominant-baseline="middle"
        font-size="10.5">${esc0(x.svc.length > 26 ? x.svc.slice(0, 25) + '…' : x.svc)}</text>
      ${barras}${ct}
      <text x="${larg - DIR + 6}" y="${y + LB / 2}" dominant-baseline="middle" font-size="10.5"
        font-weight="600" fill="${x.excedeContrato ? '#B0413E' : '#16324F'}">${
        pv == null ? '—' : fmt(100 * pv, 0) + '%'}</text>`;
  }).join('');
  const legenda = ordem.map(([cod, ], i) =>
    `<rect x="${ESQ + i * 122}" y="6" width="10" height="10" fill="${corStatus(cod)}"
       stroke="#8E9AA6" stroke-width=".5"/>
     <text x="${ESQ + i * 122 + 14}" y="11.5" font-size="9.5" dominant-baseline="middle"
       >${esc0(nomeStatus(cod === 'P' ? '' : cod))}</text>`).join('');
  return `<svg viewBox="0 0 ${larg} ${alt}" width="100%" style="max-width:${larg}px"
      font-family="system-ui, sans-serif" role="img"
      aria-label="Avanço por serviço, em quilômetro">
      ${legenda}${linhas}
    </svg>
    <div class="meta">Em quilômetro, escala comum a todos os serviços. O traço vertical marca
      a quantidade contratada${temCt ? '' : ' (nenhuma informada ainda)'}; barra que passa dele
      é executado acima do contratado. O percentual à direita é
      ${temCt ? 'do contrato onde há quantidade informada, e do trecho nos demais'
              : 'do trecho'}.</div>`;
}
const esc0 = t => esc(t);
