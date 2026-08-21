# -*- coding: utf-8 -*-
"""
Gera o acervo base da plataforma de controle de obra a partir das camadas do DMOB.

FONTE: `Projetos DMOB\\SEINFRA\\geojson_base\\` — rodovias estaduais (50 trechos, 34
rodovias) e ramais (907). Os arquivos estao em UTF-8 valido; nao ha mojibake a corrigir.

O QUE ESTE SCRIPT FAZ, e por que:

1. AGRUPA por rodovia. A camada traz um registro por TRECHO do Sistema Rodoviario Estadual;
   para o controle de obra interessa a rodovia inteira, com os trechos costurados na ordem
   em que se ligam. Sem isso, escolher «AM-010» na plataforma traria quatro pedacos soltos.

2. COSTURA as partes. Cada trecho pode ser MultiLineString com varias partes fora de ordem.
   A costura escolhe, a cada passo, a parte cuja ponta esta mais proxima do fim da anterior,
   invertendo-a quando necessario. Sem costura, a quilometragem acumulada saltaria de um
   extremo ao outro e a divisao por KM sairia errada.

3. SIMPLIFICA por Douglas-Peucker com tolerancia de ~11 m e arredonda a coordenada em 5
   casas (~1 m). Para uma plataforma que controla servico por quilometro, 11 m de desvio no
   tracado e irrelevante, e a diferenca de tamanho nao e: os ramais caem de 4 MB para uma
   fracao disso, o que decide se a pagina abre rapido ou nao.

4. GRAVA a extensao geodesica calculada sobre a geometria, ao lado da extensao cadastrada,
   para a plataforma poder mostrar as duas e o usuario decidir qual usa como referencia.
"""
import io
import json
import math
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = r"C:\Users\peneto\Desktop\Local de Trabalho do Claude"
BASE = os.path.join(RAIZ, "Projetos DMOB", "SEINFRA", "geojson_base")
DEST = os.path.join(RAIZ, "Projeto de Controle de Obra unifilar", "dados")

TOL_GRAU = 0.0001          # ~11 m — tolerancia da simplificacao
CASAS = 5                  # ~1 m — arredondamento da coordenada
SALTO_MAX_KM = 3.0         # acima disso, nao se costura: sao trechos desconexos
R_MIN = 0.6                # correlacao minima para a amarracao dos ramais decidir sentido

A_EIXO, F_ACHAT = 6378137.0, 1 / 298.257222101
B_EIXO = A_EIXO * (1 - F_ACHAT)


def geod(p1, p2):
    """Distancia geodesica em metros (Vincenty inversa, GRS-80)."""
    lon1, lat1 = p1[0], p1[1]
    lon2, lat2 = p2[0], p2[1]
    L = math.radians(lon2 - lon1)
    U1 = math.atan((1 - F_ACHAT) * math.tan(math.radians(lat1)))
    U2 = math.atan((1 - F_ACHAT) * math.tan(math.radians(lat2)))
    sU1, cU1, sU2, cU2 = math.sin(U1), math.cos(U1), math.sin(U2), math.cos(U2)
    lam, lamP, it = L, 2 * math.pi, 0
    c2Alp = sSig = cSig = sig = c2SigM = 0.0
    while abs(lam - lamP) > 1e-12 and it < 60:
        sL, cL = math.sin(lam), math.cos(lam)
        sSig = math.sqrt((cU2 * sL) ** 2 + (cU1 * sU2 - sU1 * cU2 * cL) ** 2)
        if sSig == 0:
            return 0.0
        cSig = sU1 * sU2 + cU1 * cU2 * cL
        sig = math.atan2(sSig, cSig)
        sAlp = cU1 * cU2 * sL / sSig
        c2Alp = 1 - sAlp ** 2
        c2SigM = 0 if c2Alp == 0 else cSig - 2 * sU1 * sU2 / c2Alp
        C = F_ACHAT / 16 * c2Alp * (4 + F_ACHAT * (4 - 3 * c2Alp))
        lamP = lam
        lam = L + (1 - C) * F_ACHAT * sAlp * (
            sig + C * sSig * (c2SigM + C * cSig * (-1 + 2 * c2SigM ** 2)))
        it += 1
    u2 = c2Alp * (A_EIXO ** 2 - B_EIXO ** 2) / B_EIXO ** 2
    Aa = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
    Bb = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
    dSig = Bb * sSig * (c2SigM + Bb / 4 * (
        cSig * (-1 + 2 * c2SigM ** 2) - Bb / 6 * c2SigM * (-3 + 4 * sSig ** 2)
        * (-3 + 4 * c2SigM ** 2)))
    return B_EIXO * Aa * (sig - dSig)


