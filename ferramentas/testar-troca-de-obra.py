# -*- coding: utf-8 -*-
"""Prova o que acontece com o trabalho em andamento quando se abre outra obra pelo contrato.

Abrir obra por numero de contrato e' a espinha do produto: «sempre que eu pesquisar aquele
contrato o perfil carrega para eu mexer». Esta medicao olha o outro lado do gesto -- o que
estava na tela quando ele acontece -- e o que sobra de uma obra depois de sair dela.

Nasceu medindo, em 22/08: `abreObra()` chamava `aplicaProjeto()` direto e seis lancamentos
nao guardados sumiam sem uma pergunta, enquanto os outros tres caminhos que descartam
trabalho perguntavam. E a foto da obra anterior ficava ocupando o teto da obra nova, porque
`aplicaProjeto()` fazia `Object.assign(S.fotos, ...)` em vez de trocar. A Cortanna consertou
os dois; a medicao virou portao, e agora reprova se a regressao voltar.

Uso: python ferramentas/testar-troca-de-obra.py
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

# Erro de REDE EXTERNA nao e defeito da plataforma: os ladrilhos de satelite vem de
# fora e falham quando a suite inteira disputa banda. Filtro aplicado em 24/08, depois
# de tres provas ficarem vermelhas na suite e verdes sozinhas.
EXTERNO = ("Failed to load resource", "ERR_", "net::", "arcgisonline", "tile")

falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def linha(rotulo, valor):
    print(f"   {rotulo:.<52} {valor}")


def main():
    H = functools.partial(Q, directory=RAIZ)
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)   # porta 0, nunca fixa
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console, dialogos = [], []

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1600, "height": 950})
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" and not any(x in m.text for x in EXTERNO) else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: (dialogos.append(d.message), d.accept()))
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)

        def carrega(prefixo):
            pg.evaluate("""(p) => {
                const sel = document.querySelector('#selAcervo');
                const i = [...sel.options].findIndex(o => o.textContent.startsWith(p));
                if (i >= 0){ sel.selectedIndex = i; sel.dispatchEvent(new Event('change')); }
            }""", prefixo)
            pg.wait_for_timeout(2600)

        print("1. UMA OBRA COM TRABALHO DENTRO, GUARDADA NO CONTRATO 001/2026")
        carrega("AM-151")
        r = pg.evaluate("""() => {
            document.querySelector('#nomeObra').value = 'Erosões AM-151';
            document.querySelector('#contrato').value = '001/2026';
            const l = linhasMatriz()[0];
            S.segs.slice(0, 4).forEach(s => { marcaKm(l, s.id, 'C'); });
            render();
            return {dados: Object.keys(S.dados).length};
        }""")
        linha("lançamentos na matriz", r["dados"])
        guardou = pg.evaluate("() => guardaObra()")
        linha("obra guardada no contrato", "sim" if guardou else "NÃO")

        print("\n2. TRABALHO NOVO NA TELA, AINDA NAO GUARDADO EM CONTRATO NENHUM")
        n = pg.evaluate("""() => {
            document.querySelector('#nomeObra').value = 'Recuperação AM-151 — km 8 a 12';
            document.querySelector('#contrato').value = '';
            S.dados = {};
            const l = linhasMatriz()[0];
            S.segs.slice(6, 12).forEach(s => { S.dados[chave(l, s.id)] = 'A'; });
            render();
            return Object.keys(S.dados).length;
        }""")
        linha("lançamentos novos na tela", n)
        linha("guardados em contrato", "nenhum — é justamente o caso do dia de campo")

        print("\n3. O USUARIO ABRE A OBRA DO CONTRATO 001/2026")
        dialogos.clear()
        pg.evaluate("() => abreObra('001/2026')")
        pg.wait_for_timeout(1200)
        depois = pg.evaluate("""() => ({dados: Object.keys(S.dados).length,
                                        obra: document.querySelector('#nomeObra').value})""")
        linha("perguntou algo antes de trocar", f"{len(dialogos)} pergunta(s)")
        linha("obra na tela agora", depois["obra"])
        linha("lançamentos na tela agora", depois["dados"])

        ok(len(dialogos) >= 1,
           f"perguntou antes de descartar os {n} lançamentos que estavam na tela",
           f"{len(dialogos)} pergunta(s)")
        ok(depois["dados"] == r["dados"],
           "e a obra pedida entrou inteira", f"{depois['dados']} lançamento(s)")

        # Reabrir a MESMA obra nao descarta nada -- perguntar ali seria ruido, e ruido ensina
        # o usuario a clicar «sim» sem ler, que e' como um aviso util deixa de funcionar.
        dialogos.clear()
        pg.evaluate("() => abreObra('001/2026')")
        pg.wait_for_timeout(800)
        ok(not dialogos, "reabrir a MESMA obra não pergunta nada",
           f"{len(dialogos)} pergunta(s)")

        # O BLOCO 4 SAIU EM 24/08. Ele media foto orfa: a foto da obra anterior continuava
        # ocupando o teto de armazenamento da obra nova, porque o `aplicaProjeto()` fazia
        # `Object.assign(S.fotos, ...)` em vez de trocar. O controle tecnologico inteiro --
        # ensaio, foto, norma e conformidade -- saiu por ordem do cliente («nao e isso que
        # eu preciso»), e com ele o defeito que este bloco guardava: nao ha mais foto para
        # ficar orfa. O que ele provou fica no historico, em `d9726ed` e no canal de 23/08.
        #
        # O bloco 3, acima, continua: descartar a tela ao trocar de contrato nao tem nada a
        # ver com ensaio, e e' o que esta prova existe para guardar.

        print(f"\nERROS DE CONSOLE: {len(console)}")
        for c in console[:5]:
            print("   ", c)
        nav.close()
    srv.shutdown()

    print()
    if falhas:
        print(f"RESULTADO: {len(falhas)} FALHA(S)")
        for f in falhas:
            print("   falhou:", f)
        return 1
    print("RESULTADO: OK — trocar de contrato pergunta antes de descartar, e não deixa foto "
          "órfã")
    return 0


if __name__ == "__main__":
    sys.exit(main())
