# -*- coding: utf-8 -*-
"""Confere o acervo do SICOR contra o cadastro do Departamento Rodoviario.

Duas fontes independentes sobre a mesma malha:
  A) dados/acervo-rodovias-estaduais.json  — SICOR, derivado das camadas do DMOB
  B) dados/cadastro-dmob-retrato.json      — retrato da Planilha Geral do orgao
     (regerar com ferramentas/_cache_cadastro.py; ele tenta a rede e, se ela
      estiver fora, usa uma extracao previa DECLARANDO a procedencia)

Por que a comparacao precisa ser IMPLANTADO x IMPLANTADO, e nao extensao total:
o cadastro e o acervo classificam cada trecho por situacao fisica. Comparar o
total soma rodovia planejada — que nao existe no chao — com rodovia que existe, e
uma divergencia de 78 km pode significar duas coisas opostas:

  - o acervo mediu errado um trecho existente;  ou
  - o acervo tem a DIRETRIZ PLANEJADA de um traçado e nao tem a estrada que
    existe hoje no mesmo corredor.

A segunda e' um buraco de traçado, nao de medida, e o conserto e' outro: obter a
geometria que falta, nao corrigir numero. Separar implantado de planejado e' o
que distingue os dois casos.

Uso:
  python ferramentas/conferir-acervo-vs-cadastro.py
  python ferramentas/conferir-acervo-vs-cadastro.py --gravar
      grava dados/conferencia-extensao.json, que a plataforma le para avisar,
      em cada eixo, se a extensao tem conferencia independente.
"""
import io
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ACERVO = os.path.join(RAIZ, 'dados', 'acervo-rodovias-estaduais.json')
RETRATO = os.path.join(RAIZ, 'dados', 'cadastro-dmob-retrato.json')
CONFER = os.path.join(RAIZ, 'dados', 'conferencia-extensao.json')

GRAVAR = '--gravar' in sys.argv

# 2% ou 500 m, o que for maior: abaixo disso e' simplificacao de traçado (o
# acervo simplifica a 11 m) e arredondamento do cadastro, nao divergencia.
TOL_PCT, TOL_M = 0.02, 500.0
IMPLANTADO = {'PAV', 'DUP', 'IMP', 'LEN', 'TRV', 'MTF', 'TRP'}   # tudo menos PLA


def via(cod):
    m = re.match(r'^(\d{3})', (cod or '').strip())
    return m.group(1) if m else None


def carrega():
    ac = json.load(io.open(ACERVO, encoding='utf-8'))['itens']
    trena = {}
    for r in ac:
        v = via((r.get('codigos') or [''])[0])
        if v:
            trena[v] = r
    if not os.path.exists(RETRATO):
        print('falta o retrato do cadastro:')
        print('  ' + RETRATO)
        print('\nrode primeiro:  python ferramentas/_cache_cadastro.py')
        sys.exit(2)
    ret = json.load(io.open(RETRATO, encoding='utf-8'))
    cad = {}
    for t in ret['trechos']:
        v = via(t['cod'])
        if not v:
            continue
        d = cad.setdefault(v, dict(rodovia=t['rodovia'], trechos=[],
                                   total=0.0, implantado=0.0))
        e = t.get('ext') or 0.0
        d['total'] += e
        if (t.get('situacao') or '').upper() in IMPLANTADO:
            d['implantado'] += e
        d['trechos'].append(t)
    return trena, cad, ret


trena, cad, ret = carrega()

print('=' * 100)
print('ACERVO DO TRENA  x  CADASTRO DO DEPARTAMENTO RODOVIARIO')
print(f'  SICOR ...... {len(trena)} eixos')
print(f'  cadastro ... {len(cad)} eixos · {ret.get("procedencia")}'
      + (f' · lido em {ret["lido_em"]}' if ret.get('lido_em') else ''))
print('=' * 100)

falhas, avisos, registro = [], [], {}

print(f"\n{'via':<8}{'IMPLANTADO':>22}{'':>4}{'TOTAL (c/ planejado)':>26}")
print(f"{'':<8}{'SICOR':>10}{'cadastro':>12}{'':>4}{'SICOR':>11}{'cadastro':>13}"
      f"   situação")
print('-' * 100)

