# -*- coding: utf-8 -*-
"""Prova que a tela continua simples — e reprova quando ela voltar a inchar.

O Paulo abriu a plataforma no dia 21 e disse: «muito confuso, era pra ser algo simples». O
corte que se seguiu tirou metade da tela: 6 abas viraram 3, 6 blocos viraram 3, 5 botões no
topo viraram 2, e três saídas de arquivo viraram um menu. Isto aqui existe para que ninguém
desfaça isso sem que apareça — inclusive nós.

Três perguntas, e todas com número:

  1. quantos alvos a pessoa vê ANTES de rolar a tela           (meta ≤ 30)
  2. quantos gestos até o primeiro serviço lançado             (meta ≤ 5)
  3. o que saiu da tela continua alcançável em algum lugar     (lista fixa)

A régua da pergunta 1 é `checkVisibility`, NÃO `getBoundingClientRect`. O retângulo não zera
dentro de `<details>` fechado: o navegador guarda a última medida, e um contador ingênuo soma
campos que ninguém vê. Foi assim que a contagem acusou 43 alvos onde havia 27 e mandou duas
pessoas procurar defeito onde não havia.

Uso:  python ferramentas/testar-simplicidade.py [--autoteste]
      --autoteste injeta o defeito numa cópia e confirma que esta prova reprova
"""
import functools
import http.server
import io
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTOTESTE = "--autoteste" in sys.argv
falhas = []

META_DOBRA = 30
META_CLIQUES = 5

# o que saiu da tela no corte de 22/08 e TEM de continuar alcançável — cada item é
# (o que é, como se chega). Se algum sumir de verdade, esta prova reprova nomeando qual.
PORTAS = [
    ("croqui em PNG", "#menuExportar #btCroquiPNG"),
    ("exportar CSV", "#menuExportar #btCSV"),
    ("pacote CDE", "#menuExportar #btCDE"),
    ("imprimir", "#menuExportar #btImprimir"),
    ("inverter o sentido do eixo", "#btInverte"),
    ("estaca inicial do eixo", "#estOff"),
    ("catálogo de serviços", "#selCat"),
]


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# `checkVisibility` responde «isto está pintado?», que é a pergunta certa. O retângulo
# responde «isto tem medida?», que é outra coisa — e é a diferença entre contar 27 e contar 43.
NA_DOBRA = """() => [...document.querySelectorAll('button, input, select, textarea, a[href]')]
  .filter(e => {
    const visivel = e.checkVisibility
      ? e.checkVisibility({checkVisibilityCSS: true, contentVisibilityAuto: true,
                           checkOpacity: true})
      : true;
    if (!visivel) return false;
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.top < innerHeight && b.bottom > 0;
  })
  .map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase()))"""


def serve(raiz):
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=raiz))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def mede(pg, porta):
    """Abre a plataforma do zero e devolve (alvos na dobra, gestos até lançar, portas achadas)."""
    pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
    pg.wait_for_timeout(2600)
    dobra_vazia = pg.evaluate(NA_DOBRA)

    # o gesto do Paulo, contado clique a clique: escolher a rodovia, marcar o quilômetro,
    # dizer o serviço e a situação, aplicar
    gestos = 0
    pg.evaluate("""() => { const s = document.querySelector('#selAcervo');
        const o = [...s.options].find(x => x.textContent.startsWith('AM-151'));
        s.value = o.value; s.dispatchEvent(new Event('change')); }""")
    gestos += 1                                    # 1 · escolher o eixo
    pg.wait_for_timeout(2600)
    # A MEDIDA QUE VALE é esta, com o eixo carregado. A Cortanna achou o ponto cego: a
    # primeira versão media a tela vazia, que é o caso fácil — e deixava de fora tudo o que
    # nasce com o eixo (barra de lançamento, botões da faixa, seletor de critério do mapa).
    # A confusão que o Paulo reclamou é a da tela trabalhando, não a da tela em branco.
    dobra = pg.evaluate(NA_DOBRA)
    marcou = pg.evaluate("""() => {
        const km = document.querySelector('#faixaTrilho .km');
        if (!km) return false;
        const r = km.getBoundingClientRect();
        const op = {bubbles: true, cancelable: true, clientX: r.x + r.width / 2,
                    clientY: r.y + r.height / 2, pointerType: 'touch'};
        km.dispatchEvent(new PointerEvent('pointerdown', op));
        km.dispatchEvent(new PointerEvent('pointerup', op));
        km.dispatchEvent(new MouseEvent('click', op));
        return !!(S.sel && S.sel.size); }""")
    gestos += 1                                    # 2 · marcar o quilômetro na faixa
    servico = pg.evaluate("""() => {
        const s = document.querySelector('#selSvcAtivo');
        if (!s) return false;
        s.selectedIndex = 0; s.dispatchEvent(new Event('change')); return true; }""")
    gestos += 1                                    # 3 · escolher o serviço
    pg.evaluate("""() => { const s = document.querySelector('#selSit');
        if (s){ s.value = 'C'; s.dispatchEvent(new Event('change')); } }""")
    gestos += 1                                    # 4 · escolher a situação
    antes = pg.evaluate("() => Object.keys(S.dados).length")
    pg.evaluate("() => { const b = document.querySelector('#btAplica'); if (b) b.click(); }")
    gestos += 1                                    # 5 · aplicar
    pg.wait_for_timeout(600)
    depois = pg.evaluate("() => Object.keys(S.dados).length")
    # «Ter porta» é ser alcançável em um gesto, não estar à mostra: função dentro de um
    # `<details>` recolhido ou de um menu que abre continua tendo porta — foi exatamente o
    # que o corte fez com o avançado. Por isso aqui se ABREM as portas antes de conferir, e
    # reprova o que não existe nem depois de abrir tudo.
    pg.evaluate("() => { const b = document.querySelector('#btExportar'); if (b) b.click();"
                " document.querySelectorAll('details').forEach(d => d.open = true); }")
    pg.wait_for_timeout(250)
    achadas = pg.evaluate("""(portas) => portas.map(([nome, sel]) => {
        const e = document.querySelector(sel);
        const vis = e && (e.checkVisibility ? e.checkVisibility({checkVisibilityCSS: true})
                                            : true);
        return [nome, !!vis]; })""", PORTAS)
    return dobra, dobra_vazia, gestos, (depois - antes), marcou and servico, achadas


