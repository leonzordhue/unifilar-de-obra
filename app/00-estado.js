/* Estado da aplicacao e utilitarios curtos usados por todos os modulos. */
'use strict';
const EST_M = 20;                    // 1 estaca = 20 m, praxe rodoviária
const CHAVE_LOCAL = 'controle-obra-unifilar-v1';
const CHAVE_OBRAS = 'controle-obra-unifilar-obras-v1';   // projetos por nº de contrato
const CICLO = ['', 'C', 'E', 'S', 'NA'];

// Abas registradas pelos módulos. A ordem é numérica para um módulo novo poder entrar
// entre dois existentes sem que ninguém renumere nada: mapa 10 · matriz 20 · croqui 30 ·
// resumo 40 · relatório 50.
const ABAS = [];
function registraAba(a){
  if (ABAS.some(x => x.id === a.id)) throw new Error('aba repetida: ' + a.id);
  ABAS.push(a);
  ABAS.sort((x, y) => x.ordem - y.ordem);
  if (document.readyState !== 'loading') montaAbas();
}
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
  kmIni: 0, kmFim: 0, estOff: 0, obra: '',
  mapa: null, camadas: null, ultimo: null, vista: 'mapa', croqui: null,
  invertido: false,
  ens: [], reg: [], fotos: {}, seqReg: 0, fichaSeg: null,
  contrato: '', sel: null, svcAtivo: '', responsavel: '', enquadrado: null
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (v, c = 2) => (+v || 0).toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));

