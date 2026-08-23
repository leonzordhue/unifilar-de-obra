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
    <details class="avancado">
      <summary>Quantidade contratada por serviço</summary>
      <div>
      ${ligados.length ? `<table class="tabQt"><tbody>${ligados.map(s => `<tr>
          <td>${esc(s.nome)}</td>
          <td><input type="number" step="any" min="0" data-qt="${esc(s.nome)}"
            value="${s.km_contratado == null ? '' : s.km_contratado}" placeholder="km"></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="dica">Marque serviços para informar a quantidade de cada um.</div>'}
      <div class="dica">Em quilômetros. Serviço sem quantidade é medido só contra o trecho.</div>
      </div>
    </details>`;
  $$('#blocoContrato [data-ct]').forEach(i => i.oninput = () => {
    const v = i.value.trim();
    dadosContrato()[i.dataset.ct] = i.type === 'number' ? (v === '' ? null : +v) : v;
    salvaLocal();
  });
  $$('#blocoContrato [data-qt]').forEach(i => i.oninput = () => {
    const s = S.svc.find(x => x.nome === i.dataset.qt);
    if (s) s.km_contratado = i.value.trim() === '' ? null : +i.value;
    render(); salvaLocal();
  });
}

/* ---------------------------------------------------------------- quadro da obra */
/** Uma linha por serviço, em quilômetro, no formato que o escritório reporta: quanto está
    em cada situação, quanto foi executado e quanto isso representa do contratado. */
function quadroObra(){
  const segs = segsNoTrecho();
  const porSvc = new Map();
  S.svc.filter(s => s.on).forEach(s => porSvc.set(s.nome, {
    svc: s.nome, cor: corServico(s.nome), contratado: kmContratado(s.nome),
    C: 0, E: 0, PA: 0, S: 0, P: 0, NA: 0, kmTrecho: 0
  }));
  // O serviço ocupa vários lados e o quilômetro conta UMA vez — pelo estado MENOS avançado.
  //
  // Medido em 21/08, antes desta correção: limpeza lateral concluída no acostamento direito e
  // prevista no esquerdo entrava como «1 km concluído». Meio serviço virava serviço inteiro
  // num quadro que vai a medição.
  //
  // Menos avançado, e não média: «concluído» num quadro de medição significa que não há mais
  // nada a fazer ali, e com um lado pendente há. A média daria meio quilômetro concluído e
  // meio previsto — número certo e leitura errada, porque ninguém saberia qual metade.
  // «Não se aplica» não conta como atraso: um lado inaplicável não segura o quilômetro.
  const ordem = {C: 5, E: 4, PA: 3, S: 2, P: 1};
  porSvc.forEach((q, nome) => {
    const lados = (S.svc.find(s => s.nome === nome) || {lados: []}).lados;
    segs.forEach(sg => {
      const km = kmNoTrecho(sg);
      q.kmTrecho += km;
      let pior = null, todosNA = lados.length > 0;
      lados.forEach(ld => {
        const v = S.dados[chave({svc: nome, lado: ld}, sg.id)] || 'P';
        if (v === 'NA') return;                 // lado inaplicável não segura o quilômetro
        todosNA = false;
        if (pior === null || ordem[v] < ordem[pior]) pior = v;
      });
      q[todosNA ? 'NA' : (pior === null ? 'P' : pior)] += km;
    });
  });
  return [...porSvc.values()].map(q => {
    q.pctTrecho = q.kmTrecho > 0 ? q.C / q.kmTrecho : null;
    q.pctContrato = q.contratado ? q.C / q.contratado : null;
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
  const temCt = q.some(x => x.contratado);
  const km = v => v > 0 ? fmt(v, 1) : '—';
  const pc = v => v == null ? '—' : fmt(100 * v, 1) + '%';
  const soma = k => q.reduce((a, x) => a + x[k], 0);
  // A célula com quilômetro ganha o fundo da situação, na paleta do catálogo — que é a do
  // escritório: verde concluído, laranja em andamento. Célula em zero fica branca, senão o
  // quadro vira um mosaico e a cor deixa de destacar o que importa.
  const cel = (v, cod) => v > 0.001
    ? `<td style="background:${corStatus(cod)};color:${txtStatus(cod)}">${km(v)}</td>`
    : '<td>—</td>';
  const somaCt = q.reduce((a, x) => a + (x.contratado || 0), 0);
  return `<table><thead><tr><th class="t">Serviço</th>
      ${temCt ? '<th>Contratado</th>' : ''}
      <th style="background:${corStatus('C')};color:${txtStatus('C')}">Concluído</th>
      <th style="background:${corStatus('E')};color:${txtStatus('E')}">Em and.</th>
      <th style="background:${corStatus('PA')};color:${txtStatus('PA')}">Paralisado</th>
      <th style="background:${corStatus('S')};color:${txtStatus('S')}">Sem plan.</th>
      <th>Previsto</th>
      <th>% do trecho</th>${temCt ? '<th>% do contrato</th>' : ''}</tr></thead><tbody>${
    q.map(x => `<tr><td class="t">${esc(x.svc)}</td>
      ${temCt ? `<td>${km(x.contratado || 0)}</td>` : ''}
      ${cel(x.C, 'C')}${cel(x.E, 'E')}${cel(x.PA, 'PA')}${cel(x.S, 'S')}${cel(x.P, '')}
      <td>${pc(x.pctTrecho)}</td>
      ${temCt ? `<td>${x.excedeContrato
        ? `<b title="executado acima do contratado">${pc(x.pctContrato)} ⚠</b>`
        : pc(x.pctContrato)}</td>` : ''}</tr>`).join('')}
    <tr><td class="t"><b>Total</b></td>
      ${temCt ? `<td><b>${km(somaCt)}</b></td>` : ''}
      <td><b>${km(soma('C'))}</b></td><td><b>${km(soma('E'))}</b></td>
      <td><b>${km(soma('PA'))}</b></td><td><b>${km(soma('S'))}</b></td>
      <td><b>${km(soma('P'))}</b></td>
      <td><b>${pc(soma('kmTrecho') > 0 ? soma('C') / soma('kmTrecho') : null)}</b></td>
      ${temCt ? `<td><b>${pc(somaCt > 0 ? soma('C') / somaCt : null)}</b></td>` : ''}</tr>
    </tbody></table>
    ${q.some(x => x.excedeContrato) ? `<div class="meta"><b>⚠ Executado acima do
      contratado</b> em ${q.filter(x => x.excedeContrato).length} serviço(s):
      ${esc(q.filter(x => x.excedeContrato).map(x => x.svc).join(', '))}. Isso não é avanço
      acima de 100% — ou a quantidade contratada informada está errada, ou foi lançado
      serviço além do que o contrato prevê. Confira antes de usar este quadro em medição.
      </div>` : ''}
    <div class="meta">Em quilômetros. Um quilômetro conta uma vez por serviço, pelo estado
      mais avançado entre os lados. <b>% do trecho</b> mede onde a obra está; <b>% do
      contrato</b> mede quanto falta entregar${temCt ? '' : ' — e só aparece quando a '
      + 'quantidade contratada é informada'}.</div>`;
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
