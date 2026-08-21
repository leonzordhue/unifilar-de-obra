/* Motor de calculo: geodesia, costura de partes e divisao do eixo por
   quilometro. Nao toca em DOM nem em estado global — e o que a prova
   `ferramentas/testar-motor.mjs` carrega e roda fora do navegador. */
/* ---------------------------------------------------------------- geodesia
   O traçado vem em graus. Comprimento planar em graus não tem significado métrico —
   2 km valem ~0,018 grau —, e a divisão por quilômetro depende de distância real.
   Fórmula inversa de Vincenty sobre o elipsoide GRS-80. */
const A_EIXO = 6378137.0, F_ACHAT = 1 / 298.257222101, B_EIXO = A_EIXO * (1 - F_ACHAT);
function geod(a, b){
  const L = (b[0] - a[0]) * Math.PI / 180;
  const U1 = Math.atan((1 - F_ACHAT) * Math.tan(a[1] * Math.PI / 180));
  const U2 = Math.atan((1 - F_ACHAT) * Math.tan(b[1] * Math.PI / 180));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamP = 2 * Math.PI, it = 0, c2Alp = 0, sSig = 0, cSig = 0, sig = 0, c2SigM = 0;
  while (Math.abs(lam - lamP) > 1e-12 && it++ < 60){
    const sL = Math.sin(lam), cL = Math.cos(lam);
    sSig = Math.sqrt(Math.pow(cU2 * sL, 2) + Math.pow(cU1 * sU2 - sU1 * cU2 * cL, 2));
    if (sSig === 0) return 0;
    cSig = sU1 * sU2 + cU1 * cU2 * cL;
    sig = Math.atan2(sSig, cSig);
    const sAlp = cU1 * cU2 * sL / sSig;
    c2Alp = 1 - sAlp * sAlp;
    c2SigM = c2Alp === 0 ? 0 : cSig - 2 * sU1 * sU2 / c2Alp;
    const C = F_ACHAT / 16 * c2Alp * (4 + F_ACHAT * (4 - 3 * c2Alp));
    lamP = lam;
    lam = L + (1 - C) * F_ACHAT * sAlp * (sig + C * sSig * (c2SigM + C * cSig * (-1 + 2 * c2SigM * c2SigM)));
  }
  const u2 = c2Alp * (A_EIXO * A_EIXO - B_EIXO * B_EIXO) / (B_EIXO * B_EIXO);
  const Aa = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bb = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSig = Bb * sSig * (c2SigM + Bb / 4 * (cSig * (-1 + 2 * c2SigM * c2SigM)
    - Bb / 6 * c2SigM * (-3 + 4 * sSig * sSig) * (-3 + 4 * c2SigM * c2SigM)));
  return B_EIXO * Aa * (sig - dSig);
}
const extKm = l => {let t = 0; for (let i = 0; i < l.length - 1; i++) t += geod(l[i], l[i + 1]); return t / 1000;};
const interp = (a, b, d, tot) => {
  const t = tot === 0 ? 0 : d / tot;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

/* Divide o eixo em segmentos de 1 km. Parte nova do traçado encerra o segmento em curso:
   emendar por cima de uma descontinuidade faria a quilometragem correr sobre o vazio. */
function segmentar(linhas){
  const segs = [];
  let acum = 0, atual = {ini: 0, pts: []};
  const fecha = fim => {
    if (atual.pts.length < 2) return;
    const ex = extKm(atual.pts);
    // Segmento abaixo de 10 cm é resíduo numérico do corte, não trecho de rodovia.
    if (ex < 1e-4) return;
    segs.push({id: segs.length, ini: atual.ini, fim: fim, pts: atual.pts, ext: ex});
  };
  (linhas || []).forEach((linha, iParte) => {
    if (!linha || linha.length < 2) return;
    // Parte nova do traçado: encerra o segmento em curso e ABANDONA o ponto solto do corte
    // anterior. Sem abandonar, o ponto de corte da parte anterior ficaria ligado ao primeiro
    // ponto da parte nova e o segmento atravessaria o vazio entre as duas — medido na prova:
    // duas partes de 1 km distantes geravam quatro segmentos em vez de dois.
    if (iParte > 0){
      if (atual.pts.length > 1) fecha(acum / 1000);
      atual = {ini: acum / 1000, pts: []};
    }
    if (!atual.pts.length) atual.pts.push(linha[0]);
    for (let i = 0; i < linha.length - 1; i++){
      let p = linha[i];
      const q = linha[i + 1];
      let d = geod(p, q);
      while (d > 1e-6){
        const falta = 1000 - (acum % 1000);
        if (d < falta - 1e-9){ acum += d; atual.pts.push(q); d = 0; }
        else {
          const corte = interp(p, q, falta, d);
          atual.pts.push(corte);
          acum += falta;
          fecha(acum / 1000);
          atual = {ini: acum / 1000, pts: [corte]};
          d -= falta; p = corte;
        }
      }
    }
  });
  fecha(acum / 1000);
  return segs;
}

/* Costura das partes de um arquivo do usuário. Mesmo critério do acervo: emenda pelas duas
   pontas da cadeia em formação e, quando a ponta mais próxima está acima de SALTO_MAX_KM,
   abre cadeia nova em vez de emendar — somar o vazio inflaria a extensão da obra. Um KMZ
   exportado do Google Earth traz as partes na ordem em que foram desenhadas, que raramente
   é a ordem em que se ligam. */
const SALTO_MAX_KM = 3;
function costura(partes){
  const ps = (partes || []).filter(p => p.length > 1)
    .map(p => ({p, ext: extKm(p)})).sort((a, b) => b.ext - a.ext).map(o => o.p);
  if (!ps.length) return {cadeias: [], saltos: []};
  const cadeias = [], saltos = [];
  let atual = ps.shift().slice();
  while (ps.length){
    const ini = atual[0], fim = atual[atual.length - 1];
    let alvo = null;
    ps.forEach((p, k) => {
      [[geod(fim, p[0]), 'ap'], [geod(fim, p[p.length - 1]), 'ap_inv'],
       [geod(ini, p[p.length - 1]), 'pre'], [geod(ini, p[0]), 'pre_inv']]
        .forEach(([d, modo]) => { if (!alvo || d < alvo[0]) alvo = [d, k, modo]; });
    });
    const [dmin, k, modo] = alvo;
    let p = ps.splice(k, 1)[0];
    if (modo.endsWith('_inv')) p = p.slice().reverse();
    if (dmin / 1000 > SALTO_MAX_KM){
      saltos.push(+(dmin / 1000).toFixed(3));
      cadeias.push(atual);
      atual = p.slice();
    } else if (modo.startsWith('pre')){
      atual = p.concat(dmin > 1 ? atual : atual.slice(1));
    } else {
      atual = atual.concat(dmin > 1 ? p : p.slice(1));
    }
  }
  cadeias.push(atual);
  return {cadeias, saltos};
}
