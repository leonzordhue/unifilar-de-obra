/* Projeto: salvar em arquivo, reabrir e guardar no navegador. */
/* ---------------------------------------------------------------- persistência */
function projetoAtual(){
  return {
    versao: 1, obra: $('#nomeObra').value, contrato: chaveContrato($('#contrato').value),
    contratoDados: S.contratoDados || {},
    ref: S.ref, fonte: S.fonte, catId: S.catId,
    kmIni: S.kmIni, kmFim: S.kmFim, estOff: +$('#estOff').value || 0,
    invertido: S.invertido,
    eixo: S.eixo ? {nome: S.eixo.nome, tipo: S.eixo.tipo, linhas: S.eixo.linhas,
                    km_cadastro: S.eixo.km_cadastro || 0, km_geometria: S.eixo.km_geometria || 0,
                    km_implantado: S.eixo.km_implantado, faixas: S.eixo.faixas || [],
                    inicio: S.eixo.inicio || '', fim: S.eixo.fim || '',
                    sentido: S.eixo.sentido || {}, meta: S.eixo.meta || null} : null,
    // `Set` não sobrevive ao JSON: vira `{}` sem avisar. Vai como lista e volta como Set.
    sel: [...(S.sel || [])],
    // `datas` viaja junto de `dados`: sem isto a data existiria só na aba aberta, e salvar e
    // reabrir devolveria o projeto inteiro com o histórico zerado, sem uma palavra
    svc: S.svc, dados: S.dados, datas: S.datas
  };
}
// O `catch` vazio que estava aqui custou 15 lançamentos numa medição do jarvisIV, sem um
// único aviso: a tela mostrava o trabalho e o navegador já tinha parado de gravar. A falha
// passa a ter três degraus — grava tudo, grava sem as fotos, ou avisa e deixa marca na tela.
let avisouCota = false;
function gravaProjetoLocal(txt){
  try { localStorage.setItem(CHAVE_LOCAL, txt); return true; } catch (e){ /* tenta liberar */ }
  // segunda tentativa liberando o espaço do próprio projeto: sem remover antes, o navegador
  // precisa caber o novo valor ao lado do antigo
  const antigo = localStorage.getItem(CHAVE_LOCAL);
  try { localStorage.removeItem(CHAVE_LOCAL); localStorage.setItem(CHAVE_LOCAL, txt); return true; }
  catch (e2){
    // não coube nem assim: devolve o que havia. Senão a tentativa de salvar teria apagado o
    // último estado bom — falhar é ruim, falhar destruindo o que estava guardado é pior.
    if (antigo != null) { try { localStorage.setItem(CHAVE_LOCAL, antigo); } catch (e3){} }
    return false;
  }
}
function salvaLocal(){
  S.obra = $('#nomeObra').value;
  const p = projetoAtual();
  if (gravaProjetoLocal(JSON.stringify(p))) { marcaSalvamento('ok'); return; }
  // Sem as fotos de ensaio, o que sobra no projeto é texto: o estouro de cota deixou de ter
  // um culpado óbvio para sacrificar. Se ainda assim não couber, avisa — nunca cala, que foi
  // o defeito que custou 15 lançamentos numa medição.
  marcaSalvamento('nao');
  if (!avisouCota){
    avisouCota = true;
    alert('O navegador recusou guardar o projeto: o armazenamento local está cheio.'
        + '\n\nO que você lançar a partir de agora existe só nesta aba — fechar ou '
        + 'recarregar a página perde o trabalho.\n\nUse SALVAR para gerar o arquivo do '
        + 'projeto; o traçado vai dentro dele.');
  }
}
// A marca fixa na tela importa mais que o alerta: alerta se fecha e se esquece, e quem
// chegou depois na máquina não viu nenhum.
function marcaSalvamento(estado){
  const m = $('#marcaSalvo');
  if (!m) return;
  if (estado === 'ok'){ avisouCota = false; m.className = 'hidden'; m.textContent = ''; return; }
  const semFoto = estado === 'semfoto';
  m.className = 'marcaSalvo' + (semFoto ? ' atencao' : ' ruim');
  m.textContent = semFoto ? 'Fotos sem espaço — salve em arquivo'
                          : 'NÃO ESTÁ SENDO GUARDADO — salve em arquivo';
  m.title = semFoto
    ? 'O projeto está guardado neste navegador, mas as fotos dos ensaios não couberam.'
    : 'O armazenamento local está cheio. O trabalho existe só nesta aba até ser salvo em arquivo.';
}
/** Data de hoje em AAAA-MM-DD, no fuso de quem está lançando.

    `toISOString()` daria UTC: às 21h de Manaus já é o dia seguinte em Greenwich, e o
    lançamento da tarde apareceria no dia errado do acompanhamento. */
