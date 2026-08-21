/* Controle tecnologico: catalogo de ensaios, registros por quilometro, conformidade e a
   ficha tecnica do segmento.

   Este modulo e o contrato de dados de que o painel, o mapa e o pacote CDE dependem
   (COORDENACAO.md, item 4). Ninguem mais calcula conformidade: dois calculos divergentes no
   mesmo relatorio sao defeito, nao redundancia. */

/* ---------------------------------------------------------------- catálogo */
const catEnsaios = () => (S.catEns && S.catEns.itens) || [];
const ensaioDe = cod => catEnsaios().find(e => e.cod === cod) || null;
const grupoEnsaio = nome => ((S.catEns && S.catEns.grupos) || []).find(g => g.nome === nome)
  || {nome, cor: '#8E9AA6'};

/** Ensaios que a obra contrata — os marcados na lateral. */
function catalogoEnsaios(){
  const on = new Set(S.ens.filter(e => e.on).map(e => e.cod));
  return catEnsaios().filter(e => on.has(e.cod));
}

function montaEns(){
  const antes = new Map(S.ens.map(e => [e.cod, e.on]));
  S.ens = catEnsaios().map(e => ({cod: e.cod, on: antes.get(e.cod) || false}));
}

/* ---------------------------------------------------------------- registros */
const ensaiosDoSeg = id => S.reg.filter(r => r.seg === id);
const regPorId = id => S.reg.find(r => r.id === id) || null;

function novoRegistro(seg, cod){
  const e = ensaioDe(cod) || {};
  S.seqReg += 1;
  return {
    id: 'r' + S.seqReg, seg, cod,
    valor: null,
    // O critério é COPIADO do catálogo para dentro do registro, e não consultado depois:
    // o que vale numa fiscalização é o critério vigente quando o ensaio foi aceito. Mudar o
    // catálogo em setembro não pode reprovar, retroativamente, o que passou em março.
    lim_min: e.limite_min != null ? e.limite_min : null,
    lim_max: e.limite_max != null ? e.limite_max : null,
    data: new Date().toISOString().slice(0, 10),
    resp: S.responsavel || '', obs: '', foto: null
  };
}

/** true conforme · false não conforme · null sem critério numérico para julgar. */
function conforme(r){
  if (!r || r.valor == null || !isFinite(r.valor)) return null;
  const temMin = r.lim_min != null && isFinite(r.lim_min);
  const temMax = r.lim_max != null && isFinite(r.lim_max);
  if (!temMin && !temMax) return null;
  if (temMin && r.valor < r.lim_min) return false;
  if (temMax && r.valor > r.lim_max) return false;
  return true;
}
const textoConforme = r => ({true: 'Conforme', false: 'Não conforme'})[conforme(r)] || 'Sem critério';
const corConforme = r => ({true: '#2E9E5B', false: '#D9534F'})[conforme(r)] || '#8E9AA6';

/* ---------------------------------------------------------------- agregação */
/** Quantos ensaios a frequência do catálogo prevê para estes quilômetros.
    Devolve null quando nenhum ensaio contratado tem frequência preenchida: sem base para
    calcular percentual, que é diferente de zero por cento. */
function previstosEm(ids){
  const segs = S.segs.filter(s => ids.includes(s.id));
  // extensão recortada pelo trecho: a frequência de ensaio se aplica ao que é obra
  const km = segs.reduce((a, s) => a + kmNoTrecho(s), 0);
  const comFreq = catalogoEnsaios().filter(e => e.por_km != null && isFinite(e.por_km));
  if (!comFreq.length) return null;
  return comFreq.reduce((a, e) => a + e.por_km * km, 0);
}

function resumoEnsaios(ids){
  const set = new Set(ids);
  const regs = S.reg.filter(r => set.has(r.seg));
  let conformes = 0, naoConformes = 0, semCriterio = 0;
  regs.forEach(r => {
    const c = conforme(r);
    if (c === true) conformes++; else if (c === false) naoConformes++; else semCriterio++;
  });
  const previstos = previstosEm(ids);
  const julgados = conformes + naoConformes;
  return {
    previstos, executados: regs.length, conformes, naoConformes, semCriterio,
    pctExecutado: previstos == null || previstos <= 0
      ? null : Math.min(1, regs.length / previstos),
    pctConformidade: julgados ? conformes / julgados : null
  };
}