def ext_km(linha):
    return sum(geod(linha[i], linha[i + 1]) for i in range(len(linha) - 1)) / 1000.0


def dist_perp(p, a, b):
    """Distancia perpendicular aproximada em graus, com correcao de latitude."""
    kx = math.cos(math.radians((a[1] + b[1]) / 2))
    ax, ay = a[0] * kx, a[1]
    bx, by = b[0] * kx, b[1]
    px, py = p[0] * kx, p[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplifica(pts, tol):
    """Douglas-Peucker iterativo (sem recursao, para linha longa nao estourar a pilha)."""
    if len(pts) < 3:
        return list(pts)
    manter = [False] * len(pts)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pts) - 1)]
    while pilha:
        i, j = pilha.pop()
        pior, idx = 0.0, -1
        for k in range(i + 1, j):
            d = dist_perp(pts[k], pts[i], pts[j])
            if d > pior:
                pior, idx = d, k
        if pior > tol and idx > 0:
            manter[idx] = True
            pilha.append((i, idx))
            pilha.append((idx, j))
    return [p for p, m in zip(pts, manter) if m]


def partes(geom):
    if not geom:
        return []
    if geom["type"] == "LineString":
        return [[(c[0], c[1]) for c in geom["coordinates"] if len(c) >= 2]]
    if geom["type"] == "MultiLineString":
        return [[(c[0], c[1]) for c in p if len(c) >= 2] for p in geom["coordinates"]]
    return []


def costura(lista):
    """Une as partes em CADEIAS. Devolve (cadeias, saltos_internos).

    Emenda pelas DUAS pontas da cadeia em formacao. Emendar so pelo fim quebrava rodovia
    inteira: as duas metades da AM-010 partem do mesmo vertice em Barreira (uma para
    Manaus, outra para Itacoatiara), e a que ligava no INICIO da cadeia era lida como
    desconexa — o resultado eram dois pedacos e um KM 0 no meio do tracado.

    Emenda apenas o que se liga de fato: quando a ponta mais proxima esta a mais de
    SALTO_MAX_KM, abre-se uma cadeia nova em vez de emendar. Emendar por cima do vazio
    somaria a distancia do salto a extensao da rodovia — medido em 21/08: a AM-010 saia
    com 415 km contra 268 km de cadastro, porque um salto de 147 km entre dois grupos de
    tracado entrava como se fosse pista.
    """
    ps = [p for p in lista if len(p) > 1]
    if not ps:
        return [], []
    ps.sort(key=lambda p: -ext_km(p))
    cadeias, saltos = [], []
    atual = list(ps.pop(0))
    while ps:
        ini, fim = atual[0], atual[-1]
        alvo = None                       # (distancia, indice, modo)
        for k, p in enumerate(ps):
            for d, modo in ((geod(fim, p[0]), "ap"), (geod(fim, p[-1]), "ap_inv"),
                            (geod(ini, p[-1]), "pre"), (geod(ini, p[0]), "pre_inv")):
                if alvo is None or d < alvo[0]:
                    alvo = (d, k, modo)
        dmin, k, modo = alvo
        p = ps.pop(k)
        if modo.endswith("_inv"):
            p = list(reversed(p))
        if dmin / 1000.0 > SALTO_MAX_KM:
            saltos.append(round(dmin / 1000.0, 3))
            cadeias.append(atual)
            atual = list(p)
        elif modo.startswith("pre"):
            atual = p + (atual if dmin > 1 else atual[1:])
        else:
            atual.extend(p if dmin > 1 else p[1:])
    cadeias.append(atual)
    cadeias.sort(key=lambda c: -ext_km(c))
    return cadeias, saltos


