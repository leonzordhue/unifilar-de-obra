# -*- coding: utf-8 -*-
"""J2 — resolve o sentido das rodovias "não verificáveis" pela amarração dos ramais
que está escrita em PROSA no campo `inicio`.

O achado que motiva este arquivo: o acervo de ramais registra em que km da rodovia
de referência o ramal nasce — só que dentro do texto, não em campo próprio:

    "Início do Ramal do Crispim - Am-170 - Km 5,80"

O `gerar-acervo.py` amarra por campo, então para estas rodovias ele encontrou
`pontos: 0` e marcou o sentido como não verificável. O dado estava lá o tempo
todo, em linguagem natural.

Como a prova funciona: o primeiro vértice do ramal É o entroncamento (o próprio
README registra que isso vale nos 905 casos). Sabendo o km declarado e tendo a
coordenada, mede-se a distância do entroncamento às duas pontas da rodovia. Se a
ponta A está a ~K km do entroncamento que declara km K, a ponta A é o KM 0.

Com dois ou mais ramais a prova fica mais forte: a distância medida desde a ponta
certa tem de CRESCER junto com o km declarado.
"""
import io
import json
import math
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

NAO_VERIF = ['170', '175', '239', '249', '280', '329', '374']
TOL_KM = 5.0     # erro aceitável entre km declarado e distância medida


def km(a, b):
    R = 6371.0088
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl, dp = math.radians(b[0] - a[0]), p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def texto(v):
    s = str(v or '')
    if 'Ã' in s or 'Â' in s or '�' in s:
        try:
            s = s.encode('latin-1', 'ignore').decode('utf-8', 'ignore') or s
        except Exception:
            pass
    return s


def km_declarado(inicio, via):
    """Extrai 'Am-374 - Km 96,5' -> 96.5. Exige que a via citada seja a certa,
    senão um 'Km 00' de outra referência na mesma frase entraria como amarração."""
    t = texto(inicio).upper().replace('.', ',')
    m = re.search(r'AM[\s\-]*0*' + via + r'\s*[\-–]\s*KM\s*([\d]+(?:,\d+)?)', t)
    if not m:
        return None
    return float(m.group(1).replace(',', '.'))


def dist_ao_longo(pts, alvo):
    """Distância, medida ao longo do traçado a partir de pts[0], do ponto do
    traçado mais próximo de `alvo`. É isso que se compara com o km declarado —
    distância em linha reta subestimaria em eixo sinuoso."""
    melhor, acum, dmin = 0.0, 0.0, float('inf')
    for i in range(len(pts) - 1):
        d = km(pts[i], alvo)
        if d < dmin:
            dmin, melhor = d, acum
        acum += km(pts[i], pts[i + 1])
    d = km(pts[-1], alvo)
    if d < dmin:
        dmin, melhor = d, acum
    return melhor, dmin, acum


rod = json.load(io.open(os.path.join(RAIZ, 'dados',
                'acervo-rodovias-estaduais.json'), encoding='utf-8'))['itens']
ram = json.load(io.open(os.path.join(RAIZ, 'dados',
                'acervo-ramais.json'), encoding='utf-8'))
ram = ram['itens'] if isinstance(ram, dict) else ram

trena = {}
for r in rod:
    m = re.match(r'^(\d{3})', (r.get('codigos') or [''])[0])
    if m:
        trena[m.group(1)] = r

out = []
w = out.append
w('| Rodovia | ramais com km legível | km declarados | veredito |')
w('|---|---|---|---|')

detalhe = []
for v in NAO_VERIF:
    t = trena.get(v)
    if not t:
        w(f'| AM-{v} | — | — | ausente do acervo |')
        continue
    pts = [q for linha in t['linhas'] for q in linha]
    L = sum(km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

    amarras = []
    for r in ram:
        if str(r.get('rodovia_ref') or '') != f'AM-{v}':
            continue
        k = km_declarado(r.get('inicio'), v)
        if k is None or not r.get('linhas'):
            continue
        amarras.append((k, r['linhas'][0][0], texto(r.get('nome'))))

    if not amarras:
        w(f'| AM-{v} | 0 | — | **sem amarração** — segue não verificável |')
        continue

    linhas_det = [f'**AM-{v}** — {L:.2f} km de traçado, {len(amarras)} amarração(ões)']
    acertos_direto = acertos_invertido = 0
    for k, p, nome in sorted(amarras):
        d_dir, desvio, _ = dist_ao_longo(pts, p)
        d_inv = L - d_dir
        ok_dir = abs(d_dir - k) <= TOL_KM
        ok_inv = abs(d_inv - k) <= TOL_KM
        acertos_direto += ok_dir
        acertos_invertido += ok_inv
        linhas_det.append(
            f'  - km {k:g} declarado · medido {d_dir:.2f} km do KM 0 atual '
            f'(ou {d_inv:.2f} km se invertido) · entroncamento a {desvio*1000:.0f} m '
            f'do eixo · {nome[:34]}')

    if acertos_direto and not acertos_invertido:
        ver = f'**KM 0 confirmado** ({acertos_direto}/{len(amarras)})'
    elif acertos_invertido and not acertos_direto:
        ver = f'**INVERTIDO** ({acertos_invertido}/{len(amarras)}) — trocar a ponta'
    elif acertos_direto and acertos_invertido:
        ver = 'ambíguo — as duas leituras cabem na tolerância'
    else:
        ver = f'nenhuma leitura fecha (±{TOL_KM:g} km) — km do cadastro suspeito'
    w(f'| AM-{v} | {len(amarras)} | {", ".join(f"{k:g}" for k, _, _ in sorted(amarras))} '
      f'| {ver} |')
    detalhe.append('\n'.join(linhas_det))

txt = '\n'.join(out) + '\n\n### Medição, ramal por ramal\n\n' + '\n\n'.join(detalhe)
sys.stdout.buffer.write(txt.encode('utf-8', 'replace'))
sys.stdout.buffer.write(b'\n')
os.makedirs(os.path.join(AQUI, '_temp'), exist_ok=True)
io.open(os.path.join(AQUI, '_temp', 'j2-amarracao.md'), 'w',
        encoding='utf-8', newline='').write(txt)
