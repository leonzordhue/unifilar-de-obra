/* Estado da aplicacao e utilitarios curtos usados por todos os modulos. */
'use strict';
const EST_M = 20;                    // 1 estaca = 20 m, praxe rodoviária
const CHAVE_LOCAL = 'controle-obra-unifilar-v1';
const CHAVE_OBRAS = 'controle-obra-unifilar-obras-v1';   // projetos por nº de contrato
// O giro do clique passa pelos SEIS estados do catálogo. «Paralisado» ficou de fora até
// 23/08, e o buraco era exatamente onde dói: é o primeiro estado que o cliente nomeou
// («indico a situação: parado, em andamento, concluído»), tem cor, tem coluna na grade, sai
// no quadro e no relatório — e o único lugar onde não se conseguia PÔR era a grade, que é o
// instrumento que ele pediu para pintar. Achado ao escrever o manual; conferido pelo jarvisIV.
//
// O preço está medido e declarado: voltar ao início custa cinco cliques em vez de quatro. O
// jarvisIV tem razão em dizer que ciclo não escala com número de estado, e a saída para isso
// é o pincel — a barra escolhe a situação, o clique aplica. Está proposta no canal com o
// custo; não entra na véspera de o cliente olhar a tela.
const CICLO = ['', 'C', 'E', 'PA', 'S', 'NA'];

// Abas registradas pelos módulos. A ordem é numérica para um módulo novo poder entrar
// entre dois existentes sem que ninguém renumere nada: mapa 10 · matriz 20 · croqui 30 ·
// resumo 40 · relatório 50.
// `registraAba()` foi REMOVIDA em 23/08. Nunca teve uma chamada em código nenhum, e mesmo
// assim o `COORDENACAO.md` a anunciava como «a maneira de criar aba sem mexer no index.html».
// Contrato que promete API morta é pior que contrato nenhum: quem precisou de uma vista nova
// — o painel — leu a promessa, não achou como usá-la, e criou o `#vPainel` na mão.
//
// A lista fica, vazia: `montaAbas()` e `ordemAba()` a percorrem, e é ela que sustentaria vista
// registrada por módulo. Hoje toda vista nasce no HTML. Se voltar a fazer sentido registrar
// por código, o lugar é aqui — com chamada de verdade, não com promessa no documento.
const ABAS = [];
function montaAbas(){
  const barra = $('#abas'), caixa = $('#conteudo');
  if (!barra || !caixa) return;
  ABAS.forEach(a => {
    if (!barra.querySelector(`button[data-v="${a.id}"]`)){
      const b = document.createElement('button');
      b.dataset.v = a.id;
      b.textContent = a.titulo;
      b.onclick = () => mostra(a.id);
      barra.insertBefore(b, [...barra.children].find(
        c => c.dataset && c.dataset.v && ordemAba(c.dataset.v) > a.ordem) || barra.firstChild);
    }
    if (!caixa.querySelector('#' + idVista(a.id))){
      const d = document.createElement('div');
      d.id = idVista(a.id);
      d.className = 'hidden';
      caixa.appendChild(d);
    }
  });
  $$('#abas button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === S.vista));
}
const idVista = id => 'v' + id.charAt(0).toUpperCase() + id.slice(1);
const ordemAba = id => (ABAS.find(a => a.id === id) || {ordem: 0}).ordem;

const S = {
  cat: null, catId: '', conf: null, acervo: {rodovia: null, ramal: null},
  fonte: 'rodovia', ref: 'km',
  eixo: null, segs: [], svc: [], dados: {},
  // O QUE ESTÁ A CAMINHO. Tudo o que depende de rede ou de desenho demorado passa por aqui,
  // e toda vista vazia pergunta antes de dizer «escolha um eixo»: o cliente abriu o relatório
  // 1,2 s depois de carregar o eixo e recebeu um documento sem mapa, porque a tela calada
  // durante o carregamento é indistinguível da tela vazia.
  carregando: '',
  // Data de cada lançamento, em mapa PARALELO a `dados` — e não dentro da célula. São onze
  // leitores de `S.dados` em sete arquivos: trocar o tipo do valor é a mudança que passa nas
  // provas e quebra no canto que ninguém abriu. O preço do mapa paralelo é poder divergir,
  // e o antídoto é `marcaKm()` ser o único lugar que escreve nos dois.
  datas: {},
  kmIni: 0, kmFim: 0, estOff: 0, obra: '',
  mapa: null, camadas: null, ultimo: null, vista: 'mapa', croqui: null,
  invertido: false,
  // `ens`, `reg`, `fotos`, `seqReg` e `fichaSeg` sairam em 24/08 com o controle
  // tecnologico: a plataforma controla andamento de servico por quilometro, e mais nada.
  contrato: '', sel: null, svcAtivo: '', responsavel: '', enquadrado: null
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (v, c = 2) => (+v || 0).toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));