def orienta_em_ordem(chs):
    """Escolhe o sentido de cada cadeia mantendo a ORDEM recebida (a do cadastro).

    Programacao dinamica de dois estados por cadeia (natural ou invertida), minimizando o
    vao entre o fim de uma e o inicio da seguinte. Como a ordem vem do `km_inicial` do
    cadastro, isso fixa o sentido do eixo: a AM-010 passa a comecar na Praca Nossa Senhora
    de Nazare, em Manaus, e nao no meio do tracado.
    """
    n = len(chs)
    if n < 2:
        return [list(c) for c in chs]
    INF = float("inf")
    dp, esc = [[0.0, 0.0]], []
    for i in range(1, n):
        atual, de = [INF, INF], [0, 0]
        for o in (0, 1):
            b = chs[i] if o == 0 else list(reversed(chs[i]))
            for po in (0, 1):
                a = chs[i - 1] if po == 0 else list(reversed(chs[i - 1]))
                c = dp[-1][po] + geod(a[-1], b[0])
                if c < atual[o]:
                    atual[o], de[o] = c, po
        dp.append(atual)
        esc.append(de)
    o = 0 if dp[-1][0] <= dp[-1][1] else 1
    ors = [o]
    for i in range(n - 1, 0, -1):
        o = esc[i - 1][o]
        ors.append(o)
    ors.reverse()
    return [list(chs[i]) if ors[i] == 0 else list(reversed(chs[i])) for i in range(n)]


def emenda(chs):
    """Concatena cadeias ja orientadas, abrindo cadeia nova onde o vao e grande."""
    saida, saltos = [], []
    atual = list(chs[0])
    for c in chs[1:]:
        d = geod(atual[-1], c[0]) / 1000.0
        if d > SALTO_MAX_KM:
            saltos.append(round(d, 3))
            saida.append(atual)
            atual = list(c)
        else:
            atual.extend(c if d * 1000 > 1 else c[1:])
    saida.append(atual)
    return saida, saltos


def km_ao_longo(cadeias, pt):
    """Quilometragem acumulada, ao longo do eixo, do vertice mais proximo de `pt`.

    Acumula entre cadeias sem somar o vao — a mesma conta que a plataforma faz ao dividir
    o eixo, para que a conferencia seja da mesma quilometragem que o usuario vai ver.
    """
    acum, melhor = 0.0, (float("inf"), 0.0)
    for c in cadeias:
        d = 0.0
        for i, v in enumerate(c):
            if i:
                d += geod(c[i - 1], v) / 1000.0
            g = geod(v, pt)
            if g < melhor[0]:
                melhor = (g, acum + d)
        acum += d
    return melhor[1], melhor[0] / 1000.0


RE_KM = re.compile(r"KM\s*([0-9]+(?:[.,][0-9]+)?)", re.I)


def refs_dos_ramais():
    """Pontos de referencia: {rodovia: [(km_declarado, (lon, lat))]}.

    Cada ramal declara em que KM da rodovia ele nasce (`ponto_referencia`) e onde fica esse
    ponto (`ponto_inicio`). Sao centenas de amarracoes independentes da geometria da
    rodovia — servem para conferir, sem fe, se a quilometragem do eixo cresce no sentido
    certo e se bate com o cadastro.
    """
    por = {}
    for f in carrega("ramais.geojson"):
        p = f["properties"]
        rod, pr, pi = limpa(p.get("rodovia_referencia")), limpa(p.get("ponto_referencia")), p.get("ponto_inicio")
        if not (rod.upper().startswith("AM-") and pi and len(pi) >= 2):
            continue
        m = RE_KM.search(pr)
        if not m or not pr.upper().startswith(rod.upper()):
            continue
        por.setdefault(rod, []).append((float(m.group(1).replace(",", ".")),
                                        (float(pi[0]), float(pi[1]))))
    return por