function resumoPorGrupo(ids){
  const set = new Set(ids);
  const por = new Map();
  catalogoEnsaios().forEach(e => {
    if (!por.has(e.grupo))
      por.set(e.grupo, {grupo: e.grupo, cor: grupoEnsaio(e.grupo).cor,
                        previstos: 0, executados: 0, conformes: 0, naoConformes: 0, pct: null});
  });
  const km = S.segs.filter(s => set.has(s.id)).reduce((a, s) => a + s.ext, 0);
  catalogoEnsaios().forEach(e => {
    if (e.por_km != null && isFinite(e.por_km)) por.get(e.grupo).previstos += e.por_km * km;
  });
  S.reg.filter(r => set.has(r.seg)).forEach(r => {
    const e = ensaioDe(r.cod);
    if (!e || !por.has(e.grupo)) return;
    const g = por.get(e.grupo);
    g.executados++;
    const c = conforme(r);
    if (c === true) g.conformes++; else if (c === false) g.naoConformes++;
  });
  return [...por.values()].map(g => {
    const j = g.conformes + g.naoConformes;
    g.pct = j ? g.conformes / j : null;
    return g;
  });
}

/** Semáforo único da plataforma. `null` é ausência de base, e não reprovação. */
function corConformidade(pct){
  if (pct == null) return '#C8D2DC';
  if (pct >= 0.95) return '#2E9E5B';
  if (pct >= 0.85) return '#8CB84B';
  if (pct >= 0.70) return '#F0A32B';
  return '#D9534F';
}

/* ---------------------------------------------------------------- fotos */
const CHAVE_FOTOS = 'controle-obra-unifilar-fotos-v1';
const LIMITE_FOTOS = 3.4 * 1024 * 1024;     // o armazenamento do navegador é de poucos MB
const tamanhoFotos = () => Object.values(S.fotos).reduce((a, d) => a + d.length, 0);

/** Reduz a foto antes de guardar. Uma foto de celular tem 3 a 8 MB; o navegador guarda uns
    5 MB no total. Sem reduzir, a segunda foto já estoura e o lançamento se perde. */
