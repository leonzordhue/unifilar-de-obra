# -*- coding: utf-8 -*-
"""Prova que o testar-modulos.mjs PEGA os defeitos que promete pegar.

Verificador que so' diz OK nao vale nada: se ele nunca reprovou, ninguem sabe se
ele consegue reprovar. Aqui os defeitos sao INJETADOS numa copia do projeto e
espera-se FALHA em cada um. Se algum passar, o verificador tem um furo.

Roda numa copia temporaria. O projeto nao e' tocado.
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
BS = chr(92)


def prepara(destino):
    for item in ('index.html', 'app', 'ferramentas', 'dados'):
        o = os.path.join(RAIZ, item)
        d = os.path.join(destino, item)
        if os.path.isdir(o):
            shutil.copytree(o, d, ignore=shutil.ignore_patterns('_temp', '__pycache__'))
        else:
            shutil.copy(o, d)


def roda(base):
    r = subprocess.run(['node', os.path.join(base, 'ferramentas', 'testar-modulos.mjs')],
                       cwd=base, capture_output=True, text=True, encoding='utf-8',
                       errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


CASOS = []


def caso(nome, aplica, espera):
    CASOS.append((nome, aplica, espera))


# 1. caractere de controle literal, o defeito do Divisor
def injeta_nul(base):
    p = os.path.join(base, 'app', '01-motor.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    s = s.replace('const A_EIXO', 'const MARCA = /[' + chr(0) + '-\\u001F]/;\nconst A_EIXO', 1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('caractere de controle literal (U+0000 em regex)', injeta_nul,
     'literal — o navegador compila outra coisa')


# 2. chamada a funcao que nao existe
def injeta_fantasma(base):
    p = os.path.join(base, 'app', '06-matriz.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    io.open(p, 'w', encoding='utf-8', newline='').write(
        s + '\nfunction usaFantasma(){ return calculaCoisaQueNaoExiste(1); }\n')


caso('chamada a funcao inexistente', injeta_fantasma,
     'calculaCoisaQueNaoExiste')


# 3. ordem dos <script> trocada
def injeta_ordem(base):
    p = os.path.join(base, 'index.html')
    s = io.open(p, encoding='utf-8', newline='').read()
    a = '<script src="app/00-estado.js"></script>'
    b = '<script src="app/01-motor.js"></script>'
    assert a in s and b in s
    s = s.replace(a + '\n' + b, b + '\n' + a, 1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('ordem dos <script> trocada', injeta_ordem, 'ordem dos <script>')


# 4. modulo em app/ que o index.html nao carrega
def injeta_orfao(base):
    io.open(os.path.join(base, 'app', '10-orfao.js'), 'w',
            encoding='utf-8', newline='').write('const ORFAO = 1;\n')


caso('modulo em app/ fora do index.html', injeta_orfao, 'NÃO carrega')


# 5. simbolo usado no carregamento antes de ser declarado (TDZ)
def injeta_tdz(base):
    p = os.path.join(base, 'app', '00-estado.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    io.open(p, 'w', encoding='utf-8', newline='').write(
        s + '\nconst USA_ANTES = A_EIXO;\n')   # A_EIXO nasce no 01-motor.js


caso('simbolo de modulo posterior usado na carga (TDZ)', injeta_tdz,
     'lançou no carregamento')


print('=' * 78)
print('AUTOTESTE DO testar-modulos.mjs — cada defeito TEM de reprovar')
print('=' * 78)

# controle: sem defeito, tem de passar
with tempfile.TemporaryDirectory() as tmp:
    base = os.path.join(tmp, 'limpo')
    os.makedirs(base)
    prepara(base)
    rc, saida = roda(base)
    if rc == 0:
        print('  OK      controle: projeto intacto passa (codigo 0)')
        falhas = 0
    else:
        print('  FALHOU  controle: projeto intacto REPROVOU — o verificador acusa '
              'defeito onde nao ha')
        print('\n'.join('          ' + l for l in saida.split('\n')
                        if 'FALHOU' in l)[:600])
        falhas = 1

for nome, aplica, espera in CASOS:
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'caso')
        os.makedirs(base)
        prepara(base)
        aplica(base)
        rc, saida = roda(base)
        pegou = rc != 0 and espera in saida
        if pegou:
            print(f'  OK      pegou: {nome}')
        else:
            falhas += 1
            print(f'  FALHOU  NAO pegou: {nome}')
            print(f'          codigo {rc}; esperava a mensagem conter "{espera}"')

print('=' * 78)
print('AUTOTESTE OK — o verificador reprova todos os defeitos injetados'
      if not falhas else
      f'AUTOTESTE FALHOU — {falhas} furo(s) no verificador')
print('=' * 78)
sys.exit(1 if falhas else 0)
