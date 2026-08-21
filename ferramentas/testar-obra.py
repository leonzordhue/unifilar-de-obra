# -*- coding: utf-8 -*-
"""Prova o fluxo de trabalho que o cliente descreveu, do inicio ao fim.

«Insiro um KML de uma rodovia, a AM-151, que tem pouco mais de 12 km. Vou fazer um servico
de recuperacao de erosao entre os km 3 e 5. O tracado carrega, aparece o mapa e embaixo uma
linha indicando o tracado dividido em KM ou estaca. Seleciono os KM — podem ser KM
diferentes — e o ponto fica marcado de uma cor baseada no servico, no tracado reto e no
mapa. Indico a situacao: parado, em andamento, concluido. E o projeto fica salvo com o
numero do contrato, para eu pesquisar por ele depois e o perfil carregar.»

Cada frase dessa vira uma medicao aqui. Uso: python ferramentas/testar-obra.py
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTA = 8747
CONTRATO = "017/2023-SEINFRA"

falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    H = functools.partial(Silencioso, directory=RAIZ)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORTA), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_context(viewport={"width": 1680, "height": 1000}).new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{PORTA}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)

        print("1. A RODOVIA CARREGA E VIRA UMA LINHA RETA")
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-151'));
            sel.selectedIndex = i; sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)
        ext = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)")
        cel = pg.evaluate("document.querySelectorAll('#faixaTrilho .km').length")
        ok(11 < ext < 14, "AM-151 tem pouco mais de 12 km", f"{ext:.3f} km")
        ok(cel == pg.evaluate("S.segs.length"),
           "a faixa unifilar mostra um pedaço por quilômetro", f"{cel} células")
        cabe = pg.evaluate("""() => { const t = document.querySelector('#faixaTrilho');
            return t.scrollWidth <= t.clientWidth + 2; }""")
        ok(cabe, "a faixa cabe inteira na tela, sem rolagem")

        print("\n2. SELEÇÃO DE QUILÔMETROS, INCLUSIVE DESCONTÍNUA")
        pg.evaluate("""() => {
            const clique = id => {
                const e = document.querySelector(`#faixaTrilho .km[data-id="${id}"]`);
                e.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
            };
            [3, 4, 9].forEach(clique);
        }""")
        pg.wait_for_timeout(600)
        sel = pg.evaluate("[...S.sel].sort((a,b)=>a-b)")
        ok(sel == [3, 4, 9], "seleciona KM 3, KM 4 e KM 9 — descontínua", str(sel))
        txt = pg.evaluate("document.querySelector('#faixaSel').textContent")
        ok("3 selecionado" in txt, "a faixa informa o que está selecionado", txt.strip())

        print("\n3. LANÇAMENTO PELA COR DO SERVIÇO")
        opts = pg.evaluate("""[...document.querySelectorAll('#selSit option')]
            .map(o => o.textContent)""")
        ok("Paralisado" in opts, "situação «Paralisado» disponível", " · ".join(opts))
        pg.evaluate("""() => {
            const s = document.querySelector('#selSvcAtivo');
            const i = [...s.options].findIndex(o => o.value === 'EROSÕES');
            s.selectedIndex = i; s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(500)
        cor = pg.evaluate("corServico('EROSÕES')")
        ok(cor and cor.startswith("#"), "o serviço tem cor própria", f"EROSÕES → {cor}")
        pg.evaluate("""() => {
            const st = document.querySelector('#selSit');
            const i = [...st.options].findIndex(o => o.textContent === 'Em andamento');
            st.selectedIndex = i;
            document.querySelector('#btAplica').click();
        }""")
        pg.wait_for_timeout(1200)
        marcados = pg.evaluate("Object.keys(S.dados).length")
        ok(marcados == 3, "lança nos três quilômetros selecionados", f"{marcados} lançamento(s)")
        pintados = pg.evaluate("""() => [3, 4, 9].map(id => {
            const e = document.querySelector(`#faixaTrilho .km[data-id="${id}"]`);
            return e.style.background || e.style.backgroundImage;
        })""")
        ok(all(cor.lower() in (p or "").lower() or "rgb" in (p or "") for p in pintados),
           "os três aparecem pintados na faixa", str(pintados[0])[:40])
        # a medição tem de ser da COR do serviço, e não da espessura: espessura 6 é o
        # padrão de todo quilômetro dentro do trecho, e contá-la daria verde sempre
        no_mapa = pg.evaluate("""(cor) => {
            let n = 0;
            S.camadas.eachLayer(l => {
                if (l.options && String(l.options.color).toLowerCase() === cor.toLowerCase()) n++;
            });
            return n;
        }""", cor)
        ok(no_mapa == 3, "o mapa pinta exatamente os três com a cor do serviço",
           f"{no_mapa} traço(s) em {cor}")
        pg.screenshot(path=os.path.join(RAIZ, "documentacao", "imagens",
                                        "06-faixa-unifilar.png"))

        print("\n4. SITUAÇÃO E FICHA DO QUILÔMETRO")
        pg.evaluate("abreFicha(4)")
        pg.wait_for_timeout(900)
        ficha = pg.evaluate("document.querySelector('#fichaCorpo').textContent")
        ok("EROSÕES" in ficha and "Em andamento" in ficha,
           "a ficha do KM 4 mostra o serviço e a situação")
        ok("KM 4" in ficha or "KM 4 – 5" in ficha, "a ficha identifica o quilômetro")

        print("\n5. ENSAIO COM CRITÉRIO E RESULTADO")
        pg.evaluate("""() => {
            const e = S.ens.find(x => x.cod === 'GC-BASE'); if (e) e.on = true;
            pintaEns(); pintaFicha();
        }""")
        pg.wait_for_timeout(700)
        pg.evaluate("""() => {
            const s = document.querySelector('#fEns');
            const i = [...s.options].findIndex(o => o.value === 'GC-BASE');
            s.selectedIndex = i; s.dispatchEvent(new Event('change'));
            document.querySelector('#fValor').value = '92';
            document.querySelector('#fMin').value = '95';
            document.querySelector('#fResp').value = 'Fiscal do DMOB';
            document.querySelector('#fLanca').click();
        }""")
        pg.wait_for_timeout(1200)
        n = pg.evaluate("S.reg.length")
        res = pg.evaluate("S.reg.length ? conforme(S.reg[0]) : null")
        ok(n == 1, "ensaio lançado no quilômetro", f"{n} registro(s)")
        ok(res is False, "medição de 92% contra mínimo de 95% dá NÃO CONFORME", str(res))
        rs = pg.evaluate("resumoEnsaios([4])")
        ok(rs["pctConformidade"] == 0 and rs["previstos"] is None,
           "conformidade 0% e previstos sem base — o catálogo ainda não tem frequência",
           f"conf={rs['pctConformidade']} previstos={rs['previstos']}")
        pg.evaluate("fechaFicha()")

        print("\n5b. O ENSAIO CHEGA AO RELATÓRIO")
        # ensaio que não chega ao relatório não serve de nada numa medição
        pg.evaluate("document.querySelector(\".abas button[data-v='rel']\").click()")
        pg.wait_for_timeout(2500)
        rel = pg.evaluate("document.querySelector('#vRel').textContent")
        ok("Controle tecnológico" in rel, "o relatório tem a seção de controle tecnológico")
        ok("Não conforme" in rel, "o resultado do ensaio aparece no relatório")
        ok("Fiscal do DMOB" in rel, "o responsável aparece no relatório")
        ok("pendente" in rel.lower() and "norma" in rel.lower(),
           "o relatório avisa que a norma está pendente de confirmação")
        ok("Conformidade" in rel, "o relatório traz o indicador de conformidade")
        secoes = pg.evaluate("[...document.querySelectorAll('#vRel h2')].map(e => e.textContent)")
        ok(len(secoes) == 6 and secoes[-1].strip().startswith("6."),
           "as seções ficam numeradas em sequência", " | ".join(secoes))
        pg.screenshot(path=os.path.join(RAIZ, "documentacao", "imagens",
                                        "07-relatorio-ensaios.png"), full_page=True)
        pg.evaluate("document.querySelector(\".abas button[data-v='mapa']\").click()")
        pg.wait_for_timeout(900)

        print("\n6. A OBRA É GUARDADA PELO NÚMERO DO CONTRATO")
        pg.evaluate(f"""() => {{
            document.querySelector('#nomeObra').value = 'AM-151 — recuperação de erosões';
            const c = document.querySelector('#contrato');
            c.value = '{CONTRATO}'; c.dispatchEvent(new Event('input'));
            document.querySelector('#btGuardar').click();
        }}""")
        pg.wait_for_timeout(1200)
        guardadas = pg.evaluate("Object.keys(obrasGuardadas())")
        ok(CONTRATO.upper() in [g.upper() for g in guardadas],
           "obra guardada sob o contrato", " · ".join(guardadas))
        lista = pg.evaluate("document.querySelector('#obrasCorpo').textContent")
        ok("AM-151" in lista and CONTRATO in lista,
           "a obra aparece na lista de obras guardadas")

        print("\n7. PESQUISAR O CONTRATO REABRE O PERFIL")
        pg.evaluate("""() => {
            document.querySelector('#btFechaObras').click();
            document.querySelector('#btNovo').click();
        }""")
        pg.wait_for_timeout(1500)
        ok(pg.evaluate("!S.eixo && Object.keys(S.dados).length === 0"),
           "«Novo» limpa a tela")
        pg.evaluate("""() => {
            document.querySelector('#btObras').click();
            const b = document.querySelector('#buscaObra');
            b.value = '017'; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(800)
        achou = pg.evaluate("document.querySelectorAll('#obrasCorpo [data-abre]').length")
        ok(achou == 1, "buscar por «017» encontra a obra", f"{achou} resultado(s)")
        pg.evaluate("document.querySelector('#obrasCorpo [data-abre]').click()")
        pg.wait_for_timeout(2500)
        volta = {
            "eixo": pg.evaluate("S.eixo ? S.eixo.nome : ''"),
            "lanc": pg.evaluate("Object.keys(S.dados).length"),
            "ens": pg.evaluate("S.reg.length"),
            "contrato": pg.evaluate("document.querySelector('#contrato').value"),
            "obra": pg.evaluate("document.querySelector('#nomeObra').value"),
        }
        ok(volta["eixo"] == "AM-151", "o eixo volta", volta["eixo"])
        ok(volta["lanc"] == 3, "os três lançamentos voltam", str(volta["lanc"]))
        ok(volta["ens"] == 1, "o ensaio volta", str(volta["ens"]))
        ok(volta["contrato"].upper() == CONTRATO.upper(), "o contrato volta", volta["contrato"])
        ok("AM-151" in volta["obra"], "a identificação da obra volta", volta["obra"])
        pintado = pg.evaluate("""() => {
            const e = document.querySelector('#faixaTrilho .km[data-id="4"]');
            return e ? (e.style.background || '') : '';
        }""")
        ok(pintado != "", "a faixa volta pintada", pintado[:40])

        nav.close()
    srv.shutdown()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:10]:
        print("   ", c[:160])
    print("\nRESULTADO:", f"{len(falhas)} FALHA(S)" if falhas or console
          else "OK — o fluxo da obra funcionou de ponta a ponta")
    for f in falhas:
        print("   falhou:", f)
    return 1 if (falhas or console) else 0


if __name__ == "__main__":
    sys.exit(main())