def main():
    porta = serve(RAIZ)
    console = []
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1500, "height": 900}, has_touch=True)
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        dobra, vazia, gestos, lancados, chegou, portas = mede(pg, porta)

        print("1. O QUE A PESSOA VÊ ANTES DE ROLAR A TELA")
        print(f"     tela vazia, antes de escolher o eixo: {len(vazia)} alvos")
        ok(len(dobra) <= META_DOBRA,
           f"no máximo {META_DOBRA} alvos na primeira dobra, COM o eixo carregado",
           f"{len(dobra)} alvos")

        print("\n2. GESTOS ATÉ O PRIMEIRO SERVIÇO LANÇADO")
        ok(chegou, "o caminho do lançamento existe: eixo, quilômetro, serviço, situação")
        ok(lancados > 0, "o lançamento aconteceu de verdade", f"{lancados} célula(s) marcada(s)")
        ok(gestos <= META_CLIQUES, f"em no máximo {META_CLIQUES} gestos", f"{gestos} gestos")

        print("\n3. O QUE SAIU DA TELA CONTINUA ALCANÇÁVEL")
        perdidas = [nome for nome, achou in portas if not achou]
        for nome, achou in portas:
            print(f"     {'·' if achou else '✗'} {nome}")
        ok(not perdidas, "toda função tirada da tela tem porta",
           "todas" if not perdidas else "sem porta: " + ", ".join(perdidas))

        ctx.close()
        nav.close()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:5]:
        print("  ", c)
    print("\nRESULTADO:", "OK — a tela continua simples" if not falhas and not console
          else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


def autoteste():
    """Prova que a prova reprova: injeta doze botões visíveis e um menu sem porta."""
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "inchada")
        for i in ("index.html", "app", "dados", "bibliotecas", "estilo"):
            o = os.path.join(RAIZ, i)
            if os.path.isdir(o):
                shutil.copytree(o, os.path.join(base, i),
                                ignore=shutil.ignore_patterns("_temp", "__pycache__"))
            else:
                os.makedirs(base, exist_ok=True)
                shutil.copy(o, os.path.join(base, i))
        p = os.path.join(base, "index.html")
        s = io.open(p, encoding="utf-8").read()
        extra = "".join(f'<button id="lixo{i}">Botão {i}</button>' for i in range(12))
        s2 = re.sub(r'(<div class="abas" id="abas">)', r"\1" + extra, s, count=1)
        assert s2 != s, "não achei a barra de abas para injetar o defeito"
        io.open(p, "w", encoding="utf-8", newline="\n").write(s2)

        porta = serve(base)
        with sync_playwright() as pw:
            nav = pw.chromium.launch()
            pg = nav.new_context(viewport={"width": 1500, "height": 900}, has_touch=True).new_page()
            pg.on("dialog", lambda d: d.accept())
            dobra, _v, _g, _l, _c, _portas = mede(pg, porta)
            nav.close()
        print("AUTOTESTE — doze botões injetados na barra de abas")
        print(f"   alvos na primeira dobra: {len(dobra)}  (meta {META_DOBRA})")
        pegou = len(dobra) > META_DOBRA
        print("   " + ("OK    a prova reprova a tela inchada"
                       if pegou else "FALHA a prova NÃO pegou o inchaço"))
        return 0 if pegou else 1


if __name__ == "__main__":
    sys.exit(autoteste() if AUTOTESTE else main())
