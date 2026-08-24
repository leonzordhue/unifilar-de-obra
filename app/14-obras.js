/* Obras guardadas por numero de contrato.

   O contrato e a identidade da obra no DMOB: e por ele que se pergunta, se cobra medicao e
   se acha processo. Aqui ele e a chave do projeto — digitar o numero e reabrir o perfil
   daquela obra, com tracado, servicos e lancamentos como estavam.

   Fica no navegador, ao lado do projeto em andamento. Nao substitui salvar em arquivo: o
   armazenamento do navegador e da maquina e do perfil de quem abriu, e uma limpeza de dados
   de navegacao leva tudo. A tela diz isso. */

const obrasGuardadas = () => {
  try { return JSON.parse(localStorage.getItem(CHAVE_OBRAS) || '{}'); }
  catch (e){ return {}; }
};
const chaveContrato = c => String(c || '').trim().toUpperCase().replace(/\s+/g, ' ');

function guardaObra(){
  const num = chaveContrato($('#contrato').value);
  if (!num){
    alert('Informe o número do contrato para guardar a obra. É por ele que ela será '
        + 'reencontrada.');
    $('#contrato').focus();
    return false;
  }
  if (!S.eixo){ alert('Escolha um eixo antes de guardar a obra.'); return false; }
  const todas = obrasGuardadas();
  const antes = todas[num];
  if (antes && !confirm(`Já existe obra guardada no contrato ${num}`
      + ` (${antes.obra || 'sem identificação'}, ${antes.eixo} · salva em ${antes.em}).`
      + '\n\nSubstituir pelo projeto atual?')) return false;
  const p = projetoAtual();
  p.contrato = num;
  try {
    todas[num] = {
      contrato: num, obra: p.obra, eixo: S.eixo.nome,
      km: `${fmt(S.kmIni, 0)}–${fmt(S.kmFim, 0)}`,
      lancamentos: Object.keys(S.dados).length,
      em: new Date().toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}),
      projeto: p
    };
    localStorage.setItem(CHAVE_OBRAS, JSON.stringify(todas));
  } catch (e){
    alert('O navegador recusou guardar a obra por falta de espaço. Use «Salvar» para gravar '
        + 'o projeto em arquivo — nada do que você lançou se perdeu.');
    return false;
  }
  pintaObras();
  return true;
}

/** Quanto trabalho está na tela agora. É a conta que decide se descartar exige pergunta. */
const trabalhoNaTela = () => Object.keys(S.dados || {}).length;

/** Pergunta antes de descartar o que está na tela, com o número na frente.

    Quatro caminhos descartam trabalho e três já perguntavam; este, que é o mais usado —
    pesquisar o contrato e carregar o perfil, a rotina que o cliente descreveu —, não
    perguntava. Achado do jarvisIV, medido: 6 lançamentos sumiram sem uma pergunta. */
function podeDescartar(motivo){
  const n = Object.keys(S.dados || {}).length;
  if (!n) return true;
  return confirm(motivo + ' descarta o que está na tela: ' + n + ' lançamento(s).'
    + '\n\nPara manter, guarde a obra atual (Obras > Guardar esta obra) ou gere o arquivo '
    + 'com Salvar. Descartar mesmo assim?');
}

function abreObra(num){
  const o = obrasGuardadas()[chaveContrato(num)];
  if (!o){ alert('Nenhuma obra guardada com este número de contrato.'); return; }
  // reabrir a MESMA obra não descarta nada: é recarregar o que já está na tela
  const mesma = chaveContrato($('#contrato').value) === chaveContrato(num);
  if (!mesma && !podeDescartar('Abrir a obra do contrato ' + o.contrato)) return;
  aplicaProjeto(o.projeto);
  $('#contrato').value = o.contrato;
  S.contrato = o.contrato;
  fechaObras();
}

function apagaObra(num){
  const todas = obrasGuardadas();
  const o = todas[num];
  if (!o) return;
  if (!confirm(`Apagar a obra do contrato ${num} (${o.obra || 'sem identificação'})?`
      + '\n\nIsto remove só a cópia guardada neste navegador.')) return;
  delete todas[num];
  localStorage.setItem(CHAVE_OBRAS, JSON.stringify(todas));
  pintaObras();
}

/* ---------------------------------------------------------------- janela */
function abreObras(){ pintaObras(); $('#obras').classList.remove('hidden'); }
function fechaObras(){ $('#obras').classList.add('hidden'); }

function pintaObras(){
  const cx = $('#obrasCorpo');
  if (!cx) return;
  const q = ($('#buscaObra') ? $('#buscaObra').value : '').trim().toUpperCase();
  const todas = Object.values(obrasGuardadas())
    .filter(o => !q || (o.contrato + ' ' + (o.obra || '') + ' ' + o.eixo).toUpperCase().includes(q))
    .sort((a, b) => a.contrato.localeCompare(b.contrato, 'pt-BR'));
  cx.innerHTML = !todas.length
    ? `<div class="vazio">${q ? 'Nenhuma obra com esse termo.'
        : 'Nenhuma obra guardada ainda. Monte o projeto, informe o número do contrato no '
        + 'cabeçalho e use <b>Guardar obra</b>.'}</div>`
    : `<table class="tab"><thead><tr><th>Contrato</th><th>Obra</th><th>Eixo</th><th>Trecho</th>
        <th class="num">Lanç.</th><th>Salva em</th><th></th></tr></thead>
      <tbody>${todas.map(o => `<tr>
        <td><b>${esc(o.contrato)}</b></td>
        <td>${esc(o.obra || '—')}</td>
        <td>${esc(o.eixo)}</td>
        <td>KM ${esc(o.km)}</td>
        <td class="num">${o.lancamentos}</td>
        <td class="min">${esc(o.em)}</td>
        <td><button class="mini" data-abre="${esc(o.contrato)}">Abrir</button>
            <button class="mini" data-apagaobra="${esc(o.contrato)}">Apagar</button></td>
      </tr>`).join('')}</tbody></table>`;
  $$('#obrasCorpo [data-abre]').forEach(b => b.onclick = () => abreObra(b.dataset.abre));
  $$('#obrasCorpo [data-apagaobra]').forEach(b => b.onclick = () => apagaObra(b.dataset.apagaobra));
}