def confere_sentido(cadeias, refs):
    """Correlaciona KM declarado x KM medido. Devolve (inverter, n_uteis, correlacao, erro).

    Usa so as amarracoes que caem a menos de 300 m do eixo: um ramal cujo ponto de inicio
    esta longe da rodovia nao amarra nada, e entraria como ruido.
    """
    a, b = [], []
    for km, pt in refs:
        med, dist = km_ao_longo(cadeias, pt)
        if dist <= 0.3:
            a.append(km)
            b.append(med)
    n = len(a)
    if n == 0:
        return False, 0, None, None, None
    # erro medio do KM declarado contra o medido, nas duas orientacoes possiveis do eixo
    L = sum(ext_km(c) for c in cadeias)
    err_dir = sum(abs(x - y) for x, y in zip(a, b)) / n
    err_inv = sum(abs(x - (L - y)) for x, y in zip(a, b)) / n
    if n >= 3:
        ma, mb = sum(a) / n, sum(b) / n
        va = sum((x - ma) ** 2 for x in a) ** 0.5
        vb = sum((x - mb) ** 2 for x in b) ** 0.5
        if va == 0 or vb == 0:
            return False, n, None, None, None
        r = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb)
        return r < 0, n, round(r, 4), round(err_dir, 2), "forte"
    # Um ou dois ramais nao dao correlacao — dois pontos correlacionam sempre, e um nao
    # correlaciona nada. Mas a POSICAO ainda decide: se o KM declarado cai onde o eixo diz
    # que cai numa das orientacoes e erra grosso na outra, isso e evidencia, nao palpite.
    # Exige-se as duas coisas: acerto dentro da tolerancia e a orientacao contraria muito
    # pior, para que ramal mal cadastrado nao vire sentido.
    tol = max(1.0, 0.02 * L)
    melhor, pior = min(err_dir, err_inv), max(err_dir, err_inv)
    if melhor <= tol and pior >= 3 * melhor:
        return err_inv < err_dir, n, None, round(melhor, 2), "poucos"
    return False, n, None, None, None


def inverte(cadeias):
    return [list(reversed(c)) for c in reversed(cadeias)]


def limpa(v):
    if v is None:
        return ""
    s = str(v).strip()
    return unicodedata.normalize("NFC", s)


def num(v):
    try:
        return float(str(v).replace(",", ".").strip())
    except (ValueError, AttributeError):
        return 0.0


def carrega(nome):
    with io.open(os.path.join(BASE, nome), encoding="utf-8") as fh:
        return json.load(fh)["features"]


RE_ROD = re.compile(r"(?<![0-9A-Za-z])(AM|BR)[ .-]?([0-9]{3})(?![0-9])", re.I)


def malha_referencia():
    """Vertices de cada rodovia (estadual e federal) por codigo, para achar entroncamento.

    O cadastro descreve o inicio do trecho como «AM-010 (KM 55)» ou «BR-319 (KM 181)»: a
    rodovia referenciada e uma coordenada verificavel. Onde nao ha ramal amarrado, e ela
    que diz de que lado esta o KM 0.
    """
    m = {}
    for arq, campo in (("rodovias_estaduais.geojson", "rodovia"),
                       ("rodovias_federais.geojson", "br")):
        for f in carrega(arq):
            v = limpa(f["properties"].get(campo))
            cod = ("BR-" + v.zfill(3)) if campo == "br" else v.upper()
            alvo = m.setdefault(cod, [])
            for pt in partes(f.get("geometry")):
                alvo.extend(pt)
    return m


def dist_malha(pt, vs):
    return min((geod(pt, v) for v in vs), default=float("inf"))


def orienta_por_entroncamento(cadeias, ini, fim, malha):
    """Devolve (inverter, referencia) usando o entroncamento descrito no cadastro."""
    for texto, no_inicio in ((ini, True), (fim, False)):
        m = RE_ROD.search(texto or "")
        if not m:
            continue
        cod = m.group(1).upper() + "-" + m.group(2)
        vs = malha.get(cod)
        if not vs:
            continue
        da = dist_malha(cadeias[0][0], vs)
        db = dist_malha(cadeias[-1][-1], vs)
        if min(da, db) > 3000 or abs(da - db) < 500:
            continue                     # entroncamento longe ou ambiguo: nao decide
        perto_do_fim = db < da
        return (perto_do_fim if no_inicio else not perto_do_fim), cod
    return None, ""


