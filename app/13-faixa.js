/* Faixa unifilar: o traçado esticado numa linha reta, embaixo do mapa.

   E o modo como se controla obra rodoviaria no papel — a rodovia vira um segmento reto,
   dividido em quilometro ou em estaca, e cada pedaco recebe a cor do servico. A matriz
   continua existindo para o quadro inteiro; a faixa e para o gesto do dia a dia: escolher o
   servico, marcar os quilometros onde ele acontece e dizer em que pe esta.

   Selecao: clique alterna um quilometro, arrastar pega um intervalo, e a selecao pode ser
   descontinua — obra de erosao acontece no km 4 e no km 9, e nao entre eles. */

const CH_SEL = () => S.sel || (S.sel = new Set());

/* ---------------------------------------------------------------- serviço ativo */
const svcAtivo = () => S.svc.find(s => s.nome === S.svcAtivo) || S.svc.filter(s => s.on)[0] || null;
const corServico = nome => {
  const s = S.svc.find(x => x.nome === nome);
  if (s && s.cor) return s.cor;
  const g = (S.cat.grupos || []).find(g => s && g.nome === s.grupo);
  return (g && g.cor) || '#6B7A8C';
};

/** Serviços lançados naquele quilômetro, com a cor de cada um. Um quilômetro pode ter
    vários — a faixa mostra todos, em listras, porque esconder o segundo seria mentir sobre
    o que está acontecendo ali. */
function servicosNoSeg(id){
  const out = [];
  linhasMatriz().forEach(l => {
    const v = S.dados[chave(l, id)];
    if (!v) return;
    const j = out.find(o => o.svc === l.svc);
    if (j){ if (!j.status.includes(v)) j.status.push(v); }
    else out.push({svc: l.svc, cor: corServico(l.svc), status: [v]});
  });
  return out;
}

/* ---------------------------------------------------------------- desenho */
function pintaFaixa(){
  const cx = $('#faixa');
  if (!cx) return;
  if (!S.eixo || !S.segs.length){
    cx.innerHTML = '<div class="faixaVazia">Escolha um eixo para ver o traçado dividido.</div>';
    return;
  }
  const sel = CH_SEL();
  const passo = S.segs.length > 120 ? 20 : (S.segs.length > 60 ? 10 : (S.segs.length > 24 ? 5 : 1));
  const celulas = S.segs.map((sg, i) => {
    const svcs = servicosNoSeg(sg.id);
    const dentro = dentroTrecho(sg);
    // várias cores no mesmo quilômetro viram listras verticais de largura igual
    const fundo = !svcs.length ? (dentro ? '#E8EDF2' : 'transparent')
      : svcs.length === 1 ? svcs[0].cor
      : `linear-gradient(90deg,${svcs.map((s, k) =>
          `${s.cor} ${100 * k / svcs.length}% ${100 * (k + 1) / svcs.length}%`).join(',')})`;
    const marco = i === 0 || i === S.segs.length - 1 || Math.round(sg.ini) % passo === 0;
    const rot = marco ? `<span class="rot">${esc(rotuloCurto(sg))}</span>` : '';
    const dica = `${rotuloSeg(sg)} · ${fmt(sg.ext, 3)} km`
      + (svcs.length ? ' · ' + svcs.map(s => s.svc + ' (' + s.status.map(nomeStatus).join('/') + ')').join(' · ')
                     : ' · sem lançamento');
    return `<div class="km${marco ? ' marco' : ''}${sel.has(sg.id) ? ' sel' : ''}${dentro ? '' : ' fora'}"
      data-id="${sg.id}" title="${esc(dica)}" style="background:${fundo}">${rot}</div>`;
  }).join('');

  const ext = S.segs.reduce((a, s) => a + s.ext, 0);
  cx.innerHTML = `
    <div class="faixaCab">
      <b>${esc(S.eixo.nome)}</b>
      <span class="min">${fmt(ext, 3)} km · ${S.segs.length} ${S.ref === 'est' ? 'estacas de controle' : 'quilômetros'}
        · trecho em obra KM ${fmt(S.kmIni, 0)}–${fmt(S.kmFim, 0)}</span>
      <div class="sep"></div>
      <span class="min" id="faixaSel"></span>
      <button class="mini" id="btSelTrecho">Selecionar o trecho</button>
      <button class="mini" id="btSelLimpa">Limpar</button>
    </div>
    <div class="faixaTrilho${S.segs.length > 60 ? ' densa' : ''}" id="faixaTrilho">${celulas}</div>`;
  ligaFaixa();
  atualizaSelecao();
}

function atualizaSelecao(){
  const sel = CH_SEL();
  const km = S.segs.filter(s => sel.has(s.id)).reduce((a, s) => a + s.ext, 0);
  const alvo = $('#faixaSel');
  if (alvo) alvo.textContent = sel.size
    ? `${sel.size} selecionado(s) · ${fmt(km, 3)} km` : 'nada selecionado';
  const b = $('#btAplica');
  if (b) b.disabled = !sel.size;
  $$('#faixaTrilho .km').forEach(e =>
    e.classList.toggle('sel', sel.has(+e.dataset.id)));
  if (S.mapa) desenhaMapa();
}

