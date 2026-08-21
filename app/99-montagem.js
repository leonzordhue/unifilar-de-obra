/* Montagem da interface, eventos e inicializacao. */
/* ---------------------------------------------------------------- render */
// As vistas fixas da página convivem com as registradas por módulo: esconder por varredura
// evita que cada aba nova exija uma linha aqui — e uma linha esquecida deixaria duas vistas
// visíveis ao mesmo tempo.
const VISTAS_FIXAS = {mapa: '#vMapa', matriz: '#vMatriz', croqui: '#vCroqui',
                      resumo: '#vResumo', rel: '#vRel'};
function mostra(v){
  S.vista = v;
  $$('#abas button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  Object.entries(VISTAS_FIXAS).forEach(([id, sel]) =>
    $(sel).classList.toggle('hidden', v !== id));
  ABAS.forEach(a => {
    const el = $('#' + idVista(a.id));
    if (el) el.classList.toggle('hidden', v !== a.id);
  });
  if (v === 'mapa' && S.mapa) setTimeout(() => S.mapa.invalidateSize(), 60);
  render();
}
function render(){
  const linhas = linhasMatriz(), segs = segsNoTrecho();
  $('#infoTopo').textContent = S.eixo
    ? `${S.eixo.nome} · ${fmt(S.segs.reduce((a, s) => a + s.ext, 0), 1)} km · trecho KM ${fmt(S.kmIni, 0)}–${fmt(S.kmFim, 0)} · ${linhas.length} linha(s) × ${segs.length} coluna(s)`
    : '';
  $('#dicaRef').textContent = S.ref === 'est'
    ? `Estaca de ${EST_M} m — KM 1 corresponde à estaca ${1000 / EST_M}.`
    : 'Colunas por quilômetro inteiro do eixo.';
  pintaContrato();
  if (S.vista === 'croqui') pintaCroqui();
  else if (S.vista === 'matriz') pintaMatriz();
  else if (S.vista === 'resumo') pintaResumo();
  else if (S.vista === 'rel') pintaRel();
  else if (S.vista === 'mapa'){ desenhaMapa(); pintaFaixa(); pintaBarraLanca(); }
  else {
    const a = ABAS.find(x => x.id === S.vista);
    if (a && a.pinta) a.pinta();
  }
}