def monta_rodovias():
    """Uma rodovia por registro, com os trechos na ordem do cadastro.

    A camada traz um registro por TRECHO do Sistema Rodoviario Estadual. Costurar todos os
    pedacos de uma vez, pela proximidade, ordena o tracado mas NAO diz de que lado esta o
    KM 0. Aqui os trechos entram na ordem do `km_inicial` do cadastro e so o sentido de
    cada um e escolhido — e o sentido do eixo passa a ser o oficial.
    """
    feats = carrega("rodovias_estaduais.geojson")
    refs = refs_dos_ramais()
    malha = malha_referencia()
    por = {}
    for f in feats:
        p = f["properties"]
        rod = limpa(p.get("rodovia")) or "(sem identificação)"
        por.setdefault(rod, []).append((num(p.get("km_inicial")), num(p.get("km_final")),
                                        p, partes(f.get("geometry"))))
    saida, avisos = [], []
    for rod in sorted(por):
        tr = sorted(por[rod], key=lambda t: (t[0], t[1]))
        trechos = [t[2] for t in tr]
        # 1. cada trecho e costurado em si; a maior cadeia representa o trecho
        chs, saltos = [], []
        for _ki, _kf, _p, prts in tr:
            c, sl = costura(prts)
            chs.extend(c)
            saltos.extend(sl)
        if not chs:
            continue
        # 2. o sentido de cada cadeia, mantida a ordem do cadastro
        cadeias, sl2 = emenda(orienta_em_ordem(chs))
        saltos.extend(sl2)
        cadeias = [simplifica(c, TOL_GRAU) for c in cadeias if len(c) > 1]
        if not cadeias:
            continue
        # 3. sentido do eixo, na ordem de forca da evidencia
        multi = len(trechos) > 1
        inv, nref, corr, erro, forca = confere_sentido(cadeias, refs.get(rod, []))
        ref_ent = ""
        # correlacao fraca nao decide nada: mede-se que a amarracao dos ramais e que esta
        # inconsistente, nao o sentido do eixo — a geometria bate com a extensao cadastrada.
        fraca = corr is not None and abs(corr) < R_MIN
        if fraca:
            avisos.append(f"{rod}: amarração dos ramais descartada (r={corr}, {nref} "
                          f"pontos, erro médio {erro} km) — o KM declarado nos ramais desta "
                          "rodovia é que está inconsistente; sentido definido por outra fonte")
            inv = False
        if forca == "forte" and not fraca:
            metodo = "cadastro+ramais" if multi else "ramais"
        elif forca == "poucos":
            metodo = "ramais_poucos"
        elif multi:
            metodo = "cadastro"
        else:
            inv_e, ref_ent = orienta_por_entroncamento(
                cadeias, limpa(trechos[0].get("trecho_inicio")),
                limpa(trechos[-1].get("trecho_fim")), malha)
            if inv_e is None:
                metodo = "indefinido"
            else:
                inv, metodo = inv_e, "entroncamento"
        if inv:
            cadeias = inverte(cadeias)
            if corr is not None:
                corr = -corr
            avisos.append(f"{rod}: sentido invertido — "
                          + (f"amarração dos ramais (r={corr}, {nref} pontos)"
                             if metodo.endswith("ramais") else
                             f"posição de {nref} ramal(is) declarado(s), erro médio {erro} km"
                             if metodo == "ramais_poucos" else
                             f"entroncamento com a {ref_ent}"))
        if metodo == "indefinido":
            avisos.append(f"{rod}: trecho único, sem ramal amarrado e sem entroncamento "
                          "localizável — sentido não verificável; usar «Inverter sentido» "
                          "se o KM 0 sair na ponta errada")
        km_geo = sum(ext_km(c) for c in cadeias)
        km_cad = sum(num(t.get("extensao_km")) for t in trechos)
        sit = sorted({limpa(t.get("situacao")) for t in trechos if limpa(t.get("situacao"))})
        rev = sorted({limpa(t.get("revestimento")) for t in trechos
                      if limpa(t.get("revestimento")) and limpa(t.get("revestimento")) != "—"})
        # Obra se mede onde ha pista: trecho PLANEJADA existe no cadastro e nao no chao.
        # Cada trecho e projetado na quilometragem final do eixo (ja orientado), para dizer
        # em que faixa de KM ele cai e quanto do eixo esta de fato implantado.
        faixas = []
        for _ki, _kf, prop, prts in tr:
            pts = [v for parte in prts for v in parte]
            if not pts:
                continue
            a, _da = km_ao_longo(cadeias, pts[0])
            b, _db = km_ao_longo(cadeias, pts[-1])
            faixas.append({"situacao": limpa(prop.get("situacao")),
                           "km_ini": round(min(a, b), 3), "km_fim": round(max(a, b), 3),
                           "km_cadastro": round(num(prop.get("extensao_km")) or 0.0, 3)})
        faixas.sort(key=lambda f: f["km_ini"])
        km_impl = round(sum(f["km_fim"] - f["km_ini"] for f in faixas
                            if f["situacao"] != "PLANEJADA"), 3)
        km_impl_cad = round(sum(f["km_cadastro"] for f in faixas
                                if f["situacao"] != "PLANEJADA"), 3)
        saida.append({
            "tipo": "rodovia",
            "id": rod,
            "nome": rod,
            "codigos": [limpa(t.get("codigo_snv")) for t in trechos if limpa(t.get("codigo_snv"))],
            "regiao": limpa(trechos[0].get("regiao")),
            "jurisdicao": limpa(trechos[0].get("jurisdicao")),
            "situacao": sit,
            "revestimento": rev,
            "trechos": len(trechos),
            "km_ini_cadastro": round(min(t[0] for t in tr), 3),
            "km_cadastro": round(km_cad, 3),
            "km_geometria": round(km_geo, 3),
            "km_implantado": km_impl,
            "km_implantado_cadastro": km_impl_cad,
            "faixas": faixas,
            "inicio": limpa(trechos[0].get("trecho_inicio")),
            "fim": limpa(trechos[-1].get("trecho_fim")),
            "sentido": {"metodo": metodo, "pontos": nref, "correlacao": corr,
                        "erro_medio_km": erro, "referencia": ref_ent,
                        "invertido": bool(inv)},
            "saltos_km": saltos,
            "partes": len(cadeias),
            "linhas": [[[round(x, CASAS), round(y, CASAS)] for x, y in c] for c in cadeias],
        })
    return saida, avisos


