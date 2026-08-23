/* Acervo de rodovias e ramais, catalogo de servicos e escolha do eixo. */
/* ---------------------------------------------------------------- acervo */
async function carregaJSON(u){
  const r = await fetch(u);
  if (!r.ok) throw new Error(`não foi possível ler ${u} (HTTP ${r.status})`);
  return r.json();
}
/** Traçados guardados pelo usuário no navegador — a quarta origem, «Acervo local». */
function acervoDoNavegador(){
  return {itens: (typeof acervoLocal === 'function' ? acervoLocal() : [])};
}
async function acervo(tipo){
  if (tipo === 'local') return acervoDoNavegador();
  if (!S.acervo[tipo]){
    S.acervo[tipo] = await carregaJSON(tipo === 'rodovia'
      ? 'dados/acervo-rodovias-estaduais.json' : 'dados/acervo-ramais.json');
  }
  return S.acervo[tipo];
}
// Obra se mede onde ha pista. Quando parte do eixo e planejada, a extensao total engana:
// o rotulo diz quanto e implantado, que e o que se pode medir de recuperacao.
const kmImplantado = it => it.km_implantado == null ? null : it.km_implantado;
/** Quilômetros implantados que o CADASTRO registra, mesmo sem traçado no acervo.

    A geometria do acervo e o cadastro do Departamento Rodoviário discordam em três eixos, e
    a diferença não é detalhe: a AM-366 tem 17 km pavimentados em Tefé — obra que existe no
    chão e se pode medir hoje — e a geometria não traz nenhum trecho implantado. */
const kmCadastroImplantado = it => {
  const c = ((S.conf || {}).eixos || {})[it.nome];
  return c ? (c.implantado_cadastro || 0) : 0;
};

/** Existe pista implantada, por qualquer das duas fontes?

    O cliente mandou tirar da lista a rodovia planejada — «elas não existem, são ideias, por
    isso planejadas». O filtro certo é por EXISTÊNCIA DE PISTA, não pelo rótulo do acervo:
    filtrar por rótulo sumiria com AM-326 e AM-366, que estão marcadas como planejadas na
    geometria e têm 27,84 km e 17,00 km implantados no cadastro. Seriam 44,8 km de estrada
    real desaparecendo da plataforma — e são justamente os dois eixos do defeito que ficou
    declarado em aberto no fechamento de ontem. Achado do jarvisIV; a regra é dele. */
const temPista = it => it.tipo !== 'rodovia'
  || (kmImplantado(it) == null ? true : kmImplantado(it) >= 0.05)
  || kmCadastroImplantado(it) > 0;

const rotuloAcervo = it => it.tipo === 'local'
  ? `${it.nome} — ${fmt(it.km_geometria, 1)} km · guardado em ${it.guardado_em || '—'}`
  : it.tipo === 'rodovia'
  ? `${it.nome} — ${fmt(it.km_geometria, 1)} km`
    + (kmImplantado(it) != null && kmImplantado(it) < it.km_geometria - 0.05
       ? (it.km_implantado < 0.05
          ? (kmCadastroImplantado(it) > 0
             // pista que existe no cadastro e não no traçado: o rótulo diz as duas coisas,
             // senão a pessoa escolhe o eixo achando que vai medir sobre geometria que não há
             ? ` · ${fmt(kmCadastroImplantado(it), 1)} km implantados no cadastro, sem traçado`
             : ' · planejada')
          : ` · ${fmt(it.km_implantado, 1)} km implantados`) : '')
    + ((it.situacao || []).length ? ' · ' + it.situacao.join(' + ') : '')
  : `${it.nome} — ${fmt(it.km_geometria, 1)} km` + (it.municipio ? ' · ' + it.municipio : '');
