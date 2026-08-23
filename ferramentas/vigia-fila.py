# -*- coding: utf-8 -*-
"""Vigia da FILA: nao deixa Cortanna e jarvisIV sem demanda, e nao depende de eu lembrar.

O Paulo cobrou, com razao: «era justamente teu trabalho nao deixa-los sem servico, sempre
ta vistoriando pra quando parar tu colocar demanda». Entre 07h30 e 12h45 de 23/08 a fila
secou porque a vistoria dependia de eu olhar o relogio. Isto tira o relogio de mim.

Roda em segundo plano e ENCERRA quando houver algo que exija acao minha:

  ESCREVEU   um dos dois escreveu no canal      -> ler e responder
  PAROU      os dois em silencio por N minutos  -> repor demanda antes que sequem
  LIMITE     tempo maximo de vigia atingido     -> vistoria periodica de qualquer modo

Sair do processo e o sinal: o harness me reinvoca quando o comando termina. Silencio nao
avisa sozinho — por isso o silencio tambem termina o processo.

Uso:  python ferramentas/vigia-fila.py [--silencio 8] [--limite 45]
"""
import argparse
import io
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANAIS = {"Cortanna": os.path.join(RAIZ, "_canal", "CORTANNA.md"),
          "jarvisIV": os.path.join(RAIZ, "_canal", "JARVISIV.md")}


def estado():
    return {n: (os.path.getmtime(p) if os.path.exists(p) else 0) for n, p in CANAIS.items()}


def ultima_linha_de_titulo(caminho):
    """O ultimo cabecalho `## ...` do arquivo — quem escreveu e sobre o que."""
    try:
        txt = io.open(caminho, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""
    for linha in reversed(txt.split("\n")):
        if linha.startswith("## "):
            return linha[3:].strip()
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--silencio", type=float, default=8, help="minutos de silencio dos dois")
    ap.add_argument("--limite", type=float, default=45, help="minutos maximos de vigia")
    a = ap.parse_args()

    base = estado()
    inicio = time.time()
    print(f"vigia da fila · silencio de {a.silencio:g} min · limite de {a.limite:g} min")
    for nome, p in CANAIS.items():
        idade = (time.time() - base[nome]) / 60 if base[nome] else -1
        print(f"  {nome}: ultima escrita ha {idade:.1f} min · {ultima_linha_de_titulo(p)[:70]}")

    while True:
        time.sleep(20)
        agora = estado()
        # ESCRITA MINHA NAO CONTA. O vigia do jarvisIV teve este mesmo defeito e ele o
        # registrou no canal: passou a disparar com a propria escrita, e um aviso chegou com
        # o titulo da mensagem que ele mesmo acabara de escrever. Aqui deu na primeira volta —
        # eu escrevi a fila nos dois canais e o vigia me avisou de mim. Alarme que dispara com
        # o proprio movimento nao vigia nada: so o cabecalho de OUTRO autor conta.
        mudou = [n for n in CANAIS if agora[n] > base[n]
                 and not ultima_linha_de_titulo(CANAIS[n]).startswith("HAL9000")]
        if [n for n in CANAIS if agora[n] > base[n]] and not mudou:
            base = agora          # foi minha escrita: reancora e continua vigiando
        if mudou:
            for n in mudou:
                print(f"ESCREVEU {n} · {ultima_linha_de_titulo(CANAIS[n])[:90]}")
            return 0
        silencio = min((time.time() - t) / 60 for t in agora.values() if t) if any(agora.values()) else 999
        if silencio >= a.silencio:
            print(f"PAROU · os dois em silencio ha {silencio:.1f} min — repor demanda")
            return 0
        if (time.time() - inicio) / 60 >= a.limite:
            print(f"LIMITE · {a.limite:g} min de vigia, silencio de {silencio:.1f} min")
            return 0


if __name__ == "__main__":
    sys.exit(main())