def monta_ramais():
    """Um ramal por registro, orientado pelo `ponto_inicio` declarado.

    O ramal nasce na rodovia: a coordenada de origem esta no cadastro, e e ela que define
    o KM 0. Sem isso, metade dos ramais sairia com a quilometragem contada da ponta para o
    entroncamento.
    """
    feats = carrega("ramais.geojson")
    saida, invertidos, sem_ponto = [], 0, 0
    for f in feats:
        p = f["properties"]
        cadeias, saltos = costura(partes(f.get("geometry")))
        cadeias = [simplifica(c, TOL_GRAU) for c in cadeias if len(c) > 1]
        if not cadeias:
            continue
        pi = p.get("ponto_inicio")
        if pi and len(pi) >= 2:
            o = (float(pi[0]), float(pi[1]))
            if geod(cadeias[-1][-1], o) < geod(cadeias[0][0], o):
                cadeias = inverte(cadeias)
                invertidos += 1
            metodo = "ponto_inicio"
        else:
            sem_ponto += 1
            metodo = "indefinido"
        nome = limpa(p.get("nome")) or limpa(p.get("codigo")) or "RAMAL"
        saida.append({
            "tipo": "ramal",
            "id": (limpa(p.get("codigo")) or nome) + "|" + limpa(p.get("numero")),
            "nome": nome,
            "codigo": limpa(p.get("codigo")),
            "numero": limpa(p.get("numero")),
            "municipio": limpa(p.get("municipio")),
            "rodovia_ref": limpa(p.get("rodovia_referencia")),
            "classificacao": limpa(p.get("classificacao")),
            "segmentacao": limpa(p.get("segmentacao")),
            "situacao": limpa(p.get("situacao")),
            "revestimento": limpa(p.get("revestimento")),
            "inicio": limpa(p.get("local_inicio")),
            "fim": limpa(p.get("local_termino")),
            "km_ini_cadastro": 0.0,
            "km_cadastro": round(num(p.get("extensao_km")), 3),
            "km_geometria": round(sum(ext_km(c) for c in cadeias), 3),
            "sentido": {"metodo": metodo, "pontos": 0, "correlacao": None,
                        "erro_medio_km": None},
            "saltos_km": saltos,
            "partes": len(cadeias),
            "linhas": [[[round(x, CASAS), round(y, CASAS)] for x, y in c] for c in cadeias],
        })
    saida.sort(key=lambda r: (r["municipio"], r["nome"]))
    return saida, invertidos, sem_ponto


