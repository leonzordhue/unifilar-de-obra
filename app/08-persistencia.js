/* Projeto: salvar em arquivo, reabrir e guardar no navegador. */
/* ---------------------------------------------------------------- persistência */
function projetoAtual(){
  return {
    versao: 1, obra: $('#nomeObra').value, ref: S.ref, fonte: S.fonte, catId: S.catId,
    kmIni: S.kmIni, kmFim: S.kmFim, estOff: +$('#estOff').value || 0,
    invertido: S.invertido,
    eixo: S.eixo ? {nome: S.eixo.nome, tipo: S.eixo.tipo, linhas: S.eixo.linhas,
                    km_cadastro: S.eixo.km_cadastro || 0, km_geometria: S.eixo.km_geometria || 0,
                    km_implantado: S.eixo.km_implantado, faixas: S.eixo.faixas || [],
                    inicio: S.eixo.inicio || '', fim: S.eixo.fim || '',
                    sentido: S.eixo.sentido || {}, meta: S.eixo.meta || null} : null,
    svc: S.svc, dados: S.dados
  };
}
function salvaLocal(){
  S.obra = $('#nomeObra').value;
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(projetoAtual())); }
  catch (e){ /* traçado grande estoura o armazenamento local; salvar em arquivo continua valendo */ }
}
function migraChaves(dados, catId){
  const out = {};
  for (const k in dados) out[k.split('|').length === 3 ? `${catId}|${k}` : k] = dados[k];
  return out;
}
function aplicaProjeto(p){
  if (!p || p.versao !== 1) throw new Error('arquivo de projeto não reconhecido.');
  $('#nomeObra').value = p.obra || '';
  S.ref = p.ref || 'km'; S.fonte = p.fonte || 'rodovia';
  S.catId = p.catId || S.cat.conjuntos[0].id;
  pintaCat();
  if (p.svc && p.svc.length) S.svc = p.svc; else montaSvc();
  // Projeto gravado antes de o catalogo entrar na chave tem 3 campos em vez de 4. Sem
  // migrar, reabrir devolveria a matriz vazia sem avisar — o pior jeito de perder dado.
  S.dados = migraChaves(p.dados || {}, p.catId || S.catId);
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
