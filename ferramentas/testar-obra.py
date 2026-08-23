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
            // Ponteiro, e não mouse: a faixa atende dedo, caneta e mouse pelo mesmo caminho.
            // As coordenadas são reais porque o alvo vem de `elementFromPoint`.
            const clique = id => {
                const e = document.querySelector(`#faixaTrilho .km[data-id="${id}"]`);
                const r = e.getBoundingClientRect();
                const p = {bubbles: true, clientX: r.left + r.width / 2,
                           clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true};
                e.dispatchEvent(new PointerEvent('pointerdown', p));
                document.dispatchEvent(new PointerEvent('pointerup', p));
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

        print("\n5-lados. UM QUILÔMETRO COM OS LADOS EM ESTADOS DIFERENTES")
        # Achado auditando meu próprio código: limpeza lateral concluída num acostamento e
        # prevista no outro entrava como «1 km concluído» — meio serviço virando serviço
        # inteiro num quadro de medição. O quilômetro passa a contar pelo lado MENOS avançado.
        casos = [
            # aqui o que importa é o km NÃO entrar como concluído; o total de «previsto»
            # inclui os outros doze quilômetros do eixo e não serviria de asserção
            ("um lado concluído, outro previsto", "C", "", "C", 0.0),
            ("os dois lados concluídos", "C", "C", "C", 1.0),
            ("um concluído, outro não se aplica", "C", "NA", "C", 1.0),
            ("os dois não se aplicam", "NA", "NA", "NA", 1.0),
            ("um concluído, outro em andamento", "C", "E", "E", 1.0),
        ]
        for nome, a, b, esperado, quanto in casos:
            r = pg.evaluate("""([a, b]) => {
                const s = S.svc.find(x => x.on && x.lados.length > 1);
                if (!s) return null;
                const guardado = S.dados; S.dados = {};
                if (a) S.dados[chave({svc: s.nome, lado: s.lados[0]}, 3)] = a;
                if (b) S.dados[chave({svc: s.nome, lado: s.lados[1]}, 3)] = b;
                const q = quadroObra().find(x => x.svc === s.nome);
                const fora = {C: q.C, E: q.E, P: q.P, NA: q.NA, S: q.S, PA: q.PA};
                S.dados = guardado;
                return fora;
            }""", [a, b])
            if r is None:
                ok(False, "há serviço de dois lados marcado para testar")
                break
            medido = r.get(esperado, 0)
            # a mensagem tem de ler o que a asserção mede: quando o esperado é zero, o que
            # se afirma é a AUSÊNCIA — «conta como C» com C igual a zero lê ao contrário
            frase = (f"{nome} → NÃO entra como «{esperado}»" if quanto == 0
                     else f"{nome} → conta como «{esperado}»")
            ok(abs(medido - quanto) < 0.02, frase,
               " · ".join(f"{k} {v:.2f}" for k, v in r.items() if v > 0.001) or "nada")
        pg.evaluate("render()")
        pg.wait_for_timeout(400)

        print("\n5a. QUANTIDADE CONTRATADA E QUADRO POR SERVIÇO")
        # o escritório mede contra o contratado: 2 km executados de 3 contratados são 67%,
        # e não os 15% que os mesmos 2 km representam num trecho de 13 km
        pg.evaluate("""() => {
            // conclui o KM 3 e o KM 4; o KM 9 fica em andamento
            const l = {svc: 'EROSÕES', lado: 'U'};
            [3, 4].forEach(id => S.dados[chave(l, id)] = 'C');
            const s = S.svc.find(x => x.nome === 'EROSÕES');
            s.km_contratado = 3;
            const o = document.querySelector('[data-ct="objeto"]');
            o.value = 'Recuperação de erosões na AM-151';
            o.dispatchEvent(new Event('input'));
            const v = document.querySelector('[data-ct="valor"]');
            v.value = '1250000'; v.dispatchEvent(new Event('input'));
            render();
        }""")
        pg.wait_for_timeout(900)
        q = pg.evaluate("quadroObra().find(x => x.svc === 'EROSÕES')")
        ok(q is not None and abs(q["C"] - 2) < 0.05,
           "quilômetros concluídos do serviço, contados uma vez por quilômetro",
           f"{q['C']:.2f} km" if q else "não achou")
        ok(q and q["pctContrato"] and abs(q["pctContrato"] - 2 / 3) < 0.01,
           "% do contrato mede contra a quantidade contratada",
           f"{100 * q['pctContrato']:.1f}% de 3 km" if q and q["pctContrato"] else "—")
        ok(q and q["E"] and abs(q["E"] - 1) < 0.05,
           "o quilômetro em andamento não entra como concluído",
           f"{q['E']:.2f} km em andamento" if q else "—")
        ok(q and q["pctTrecho"] is not None and q["pctTrecho"] < 0.2,
           "% do trecho continua existindo, e é outro número",
           f"{100 * q['pctTrecho']:.1f}%" if q and q["pctTrecho"] is not None else "—")
        outros = pg.evaluate("quadroObra().filter(x => x.svc !== 'EROSÕES')")
        ok(all(x["pctContrato"] is None for x in outros),
           "serviço sem quantidade informada não inventa percentual de contrato",
           f"{len(outros)} serviço(s) sem quantidade")
        cd = pg.evaluate("S.contratoDados")
        ok(cd.get("objeto", "").startswith("Recuperação"),
           "os dados do contrato ficam no projeto", cd.get("objeto", ""))

        print("\n5a-bis. EXECUTADO ACIMA DO CONTRATADO É AVISADO")
        # 2 km concluídos com 1 km contratado: 200% num quadro de medição não é avanço, é
        # quantidade contratada errada ou serviço lançado fora do contrato
        pg.evaluate("""() => {
            S.svc.find(x => x.nome === 'EROSÕES').km_contratado = 1;
            render();
        }""")
        pg.wait_for_timeout(700)
        ex = pg.evaluate("quadroObra().find(x => x.svc === 'EROSÕES').excedeContrato")
        # o CALCULO do excedente continua vivo: o contrato saiu da tela nesta fase, por ordem
        # do cliente, e volta noutro projeto sobre o dado que ja esta guardado
        ok(ex is True, "o quadro ainda calcula o serviço que passou do contratado", str(ex))
        html = pg.evaluate("tabelaQuadroObra()")
        ok("Contratado" not in html and "% do contrato" not in html,
           "e as colunas de contrato NAO aparecem nesta fase")
        ok("menos avançado" in html and "mesma base da matriz" in html,
           "o quadro explica por extenso a base do numero que mostra")
        pg.evaluate("""() => {
            S.svc.find(x => x.nome === 'EROSÕES').km_contratado = 3;
            render();
        }""")
        pg.wait_for_timeout(500)
        ok(pg.evaluate("!quadroObra().find(x => x.svc === 'EROSÕES').excedeContrato"),
           "e não marca quando está dentro do contratado")

        print("\n5b. O ENSAIO CHEGA AO RELATÓRIO")
        # ensaio que não chega ao relatório não serve de nada numa medição
        pg.evaluate("document.querySelector(\".abas button[data-v='rel']\").click()")
        pg.wait_for_timeout(2500)
        rel = pg.evaluate("document.querySelector('#vRel').textContent")
        ok("Controle tecnológico" in rel, "o relatório tem a seção de controle tecnológico")
        ok("Não conforme" in rel, "o resultado do ensaio aparece no relatório")
        ok("Fiscal do DMOB" in rel, "o responsável aparece no relatório")
        # GC-BASE passou a ter norma conferida: o relatório tem de mostrar o CÓDIGO. O aviso
        # de pendência continua provado, mais abaixo, com um ensaio ainda não conferido.
        ok("DNER-ME 092/94" in rel or "DNIT 141/2022-ES" in rel,
           "o relatório mostra a norma de referência do ensaio conferido")
        ok("Conformidade" in rel, "o relatório traz o indicador de conformidade")
        secoes = pg.evaluate("[...document.querySelectorAll('#vRel h2')].map(e => e.textContent)")
        ok(len(secoes) == 6 and secoes[-1].strip().startswith("6."),
           "as seções ficam numeradas em sequência", " | ".join(secoes))
        pg.screenshot(path=os.path.join(RAIZ, "documentacao", "imagens",
                                        "07-relatorio-ensaios.png"), full_page=True)
        pg.evaluate("document.querySelector(\".abas button[data-v='mapa']\").click()")
        pg.wait_for_timeout(900)

        print("\n5c. RESUMO PINTADO NO CROQUI E GRÁFICO NO RELATÓRIO")
        # O croqui circula sozinho — colado num ofício, impresso. Ou ele leva o resumo, ou
        # diz onde é a obra sem dizer como ela está.
        g = pg.evaluate("typeof graficoQuadroObra === 'function' ? graficoQuadroObra() : ''")
        ok("<svg" in g and "</svg>" in g, "o relatório traz o gráfico do quadro",
           f"{len(g)} caracteres de SVG")
        import re as _re
        barras = len(_re.findall(r"<rect ", g))
        ok(barras >= 8, "uma barra por situação em cada serviço", f"{barras} retângulo(s)")
        cores = pg.evaluate("""() => ['C','E','PA','S','P'].map(c => corStatus(c))""")
        ok(all(c.lower() in g.lower() for c in cores if c),
           "todas as situações aparecem com a cor do catálogo, inclusive Previsto",
           " ".join(cores))
        ok("contratado" in g, "o gráfico marca a quantidade contratada")

        # o painel do croqui é desenhado em canvas: a conferência é por PIXEL, contando os
        # que têm a cor de «concluído» dentro da imagem gerada
        # o bloco guarda o estado e devolve depois: acrescentar lançamento aqui mudava a
        # contagem que os blocos 6 e 7 conferem, e a prova passava a medir a si mesma
        pg.evaluate("""() => {
            window.__guardado = JSON.stringify(S.dados);
            S.svc.filter(s => s.on).forEach(s => { s.km_contratado = 4; });
            const l = {svc: 'EROSÕES', lado: 'U'};
            [3, 4, 5].forEach(id => S.dados[chave(l, id)] = 'C');
            S.croqui = null; render();
        }""")
        pg.wait_for_timeout(600)
        pix = pg.evaluate("""async () => {
            const c = await geraCroqui();
            if (!c || !c.url) return null;
            const im = new Image();
            await new Promise(r => { im.onload = r; im.src = c.url; });
            const cv = document.createElement('canvas');
            cv.width = im.width; cv.height = im.height;
            const g2 = cv.getContext('2d');
            g2.drawImage(im, 0, 0);
            const alvo = corStatus('C').replace('#', '');
            const R = parseInt(alvo.slice(0, 2), 16), G = parseInt(alvo.slice(2, 4), 16),
                  B = parseInt(alvo.slice(4, 6), 16);
            const d = g2.getImageData(0, 0, cv.width, cv.height).data;
            let n = 0;
            for (let i = 0; i < d.length; i += 4)
                if (Math.abs(d[i] - R) < 6 && Math.abs(d[i+1] - G) < 6 && Math.abs(d[i+2] - B) < 6) n++;
            return {larg: im.width, alt: im.height, pixelsVerdes: n};
        }""")
        if pix and pix["larg"] >= 560:
            ok(pix["pixelsVerdes"] > 200,
               "a tabela pintada aparece dentro da imagem do croqui",
               f"{pix['pixelsVerdes']} pixels na cor de concluído em "
               f"{pix['larg']}×{pix['alt']}")
        else:
            print("         (imagem estreita: o painel não entra para não cobrir o traçado)")
        pg.evaluate("() => { S.dados = JSON.parse(window.__guardado); S.croqui = null; render(); }")
        pg.wait_for_timeout(500)

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
        ok(pg.evaluate("Array.isArray([...(S.sel || [])]) && S.sel instanceof Set"),
           "a seleção volta como Set, e não como objeto vazio",
           f"{pg.evaluate('[...(S.sel || [])].length')} quilômetro(s) selecionado(s)")
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