def grava(nome, obj):
    os.makedirs(DEST, exist_ok=True)
    alvo = os.path.join(DEST, nome)
    with io.open(alvo, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(alvo) / 1024
    print(f"   {nome}: {kb:,.0f} KB")
    return alvo


def main():
    print("ACERVO BASE — plataforma de controle de obra")
    rod, avisos = monta_rodovias()
    ram, invertidos, sem_ponto = monta_ramais()
    print(f"\nrodovias estaduais: {len(rod)} · "
          f"{sum(r['km_geometria'] for r in rod):,.1f} km de geometria")
    print(f"ramais            : {len(ram)} · "
          f"{sum(r['km_geometria'] for r in ram):,.1f} km de geometria "
          f"({invertidos} com sentido corrigido pelo ponto de início, "
          f"{sem_ponto} sem ponto declarado)")

    print("\nsentido do eixo das rodovias:")
    for m in ("cadastro+ramais", "ramais", "ramais_poucos", "cadastro",
              "entroncamento", "indefinido"):
        q = [r["nome"] for r in rod if r["sentido"]["metodo"] == m]
        if q:
            print(f"   {m:16s} {len(q):3d} → {', '.join(q[:12])}"
                  + (" ..." if len(q) > 12 else ""))
    amarradas = [r for r in rod if r["sentido"]["metodo"].endswith("ramais")]
    if amarradas:
        pior = max(amarradas, key=lambda r: r["sentido"]["erro_medio_km"])
        print(f"   conferência por ramais: {len(amarradas)} rodovia(s), "
              f"correlação mínima {min(r['sentido']['correlacao'] for r in amarradas):.3f}, "
              f"pior erro médio {pior['sentido']['erro_medio_km']:.2f} km ({pior['nome']})")
    for a in avisos:
        print("   aviso:", a)

    com_salto = [r for r in rod + ram if r["saltos_km"]]
    if com_salto:
        print(f"\n{len(com_salto)} eixo(s) com descontinuidade acima de {SALTO_MAX_KM} km "
              "entre partes — a costura foi feita, mas a quilometragem acumulada nesses "
              "eixos passa por vazio de traçado:")
        for r in sorted(com_salto, key=lambda x: -max(x["saltos_km"]))[:8]:
            print(f"   {r['nome'][:40]:42s} saltos: "
                  f"{', '.join(f'{s:.1f} km' for s in r['saltos_km'][:4])}")

    print("\ngravando:")
    grava("acervo-rodovias-estaduais.json",
          {"gerado_em": "2026-08-21", "fonte": "SEINFRA/DMOB — geojson_base",
           "tolerancia_simplificacao_m": 11, "itens": rod})
    grava("acervo-ramais.json",
          {"gerado_em": "2026-08-21", "fonte": "SEINFRA/DMOB — geojson_base",
           "tolerancia_simplificacao_m": 11, "itens": ram})

    # conferencia: geometria x cadastro
    print("\nconferência geometria x cadastro (rodovias com diferença acima de 10%):")
    n = 0
    for r in rod:
        c, g = r["km_cadastro"], r["km_geometria"]
        if c > 0 and abs(g - c) / c > 0.10:
            print(f"   {r['nome']:10s} cadastro {c:9.2f} km · geometria {g:9.2f} km")
            n += 1
    if not n:
        print("   nenhuma")


if __name__ == "__main__":
    main()
