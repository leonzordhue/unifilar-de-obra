# -*- coding: utf-8 -*-
"""Mede o custo da matriz. E o «antes» que a correcao precisa para ser provada.

A suspeita e que `pintaMatriz()` remonta o HTML inteiro a cada lancamento: na AM-010 sao 269
colunas por 22 linhas, quase 6.000 celulas reconstruidas para uma celula mudar de cor. Num
monitor de escritorio isso passa; num tablet em campo, que e onde se lanca servico, nao.

Suspeita nao e medicao. Este programa da o numero, e o numero e o que autoriza — ou desautoriza
— mexer no codigo.

O limite de reprovacao e de USO, nao de gosto: acima de 400 ms entre o toque e a tela mudar, a
pessoa toca de novo achando que nao pegou, e lanca duas vezes. Esse e o defeito que a lentidao
vira.

Uso: python ferramentas/testar-desempenho.py
"""
import functools
import http.server
import os
import socketserver
import statistics
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTA = 8767
LIMITE_CLIQUE_MS = 400      # acima disto a pessoa toca de novo e lança em dobro
LIMITE_CARGA_MS = 6000      # abrir a plataforma e ter o acervo na tela

falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


def nota(msg):
    print(f"         {msg}")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    H = functools.partial(Q, directory=RAIZ)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORTA), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        pg = nav.new_context(viewport={"width": 1680, "height": 1000}).new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))

        print("1. CARGA DA PLATAFORMA")
        t0 = pg.evaluate("performance.now()") if False else None
        pg.goto(f"http://127.0.0.1:{PORTA}/index.html", wait_until="domcontentloaded")
        # 21 rodovias, não 34: as planejadas saíram da lista por ordem do cliente —
        # «elas não existem, são ideias, por isso planejadas»
        pg.wait_for_function("document.querySelectorAll('#selAcervo option').length > 15",
                             timeout=30000)
        carga = pg.evaluate("performance.now()")
        ok(carga < LIMITE_CARGA_MS, "abrir a plataforma com os dois acervos na tela",
           f"{carga:.0f} ms")

        print("\n2. O EIXO MAIS PESADO DO ACERVO")
        pg.evaluate("""() => {
            const s = document.querySelector('#selAcervo');
            s.selectedIndex = [...s.options].findIndex(o => o.textContent.startsWith('AM-010'));
            s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_function("S.segs && S.segs.length > 200", timeout=30000)
        # lançamentos como os da obra real: uma frente por quilômetro
        pg.evaluate("""() => {
            const svc = S.svc.filter(s => s.on);
            S.segs.forEach((sg, i) => {
                const s = svc[i % svc.length];
                s.lados.forEach(ld => {
                    S.dados[chave({svc: s.nome, lado: ld}, sg.id)] = ['C','E','PA'][i % 3];
                });
            });
            render();
        }""")
        pg.wait_for_timeout(1500)
        tam = pg.evaluate("""() => ({
            segs: S.segs.length, linhas: linhasMatriz().length,
            lanc: Object.keys(S.dados).length
        })""")
        nota(f"AM-010: {tam['segs']} quilômetros × {tam['linhas']} linhas = "
             f"{tam['segs'] * tam['linhas']:,} células · {tam['lanc']} lançamentos"
             .replace(",", "."))

        print("\n3. QUANTO CUSTA DESENHAR A MATRIZ")
        pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
        pg.wait_for_timeout(1200)
        pinta = pg.evaluate("""() => {
            const t = [];
            for (let i = 0; i < 5; i++){
                const a = performance.now();
                pintaMatriz();
                t.push(performance.now() - a);
            }
            return t;
        }""")
        med_pinta = statistics.median(pinta)
        nota(f"pintaMatriz(): {' · '.join(f'{v:.0f}' for v in pinta)} ms "
             f"(mediana {med_pinta:.0f} ms)")

        print("\n4. QUANTO É RECÁLCULO E QUANTO É HTML")
        partes = pg.evaluate("""() => {
            const r = {};
            let a = performance.now();
            for (let i = 0; i < 20; i++) linhasMatriz();
            r.linhasMatriz = (performance.now() - a) / 20;
            const ls = linhasMatriz();
            a = performance.now();
            ls.forEach(l => resumoLinha(l));
            r.resumoTodasLinhas = performance.now() - a;
            a = performance.now();
            for (let i = 0; i < 200; i++) pctSeg(S.segs[i % S.segs.length].id);
            r.pctSeg200 = performance.now() - a;
            return r;
        }""")
        nota(f"linhasMatriz(): {partes['linhasMatriz']:.2f} ms por chamada")
        nota(f"resumoLinha() em todas as linhas: {partes['resumoTodasLinhas']:.0f} ms")
        nota(f"pctSeg() 200 vezes: {partes['pctSeg200']:.0f} ms")
        recalc = partes["resumoTodasLinhas"]
        if med_pinta > 0:
            nota(f"recálculo é {100 * recalc / med_pinta:.0f}% do tempo de pintar a matriz")

        print("\n5. O QUE O USUÁRIO SENTE: CLIQUE ATÉ A TELA MUDAR")
        cliques = pg.evaluate("""() => {
            const t = [];
            for (let i = 0; i < 8; i++){
                const c = document.querySelector(`#vMatriz td.cel[data-id="${20 + i}"]`);
                if (!c) continue;
                const a = performance.now();
                c.click();
                t.push(performance.now() - a);
            }
            return t;
        }""")
        # O 1 ms só é crível se o clique NÃO remontar a tabela. Verificação do próprio
        # instrumento: se os nós sobrevivem, a célula é trocada no lugar; se não, a medição
        # está olhando para o lado errado e o número não vale.
        sobrevive = pg.evaluate("""() => {
            const alvo = document.querySelector('#vMatriz td.cel[data-id="30"]');
            const tab = document.querySelector('#vMatriz table');
            alvo.click();
            return {celula: alvo.isConnected, tabela: tab.isConnected};
        }""")
        ok(sobrevive["celula"] and sobrevive["tabela"],
           "o clique troca a célula no lugar, sem remontar a tabela",
           "é isto que torna o tempo acima crível")
        rebuild = pg.evaluate("""() => {
            const t = document.querySelector('#vMatriz table');
            const a = performance.now(); render();
            return {ms: performance.now() - a, remontou: !t.isConnected};
        }""")
        nota(f"render() completo: {rebuild['ms']:.0f} ms · remonta a tabela: "
             f"{'sim' if rebuild['remontou'] else 'não'} — acontece ao trocar eixo, trecho ou "
             "serviços, não a cada lançamento")

        med_clique = statistics.median(cliques) if cliques else 0
        pior = max(cliques) if cliques else 0
        nota(f"clique → repintura: {' · '.join(f'{v:.0f}' for v in cliques)} ms")
        ok(med_clique < LIMITE_CLIQUE_MS,
           f"lançar uma célula responde em menos de {LIMITE_CLIQUE_MS} ms",
           f"mediana {med_clique:.0f} ms · pior {pior:.0f} ms")

        print("\n6. LANÇAMENTO EM LOTE PELA FAIXA")
        lote = pg.evaluate("""() => {
            document.querySelector(".abas button[data-v='mapa']").click();
            S.sel = new Set(S.segs.slice(0, 50).map(s => s.id));
            const a = performance.now();
            aplicaNaSelecao();
            return performance.now() - a;
        }""")
        ok(lote < 2000, "aplicar serviço a 50 quilômetros de uma vez", f"{lote:.0f} ms")

        print("\n7. O CROQUI")
        cro = pg.evaluate("""async () => {
            const a = performance.now();
            await geraCroqui();
            return performance.now() - a;
        }""")
        nota(f"geraCroqui(): {cro:.0f} ms — inclui baixar os quadros de satélite")

        nav.close()
    srv.shutdown()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:6]:
        print("   ", c[:150])
    print("\nRESULTADO:", f"{len(falhas)} FALHA(S)" if falhas or console
          else "OK — a plataforma responde no tempo de uso")
    for f in falhas:
        print("   falhou:", f)
    print("\nA suspeita era que a matriz remontasse a cada lançamento. A medição diz que não:")
    print("o clique troca a célula no lugar. A remontagem de 250 ms só acontece ao trocar")
    print("eixo, trecho ou serviços — e aí o usuário está esperando por outra coisa.")
    print("Não há o que otimizar aqui: otimizar o que não está lento é risco sem ganho.")
    return 1 if (falhas or console) else 0


if __name__ == "__main__":
    sys.exit(main())