/* ---------------------------------------------------------------- interação */
function ligaFaixa(){
  const trilho = $('#faixaTrilho');
  if (!trilho) return;
  let arrastando = false, ligando = true, ultimo = null;
  // O alvo vem da COORDENADA, e não de `ev.target`: com o dedo capturado pelo ponteiro,
  // `target` continua sendo a célula onde o toque começou durante todo o arrasto.
  const idDe = ev => {
    const e = document.elementFromPoint(ev.clientX, ev.clientY);
    const c = e && e.closest ? e.closest('.km') : null;
    return c ? +c.dataset.id : null;
  };
  const aplica = (id, liga) => {
    if (id == null) return;
    const sel = CH_SEL();
    if (liga) sel.add(id); else sel.delete(id);
  };
  trilho.onpointerdown = ev => {
    const id = idDe(ev);
    if (id == null) return;
    ev.preventDefault();
    if (ev.shiftKey && ultimo != null){
      const a = Math.min(ultimo, id), z = Math.max(ultimo, id);
      S.segs.filter(s => s.id >= a && s.id <= z).forEach(s => CH_SEL().add(s.id));
    } else {
      ligando = !CH_SEL().has(id);
      aplica(id, ligando);
      ultimo = id;
    }
    arrastando = true;
    // captura o ponteiro: o arrasto continua mesmo se o dedo sair da faixa
    if (trilho.setPointerCapture) try { trilho.setPointerCapture(ev.pointerId); } catch (e){}
    atualizaSelecao();
  };
  trilho.onpointermove = ev => {
    if (!arrastando) return;
    aplica(idDe(ev), ligando);
    atualizaSelecao();
  };
  // a faixa é a leitura espacial e a grade é a planilha: marcar num lugar move o outro, senão
  // são duas telas do mesmo eixo que não se conversam
  trilho.addEventListener('pointerup', ev => {
    const id = idDe(ev);
    if (id != null && typeof marcaColuna === 'function') marcaColuna(id);
  });
  const solta = () => { arrastando = false; };
  trilho.onpointerup = solta;
  trilho.onpointercancel = solta;
  document.addEventListener('pointerup', solta);
  trilho.ondblclick = ev => {
    const id = idDe(ev);
    if (id != null) abreFicha(id);
  };
  $('#btSelLimpa').onclick = () => { CH_SEL().clear(); atualizaSelecao(); };
  $('#btSelTrecho').onclick = () => {
    CH_SEL().clear();
    S.segs.filter(dentroTrecho).forEach(s => CH_SEL().add(s.id));
    atualizaSelecao();
  };
}

/* ---------------------------------------------------------------- barra de lançamento */
function pintaBarraLanca(){
  const cx = $('#barraLanca');
  if (!cx) return;
  const ligados = S.svc.filter(s => s.on);
  if (!ligados.length){
    cx.innerHTML = '<div class="min">Marque um serviço na lateral para poder lançar.</div>';
    return;
  }
  if (!ligados.some(s => s.nome === S.svcAtivo)) S.svcAtivo = ligados[0].nome;
  const at = svcAtivo();
  const lados = at ? at.lados : [];
  cx.innerHTML = `
    <label>Serviço<select id="selSvcAtivo">${ligados.map(s =>
      `<option value="${esc(s.nome)}"${s.nome === S.svcAtivo ? ' selected' : ''}>${esc(s.nome)}</option>`
      ).join('')}</select></label>
    <span class="amostra" style="background:${corServico(S.svcAtivo)}"></span>
    ${lados.length > 1 ? `<label>Lado<select id="selLado">
      <option value="*">Ambos (${esc(lados.join(' e '))})</option>
      ${lados.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select></label>` : ''}
    <label>Situação<select id="selSit">${S.cat.status.map(st =>
      `<option value="${esc(st.cod === 'P' ? '' : st.cod)}">${esc(st.nome)}</option>`).join('')}</select></label>
    <button class="btn pri" id="btAplica" disabled>Aplicar à seleção</button>
    <div class="sep"></div>
    <span class="min">Clique marca · arraste pega o intervalo · duplo clique abre a ficha</span>`;
  $('#selSvcAtivo').onchange = e => { S.svcAtivo = e.target.value; pintaBarraLanca(); atualizaSelecao(); };
  $('#btAplica').onclick = aplicaNaSelecao;
  atualizaSelecao();
}

function aplicaNaSelecao(){
  const at = svcAtivo();
  const sel = [...CH_SEL()];
  if (!at || !sel.length) return;
  const ladoEsc = $('#selLado') ? $('#selLado').value : '*';
  const lados = ladoEsc === '*' ? at.lados : [ladoEsc];
  const v = $('#selSit').value;
  lados.forEach(ld => {
    const l = {svc: at.nome, lado: ld};
    sel.forEach(id => {
      marcaKm(l, id, v);
    });
  });
  render(); salvaLocal();
}
