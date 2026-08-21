# -*- coding: utf-8 -*-
"""Prova que o bloco 11 do testar-fluxos.py REPROVA se a correcao do J5 for desfeita.

Prova que passou depois de uma correcao pode estar passando pelo motivo errado.
Aqui a chave volta ao formato de tres campos numa COPIA do projeto e espera-se
que o bloco 11 acuse o vazamento de novo.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def prepara(dst):
    for i in ('index.html', 'app', 'ferramentas', 'dados', 'bibliotecas'):
        o = os.path.join(RAIZ, i)
        if not os.path.exists(o):
            continue
        d = os.path.join(dst, i)
        if os.path.isdir(o):
            shutil.copytree(o, d, ignore=shutil.ignore_patterns('_temp', '__pycache__'))
        else:
            shutil.copy(o, d)


with tempfile.TemporaryDirectory() as tmp:
    base = os.path.join(tmp, 'regr')
    os.makedirs(base)
    prepara(base)

    p = os.path.join(base, 'app', '06-matriz.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    antes = s
    # desfaz a correcao: tira o catId da chave
    s = re.sub(r'const chave = \(l, id\) =>\s*`\$\{S\.catId\}\|',
               'const chave = (l, id) => `', s, count=1)
    if s == antes:
        print('AVISO: nao achei a chave com catId — a correcao mudou de forma?')
        print('       procurando:', [l for l in antes.split('\n')
                                     if 'const chave' in l])
        sys.exit(2)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('na copia, a chave voltou para:',
          [l.strip() for l in s.split('\n') if 'const chave' in l][0])

    r = subprocess.run([sys.executable,
                        os.path.join(base, 'ferramentas', 'testar-fluxos.py')],
                       cwd=base, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    saida = (r.stdout or '') + (r.stderr or '')
    bloco = saida[saida.find('11. TROCA'):]

    print('\n--- bloco 11 na copia com a correcao desfeita ---')
    print('\n'.join(l for l in bloco.split('\n')[:6] if l.strip()))

    pegou = r.returncode != 0 and 'VAZOU' in saida
    print('\n' + ('REGRESSAO OK — o bloco 11 reprova quando a correcao e desfeita'
                  if pegou else
                  'REGRESSAO FALHOU — o bloco 11 passou mesmo sem a correcao'))
    sys.exit(0 if pegou else 1)
