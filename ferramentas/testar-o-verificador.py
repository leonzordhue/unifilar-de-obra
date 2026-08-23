# -*- coding: utf-8 -*-
"""Prova que as provas PEGAM os defeitos que prometem pegar.

Verificador que so' diz OK nao vale nada: se ele nunca reprovou, ninguem sabe se
ele consegue reprovar. Aqui os defeitos sao INJETADOS numa copia do projeto e
espera-se FALHA em cada um. Se algum passar, a prova tem um furo.

Cobre duas provas hoje:
  testar-modulos.mjs         carga dos modulos (casos 1 a 5)
  testar-estaca-e-trecho.mjs medicao: recorte e avanco (casos 6 e 7)

Os casos 6 e 7 desfazem correcoes que a Cortanna aplicou em 21/08. Existem porque
prova que fica verde logo depois de correcao alheia e' exatamente onde ela pode
estar passando pelo motivo errado — foi o que aconteceu com o bloco 11 do
testar-fluxos.py, que reprovava por construcao depois da correcao do J5.

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


def roda(base, prova='testar-modulos.mjs'):
    exe = ['node'] if prova.endswith('.mjs') else [sys.executable]
    r = subprocess.run(exe + [os.path.join(base, 'ferramentas', prova)],
                       cwd=base, capture_output=True, text=True, encoding='utf-8',
                       errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


CASOS = []


def caso(nome, aplica, espera, prova='testar-modulos.mjs'):
    """`prova` e a prova que TEM de reprovar quando o defeito e injetado."""
    CASOS.append((nome, aplica, espera, prova))


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



# ---------------------------------------------------------------------------
# Casos do J4. A Cortanna corrigiu as duas coisas em 21/08; estes casos existem
# para que ninguem as desfaca sem alguem perceber. Verde depois de correcao
# alheia e' justamente onde a prova pode estar passando pelo motivo errado.

# 6. o recorte volta a excluir o segmento parcialmente dentro do trecho
def injeta_recorte_estrito(base):
    p = os.path.join(base, 'app', '04-mapa.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    antes = s
    s = s.replace(
        'const dentroTrecho = sg => sg.fim > S.kmIni + 1e-9 && sg.ini < S.kmFim - 1e-9;',
        'const dentroTrecho = sg => sg.ini >= S.kmIni - 1e-9 && sg.fim <= S.kmFim + 1e-9;',
        1)
    if s == antes:
        raise SystemExit('injecao 6 nao achou o dentroTrecho atual — revisar o caso')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('recorte volta a excluir segmento parcial (perde a ponta da obra)',
     injeta_recorte_estrito, 'perde', 'testar-estaca-e-trecho.mjs')


# 7. duas bases de avanco convivendo: o quadro por extensao e a matriz por contagem.
#
# Ate 23/08 este caso injetava «o pct voltou a contar celula». A base MUDOU por decisao do
# coordenador -- a equipe do cliente conta quadradinho -- e o caso antigo passou a injetar o
# comportamento CORRETO, o que fez a injecao nao achar mais a linha e o autoteste parar.
#
# O risco que sobrou nao e' qual base; e' DUAS bases ao mesmo tempo. Tres telas mostram
# avanco -- matriz, painel e quadro da obra -- e se uma divergir das outras a plataforma
# exibe dois avancos da mesma obra, cada um defensavel sozinho. E' esse o defeito injetado
# agora: o quadro volta para extensao e as outras duas ficam em contagem.
def injeta_duas_bases(base):
    p = os.path.join(base, 'app', '15-contrato.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    antes = s
    s = s.replace('q.pctTrecho = q.trechos > 0 ? q.C / q.trechos : null;',
                  'q.pctTrecho = q.kmTrecho > 0 ? q.km.C / q.kmTrecho : null;', 1)
    if s == antes:
        raise SystemExit('injecao 7 nao achou o pctTrecho por contagem — revisar o caso')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('quadro e matriz mostram avanco em bases diferentes',
     injeta_duas_bases, 'base diferente da matriz', 'testar-estaca-e-trecho.mjs')


# 7-B. a declaracao do vies some do relatorio.
#
# A contagem foi adotada com uma mitigacao: quando o recorte tem quilometro parcial, o
# relatorio declara que o percentual e' otimista em relacao a extensao medida em campo.
# Declarado, o vies e' escolha; apagado, vira defeito esperando auditoria -- e apagar uma
# frase numa limpeza de relatorio e' o tipo de coisa que ninguem nota.
def injeta_vies_calado(base):
    p = os.path.join(base, 'app', '07-relatorio.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    antes = s
    s = s.replace('entram parcialmente', 'entram no recorte', 1)
    if s == antes:
        raise SystemExit('injecao 7-B nao achou a declaracao do vies — revisar o caso')
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('o relatorio para de declarar o vies da contagem',
     injeta_vies_calado, 'parou de declarar o viés', 'testar-estaca-e-trecho.mjs')


# 7-C. funcao declarada e nunca chamada.
#
# O passo 6 do varredor nasceu em 23/08 de um caso real: `marcaColuna()` vivia no
# `06-matriz.js`, rolava a grade ate a coluna do quilometro, e ninguem a chamava -- enquanto o
# manual prometia o gesto. Cinco rodadas de suite verde por cima, porque nenhuma prova media
# navegacao. Na estreia o passo achou mais duas: `registraAba()`, que o COORDENACAO.md
# anunciava havia dois dias como «a maneira de criar aba», e `removeDoAcervoLocal()`, que
# deixava o acervo local sem porta de saida.
#
# Portao novo sem autoteste e' promessa: este caso injeta o defeito que ele existe para pegar.
def injeta_funcao_morta(base):
    p = os.path.join(base, 'app', '00-estado.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    s += '\n\nfunction gestoQueNinguemLiga(x){ return x; }\n'
    io.open(p, 'w', encoding='utf-8', newline='').write(s)


caso('funcao declarada e nunca chamada',
     injeta_funcao_morta, 'declarada e nunca usada', 'testar-modulos.mjs')


# 8. chamada dentro de INTERPOLACAO de template.
# A varredura antiga apagava o template inteiro, inclusive o ${...}, e ficava
# cega para chamada feita ali dentro — que neste projeto e' onde mora boa parte
# do codigo, porque a interface e' montada com template. A varredura com pilha
# trata ${...} como codigo; este caso prova que trata.
def injeta_fantasma_em_template(base):
    p = os.path.join(base, 'app', '13-faixa.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    linha = ('\nfunction usaNoTemplate(){ return ' + chr(96) + 'x ${'
             + 'somaQueNaoExiste(1)} y' + chr(96) + '; }\n')
    io.open(p, 'w', encoding='utf-8', newline='').write(s + linha)


caso('chamada dentro de ${...} de template', injeta_fantasma_em_template,
     'somaQueNaoExiste')


# 9. AO CONTRARIO dos outros: plural em portugues dentro de template e' TEXTO, e
# a prova NAO pode reclamar dele. `ensaio(s)`, `julgado(s)`, `Ambos (...)` sao
# indistinguiveis de chamada para uma varredura ingenua. Quando a minha perdia a
# crase de fechamento de template aninhado, cada plural virava "funcao que
# ninguem declara" — quatro falsos positivos de uma vez, no codigo real.
FALSOS = []


def falso_positivo(nome, aplica, nao_espera, prova='testar-modulos.mjs'):
    FALSOS.append((nome, aplica, nao_espera, prova))


def injeta_plural_em_template(base):
    # Template com plural NO TEXTO e outro template dentro da interpolacao —
    # exatamente a forma que quebrava a varredura. A primeira versao deste
    # fixture era JavaScript INVALIDO, e a prova acusou erro de sintaxe: ela
    # estava certa e o meu fixture errado. Montado com chr(96) porque escrever a
    # crase aqui e' o que produziu a confusao.
    p = os.path.join(base, 'app', '13-faixa.js')
    s = io.open(p, encoding='utf-8', newline='').read()
    b = chr(96)
    #
    # A CHAMADA no fim nao e' enfeite: o passo 6 («funcao declarada e nunca usada») entrou em
    # 23/08 e passou a acusar este fixture, porque a funcao injetada nao era chamada por
    # ninguem. O controle negativo virava falso positivo do portao novo -- e o furo era do
    # fixture, nao do portao: funcao real nasce com chamador, e um fixture que nao imita isso
    # nao imita codigo de verdade. Com a chamada, ele volta a testar so o que veio testar.
    linha = ('\nfunction textoPlural(n){ return ' + b
             + '${n} ensaio(s), ${n} registro(s), Ambos (dois lados) e ${'
             + b + 'aninhado ${n} vez(es)' + b + '}' + b + '; }\n'
             + 'const _plural = textoPlural(1);\n')
    io.open(p, 'w', encoding='utf-8', newline='').write(s + linha)


falso_positivo('plural em portugues dentro de template nao e chamada',
               injeta_plural_em_template, 'ensaio')


print('=' * 78)
print('AUTOTESTE DAS PROVAS — cada defeito injetado TEM de reprovar')
print('=' * 78)

# controle: sem defeito, tem de passar
with tempfile.TemporaryDirectory() as tmp:
    base = os.path.join(tmp, 'limpo')
    os.makedirs(base)
    prepara(base)
    rc, saida = roda(base)
    rc2, saida2 = roda(base, 'testar-estaca-e-trecho.mjs')
    if rc == 0 and rc2 == 0:
        print('  OK      controle: projeto intacto passa nas duas provas (codigo 0)')
        falhas = 0
    else:
        print('  FALHOU  controle: projeto intacto REPROVOU — o verificador acusa '
              'defeito onde nao ha')
        saida = saida + saida2
        print('\n'.join('          ' + l for l in saida.split('\n')
                        if 'FALHOU' in l)[:600])
        falhas = 1

for nome, aplica, espera, prova in CASOS:
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'caso')
        os.makedirs(base)
        prepara(base)
        aplica(base)
        rc, saida = roda(base, prova)
        pegou = rc != 0 and espera in saida
        if pegou:
            print(f'  OK      pegou: {nome}')
        else:
            falhas += 1
            print(f'  FALHOU  NAO pegou: {nome}')
            print(f'          codigo {rc}; esperava a mensagem conter "{espera}"')

for nome, aplica, nao_espera, prova in FALSOS:
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'falso')
        os.makedirs(base)
        prepara(base)
        aplica(base)
        rc, saida = roda(base, prova)
        # Aqui o certo e' PASSAR: o que foi injetado e' texto, nao defeito.
        #
        # A condicao NAO pode ser "a palavra X nao aparece na saida": eu tentei
        # com 'ensaio' e deu falso alarme, porque existe um modulo chamado
        # `10-ensaios.js` e o nome dele sai na linha "carregou" do passo 3.
        # Procurar palavra na saida inteira e' o mesmo erro de mirar largo que
        # essa familia de defeito vive cometendo. O que interessa e' se a prova
        # ACUSOU algo.
        acusou = [l.strip() for l in saida.split('\n') if 'FALHOU' in l]
        if rc == 0 and not acusou:
            print(f'  OK      nao reclamou de: {nome}')
        else:
            falhas += 1
            print(f'  FALHOU  FALSO POSITIVO: {nome}')
            for l in saida.split('\n'):
                if 'FALHOU' in l:
                    print('          ' + l.strip()[:110])

print('=' * 78)
print('AUTOTESTE OK — reprova todo defeito injetado e não inventa nenhum'
      if not falhas else
      f'AUTOTESTE FALHOU — {falhas} furo(s) nas provas')
print('=' * 78)
sys.exit(1 if falhas else 0)
