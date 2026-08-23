# -*- coding: utf-8 -*-
"""Prova a CONTAGEM e a LINGUAGEM do quilômetro, com o projeto real do cliente.

O Paulo abriu a plataforma e disse: «em vez de marcar o KM fica assumindo que é mais KM;
quando digo que tá no KM 5 ele acha que tem 5 km». Não era erro de aritmética — era a
plataforma falando em extensão somada onde a equipe dele fala em quilômetro marcado.

A planilha que eles usam (`CAMADA DE KM AM-010.xlsx`) resolve isso há anos: uma LINHA por
quilômetro, situação por serviço e lado, e o resumo conta quilômetros inteiros. É essa a
unidade do acompanhamento — a extensão fracionária continua valendo para geodésia, croqui e
medição, que é outro projeto.

Esta prova roda sobre `11-CONTROLE AM-010/projeto-am-010-ct-00057-2022-seinfra.json`: obra
real, 760 lançamentos, contrato CT-00057/2022-SEINFRA, feita pelo próprio cliente na
plataforma. Dado de demonstração não serve para dizer que a conta está certa.

Uso:  python ferramentas/testar-contagem-km.py
"""
import functools
import http.server
import io
import json
import os
import socketserver
import sys
import threading
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.join(RAIZ, "11-CONTROLE AM-010",
                       "projeto-am-010-ct-00057-2022-seinfra.json")
falhas = []