/* ---------------------------------------------------------------- eventos */
async function carregaGeo(file){
  const inf = $('#infoArq');
  inf.textContent = 'lendo o traçado…';
  try {
    const g = await lerArquivoGeo(file);
    const {cadeias, saltos} = costura(g.linhas);
    aplicaEixo({nome: g.nome, tipo: 'arquivo', linhas: cadeias, arquivo: file.name,
                sentido: {metodo: 'indefinido'},
                meta: {saltos_km: saltos, partes: cadeias.length}});
    inf.innerHTML = `<b>${esc(file.name)}</b> · ${g.linhas.length} parte(s) do arquivo ` +
      `costurada(s) em ${cadeias.length} · ${fmt(S.segs.reduce((a, s) => a + s.ext, 0), 3)} km` +
      (saltos.length ? `<br>Descontinuidade: ${saltos.length} interrupção(ões) ` +
        `(${saltos.map(v => fmt(v, 1) + ' km').join(', ')}). A quilometragem não soma os vazios.` : '');
  } catch (e){
    inf.textContent = 'não foi possível ler: ' + e.message;
  }
}
function liga(){
  $$('#segFonte button').forEach(b => b.onclick = () => {
    S.fonte = b.dataset.f;
    $$('#segFonte button').forEach(x => x.classList.toggle('on', x === b));
    const arq = S.fonte === 'arquivo';
    $('#cxAcervo').classList.toggle('hidden', arq);
    $('#cxArquivo').classList.toggle('hidden', !arq);
    if (!arq) pintaAcervo();
  });
  $('#buscaAcervo').oninput = pintaAcervo;
  $('#selAcervo').onchange = escolheAcervo;
  $$('#segRef button').forEach(b => b.onclick = () => {
    S.ref = b.dataset.r;
    $$('#segRef button').forEach(x => x.classList.toggle('on', x === b));
    render(); salvaLocal();
  });
  $('#btInverte').onclick = inverteEixo;
  // O trecho é preso à extensão do eixo e à ordem entre as pontas: KM 9999 num eixo de
  // 84 km, ou inicial acima do final, deixavam a matriz inteira hachurada sem dizer por quê.
  const limitaTrecho = quem => {
    if (!S.segs.length) return;
    const lo = S.segs[0].ini, hi = S.segs[S.segs.length - 1].fim;
    const preso = v => Math.min(Math.max(v, lo), hi);
    let a = parseFloat($('#kmIni').value), z = parseFloat($('#kmFim').value);
    a = isFinite(a) ? preso(a) : lo;
    z = isFinite(z) ? preso(z) : hi;
    if (a > z){ if (quem === 'ini') z = a; else a = z; }   // quem foi editado manda
    S.kmIni = a; S.kmFim = z;
    if (+$('#kmIni').value !== a) $('#kmIni').value = +a.toFixed(3);
    if (+$('#kmFim').value !== z) $('#kmFim').value = +z.toFixed(3);
    render(); salvaLocal(); renovaCroqui();
  };
  $('#kmIni').oninput = () => limitaTrecho('ini');
  $('#kmFim').oninput = () => limitaTrecho('fim');
  $('#estOff').oninput = () => {
    S.estOff = Math.max(0, +$('#estOff').value || 0);
    if (+$('#estOff').value < 0) $('#estOff').value = 0;
    render(); salvaLocal();
  };
  $('#btTodosEns').onclick = () => { S.ens.forEach(e => e.on = true); pintaEns(); render(); salvaLocal(); };
  $('#btNenhumEns').onclick = () => { S.ens.forEach(e => e.on = false); pintaEns(); render(); salvaLocal(); };
  $('#btFechaFicha').onclick = fechaFicha;
  $('#btObras').onclick = abreObras;
  $('#btFechaObras').onclick = fechaObras;
  $('#buscaObra').oninput = pintaObras;
  $('#obras').onclick = ev => { if (ev.target.id === 'obras') fechaObras(); };
  $('#btGuardar').onclick = () => { if (guardaObra()) abreObras(); };
  $('#contrato').oninput = () => { S.contrato = $('#contrato').value; salvaLocal(); };
  $('#ficha').onclick = ev => { if (ev.target.id === 'ficha') fechaFicha(); };
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !$('#ficha').classList.contains('hidden')) fechaFicha();
  });
  const passaFicha = d => () => {
    const i = S.segs.findIndex(s => s.id === S.fichaSeg);
    const j = Math.min(Math.max(i + d, 0), S.segs.length - 1);
    if (j !== i) abreFicha(S.segs[j].id);
  };
  $('#btFichaAnt').onclick = passaFicha(-1);
  $('#btFichaProx').onclick = passaFicha(1);
  $('#btTodos').onclick = () => { S.svc.forEach(s => s.on = true); pintaSvc(); render(); salvaLocal(); };
  $('#btNenhum').onclick = () => { S.svc.forEach(s => s.on = false); pintaSvc(); render(); salvaLocal(); };
  $('#btAddSvc').onclick = () => {
    const nm = $('#novoSvc').value.trim();
    if (!nm) return;
    S.svc.push({nome: nm.toUpperCase(), grupo: 'Serviços acrescentados',
                lados: $('#novoLado').value.split(','), unidade: '', on: true});
    $('#novoSvc').value = ''; pintaSvc(); render(); salvaLocal();
  };
  $$('.abas button[data-v]').forEach(b => b.onclick = () => mostra(b.dataset.v));
  $('#btCSV').onclick = exportaCSV;
  $('#btCDE').onclick = exportaCDE;
  $('#btGuardaAcervo').onclick = guardaNoAcervoLocal;
  $('#btImprimir').onclick = () => { mostra('rel'); setTimeout(() => window.print(), 300); };

  const dz = $('#dz'), fg = $('#fileGeo');
  dz.onclick = () => fg.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = e => {
    e.preventDefault(); dz.classList.remove('drag');
    if (e.dataTransfer.files[0]) carregaGeo(e.dataTransfer.files[0]);
  };
  fg.onchange = () => { if (fg.files[0]) carregaGeo(fg.files[0]); };

  $('#btSalvar').onclick = () => {
    const nome = `obra-${($('#nomeObra').value || 'sem-nome').replace(/[^\w\-]+/g, '-').toLowerCase()}.json`;
    baixa(new Blob([JSON.stringify(projetoAtual(), null, 1)], {type: 'application/json'}), nome);
  };
  $('#btAbrir').onclick = () => $('#fileProjeto').click();
  $('#fileProjeto').onchange = async () => {
    const f = $('#fileProjeto').files[0];
    if (!f) return;
    try {
      // Aceita o projeto solto e o pacote CDE: quem recebe o pacote não deveria ter de
      // descompactar para achar o json lá dentro.
      const p = f.name.toLowerCase().endsWith('.zip')
        ? await abrePacoteCDE(f) : JSON.parse(await f.text());
      aplicaProjeto(p);
      salvaLocal();
    }
    catch (e){ alert('Não foi possível abrir: ' + e.message); }
  };
  $('#btNovo').onclick = () => {
    if (!confirm('Começar um projeto novo? O controle atual será descartado.')) return;
    localStorage.removeItem(CHAVE_LOCAL); location.reload();
  };
  // Trocar de catalogo troca a lista de servicos. Os lancamentos ficam guardados por
  // nome de servico, entao voltar ao catalogo anterior devolve o que estava marcado.
  $('#selCat').onchange = e => {
    if (Object.keys(S.dados).length && !confirm(
        'Trocar o catálogo troca a lista de serviços da matriz. Os lançamentos do catálogo ' +
        'atual ficam guardados e voltam se você retornar a ele. Trocar?')){
      e.target.value = S.catId; return;
    }
    S.catId = e.target.value;
    montaSvc(); pintaCat(); pintaSvc(); render(); salvaLocal();
  };
  $('#nomeObra').oninput = salvaLocal;
}