function hoje(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O ÚNICO lugar que escreve lançamento — estado e data juntos.

    Antes havia três (dois na matriz, um na faixa), cada um cuidando só do estado. Com a data
    entrando no produto, três lugares seriam três chances de gravar estado sem data ou deixar
    data órfã de estado; e o quarto lugar que alguém acrescentasse amanhã não saberia da regra.

    A data é carimbada na MUDANÇA, não na escrita — achado do jarvisIV: o clique da matriz gira
    o estado, e girar o ciclo inteiro volta ao mesmo valor. Carimbando na escrita, essa volta
    trocaria uma data de junho pela de hoje e apagaria histórico sem mudar nada no dado.

    E o que ela guarda é quando se LANÇOU, não quando se executou: a turma executa na sexta e
    lança na segunda. Nenhum texto do produto pode chamar isto de «executado em». */
function marcaKm(l, id, v){
  const k = chave(l, id);
  if (v){
    if (S.dados[k] !== v) S.datas[k] = hoje();
    S.dados[k] = v;
  } else {
    delete S.dados[k];
    delete S.datas[k];
  }
}

/** A data mais recente entre um conjunto de chaves — vazio quando nenhuma tem data. */
function ultimaData(chaves){
  let m = '';
  chaves.forEach(k => { const d = S.datas[k]; if (d && d > m) m = d; });
  return m;
}

function migraChaves(dados, catId){
  const out = {};
  for (const k in dados) out[k.split('|').length === 3 ? `${catId}|${k}` : k] = dados[k];
  return out;
}
/** Projeto gravado quando o serviço tinha lado: LD/LE/AD/AE viram o lado único `U`.

    O cliente tirou o lado do controle em 24/08 («tudo é considerado no KM»). Sem esta
    migração, todo lançamento antigo ficaria órfão de uma chave que a tela não gera mais — a
    matriz abriria vazia sem avisar, que é o pior jeito de perder dado, e é o mesmo buraco
    que a `migraChaves` fechou quando o catálogo entrou na chave.

    Quando os dois lados divergem, vence o MAIS avançado, e a regra é dele: «por mais que
    seja de um lado, não iremos ver essa diferenciação». Se um lado foi executado, aquele
    quilômetro tem o serviço. É o contrário do que o quadro fazia enquanto o lado existia,
    onde o lado pendente segurava o quilômetro — e é o contrário de propósito: lá havia dois
    lados para comparar, aqui não há mais. */
const ORDEM_LADO = {C: 5, E: 4, PA: 3, S: 2, P: 1, NA: 0};
function colapsaLados(dados){
  const out = {};
  Object.keys(dados || {}).forEach(k => {
    const p = k.split('|');
    if (p.length !== 4){ out[k] = dados[k]; return; }
    const nova = [p[0], p[1], 'U', p[3]].join('|');
    const atual = out[nova];
    if (atual === undefined || ORDEM_LADO[dados[k]] > ORDEM_LADO[atual]) out[nova] = dados[k];
  });
  return out;
}

function aplicaProjeto(p){
  if (!p || p.versao !== 1) throw new Error('arquivo de projeto não reconhecido.');
  $('#nomeObra').value = p.obra || '';
  $('#contrato').value = p.contrato || '';
  S.contrato = p.contrato || '';
  S.contratoDados = p.contratoDados || {};
  // PROJETO ANTIGO COM ENSAIO ABRE E IGNORA. O controle tecnológico saiu em 24/08 e os
  // campos `ens`, `reg`, `seqReg` e `fotos` deixaram de ser lidos. O arquivo do cliente
  // continua com eles dentro — abrir e ignorar é aceitável, abrir e explodir não é —, e o
  // aviso abaixo diz o que a tela não está mostrando, em vez de calar sobre dado que existe.
  const nEns = Array.isArray(p.reg) ? p.reg.length : 0;
  if (nEns) console.info(`projeto traz ${nEns} ensaio(s) de uma versão anterior; `
    + 'esta versão controla apenas o andamento dos serviços.');
  S.sel = new Set(Array.isArray(p.sel) ? p.sel : []);
  S.ref = p.ref || 'km'; S.fonte = p.fonte || 'rodovia';
  S.catId = p.catId || S.cat.conjuntos[0].id;
  pintaCat();
  if (p.svc && p.svc.length) S.svc = p.svc.map(x => ({...x, lados: ['U'],
    ladosCatalogo: x.ladosCatalogo || x.lados}));
  else montaSvc();
  // Projeto gravado antes de o catalogo entrar na chave tem 3 campos em vez de 4. Sem
  // migrar, reabrir devolveria a matriz vazia sem avisar — o pior jeito de perder dado.
  S.dados = colapsaLados(migraChaves(p.dados || {}, p.catId || S.catId));
  // projeto salvo antes do registro de data abre sem data nenhuma, e isso é fato, não erro:
  // aqueles lançamentos são anteriores ao registro. Carimbar hoje inventaria um pico de
  // produção no dia da migração.
  S.datas = colapsaLados(migraChaves(p.datas || {}, p.catId || S.catId));
  // depois de `S.dados` existir: o que foi lançado e não está no catálogo entra na lista em
  // vez de sumir da tela — projeto do cliente trouxe 10 km assim
  if (typeof adotaServicosOrfaos === 'function' && adotaServicosOrfaos()) pintaSvc();
  S.estOff = p.estOff || 0; $('#estOff').value = S.estOff;
  $$('#segRef button').forEach(b => b.classList.toggle('on', b.dataset.r === S.ref));
  $$('#segFonte button').forEach(b => b.classList.toggle('on', b.dataset.f === S.fonte));
  $('#cxAcervo').classList.toggle('hidden', S.fonte === 'arquivo');
  $('#cxArquivo').classList.toggle('hidden', S.fonte !== 'arquivo');
  pintaSvc();
  if (p.eixo && p.eixo.linhas && p.eixo.linhas.length){
    S.eixo = p.eixo;
    S.segs = segmentar(p.eixo.linhas);
    S.invertido = !!p.invertido;
    // reabrir tem de devolver tambem a origem da quilometragem e o aviso de trecho
    // planejado: sem isto o projeto reaberto perde o que justifica a leitura da matriz
    $('#dicaSentido').innerHTML = textoSentido(S.eixo) + textoSituacao(S.eixo) + textoExtensao(S.eixo);
    S.kmIni = p.kmIni != null ? p.kmIni : 0;
    S.kmFim = p.kmFim != null ? p.kmFim : (S.segs.length ? S.segs[S.segs.length - 1].fim : 0);
    $('#kmIni').value = S.kmIni; $('#kmFim').value = S.kmFim;
    $('#semEixo').classList.add('hidden');
    desenhaMapa();
  }
  render();
}
