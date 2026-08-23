# -*- coding: utf-8 -*-
"""Abre a plataforma num navegador real, opera a interface e grava capturas.

Existe para nao entregar pagina conferida so por leitura de codigo. Sobe um servidor local
na pasta do projeto, carrega o `index.html` no Chromium e verifica, com numero: o acervo
carrega, a escolha de um eixo divide o tracado por quilometro, a matriz monta colunas, o
lancamento por clique altera o percentual, o recorte de trecho funciona, o estaqueamento
troca os rotulos, o croqui em satelite e gerado e o relatorio se monta.

As acoes sao feitas por `evaluate`, e nao pelos locators do Playwright: neste ambiente as
esperas de «actionability» do locator expiram, ainda que o elemento exista e responda.

Uso:  python ferramentas/testar-interface.py [--ver]
      --ver regrava as capturas de `documentacao/imagens/`
"""
import functools
import http.server
import os
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = os.path.join(RAIZ, "documentacao", "imagens")
# Porta EFEMERA, de proposito. Porta fixa + allow_reuse_address deixava duas
# provas simultaneas subirem servidor na mesma porta, e o Chromium de uma era
# atendido pelo servidor da outra — a prova media a copia achando que media o
# produto. Com porta 0 o SO escolhe uma livre; a porta real sai de
# srv.server_address[1] depois de subir.
PORTA = 0
VER = "--ver" in sys.argv


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