async function pintaAcervo(){
  const tipo = S.fonte, sel = $('#selAcervo');
  $('#lbAcervo').textContent = tipo === 'rodovia' ? 'Rodovia estadual'
    : tipo === 'ramal' ? 'Ramal' : 'Traçado guardado neste navegador';
  sel.innerHTML = '<option>carregando…</option>';
  let d;
  try { d = await acervo(tipo); }
  catch (e){ sel.innerHTML = `<option>${esc(e.message)}</option>`; return; }
  const q = $('#buscaAcervo').value.trim().toLowerCase();
  let n = 0, semPista = 0;
  sel.innerHTML = d.itens.map((it, i) => {
    if (!temPista(it)){ semPista++; return ''; }
    const alvo = [it.nome, it.municipio, it.rodovia_ref, it.classificacao,
                  [].concat(it.situacao || []).join(' '),
                  [].concat(it.revestimento || []).join(' ')].join(' ').toLowerCase();
    if (q && !alvo.includes(q)) return '';
    n++;
    return `<option value="${i}">${esc(rotuloAcervo(it))}</option>`;
  }).join('');
  // o que saiu da lista é dito, não sumido: quem procurar a AM-170 tem de saber por que ela
  // não está ali, senão vai achar que o acervo está incompleto
  const total = d.itens.length - semPista;
  // O traçado guardado no navegador podia entrar e não podia sair: `removeDoAcervoLocal()`
  // existia em `12-cde.js` desde que o acervo local nasceu, e nenhum botão a chamava. Quem
  // guardasse um KMZ errado ficava com ele para sempre, ocupando cota — e cota cheia é o que
  // faz o projeto parar de salvar (medido em 22/08: 15 lançamentos perdidos em silêncio).
  // Achado pelo varredor de função morta do jarvisIV, 23/08.
  const btRem = $('#btRemoveLocal');
  if (btRem) btRem.classList.toggle('hidden', tipo !== 'local' || !d.itens.length);
  $('#infoAcervo').textContent =
    `${n} de ${total} ${tipo === 'rodovia' ? 'rodovias' : 'ramais'} · acervo do Departamento Rodoviário`
    + (semPista ? ` · ${semPista} rodovia(s) só planejadas ficam fora: não há pista para medir` : '');
}