function reduzFoto(file, lado = 1280, q = 0.72){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('não foi possível ler a imagem'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => rej(new Error('o arquivo não é uma imagem válida'));
      im.onload = () => {
        const f = Math.min(1, lado / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * f); cv.height = Math.round(im.height * f);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', q));
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function guardaFoto(idReg, dataURL){
  if (tamanhoFotos() + dataURL.length > LIMITE_FOTOS)
    throw new Error('as fotos já ocupam o espaço que o navegador reserva para esta página. '
      + 'Salve o projeto em arquivo (ou exporte o pacote CDE) antes de acrescentar mais.');
  S.fotos[idReg] = dataURL;
  salvaFotos();
  return idReg;
}
function salvaFotos(){
  try { localStorage.setItem(CHAVE_FOTOS, JSON.stringify(S.fotos)); }
  catch (e){
    alert('O navegador recusou guardar as fotos por falta de espaço. Os lançamentos estão '
        + 'preservados; salve o projeto em arquivo para não perder as imagens.');
  }
}
function carregaFotos(){
  try { S.fotos = JSON.parse(localStorage.getItem(CHAVE_FOTOS) || '{}'); }
  catch (e){ S.fotos = {}; }
}

/* ---------------------------------------------------------------- lateral */
function pintaEns(){
  const alvo = $('#listaEns');
  if (!alvo) return;
  const itens = catEnsaios();
  if (!itens.length){
    alvo.innerHTML = '<div class="dica">Catálogo de ensaios não carregado.</div>';
    return;
  }
  const pend = itens.filter(e => !e.confirmado).length;
  let grupo = '';
  alvo.innerHTML = itens.map(e => {
    const cab = e.grupo !== grupo ? (grupo = e.grupo,
      `<div class="grEns" style="border-color:${grupoEnsaio(e.grupo).cor}">${esc(e.grupo)}</div>`) : '';
    const on = (S.ens.find(x => x.cod === e.cod) || {}).on;
    const nrm = e.norma_metodo && e.norma_metodo.codigo
      ? esc(e.norma_metodo.codigo)
      : '<i title="Norma ainda não confirmada — ver COORDENACAO.md">norma pendente</i>';
    return cab + `<label class="svc"><input type="checkbox" data-e="${esc(e.cod)}"${on ? ' checked' : ''}>
      <div><b>${esc(e.nome)}</b><span>${esc(e.camada)} · ${nrm}</span></div>
      <em>${esc(e.unidade)}</em></label>`;
  }).join('');
  $('#dicaEns').innerHTML = pend
    ? `<b>${pend} de ${itens.length}</b> ensaio(s) ainda sem norma confirmada. A plataforma `
      + 'não exibe norma que não foi conferida na fonte.'
    : `${itens.length} ensaios, todos com norma confirmada.`;
  $$('#listaEns input[type=checkbox]').forEach(c => c.onchange = () => {
    const e = S.ens.find(x => x.cod === c.dataset.e);
    if (e) e.on = c.checked;
    render(); salvaLocal();
  });
}

/* ---------------------------------------------------------------- ficha técnica */
function abreFicha(idSeg){
  S.fichaSeg = idSeg;
  pintaFicha();
  $('#ficha').classList.remove('hidden');
}
function fechaFicha(){
  S.fichaSeg = null;
  $('#ficha').classList.add('hidden');
}

function pintaFicha(){
  const sg = S.segs.find(s => s.id === S.fichaSeg);
  const cx = $('#fichaCorpo');
  if (!sg){ cx.innerHTML = ''; return; }
  const a = sg.pts[0], z = sg.pts[sg.pts.length - 1];
  const coord = p => `${fmt(p[1], 5)}, ${fmt(p[0], 5)}`;
  const regs = ensaiosDoSeg(sg.id);
  const rs = resumoEnsaios([sg.id]);
  const contratados = catalogoEnsaios();

  const servicos = linhasMatriz().map(l => {
    const v = S.dados[chave(l, sg.id)] || '';
    return `<tr><td>${esc(l.svc)}</td><td>${esc(l.lado)}</td>
      <td><span class="pil" style="background:${corStatus(v)};color:${txtStatus(v)}">${esc(nomeStatus(v))}</span></td></tr>`;
  }).join('') || '<tr><td colspan="3" class="vazio">Nenhum serviço marcado na lateral.</td></tr>';

  const linhasEnsaio = regs.map(r => {
    const e = ensaioDe(r.cod) || {nome: r.cod, unidade: '', norma_metodo: {}};
    const lim = [r.lim_min != null ? '≥ ' + fmt(r.lim_min, 2) : '',
                 r.lim_max != null ? '≤ ' + fmt(r.lim_max, 2) : ''].filter(Boolean).join(' e ')
                || '<i>do projeto</i>';
    return `<tr>
      <td><b>${esc(e.nome)}</b><br><span class="min">${e.norma_metodo && e.norma_metodo.codigo
        ? esc(e.norma_metodo.codigo) : '<i>norma pendente</i>'}</span></td>
      <td class="num">${r.valor != null ? fmt(r.valor, 2) : '—'} ${esc(e.unidade || '')}</td>
      <td class="num">${lim}</td>
      <td><span class="pil" style="background:${corConforme(r)};color:#fff">${esc(textoConforme(r))}</span></td>
      <td>${esc(r.data)}<br><span class="min">${esc(r.resp || '—')}</span></td>
      <td>${r.foto && S.fotos[r.foto]
        ? `<img class="mini-foto" src="${S.fotos[r.foto]}" data-foto="${esc(r.foto)}" alt="Foto do ensaio">`
        : '<span class="min">sem foto</span>'}</td>
      <td><button class="mini" data-apaga="${esc(r.id)}">Apagar</button></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="vazio">Nenhum ensaio lançado neste quilômetro.</td></tr>`;

  cx.innerHTML = `
    <div class="fichaCab">
      <div>
        <h3>${esc(S.eixo ? S.eixo.nome : '')} — ${esc(rotuloSeg(sg))}</h3>
        <div class="min">${fmt(sg.ext, 3)} km · início ${coord(a)} · fim ${coord(z)}
          ${dentroTrecho(sg) ? '' : ' · <b>fora do trecho em obra</b>'}</div>
      </div>
      <div class="fichaInd">
        <div><span>${rs.pctExecutado == null ? '—' : fmt(100 * rs.pctExecutado, 0) + '%'}</span>ensaios executados</div>
        <div><span>${rs.pctConformidade == null ? '—' : fmt(100 * rs.pctConformidade, 0) + '%'}</span>conformidade</div>
      </div>
    </div>

    <h4>Serviços</h4>
    <table class="tab"><thead><tr><th>Serviço</th><th>Lado</th><th>Situação</th></tr></thead>
      <tbody>${servicos}</tbody></table>

    <h4>Ensaios de controle tecnológico</h4>
    <table class="tab"><thead><tr><th>Ensaio e norma</th><th>Medição</th><th>Critério</th>
      <th>Resultado</th><th>Data e responsável</th><th>Foto</th><th></th></tr></thead>
      <tbody>${linhasEnsaio}</tbody></table>

    <h4>Lançar ensaio</h4>
    ${contratados.length ? `<div class="fichaForm">
      <label>Ensaio<select id="fEns">${contratados.map(e =>
        `<option value="${esc(e.cod)}">${esc(e.nome)} — ${esc(e.camada)}</option>`).join('')}</select></label>
      <label>Medição<input type="number" step="any" id="fValor" placeholder="valor"></label>
      <label>Mínimo<input type="number" step="any" id="fMin" placeholder="—"></label>
      <label>Máximo<input type="number" step="any" id="fMax" placeholder="—"></label>
      <label>Data<input type="date" id="fData" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Responsável<input type="text" id="fResp" placeholder="nome e registro" value="${esc(S.responsavel || '')}"></label>
      <label class="largo">Observação<input type="text" id="fObs" placeholder="opcional"></label>
      <label class="largo">Foto<input type="file" id="fFoto" accept="image/*" capture="environment"></label>
      <button class="btn pri" id="fLanca">Lançar ensaio</button>
      <div class="dica" id="fAviso"></div>
    </div>` : '<div class="dica">Marque ao menos um ensaio na lateral, no bloco <b>Ensaios</b>, para poder lançar.</div>'}`;

  // o critério vem do catálogo, e fica editável: o que vale é o critério aplicado no aceite
  const preenche = () => {
    const e = ensaioDe($('#fEns').value) || {};
    $('#fMin').value = e.limite_min != null ? e.limite_min : '';
    $('#fMax').value = e.limite_max != null ? e.limite_max : '';
    $('#fAviso').innerHTML = e.criterio ? esc(e.criterio)
      : 'Critério não preenchido no catálogo: informe o do projeto nos campos acima, ou deixe '
        + 'em branco para o ensaio ficar registrado sem julgamento.';
  };
  if ($('#fEns')){ $('#fEns').onchange = preenche; preenche(); $('#fLanca').onclick = lancaEnsaio; }
  $$('#fichaCorpo [data-apaga]').forEach(b => b.onclick = () => {
    const id = b.dataset.apaga;
    if (!confirm('Apagar este ensaio? A foto vai junto.')) return;
    S.reg = S.reg.filter(r => r.id !== id);
    delete S.fotos[id];
    salvaFotos(); pintaFicha(); render(); salvaLocal();
  });
  $$('#fichaCorpo .mini-foto').forEach(im => im.onclick = () => {
    const w = window.open('');
    if (w) w.document.write(`<title>Foto do ensaio</title><img src="${im.src}" style="max-width:100%">`);
  });
}

async function lancaEnsaio(){
  const sg = S.segs.find(s => s.id === S.fichaSeg);
  if (!sg) return;
  const av = $('#fAviso');
  const r = novoRegistro(sg.id, $('#fEns').value);
  const v = parseFloat($('#fValor').value);
  r.valor = isFinite(v) ? v : null;
  const mn = parseFloat($('#fMin').value), mx = parseFloat($('#fMax').value);
  r.lim_min = isFinite(mn) ? mn : null;
  r.lim_max = isFinite(mx) ? mx : null;
  r.data = $('#fData').value || r.data;
  r.resp = $('#fResp').value.trim();
  r.obs = $('#fObs').value.trim();
  if (r.valor == null){ av.innerHTML = '<b>Informe a medição.</b>'; return; }
  S.responsavel = r.resp;
  const arq = $('#fFoto').files[0];
  if (arq){
    try {
      av.textContent = 'preparando a foto…';
      const d = await reduzFoto(arq);
      guardaFoto(r.id, d);
      r.foto = r.id;
    } catch (e){
      av.innerHTML = '<b>Ensaio não lançado:</b> ' + esc(e.message);
      S.seqReg -= 1;
      return;
    }
  }
  S.reg.push(r);
  pintaFicha(); render(); salvaLocal();
}