def main():
    os.makedirs(CAP, exist_ok=True)
    H = functools.partial(Silencioso, directory=RAIZ)
    srv = socketserver.TCPServer(("127.0.0.1", PORTA), H)
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"servidor local: http://127.0.0.1:{porta}\n")
    console = []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_page(viewport={"width": 1680, "height": 980})
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)

        print("1. CARGA")
        ok(pg.evaluate("typeof L") == "object", "Leaflet carregou")
        ok(pg.evaluate("typeof JSZip") == "function", "JSZip carregou")
        n = pg.evaluate("document.querySelectorAll('#selAcervo option').length")
        # o acervo tem 34 eixos, mas 13 são PLANEJADAS e saíram da lista a pedido do
        # cliente: rodovia planejada não existe no chão, e obra não se lança nela
        ok(n >= 15, "acervo de rodovias implantadas no seletor", f"{n} opções")
        ok(pg.evaluate("document.querySelectorAll('#listaSvc .svc').length") >= 10,
           "catálogo de serviços na lateral",
           str(pg.evaluate("document.querySelectorAll('#listaSvc .svc').length")) + " serviços")

        print("\n2. ESCOLHA DO EIXO (AM-010)")
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-010'));
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(3000)
        info = pg.evaluate("document.querySelector('#infoTopo').textContent")
        print("   topo:", info)
        nseg = pg.evaluate("window.__dbg ? 0 : document.querySelectorAll('#vMatriz td.cel').length")
        ok("AM-010" in info and "km" in info, "eixo aplicado e extensão exibida")
        if VER:
            pg.screenshot(path=os.path.join(CAP, "01-mapa-satelite.png"))

        sent = pg.evaluate("document.querySelector('#dicaSentido').textContent")
        ok("Conferido por" in sent and "ramais" in sent,
           "origem do KM 0 declarada na interface", sent[:96])

        print("\n2b. INVERSÃO DO SENTIDO")
        # o KM 0 tem de mudar de ponta, e o croqui refletir isso
        antes = pg.evaluate("JSON.stringify(S.segs[0].pts[0])")
        pg.evaluate("document.querySelector('#btInverte').click()")
        pg.wait_for_timeout(2500)
        dep = pg.evaluate("JSON.stringify(S.segs[0].pts[0])")
        ext = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0).toFixed(3)")
        ok(antes != dep, "KM 0 muda de ponta ao inverter", f"{antes} → {dep}")
        ok(abs(float(ext) - 268.062) < 0.01, "extensão preservada na inversão", f"{ext} km")
        pg.evaluate("document.querySelector('#btInverte').click()")
        pg.wait_for_timeout(2500)
        volta = pg.evaluate("JSON.stringify(S.segs[0].pts[0])")
        ok(volta == antes, "inverter duas vezes volta ao original", f"{volta}")

        print("\n3. MATRIZ")
        pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
        pg.wait_for_timeout(2000)
        cols = pg.evaluate("document.querySelectorAll('#vMatriz thead th').length")
        rows = pg.evaluate("document.querySelectorAll('#vMatriz tbody tr').length")
        cels = pg.evaluate("document.querySelectorAll('#vMatriz td.cel').length")
        ok(cols > 200, "colunas de quilômetro no cabeçalho", f"{cols}")
        ok(rows > 20, "linhas de serviço × lado", f"{rows}")
        ok(cels > 4000, "células de lançamento", f"{cels:,}".replace(",", "."))
        if VER:
            pg.screenshot(path=os.path.join(CAP, "02-matriz-de-controle.png"))

        print("\n4. LANÇAMENTO POR CLIQUE")
        # a coluna «%» e a SETIMA celula da linha: servico/lado · C · E · PA · S · NA · %.
        # Era a sexta ate 23/08, quando «PA» ganhou coluna propria — paralisado estava sendo
        # somado em «previsto», e obra parada nao e obra que vai acontecer. Sem este ajuste a
        # prova comparava a coluna NA consigo mesma e passava verde sem medir o percentual.
        antes = pg.evaluate("document.querySelector('#vMatriz tbody tr:not(.gr) td:nth-child(7)').textContent")
        pg.evaluate("""() => {
            for (let k = 0; k < 8; k++){
                const c = document.querySelector(`#vMatriz td.cel[data-id="${k}"]`);
                if (c) c.click();
            }
        }""")
        pg.wait_for_timeout(900)
        depois = pg.evaluate("document.querySelector('#vMatriz tbody tr:not(.gr) td:nth-child(7)').textContent")
        ok(antes != depois, "percentual da linha muda ao lançar", f"{antes} → {depois}")

        print("\n5. RECORTE DE TRECHO")
        pg.evaluate("""() => {
            const a = document.querySelector('#kmIni'), b = document.querySelector('#kmFim');
            a.value = 13; a.dispatchEvent(new Event('input'));
            b.value = 40; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1500)
        fora = pg.evaluate("document.querySelectorAll('#vMatriz td.fora').length")
        dentro = pg.evaluate("document.querySelectorAll('#vMatriz td.cel').length")
        ok(fora > 0 and dentro > 0, "trecho recortado: célula fora do trecho fica hachurada",
           f"{dentro} dentro · {fora} fora")

        print("\n6. ESTAQUEAMENTO")
        pg.evaluate("document.querySelector(\"#segRef button[data-r='est']\").click()")
        pg.wait_for_timeout(1200)
        # por CONTEUDO, nao por indice: as colunas fixas da grade passaram de 6 para 7 quando
        # o «PA» virou coluna, e um slice por posicao passou a ler o «%» como se fosse estaca
        rot = pg.evaluate("""[...document.querySelectorAll('#vMatriz thead th')]
            .map(e => e.textContent.trim())
            .filter(t => /^(KM|E)\s/.test(t.replace(/ /g, ' '))).slice(0, 4)""")
        # 1 estaca = 20 m, logo o KM n abre na estaca n*50: 0, 50, 100, 150...
        esperado = ["0", "50", "100", "150"]
        # «E 0», «E 50»…: o prefixo entrou de proposito, para o numero nu deixar de ser lido
        # como quantidade. A prova continua medindo o passo de 50 estacas por quilometro.
        limpa = [r.replace("E", "").replace(" ", " ").replace(".", "").strip() for r in rot]
        ok(limpa == esperado, "colunas passam a estaca (km x 50)", " ".join(rot))
        pg.evaluate("document.querySelector(\"#segRef button[data-r='km']\").click()")
        pg.wait_for_timeout(800)

        print("\n7. CROQUI EM SATÉLITE")
        pg.evaluate("document.querySelector(\".abas button[data-v='croqui']\").click()")
        pg.wait_for_timeout(14000)
        img = pg.evaluate("""() => {
            const i = document.querySelector('#vCroqui img');
            return i ? {w: i.naturalWidth, h: i.naturalHeight, tam: i.src.length} : null;
        }""")
        st = pg.evaluate("(document.querySelector('#vCroqui .st')||{}).textContent||''")
        ok(bool(img) and img["w"] > 300, "croqui gerado",
           f"{img['w']}×{img['h']} px · {img['tam'] // 1024} KB" if img else "não gerou")
        print("   ", st.strip()[:110])
        if VER:
            pg.screenshot(path=os.path.join(CAP, "03-croqui-do-trecho.png"))

        print("\n8. RESUMO E RELATÓRIO")
        pg.evaluate("document.querySelector(\".abas button[data-v='resumo']\").click()")
        pg.wait_for_timeout(1200)
        cards = pg.evaluate("[...document.querySelectorAll('#vResumo .card .val')].map(e => e.textContent)")
        ok(len(cards) >= 6, "cartões do resumo", " | ".join(cards[:4]))
        if VER:
            pg.screenshot(path=os.path.join(CAP, "04-resumo.png"))
        pg.evaluate("document.querySelector(\".abas button[data-v='rel']\").click()")
        pg.wait_for_timeout(2000)
        h1 = pg.evaluate("(document.querySelector('#vRel h1')||{}).textContent||''")
        tab = pg.evaluate("document.querySelectorAll('#vRel table').length")
        cro = pg.evaluate("document.querySelectorAll('#vRel img').length")
        ok("Relatório" in h1, "relatório montado", h1)
        ok(tab >= 3, "tabelas no relatório", f"{tab}")
        ok(cro >= 1, "croqui incluído no relatório", f"{cro} imagem(ns)")
        if VER:
            pg.screenshot(path=os.path.join(CAP, "05-relatorio.png"), full_page=True)

        print("\n9. ACERVO DE RAMAIS")
        pg.evaluate("document.querySelector(\"#segFonte button[data-f='ramal']\").click()")
        pg.wait_for_timeout(4000)
        nr = pg.evaluate("document.querySelectorAll('#selAcervo option').length")
        ok(nr > 800, "ramais no seletor", f"{nr} opções")
        pg.evaluate("""() => {
            const b = document.querySelector('#buscaAcervo');
            b.value = 'manacapuru'; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1500)
        nf = pg.evaluate("document.querySelectorAll('#selAcervo option').length")
        ok(0 < nf < nr, "filtro por município reduz a lista", f"{nf} de {nr}")

        nav.close()
    srv.shutdown()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:10]:
        print("   ", c[:150])
    if VER:
        print(f"\ncapturas em {CAP}")
    print("\nRESULTADO:", f"{len(falhas)} FALHA(S)" if falhas or console
          else "OK — a interface operou sem erro")
    return 1 if (falhas or console) else 0


if __name__ == "__main__":
    sys.exit(main())
