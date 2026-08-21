# -*- coding: utf-8 -*-
"""Confere o acervo do Trena contra o cadastro OFICIAL do Departamento Rodoviario.

Por que existe: o acervo do Trena e' derivado das camadas geojson do DMOB. A
Planilha Geral do Departamento Rodoviario e' outro documento, mantido a mao pelo
orgao, e e' a fonte que o Estado declara ao DNIT para a CIDE. Sao DUAS fontes
independentes sobre a mesma malha -- cruzar as duas e' a unica forma de saber se
o acervo esta certo sem ir a campo.

O que interessa aqui, e nao e' pouco: a extensao de cada eixo governa a matriz de
controle da obra. Se o Trena divide um eixo de 268 km e o cadastro diz 250 km, a
obra vai ser medida contra um eixo que nao existe.

Cruza:
  A) dados/acervo-rodovias-estaduais.json          (Trena, via geojson do DMOB)
  B) PLANILHA GERAL DEPARTAMENTO RODOVIARIO.xlsx   (cadastro do orgao, na rede)

Uso: python ferramentas/conferir-acervo-vs-cadastro.py
"""
import io
import json
import os
import re
import sys

try:
    import openpyxl
except ImportError:
    print('precisa de openpyxl: pip install openpyxl'); sys.exit(1)

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ACERVO = os.path.join(RAIZ, 'dados', 'acervo-rodovias-estaduais.json')

PLANILHA = (r'\\seinfra-fs01\ASPLAN\8.Departamento Rodoviário\9-BANCO DE DADOS'
            r'\1-PLANILHA GERAL DEPARTAMENTO\PLANILHA GERAL DEPARTAMENTO RODOVIÁRIO.xlsx')

# Tolerancia: 2% ou 500 m, o que for maior. Abaixo disso e' diferenca de
# simplificacao de tracado (o acervo simplifica a 11 m) e de arredondamento do
# cadastro, nao divergencia de fato.
TOL_PCT = 0.02
TOL_M = 500.0


def limpa(v):
    if v is None:
        return ''
    s = str(v).strip()
    if 'Ã' in s or 'Â' in s or '\ufffd' in s:
        try:
            s = s.encode('latin-1', 'ignore').decode('utf-8', 'ignore') or s
        except Exception:
            pass
    return re.sub(r'\s+', ' ', s).strip()


def num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(' ', '')
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def via(cod):
    m = re.match(r'^(\d{3})', (cod or '').strip())
    return m.group(1) if m else None


# ------------------------------------------------------------------ A) Trena
acervo = json.load(io.open(ACERVO, encoding='utf-8'))['itens']
trena = {}
for r in acervo:
    v = via((r.get('codigos') or [''])[0]) or re.sub(r'\D', '', r.get('nome', ''))[:3]
    trena[v] = r

# ------------------------------------------------------- B) cadastro do orgao
if not os.path.exists(PLANILHA):
    print('cadastro nao acessivel (rede fora do ar?):')
    print('  ' + PLANILHA)
    print('\nsem a segunda fonte nao ha o que cruzar. Abortando sem falsear resultado.')
    sys.exit(2)

wb = openpyxl.load_workbook(PLANILHA, read_only=True, data_only=True)
ws = wb['1 - PLANILHA GERAL DE RODOVIAS']
linhas = list(ws.iter_rows(values_only=True))
cab = [limpa(c).lower() for c in linhas[0]]


def col(*chaves):
    for j, nome in enumerate(cab):
        for k in chaves:
            if nome.startswith(k):
                return j
    return None


C = dict(cod=col('código', 'codigo'), rod=col('rodovia'), ki=col('km inicial'),
         kf=col('km final'), ext=col('extensão', 'extensao'),
         ini=col('início', 'inicio'), fim=col('final'),
         sit=col('situação f', 'situacao f'))

cadastro = {}
for ln in linhas[1:]:
    if not any(c is not None and str(c).strip() for c in ln):
        continue
    cod = limpa(ln[C['cod']]) if C['cod'] is not None else ''
    v = via(cod)
    if not v:
        continue
    d = cadastro.setdefault(v, dict(via=v, rod=limpa(ln[C['rod']]), trechos=[], ext=0.0))
    e = num(ln[C['ext']]) or 0.0
    d['ext'] += e
    d['trechos'].append(dict(
        cod=cod, ext=e, ki=num(ln[C['ki']]), kf=num(ln[C['kf']]),
        ini=limpa(ln[C['ini']]), fim=limpa(ln[C['fim']]),
        sit=limpa(ln[C['sit']])))
wb.close()