for v in sorted(set(trena) & set(cad)):
    t, c = trena[v], cad[v]
    ti = t.get('km_implantado')
    ti = 0.0 if ti is None else float(ti)
    ci = c['implantado']
    tt = float(t.get('km_geometria') or 0)
    ct = c['total']

    lim_i = max(TOL_M / 1000.0, ci * TOL_PCT)
    lim_t = max(TOL_M / 1000.0, ct * TOL_PCT)
    ok_i = abs(ti - ci) <= lim_i
    ok_t = abs(tt - ct) <= lim_t

    if ok_i and ok_t:
        estado, marca = 'confere', ''
    elif not ok_i and ci > 0.01 and ti < 0.01:
        estado = 'TRAÇADO FALTANDO'
        marca = f'  <== o cadastro tem {ci:.2f} km implantados e o acervo não tem nenhum'
        falhas.append((v, 'tracado', ti, ci, tt, ct))
    elif not ok_i:
        estado = 'IMPLANTADO DIVERGE'
        marca = f'  <== {ti - ci:+.2f} km'
        falhas.append((v, 'implantado', ti, ci, tt, ct))
    else:
        estado = 'só o total diverge'
        marca = f'  <== total {tt - ct:+.2f} km, implantado confere'
        avisos.append(f'AM-{v}: total diverge {tt - ct:+.2f} km, implantado confere')

    print(f'AM-{v:<5}{ti:>10.3f}{ci:>12.3f}{"":>4}{tt:>11.3f}{ct:>13.3f}'
          f'   {estado}{marca}')

    # Os quatro primeiros campos sao o CONTRATO que app/03-acervo.js consome em
    # textoExtensao(): `situacao` decide se avisa, e `km_cadastro`, `dif_pct` e
    # `nota` entram no texto da tela. O resto e' extra, para leitura humana.
    # Conferido lendo o consumidor antes de gravar — escrever forma errada aqui
    # nao daria erro, daria aviso silenciosamente ausente.
    diverge = not (ok_i and ok_t)
    if estado == 'TRAÇADO FALTANDO':
        nota = (f'O cadastro registra {ci:.2f} km de estrada implantada '
                f'({", ".join(x["cod"] for x in c["trechos"] if x["situacao"] != "PLA")}) '
                f'que não existe na geometria do acervo — falta traçado, não sobra '
                f'número. O que o acervo traz é a diretriz planejada até '
                f'{(trena[v].get("fim") or "").strip()[:40]}')
    elif estado == 'IMPLANTADO DIVERGE':
        nota = (f'Implantado no cadastro: {ci:.2f} km; no acervo: {ti:.2f} km. '
                f'A diferença está na classificação de situação física dos trechos')
    elif estado == 'só o total diverge':
        nota = 'A parte implantada confere; a divergência está no trecho planejado'
    else:
        nota = ''

    registro[f'AM-{v}'] = dict(
        situacao='diverge' if diverge else 'confere',
        km_cadastro=round(ct, 3),
        dif_pct=round((tt - ct) / ct * 100, 2) if ct > 0.01 else 0.0,
        nota=nota,
        implantado_trena=round(ti, 3), implantado_cadastro=round(ci, 3),
        total_trena=round(tt, 3), estado=estado,
        local_i_cadastro=c['trechos'][0].get('local_i', ''),
        local_f_cadastro=c['trechos'][-1].get('local_f', ''),
        codigos_cadastro=[x['cod'] for x in c['trechos']])

print('-' * 100)
soma_ti = sum(float(trena[v].get('km_implantado') or 0) for v in trena)
soma_ci = sum(cad[v]['implantado'] for v in cad)
print(f'{"IMPLANTADO, somando tudo":<8}{soma_ti:>10.1f}{soma_ci:>12.1f}'
      f'   diferença {soma_ti - soma_ci:+.1f} km')

so_t = sorted(set(trena) - set(cad))
so_c = sorted(set(cad) - set(trena))
if so_t:
    print(f'\nSÓ NO TRENA: {["AM-" + v for v in so_t]}')
if so_c:
    print(f'\nSÓ NO CADASTRO: {["AM-" + v for v in so_c]}')
    for v in so_c:
        avisos.append(f'AM-{v} está no cadastro e não no acervo do SICOR')

# ------------------------------------------------------- detalhe das falhas
if falhas:
    print('\n' + '=' * 100)
    print('DETALHE — o que o cadastro declara nos eixos que não fecham')
    print('=' * 100)
    for v, tipo, ti, ci, tt, ct in falhas:
        c = cad[v]
        print(f'\nAM-{v}  ({tipo})')
        print(f'   SICOR:    {tt:.3f} km de traçado, {ti:.3f} km implantado, '
              f'fim declarado "{(trena[v].get("fim") or "")[:44]}"')
        print(f'   cadastro: {ct:.3f} km em {len(c["trechos"])} trecho(s), '
              f'{ci:.3f} km implantado')
        for x in c['trechos']:
            print(f'      {x["cod"]:<12} km {x["km_i"]:>7}–{x["km_f"]:<8} '
                  f'{(x["ext"] or 0):>8.2f} km  {x["situacao"]:<4} '
                  f'{x["local_i"][:30]} -> {x["local_f"][:26]}')

# ------------------------------------------------------------------ gravação
if GRAVAR:
    saida = dict(
        gerado_em='2026-08-21',
        fonte_cadastro=ret.get('origem'),
        procedencia=ret.get('procedencia'),
        criterio=('Comparação implantado x implantado. Tolerância de 2% ou 500 m, '
                  'o que for maior. "TRAÇADO FALTANDO" significa que o cadastro '
                  'registra estrada implantada que o acervo não tem — falta '
                  'geometria, não sobra número.'),
        eixos=registro)
    io.open(CONFER, 'w', encoding='utf-8', newline='').write(
        json.dumps(saida, ensure_ascii=False, indent=1))
    print(f'\ngravado: dados/conferencia-extensao.json  ({len(registro)} eixos, '
          f'{sum(1 for r in registro.values() if r["situacao"] == "confere")} conferem)')

print('\n' + '=' * 100)
if falhas:
    print(f'{len(falhas)} eixo(s) não fecham — conferir antes de medir obra:')
    for v, tipo, ti, ci, tt, ct in falhas:
        print(f'  AM-{v} ({tipo}): implantado SICOR {ti:.2f} km x '
              f'cadastro {ci:.2f} km')
else:
    print('IMPLANTADO: todos os eixos comuns fecham dentro da tolerância.')
for a in avisos:
    print('  ! ' + a)
print('=' * 100)
sys.exit(1 if falhas else 0)
