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
    <div class="campo">
      ${CAMPOS_CONTRATO.map(c => `<label class="rotCampo">${esc(c.rot)}
        <input type="${c.tipo}" ${c.tipo === 'number' ? 'step="any"' : ''} data-ct="${c.k}"
          value="${esc(d[c.k] == null ? '' : d[c.k])}"
          placeholder="${esc(c.dica)}"></label>`).join('')}
    </div>
    <div class="campo">
      <label>Quantidade contratada por serviço</label>
      ${ligados.length ? `<table class="tabQt"><tbody>${ligados.map(s => `<tr>
          <td>${esc(s.nome)}</td>
          <td><input type="number" step="any" min="0" data-qt="${esc(s.nome)}"
            value="${s.km_contratado == null ? '' : s.km_contratado}" placeholder="km"></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="dica">Marque serviços para informar a quantidade de cada um.</div>'}
      <div class="dica">Em quilômetros, como no quadro de controle da obra. Serviço sem
        quantidade informada é medido só contra o trecho.</div>
    </div>`;
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
  // o serviço ocupa vários lados; o quilômetro conta uma vez, pelo estado mais avançado
  const ordem = {C: 5, E: 4, PA: 3, S: 2, P: 1, NA: 0};
  porSvc.forEach((q, nome) => {
    const lados = (S.svc.find(s => s.nome === nome) || {lados: []}).lados;
    segs.forEach(sg => {
      const km = kmNoTrecho(sg);
      q.kmTrecho += km;
      let melhor = null;
      lados.forEach(ld => {
        const v = S.dados[chave({svc: nome, lado: ld}, sg.id)] || 'P';
        if (melhor === null || ordem[v] > ordem[melhor]) melhor = v;
      });
      q[melhor === null ? 'P' : melhor] += km;
    });
  });
  return [...porSvc.values()].map(q => {
    q.pctTrecho = q.kmTrecho > 0 ? q.C / q.kmTrecho : null;
    q.pctContrato = q.contratado ? q.C / q.contratado : null;
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
  const somaCt = q.reduce((a, x) => a + (x.contratado || 0), 0);
  return `<table><thead><tr><th class="t">Serviço</th>
      ${temCt ? '<th>Contratado</th>' : ''}
      <th>Concluído</th><th>Em and.</th><th>Paralisado</th><th>Sem plan.</th><th>Previsto</th>
      <th>% do trecho</th>${temCt ? '<th>% do contrato</th>' : ''}</tr></thead><tbody>${
    q.map(x => `<tr><td class="t">${esc(x.svc)}</td>
      ${temCt ? `<td>${km(x.contratado || 0)}</td>` : ''}
      <td>${km(x.C)}</td><td>${km(x.E)}</td><td>${km(x.PA)}</td><td>${km(x.S)}</td>
      <td>${km(x.P)}</td><td>${pc(x.pctTrecho)}</td>
      ${temCt ? `<td>${pc(x.pctContrato)}</td>` : ''}</tr>`).join('')}
    <tr><td class="t"><b>Total</b></td>
      ${temCt ? `<td><b>${km(somaCt)}</b></td>` : ''}
      <td><b>${km(soma('C'))}</b></td><td><b>${km(soma('E'))}</b></td>
      <td><b>${km(soma('PA'))}</b></td><td><b>${km(soma('S'))}</b></td>
      <td><b>${km(soma('P'))}</b></td>
      <td><b>${pc(soma('kmTrecho') > 0 ? soma('C') / soma('kmTrecho') : null)}</b></td>
      ${temCt ? `<td><b>${pc(somaCt > 0 ? soma('C') / somaCt : null)}</b></td>` : ''}</tr>
    </tbody></table>
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