# REGRA DO PRODUTO, espelhada aqui de proposito: um quilometro conta UMA vez por servico, e
# quando os lados divergem vale o estado MENOS avancado. Concluido num quadro de obra quer
# dizer «nao ha mais nada a fazer aqui» — com um lado pendente, ha. Lado «nao se aplica» nao
# segura o quilometro, e lado sem lancamento e «previsto».
#
# Esta prova ja aferiu pelo MAIS avancado, que era a regra antiga; virou em 23/08 junto com o
# produto. Instrumento que mede regra diferente da do produto nao e conservador: e cego.
ORDEM = {"C": 5, "E": 4, "PA": 3, "S": 2, "P": 1}


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  -> {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def conta_do_arquivo(proj, segs):
    """A verdade independente: conta quilometros no JSON, sem passar pela plataforma.

    `segs` sao os identificadores de quilometro do trecho, na ordem do eixo."""
    dados, cat = proj["dados"], proj.get("catId", "")
    servicos = [s for s in proj.get("svc", []) if s.get("on")]
    # SERVICO ORFAO: quem tem lancamento mas nao esta na lista de servicos do projeto —
    # «TERRAPLENAGEM» com 10 km marcados, herdada de um catalogo antigo. Ela sumia do
    # quadro em silencio, e um servico que some sem aviso e pior que um servico errado.
    # A referencia tem de ve-la, senao a prova passa verde justamente onde ja falhou.
    nomes = {s["nome"] for s in servicos}
    orfaos = {}
    for k in dados:
        p4 = k.split("|")
        if len(p4) == 4 and p4[1] not in nomes:
            orfaos.setdefault(p4[1], set()).add(p4[2])
    servicos += [{"nome": n, "lados": sorted(l)} for n, l in orfaos.items()]
    out = {}
    for s in servicos:
        lados = s.get("lados") or []
        conta = defaultdict(int)
        for sg in segs:
            pior, todos_na = None, bool(lados)
            for ld in lados:
                v = dados.get(f'{cat}|{s["nome"]}|{ld}|{sg}', "P")
                if v == "NA":
                    continue
                todos_na = False
                if pior is None or ORDEM.get(v, 1) < ORDEM.get(pior, 1):
                    pior = v
            conta["NA" if todos_na else (pior or "P")] += 1
        out[s["nome"]] = {"C": conta["C"], "E": conta["E"]}
    return out


def main(defeito=False):
    if not os.path.exists(PROJETO):
        print("projeto real do cliente não encontrado:", PROJETO)
        return 1
    proj = json.load(io.open(PROJETO, encoding="utf-8"))
    proj_svc = sum(1 for s in proj.get("svc", []) if s.get("on"))
    print(f"projeto do cliente: {proj.get('contrato')} · {len(proj['dados'])} lancamentos · "
          f"{proj_svc} servico(s) ligado(s)\n")

    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=RAIZ))
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_context(viewport={"width": 1600, "height": 950}).new_page()
        pg.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2600)

        print("1. A PLATAFORMA ABRE O PROJETO DO CLIENTE")
        r = pg.evaluate("""(proj) => {
            aplicaProjeto(proj);
            return {lanc: Object.keys(S.dados).length, obra: S.obra || '',
                    contrato: S.contrato || '', kmIni: S.kmIni, kmFim: S.kmFim,
                    segs: S.segs.length}; }""", proj)
        ok(r["lanc"] == len(proj["dados"]),
           "todos os lançamentos entram", f"{r['lanc']} de {len(proj['dados'])}")
        ok(r["segs"] > 260, "o eixo da AM-010 é dividido por quilômetro",
           f"{r['segs']} quilômetro(s)")

        print("\n2. O QUADRO CONTA QUILÔMETRO INTEIRO, NÃO EXTENSÃO SOMADA")
        # os quilometros do trecho, na ordem do eixo, saem da propria plataforma — a
        # conta de referencia e feita aqui, no arquivo, sobre a mesma lista
        segs_trecho = pg.evaluate("() => segsNoTrecho().map(s => String(s.id))")
        esperado = conta_do_arquivo(proj, segs_trecho)
        if defeito:
            # AUTOTESTE: devolve o quadro contando EXTENSAO somada, que foi o defeito que o
            # cliente apontou («quando digo que ta no KM 5 ele acha que tem 5 km»). Se a prova
            # nao reprovar aqui, ela nao esta medindo nada.
            pg.evaluate("""() => { const o = quadroObra;
                window.quadroObra = () => o().map(q => ({...q, C: q.kmC, E: q.km.E})); }""")
        # o que a plataforma diz hoje, serviço por serviço
        quadro = pg.evaluate("""() => quadroObra().map(q => ({
            svc: q.svc, C: q.C, E: q.E, kmTrecho: q.kmTrecho})) """)
        por_svc = {q["svc"]: q for q in quadro}
        for svc, esp in sorted(esperado.items()):
            q = por_svc.get(svc)
            if not q:
                ok(False, f"{svc}: o quadro traz o serviço", "não achei no quadro")
                continue
            inteiro = float(q["C"]).is_integer() and float(q["E"]).is_integer()
            certo = round(q["C"]) == esp["C"] and round(q["E"]) == esp["E"]
            ok(inteiro and certo,
               f"{svc}: {esp['C']} km concluído(s) e {esp['E']} em andamento",
               f"quadro diz C={q['C']} E={q['E']}")

        print("\n3. A LINGUAGEM SEPARA POSIÇÃO DE QUANTIDADE")
        # «KM 5» é onde; «5 km» é quanto. Uma tela que troca as duas foi o que confundiu
        # o cliente, e é isto que esta prova trava.
        textos = pg.evaluate("""() => {
            mostra('matriz');
            const cab = [...document.querySelectorAll('#vMatriz thead th')]
                .map(e => e.textContent.trim()).filter(Boolean).slice(0, 12);
            const painel = (document.querySelector('#vPainel') || {}).innerText || '';
            return {cab, painel: painel.slice(0, 400)}; }""")
        cabecalho = " ".join(textos["cab"])
        ok("KM" in cabecalho, "o cabeçalho da grade nomeia o quilômetro pela posição",
           cabecalho[:80])
        ok("km" in textos["painel"] or "KM" in textos["painel"],
           "o painel fala de quilômetro", textos["painel"][:60].replace("\n", " "))

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:5]:
        print("  ", c)
    print("\nRESULTADO:", "OK — a contagem é em quilômetro inteiro" if not falhas and not console
          else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


def autoteste():
    """Prova que a prova reprova: faz o quadro contar extensao somada em vez de quilometro."""
    print("AUTOTESTE - quadro devolvendo extensao somada no lugar da contagem\n")
    falhas.clear()
    main(defeito=True)
    pegou = bool(falhas)
    print("\n   " + ("OK    a prova reprova a contagem por extensao"
                     if pegou else "FALHA a prova NAO pegou a contagem por extensao"))
    return 0 if pegou else 1


if __name__ == "__main__":
    sys.exit(autoteste() if "--autoteste" in sys.argv else main())