# ------------------------------------------------------------------ cruzamento
print('=' * 100)
print('ACERVO DO TRENA  x  CADASTRO DO DEPARTAMENTO RODOVIARIO')
print(f'  Trena ...... {len(trena)} eixos   (dados/acervo-rodovias-estaduais.json)')
print(f'  cadastro ... {len(cadastro)} eixos   (Planilha Geral, aba 1)')
print('=' * 100)

falhas, avisos = [], []

print(f"\n{'via':<8}{'Trena (km)':>12}{'cadastro (km)':>15}{'dif':>11}{'dif %':>9}"
      f"  sentido do Trena")
print('-' * 100)

comuns = sorted(set(trena) & set(cadastro))
for v in comuns:
    t, c = trena[v], cadastro[v]
    kt = t.get('km_geometria') or t.get('km_cadastro') or 0.0
    kc = c['ext']
    dif = kt - kc
    pct = (dif / kc * 100) if kc > 0.01 else 0.0
    lim = max(TOL_M / 1000.0, kc * TOL_PCT)
    marca = '' if abs(dif) <= lim else '  <== DIVERGE'
    if marca:
        falhas.append((v, kt, kc, dif, pct))
    sent = (t.get('sentido') or {})
    met = sent.get('metodo') if isinstance(sent, dict) else str(sent)
    print(f"AM-{v:<4}{kt:>12.3f}{kc:>15.3f}{dif:>11.3f}{pct:>8.1f}%  {met or '?'}{marca}")

so_trena = sorted(set(trena) - set(cadastro))
so_cad = sorted(set(cadastro) - set(trena))

print('-' * 100)
print(f'{len(comuns)} eixo(s) nos dois · {len(falhas)} divergencia(s) acima da tolerancia')

if so_trena:
    print(f'\nSO NO TRENA (sem correspondente no cadastro): {["AM-"+v for v in so_trena]}')
    for v in so_trena:
        t = trena[v]
        print(f'  AM-{v}  {t.get("km_geometria",0):.3f} km  {t.get("nome","")}')
        avisos.append(f'AM-{v} esta no acervo do Trena e nao no cadastro do orgao')

if so_cad:
    print(f'\nSO NO CADASTRO (ausente do acervo do Trena): {["AM-"+v for v in so_cad]}')
    for v in so_cad:
        c = cadastro[v]
        pav = [x for x in c['trechos'] if x['sit'] in ('PAV', 'DUP')]
        print(f'  AM-{v}  {c["ext"]:.2f} km  {c["rod"]}  '
              f'({len(c["trechos"])} trecho(s), {len(pav)} pavimentado(s))')
        for x in c['trechos']:
            print(f'       {x["cod"]:<12} km {x["ki"]:>7}-{x["kf"]:<8} {x["ext"]:>8.2f} '
                  f'{x["sit"]:<4} {x["ini"][:34]} -> {x["fim"][:28]}')
        avisos.append(f'AM-{v} ({c["ext"]:.2f} km) esta no cadastro e nao no acervo do Trena')

# --------------------------------------------- socorro ao sentido nao verificavel
print('\n' + '=' * 100)
print('EIXOS COM SENTIDO NAO VERIFICAVEL — o que o cadastro do orgao informa')
print('=' * 100)
print('O cadastro declara inicio e fim por trecho. Isso NAO prova o sentido da')
print('geometria, mas diz para onde o eixo deve apontar — e da ao operador como')
print('conferir na tela em vez de aceitar o padrao.\n')

nv = [v for v in trena
      if isinstance(trena[v].get('sentido'), dict)
      and trena[v]['sentido'].get('metodo') in ('indefinido', 'nao_verificavel', None)]
for v in sorted(nv):
    c = cadastro.get(v)
    t = trena[v]
    print(f'AM-{v}  ({t.get("km_geometria",0):.3f} km no Trena)')
    if not c:
        print('   sem registro no cadastro\n')
        continue
    for x in c['trechos']:
        print(f'   km {x["ki"]:>7} a {x["kf"]:<8} {x["ext"]:>8.2f} km  {x["sit"]:<4}')
        print(f'      inicio: {x["ini"]}')
        print(f'      fim   : {x["fim"]}')
    print()

print('=' * 100)
if falhas:
    print(f'DIVERGENCIA DE EXTENSAO em {len(falhas)} eixo(s) — conferir antes de medir obra:')
    for v, kt, kc, dif, pct in falhas:
        print(f'  AM-{v}: Trena {kt:.3f} km x cadastro {kc:.3f} km  ({dif:+.3f} km, {pct:+.1f}%)')
else:
    print('EXTENSAO: todos os eixos comuns fecham dentro da tolerancia.')
for a in avisos:
    print('  ! ' + a)
print('=' * 100)
sys.exit(1 if falhas else 0)