/* ---------------------------------------------------------------- serviços */
// O catalogo traz mais de um conjunto de servicos: recuperacao (padrao AM-010) e
// implantacao (padrao AM-070). Sao obras diferentes e nao se misturam na mesma matriz.
const conjuntoAtual = () => S.cat.conjuntos.find(c => c.id === S.catId) || S.cat.conjuntos[0];
function montaSvc(){
  S.catId = conjuntoAtual().id;
  S.svc = conjuntoAtual().servicos.map(s => ({nome: s.nome, grupo: s.grupo, lados: s.lados.slice(),
                                              unidade: s.unidade, cor: s.cor || '', on: true}));
}
function pintaCat(){
  $('#selCat').innerHTML = S.cat.conjuntos.map(c =>
    `<option value="${esc(c.id)}"${c.id === S.catId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('');
  $('#infoCat').textContent = conjuntoAtual().descricao;
}
/** Serviço que existe no lançamento e não no catálogo da obra entra na lista, declarado.

    O Paulo lançou 10 km de `TERRAPLENAGEM` num projeto cujo catálogo tem `TERRAPLENAGEM DOS
    ACOSTAMENTOS`. O dado estava salvo, a matriz e o quadro montam a lista a partir de
    `S.svc`, e o serviço inteiro ficava invisível — nem na tela, nem no quadro, nem no
    relatório. É a família do `catch` vazio: o trabalho existe e ninguém vê.

    Adotar em vez de só listar (a saída que o HAL9000 propôs e eu escolhi) devolve o dado ao
    controle: a linha volta a ser editável, pode ser desmarcada, e viaja com o projeto. O
    rótulo `foraCatalogo` acompanha o serviço até o relatório e o CSV do pacote CDE, porque
    quem instrui processo precisa saber que aquele serviço entrou por fora do catálogo. */
function adotaServicosOrfaos(){
  const vistos = new Map();
  for (const k in S.dados){
    const p = k.split('|');
    if (p.length !== 4 || p[0] !== S.catId) continue;
    if (S.svc.some(s => s.nome === p[1])) continue;
    if (!vistos.has(p[1])) vistos.set(p[1], new Set());
    vistos.get(p[1]).add(p[2]);
  }
  vistos.forEach((lados, nome) => S.svc.push({
    nome, grupo: 'Fora do catálogo desta obra', lados: [...lados],
    unidade: 'km', on: true, foraCatalogo: true
  }));
  return vistos.size;
}

function pintaSvc(){
  $('#listaSvc').innerHTML = S.svc.map((s, i) => `
    <div class="svc">
      <input type="checkbox" data-i="${i}" ${s.on ? 'checked' : ''}>
      <div class="nm">${esc(s.nome)}${s.foraCatalogo
        ? ' <b style="color:var(--ambar)" title="Este serviço veio do projeto aberto e não '
          + 'está no catálogo desta obra. Ele conta no quadro e sai no relatório.">fora do '
          + 'catálogo</b>' : ''}<div class="gr">${esc(s.grupo)}</div></div>
      <div class="lados">${esc(s.lados.join(' · '))}</div>
    </div>`).join('');
  $$('#listaSvc input').forEach(c => c.onchange = () => {
    S.svc[+c.dataset.i].on = c.checked; render(); salvaLocal();
  });
}
function pintaLegenda(){
  $('#legenda').innerHTML = S.cat.status.map(s =>
    `<div class="leg"><i style="background:${s.cor}"></i><span><b>${s.cod}</b> — ${esc(s.nome)}</span></div>`).join('')
    + `<div class="leg" style="margin-top:8px"><i style="background:repeating-linear-gradient(45deg,#fff,#fff 3px,#F0F2F5 3px,#F0F2F5 6px);border:1px solid #D4DBE2"></i><span>Fora do trecho em obra</span></div>`
;
}
const corStatus = c => (S.cat.status.find(s => s.cod === c) || {}).cor || '#fff';
const txtStatus = c => (S.cat.status.find(s => s.cod === c) || {}).texto || '#1F2933';
const nomeStatus = c => (S.cat.status.find(s => s.cod === c) || {nome: 'Previsto'}).nome;

/* ---------------------------------------------------------------- eixo */
// Inverter troca a ponta do KM 0: a ordem das cadeias e a de cada vértice dentro delas.
// Os lançamentos são apagados, porque a célula «KM 12» passaria a designar outro lugar da
// rodovia — manter o preenchimento seria transferir serviço executado para o trecho errado.
const inverteLinhas = ls => ls.slice().reverse().map(l => l.slice().reverse());
function textoSentido(eixo){
  const st = (eixo && eixo.sentido) || {};
  const inv = S.invertido ? ' Sentido invertido manualmente.' : '';
  const q = n => n === 1 ? '1 ramal' : n + ' ramais';
  if (st.metodo === 'cadastro+ramais' || st.metodo === 'ramais')
    return `KM 0 em <b>${esc(eixo.inicio || 'início do cadastro')}</b>. Conferido por ` +
           `${q(st.pontos)} que declaram o KM onde nascem (correlação ${fmt(st.correlacao, 3)}` +
           `, erro médio ${fmt(st.erro_medio_km, 2)} km).` + inv;
  if (st.metodo === 'ramais_poucos')
    return `KM 0 em <b>${esc(eixo.inicio || 'início do cadastro')}</b>. Conferido pela ` +
           `posição de ${q(st.pontos)} que declara(m) o KM onde nasce(m) — erro médio ` +
           `${fmt(st.erro_medio_km, 2)} km. São poucos pontos para correlação: se o croqui ` +
           'mostrar o KM 0 na ponta errada, inverta.' + inv;
  if (st.metodo === 'cadastro')
    return `KM 0 em <b>${esc(eixo.inicio || 'início do cadastro')}</b>, pela ordem dos ` +
           'trechos no Sistema Rodoviário Estadual.' + inv;
  if (st.metodo === 'entroncamento')
    return `KM 0 no entroncamento com a <b>${esc(st.referencia)}</b>, localizado na ` +
           'geometria da rodovia de referência.' + inv;
  if (st.metodo === 'ponto_inicio')
    return 'KM 0 no ponto de início declarado no cadastro do ramal.' + inv;
  return '<b>Sentido não verificado.</b> Trecho único, sem ramal amarrado e sem ' +
         'entroncamento localizável. Confira no croqui de que lado está o KM 0 e inverta ' +
         'se preciso.' + inv;
}
// A extensao do acervo vem da mesma origem que a geometria (as camadas do DMOB), entao um
// registro errado sai auto-consistente e nenhuma prova interna o pega. `conferencia-extensao`
// e a conferencia contra a Planilha Geral do Departamento Rodoviario, que e fonte de fora.
// O arquivo e opcional: sem ele, a plataforma nao afirma nada sobre extensao conferida.
function textoSituacao(eixo){
  if (!eixo || eixo.tipo !== 'rodovia' || !eixo.faixas || !eixo.faixas.length) return '';
  const pl = eixo.faixas.filter(f => f.situacao === 'PLANEJADA');
  if (!pl.length) return '';
  const total = eixo.km_geometria || S.segs.reduce((a, sg) => a + sg.ext, 0);
  // DUAS FONTES, E ELAS DISCORDAM. `km_implantado` vem da GEOMETRIA do acervo; quem lê o
  // CADASTRO é a `conferencia-extensao.json`. Enquanto esta frase dizia «o cadastro» olhando
  // só a geometria, a AM-366 mostrava, na mesma caixa e a duas frases de distância, «o
  // cadastro não registra nenhum trecho implantado» e «o cadastro registra 17,00 km
  // implantados». Pior que a contradição era o conselho: «não há pista para medir
  // recuperação» num eixo com 17 km pavimentados em Tefé faz o fiscal concluir que não há
  // obra a fiscalizar onde há. Achado do jarvisIV em 23/08, e só apareceu porque o filtro de
  // planejadas trouxe esses eixos de volta à lista.
  if (eixo.km_implantado != null && eixo.km_implantado < 0.05){
    // o cadastro contradiz a geometria: quem fala deste eixo é o `textoExtensao`, que conhece
    // as duas fontes e diz qual é qual. Duas frases sobre o mesmo fato, uma delas errada, é
    // pior que uma frase só.
    if (kmCadastroImplantado(eixo) > 0) return '';
    return '<div class="aviso" style="margin-top:6px"><b>Rodovia planejada.</b> A ' +
           '<b>geometria</b> do acervo não traz nenhum trecho implantado neste eixo, e o ' +
           'cadastro não registra quilometragem implantada: não há pista para medir ' +
           'recuperação. O que se controla aqui é obra de <b>implantação</b>.</div>';
  }
  const faixa = f => `KM ${fmt(f.km_ini, 0)}–${fmt(f.km_fim, 0)}`;
  return `<div class="aviso" style="margin-top:6px"><b>Parte do eixo é planejada.</b> ` +
         `Implantado: <b>${fmt(eixo.km_implantado, 1)} km</b> de ${fmt(total, 1)} km. ` +
         `Planejado em ${pl.map(faixa).join(', ')} — nesses quilômetros não há pista ` +
         'implantada no cadastro.</div>';
}
function textoExtensao(eixo){
  if (!S.conf || !eixo || eixo.tipo !== 'rodovia') return '';
  const c = (S.conf.eixos || {})[eixo.nome];
  if (!c) return '<div class="dica" style="margin-top:6px">Extensão sem conferência ' +
                 'independente: o cadastro do Departamento Rodoviário não foi consultado ' +
                 'para este eixo.</div>';
  if (c.situacao !== 'diverge') return '';
  const cx = t => `<div class="aviso" style="margin-top:6px">${t}${
    c.nota ? ` <span class="dica">${esc(c.nota)}.</span>` : ''}</div>`;
  // Divergencia no trecho IMPLANTADO nao aparece no total: a AM-366 fecha o total em 0,01%
  // e mesmo assim tem 17 km de pista existente que a geometria nao traz. Falar de km total
  // aqui daria uma manchete tranquilizadora sobre um defeito grave.
  if (c.estado === 'TRAÇADO FALTANDO')
    return cx(`<b>Falta traçado no acervo.</b> O cadastro registra ` +
      `<b>${fmt(c.implantado_cadastro, 2)} km implantados</b>` +
      (c.local_f_cadastro ? ` até ${esc(c.local_f_cadastro)}` : '') +
      `, e a geometria não tem esse trecho — o que ela traz são ` +
      `${fmt(c.total_trena, 1)} km de diretriz planejada. Obra executada nesses ` +
      'quilômetros não tem onde ser lançada aqui.');
  if (c.estado === 'IMPLANTADO DIVERGE')
    return cx(`<b>Trecho implantado divergente.</b> O cadastro registra ` +
      `<b>${fmt(c.implantado_cadastro, 2)} km implantados</b> e o acervo classifica ` +
      `<b>${fmt(c.implantado_trena, 2)} km</b> — ` +
      `${fmt(Math.abs(c.implantado_cadastro - c.implantado_trena), 2)} km de diferença. ` +
      'O traçado está no acervo; o que difere é a situação física declarada.');
  return cx(`<b>Extensão divergente do cadastro.</b> O Departamento Rodoviário registra ` +
    `<b>${fmt(c.km_cadastro, 2)} km</b> e a geometria mede ` +
    `<b>${fmt(S.segs.reduce((a, sg) => a + sg.ext, 0), 2)} km</b> ` +
    `(${fmt(c.dif_pct, 1)}% de diferença). Confira antes de medir obra neste eixo.`);
}
let tmCroqui = null;
// A imagem custa dezenas de tiles: refazer a cada dígito do campo de KM seria pedir a
// mesma coisa dez vezes. Espera-se o usuário parar de digitar.
function renovaCroqui(){
  clearTimeout(tmCroqui);
  tmCroqui = setTimeout(() => {
    S.croqui = null;
    if (S.vista === 'croqui') pintaCroqui();
    geraCroqui().then(c => { S.croqui = c; if (S.vista === 'croqui') pintaCroqui(); });
  }, 900);
}
function inverteEixo(){
  if (!S.eixo) return;
  const tem = Object.keys(S.dados).length;
  if (tem && !confirm('Inverter o sentido reposiciona toda a quilometragem: a coluna KM 12 ' +
      'passa a ser outro ponto da rodovia. Os lançamentos serão apagados. Continuar?')) return;
  S.dados = {};
  S.invertido = !S.invertido;
  aplicaEixo({...S.eixo, linhas: inverteLinhas(S.eixo.linhas)}, true);
}
function aplicaEixo(eixo, mantemInv){
  S.eixo = eixo;
  if (!mantemInv) S.invertido = false;
  S.segs = segmentar(eixo.linhas);
  $('#dicaSentido').innerHTML = textoSentido(eixo) + textoSituacao(eixo) + textoExtensao(eixo);
  S.kmIni = S.segs.length ? S.segs[0].ini : 0;
  S.kmFim = S.segs.length ? S.segs[S.segs.length - 1].fim : 0;
  $('#kmIni').value = Math.floor(S.kmIni);
  $('#kmFim').value = Math.ceil(S.kmFim);
  $('#kmIni').max = $('#kmFim').max = Math.ceil(S.kmFim);
  if (!$('#nomeObra').value) $('#nomeObra').value = eixo.nome;
  $('#semEixo').classList.add('hidden');
  S.croqui = null;
  desenhaMapa(); render(); salvaLocal();
  // A imagem do traçado é montada assim que o eixo entra, para quem abre a plataforma já se
  // situar no local sem precisar pedir nada.
  geraCroqui().then(c => {
    S.croqui = c;
    if (S.vista === 'croqui') pintaCroqui();
  });
}
async function escolheAcervo(){
  const sel = $('#selAcervo');
  if (!sel.value) return;
  const d = await acervo(S.fonte);
  const it = d.itens[+sel.value];
  if (!it) return;
  aplicaEixo({nome: it.nome, tipo: it.tipo, linhas: it.linhas,
              km_cadastro: it.km_cadastro, km_geometria: it.km_geometria,
              km_implantado: it.km_implantado, faixas: it.faixas || [],
              inicio: it.inicio, fim: it.fim,
              sentido: it.sentido || {},
              meta: {saltos_km: it.saltos_km || [], partes: it.partes || 1}});
}