/* ---------------------------------------------------------------- início */
(async function inicia(){
  try { S.cat = await carregaJSON('dados/catalogo-servicos.json'); }
  catch (e){
    document.body.innerHTML = `<div style="padding:40px;font:15px system-ui;line-height:1.6">
      <b style="font-size:17px">Não foi possível carregar o catálogo de serviços.</b><br><br>
      ${esc(e.message)}<br><br>
      Esta plataforma lê arquivos da pasta <code>dados/</code>, e por isso precisa ser aberta
      por um servidor — abrir o arquivo com duplo clique não funciona, porque o navegador
      bloqueia a leitura de arquivos locais. Na própria máquina, entre na pasta do projeto e
      rode:<br><br>
      <code style="background:#eee;padding:7px 11px;border-radius:5px">python -m http.server 8000</code>
      <br><br>depois abra <code>http://localhost:8000</code> no navegador.</div>`;
    return;
  }
  // conferencia externa da extensao: opcional, e a plataforma abre sem ela
  try { S.conf = await carregaJSON('dados/conferencia-extensao.json'); }
  catch (e){ S.conf = null; }
  // catalogo de ensaios: a plataforma abre sem ele, so nao controla ensaio
  try { S.catEns = await carregaJSON('dados/catalogo-ensaios.json'); }
  catch (e){ S.catEns = {itens: [], grupos: []}; }
  montaSvc(); montaEns(); carregaFotos();
  pintaCat(); pintaSvc(); pintaEns(); pintaContrato(); pintaLegenda();
  montaAbas(); liga(); iniMapa();
  await pintaAcervo();
  const salvo = localStorage.getItem(CHAVE_LOCAL);
  if (salvo){
    try { aplicaProjeto(JSON.parse(salvo)); }
    catch (e){ /* projeto local corrompido: começa limpo */ }
  }
  render();
})();
