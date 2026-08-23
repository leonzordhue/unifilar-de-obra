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
              if m.type == "error" else None)
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

        # foto pequena de verdade, gerada pela propria reducao da plataforma
        foto = pg.evaluate("""() => {
            const c = document.createElement('canvas');
            c.width = 320; c.height = 240;
            const x = c.getContext('2d');
            x.fillStyle = '#6d6f70'; x.fillRect(0, 0, 320, 240);
            x.fillStyle = '#e8e4d8'; x.fillRect(150, 0, 8, 240);
            return c.toDataURL('image/jpeg', 0.72);
        }""")

        print("1. UMA OBRA COM TRABALHO DENTRO, GUARDADA NO CONTRATO 001/2026")
        carrega("AM-151")
        r = pg.evaluate("""(foto) => {
            document.querySelector('#nomeObra').value = 'Erosões AM-151';
            document.querySelector('#contrato').value = '001/2026';
            const l = linhasMatriz()[0];
            S.segs.slice(0, 4).forEach(s => { S.dados[chave(l, s.id)] = 'C'; });
            if (!S.ens.length) montaEns();
            S.ens.forEach(e => e.on = true);
            const g = novoRegistro(S.segs[0].id, S.ens[0].cod);
            g.valor = 97; S.reg.push(g);
            guardaFoto(g.id, foto); g.foto = g.id;
            render();
            return {dados: Object.keys(S.dados).length, reg: S.reg.length,
                    fotos: Object.keys(S.fotos).length};
        }""", foto)
        linha("lançamentos na matriz", r["dados"])
        linha("ensaios com foto", f"{r['reg']} ensaio(s) · {r['fotos']} foto(s)")
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
                                        obra: document.querySelector('#nomeObra').value,
                                        fotos: Object.keys(S.fotos).length})""")
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

        print("\n4. AS FOTOS DA OBRA ANTERIOR CONTINUAM NA MAQUINA")
        # abre uma obra sem foto e ve se a foto da primeira ficou para tras
        pg.evaluate("""() => {
            document.querySelector('#contrato').value = '002/2026';
            document.querySelector('#nomeObra').value = 'Obra sem foto';
            S.reg = []; S.dados = {};
            guardaObra();
        }""")
        pg.wait_for_timeout(400)
        pg.evaluate("() => abreObra('002/2026')")
        pg.wait_for_timeout(800)
        f2 = pg.evaluate("""() => ({fotos: Object.keys(S.fotos).length,
                                    bytes: tamanhoFotos(),
                                    reg: S.reg.length,
                                    orfas: Object.keys(S.fotos)
                                      .filter(k => !S.reg.some(r => r.foto === k)).length})""")
        linha("ensaios da obra aberta", f2["reg"])
        linha("fotos ainda em memória e no navegador", f2["fotos"])
        linha("dessas, órfãs (sem ensaio na obra atual)", f2["orfas"])
        linha("espaço que elas ocupam", f"{f2['bytes'] / 1024:,.0f} KB".replace(",", "."))
        ok(f2["orfas"] == 0,
           "nenhuma foto da obra anterior ficou ocupando o teto da obra nova",
           f"{f2['orfas']} órfã(s) · {f2['bytes'] / 1024:,.0f} KB".replace(",", "."))

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
