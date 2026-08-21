/* Estado da aplicacao e utilitarios curtos usados por todos os modulos. */
'use strict';
const EST_M = 20;                    // 1 estaca = 20 m, praxe rodoviária
const CHAVE_LOCAL = 'controle-obra-unifilar-v1';
const CICLO = ['', 'C', 'E', 'S', 'NA'];

const S = {
  cat: null, catId: '', conf: null, acervo: {rodovia: null, ramal: null},
  fonte: 'rodovia', ref: 'km',
  eixo: null, segs: [], svc: [], dados: {},
  kmIni: 0, kmFim: 0, estOff: 0, obra: '',
  mapa: null, camadas: null, ultimo: null, vista: 'mapa', croqui: null,
  invertido: false
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (v, c = 2) => (+v || 0).toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[m]));

