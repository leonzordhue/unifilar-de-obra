# -*- coding: utf-8 -*-
"""Roda a suite inteira e diz, numa linha por prova, o que esta verde e o que nao esta.

A regra da casa e' «nenhum commit entra com suite vermelha», e ate agora conferir isso
custava dezenove comandos digitados a mao -- o que na pratica queria dizer que ninguem
conferia inteiro. Uma regra que custa caro demais para verificar nao e' cumprida: e'
lembrada.

Descobre as provas sozinho (`ferramentas/testar-*.py` e `testar-*.mjs`), entao prova nova
entra na suite so por existir, sem ninguem precisar lembrar de acrescenta-la a uma lista.

Uso:  python ferramentas/rodar-todas.py            roda tudo
      python ferramentas/rodar-todas.py -r         so as rapidas (node, sem navegador)
      python ferramentas/rodar-todas.py motor cde  so as que casam com esses nomes
"""
import glob
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FERR = os.path.join(RAIZ, "ferramentas")
TEMPO_MAX = 600

# Reprovacao nem sempre vem no codigo de saida: prova que imprime «2 FALHA(S)» e sai 0
# passaria por verde. Estes carimbos sao os que as provas da casa usam para dizer que nao.
CARIMBOS_VERMELHOS = ("FALHA(S)", "REPROV", "falhou:", "Traceback")

# Verde tem de ser CONQUISTADO. Um `testar-*.py` que so imprime relatorio e sai 0 nunca
# reprova, e conta-lo como verde infla a suite com garantia que ninguem deu -- foi o que
# aconteceu com a `testar-sentido-por-ramal.py`: 0,1 s e «verde», sem uma assercao.
CARIMBOS_DE_VEREDITO = ("RESULTADO:", "  OK   ", "  FALHA", "REGRESSAO OK")


def provas(filtros, so_rapidas):
    achadas = []
    for cam in sorted(glob.glob(os.path.join(FERR, "testar-*.py"))
                      + glob.glob(os.path.join(FERR, "testar-*.mjs"))):
        nome = os.path.basename(cam)
        if so_rapidas and not nome.endswith(".mjs"):
            continue
        if filtros and not any(f.lower() in nome.lower() for f in filtros):
            continue
        achadas.append(cam)
    # as de node primeiro: sao segundos, e derrubam cedo o erro que quebraria as de navegador
    return sorted(achadas, key=lambda c: (not c.endswith(".mjs"), c))


def roda(caminho):
    nome = os.path.basename(caminho)
    cmd = (["node", caminho] if nome.endswith(".mjs") else [sys.executable, caminho])
    t = time.time()
    try:
        p = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=TEMPO_MAX)
        saida = (p.stdout or "") + (p.stderr or "")
        codigo = p.returncode
    except subprocess.TimeoutExpired:
        return nome, "ESTOUROU", TEMPO_MAX, f"passou de {TEMPO_MAX}s sem terminar"
    dur = time.time() - t
    vermelha = codigo != 0 or any(c in saida for c in CARIMBOS_VERMELHOS)
    if not vermelha:
        if not any(c in saida for c in CARIMBOS_DE_VEREDITO):
            return nome, "RELATO", dur, "não dá veredito — é relatório, não portão"
        return nome, "VERDE", dur, ""
    motivo = next((l.strip() for l in saida.splitlines()
                   if "falhou:" in l or "FALHA" in l or "REPROV" in l), f"saída {codigo}")
    return nome, "VERMELHA", dur, motivo[:96]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    so_rapidas = "-r" in sys.argv
    lista = provas(args, so_rapidas)
    if not lista:
        print("nenhuma prova casou com o filtro.")
        return 1
    print(f"{len(lista)} prova(s) · limite de {TEMPO_MAX}s cada\n")
    vermelhas, relatos, total = [], [], time.time()
    for cam in lista:
        nome, estado, dur, motivo = roda(cam)
        print(f"  {estado:<9} {nome:<34} {dur:5.1f}s" + (f"   {motivo}" if motivo else ""))
        if estado == "RELATO":
            relatos.append(nome)
        elif estado != "VERDE":
            vermelhas.append((nome, motivo))
    portoes = len(lista) - len(relatos)
    if relatos:
        print(f"\n{len(relatos)} fora da conta, por não darem veredito: {', '.join(relatos)}")
    print(f"\n{portoes - len(vermelhas)} de {portoes} portões verdes "
          f"· {time.time() - total:.0f}s no total")
    if vermelhas:
        print("\nVERMELHAS — commit bloqueado pela regra da casa:")
        for nome, motivo in vermelhas:
            print(f"   {nome}: {motivo}")
        return 1
    print("\nSUITE VERDE — a regra da casa está cumprida.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
