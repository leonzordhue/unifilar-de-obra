# -*- coding: utf-8 -*-
"""Prova o painel de conformidade (app/11-painel.js) num Chromium de verdade.

O que se mede aqui, e por que: o painel mistura duas contas de origens diferentes — avanco
de servico (S.dados) e ensaio (S.reg) — e a armadilha da tela e' tratar AUSENCIA DE BASE como
zero por cento. Quilometro sem ensaio previsto nao e' quilometro reprovado. Cada bloco abaixo
existe para pegar exatamente esse tipo de mentira plausivel.

Porta 0: o SO escolhe uma livre. Porta fixa faz duas provas simultaneas se servirem os
arquivos uma da outra — ja aconteceu neste repositorio, deu falso vermelho, e a colisao
invertida daria falso verde.

Uso:  python ferramentas/testar-painel.py
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
falhas = []
pendencias = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


def pendente(cond, msg, dono, extra=""):
    """Defeito real, em arquivo de outro dono. Nao entra como falha desta suite — seria
    bloquear o repositorio por algo que este modulo nao pode consertar —, mas aparece em
    toda execucao para nao virar silencio confortavel."""
    if cond:
        print(f"  OK    {msg}" + (f"  → {extra}" if extra else ""))
    else:
        print(f"  PENDENTE (dono: {dono}) {msg}" + (f"  → {extra}" if extra else ""))
        pendencias.append(f"{msg} — dono: {dono}")


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def raiz_servida(tmp):
    """Serve o projeto como esta. Enquanto o `index.html` nao carregar o painel — a linha e'
    do dono daquele arquivo, pedida em COORDENACAO.md —, serve uma copia com o <script>
    injetado, e diz isso em voz alta para ninguem ler este verde como se fosse o produto."""
    html = io.open(os.path.join(RAIZ, "index.html"), encoding="utf-8").read()
    if "app/11-painel.js" in html:
        return RAIZ, False
    base = os.path.join(tmp, "com-painel")
    for i in ("index.html", "app", "dados", "bibliotecas"):
        o = os.path.join(RAIZ, i)
        if os.path.isdir(o):
            shutil.copytree(o, os.path.join(base, i),
                            ignore=shutil.ignore_patterns("_temp", "__pycache__"))
        else:
            os.makedirs(base, exist_ok=True)
            shutil.copy(o, os.path.join(base, i))
    p = os.path.join(base, "index.html")
    s = io.open(p, encoding="utf-8").read()
    s2 = re.sub(r'(<script src="app/09-app\.js"></script>)',
                '<script src="app/11-painel.js"></script>\n\\1', s, count=1)
    if s2 == s:
        s2 = s.replace("</body>", '<script src="app/11-painel.js"></script>\n</body>')
    io.open(p, "w", encoding="utf-8", newline="\n").write(s2)
    return base, True


# catalogo de ensaio com frequencia e limite, injetado em memoria so para esta prova: o
# catalogo do repositorio ainda esta sem `por_km` e sem limite, e e' o jarvisIV quem o
# preenche. Injetar aqui prova o caminho COM base sem inventar norma no arquivo de ninguem.
CATALOGO_DE_TESTE = """() => {
  S.catEns = {
    grupos: [{nome: 'Terraplenagem', cor: '#8C6D3F'}, {nome: 'Base e sub-base', cor: '#1F4E79'}],
    itens: [
      {cod: 'T1', nome: 'Grau de compactação', grupo: 'Terraplenagem',
       por_km: 2, limite_min: 95, limite_max: null, unidade: '%'},
      {cod: 'B1', nome: 'Espessura da base', grupo: 'Base e sub-base',
       por_km: 1, limite_min: 18, limite_max: 22, unidade: 'cm'}
    ]
  };
  montaEns();
  S.ens.forEach(e => e.on = true);   // na tela quem marca e' o usuario, na prova marca-se aqui
  return S.ens.filter(e => e.on).length;
}"""


def lanca(pg, seg, cod, valor, data="2026-08-10"):
    pg.evaluate("""([seg, cod, valor, data]) => {
        const r = novoRegistro(seg, cod);
        r.valor = valor; r.data = data;
        S.reg.push(r);
        return r.id;
    }""", [seg, cod, valor, data])


def main():
    with tempfile.TemporaryDirectory() as tmp:
        base, injetado = raiz_servida(tmp)
        if injetado:
            print("AVISO: o index.html do repositório ainda não carrega app/11-painel.js.")
            print("       Esta execução usa uma cópia com a linha injetada — o pedido ao dono")
            print("       do arquivo está em COORDENACAO.md.\n")
        srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=base))
        porta = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        console = []

        with sync_playwright() as p:
            nav = p.chromium.launch()
            pg = nav.new_context(viewport={"width": 1600, "height": 950}).new_page()
            pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
            pg.on("dialog", lambda d: d.accept())
            pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
            pg.wait_for_timeout(2400)

            print("1. A ABA SE REGISTRA SOZINHA")
            abas = pg.eval_on_selector_all("#abas button[data-v]", "es => es.map(e => e.dataset.v)")
            ok("painel" in abas, "aba «painel» aparece na barra", " ".join(abas))
            # `montaAbas` procura a primeira aba de ordem maior para inserir antes dela; as
            # abas fixas do html nao estao em ABAS, entao `ordemAba` devolve 0 para todas e a
            # aba registrada cai no comeco da barra. O registro de abas e' de outro dono.
            pendente(abas.index("painel") == 1 if "painel" in abas else False,
                     "entra depois do mapa e antes da matriz (ordem 15)",
                     "Cortanna · app/00-estado.js", " ".join(abas))
            pg.click("#abas button[data-v='painel']")
            pg.wait_for_timeout(600)
            ok("Nada a exibir" in pg.inner_text("#vPainel"),
               "sem eixo, o painel diz o que falta em vez de mostrar zero")

            print("\n2. SEM ENSAIO PREVISTO — «sem base» e não «zero por cento»")
            pg.evaluate("""() => { const s = document.querySelector('#selAcervo');
                const o = [...s.options].find(x => x.textContent.startsWith('AM-070'));
                s.value = o.value; s.dispatchEvent(new Event('change')); }""")
            pg.wait_for_timeout(2200)
            pg.click("#abas button[data-v='painel']")
            pg.wait_for_timeout(800)
            t = pg.inner_text("#vPainel")
            ok("—" in t, "percentual sem base sai como travessão")
            cartoes = pg.eval_on_selector_all("#vPainel .card",
                "es => es.map(e => e.querySelector('.rot').textContent + '=' + e.querySelector('.val').textContent)")
            conf = [c for c in cartoes if c.startswith("Conformidade")][0]
            ens = [c for c in cartoes if c.startswith("Ensaios")][0]
            ok(conf.endswith("—"), "conformidade sem julgamento sai «—», não 0,0%", conf)
            ok(ens.endswith("0"), "ensaios executados mostra a contagem, não percentual falso", ens)
            cor = pg.eval_on_selector_all("#vPainel table.res tbody tr td:last-child span",
                                          "es => es.map(e => e.style.background)")
            ok(bool(cor) and all("200, 210, 220" in c or "#C8D2DC" in c.upper() or c == ""
                                 for c in cor),
               "semáforo cinza (sem base), não vermelho", cor[0] if cor else "sem linhas")

            print("\n3. COM CATÁLOGO E ENSAIOS LANÇADOS")
            n = pg.evaluate(CATALOGO_DE_TESTE)
            ok(n == 2, "catálogo de teste com 2 ensaios contratados", str(n))
            ids = pg.evaluate("() => S.segs.slice(0, 3).map(s => s.id)")
            lanca(pg, ids[0], "T1", 97.0)     # conforme
            lanca(pg, ids[0], "T1", 91.0)     # não conforme
            lanca(pg, ids[1], "B1", 20.0)     # conforme
            lanca(pg, ids[2], "B1", 26.0)     # não conforme (acima do máximo)
            pg.evaluate("() => render()")
            pg.wait_for_timeout(700)
            r = pg.evaluate("""() => { const ids = segsNoTrecho().map(s => s.id);
                const e = resumoEnsaios(ids);
                return {exec: e.executados, conf: e.conformes, nc: e.naoConformes,
                        pctC: e.pctConformidade, prev: e.previstos}; }""")
            ok(r["exec"] == 4 and r["conf"] == 2 and r["nc"] == 2,
               "4 ensaios: 2 conformes e 2 não conformes",
               f"{r['exec']}/{r['conf']}/{r['nc']}")
            ok(abs(r["pctC"] - 0.5) < 1e-9, "conformidade 50%", f"{r['pctC']:.3f}")
            ok(r["prev"] is not None and r["prev"] > 0,
               "previstos calculados pela frequência do catálogo", f"{r['prev']:.0f}")
            t = pg.inner_text("#vPainel")
            ok("50,0%" in t, "o cartão de conformidade mostra 50,0%")
            ok("2" in t, "as não conformidades em aberto aparecem")

            print("\n4. NÃO CONFORMIDADE FECHA COM REENSAIO CONFORME")
            antes = pg.evaluate("() => naoConformidadesAbertas(segsNoTrecho().map(s => s.id)).length")
            lanca(pg, ids[0], "T1", 96.0, "2026-08-20")   # reensaio conforme, posterior
            depois = pg.evaluate("() => naoConformidadesAbertas(segsNoTrecho().map(s => s.id)).length")
            ok(antes == 2 and depois == 1,
               "reensaio conforme posterior fecha a não conformidade daquele km",
               f"{antes} → {depois}")

            print("\n5. FAIXA DA TABELA")
            pg.evaluate("() => render()")
            pg.wait_for_timeout(500)
            linhas = {}
            for km in (1, 5, 10, 20):
                pg.click(f"#vPainel button[data-faixa='{km}']")
                pg.wait_for_timeout(500)
                linhas[km] = len(pg.eval_on_selector_all("#vPainel table.res tbody tr", "e => e"))
            ok(linhas[1] > linhas[5] > linhas[10] >= linhas[20],
               "faixa menor gera mais linhas", str(linhas))
            n_segs = pg.evaluate("() => segsNoTrecho().length")
            ok(linhas[1] == n_segs, "faixa de 1 km = uma linha por quilômetro",
               f"{linhas[1]} linhas para {n_segs} km")

            print("\n6. GRÁFICO POR TIPO DE CONTROLE")
            pg.click("#vPainel button[data-faixa='10']")
            pg.wait_for_timeout(500)
            svg = pg.eval_on_selector_all("#vPainel svg", "e => e.length")
            ok(svg == 1, "um SVG, escrito à mão", str(svg))
            grupos = pg.eval_on_selector_all("#vPainel svg text",
                                             "es => es.map(e => e.textContent)")
            ok(any("Terraplenagem" in g for g in grupos)
               and any("Base e sub-base" in g for g in grupos),
               "uma barra por tipo de controle com dado", " · ".join(grupos[:4]))
            externos = pg.evaluate("""() => [...document.querySelectorAll('script[src],link[href]')]
                .map(e => e.getAttribute('src') || e.getAttribute('href'))
                .filter(u => /^https?:/i.test(u || ''))""")
            ok(not externos, "nenhuma biblioteca de gráfico foi acrescentada",
               "todos locais" if not externos else str(externos))

            print("")
            print("7. MAPA POR CRITÉRIO DE COR")
            pg.click("#abas button[data-v='mapa']")
            pg.wait_for_timeout(1200)
            crits = pg.eval_on_selector_all("#selCrit option", "es => es.map(e => e.value)")
            ok(crits == ["servico", "avanco", "conformidade", "ensaios"],
               "quatro critérios no seletor do mapa", " ".join(crits))

            def cores():
                return pg.evaluate("() => { const c = []; S.camadas.eachLayer(l => {"
                                   " if (l.options && l.options.color) c.push(l.options.color); });"
                                   " return c; }")

            def usa(crit):
                pg.evaluate("(c) => { const s = document.querySelector('#selCrit');"
                            " s.value = c; s.dispatchEvent(new Event('change')); }", crit)
                pg.wait_for_timeout(900)
                return cores()

            base = usa("servico")
            ok(len(base) > 0, "o eixo é desenhado", f"{len(base)} traço(s)")
            cf = usa("conformidade")
            # so os 3 primeiros km receberam ensaio; o resto do eixo nao tem base e tem de sair
            # cinza-claro — vermelho ali seria acusar quilometro que ninguem mandou ensaiar
            ok(cf.count("#C8D2DC") >= len(cf) - 4,
               "quilômetro sem ensaio sai «sem base», não reprovado",
               f"{cf.count('#C8D2DC')} de {len(cf)} sem base")
            ok(any(c in cf for c in ("#D9534F", "#F0A32B", "#2E9E5B", "#8CB84B")),
               "quilômetro com ensaio recebe cor de semáforo",
               " ".join(sorted(set(c for c in cf if c != "#C8D2DC")))[:60])
            en = usa("ensaios")
            ok(en != cf, "trocar o critério muda o desenho")
            leg = pg.inner_text("#legCrit")
            ok("sem base" in leg, "a legenda declara o cinza como «sem base»", leg[:60])
            tip = pg.evaluate("() => { let t = null; S.camadas.eachLayer(l => {"
                              " if (!t && l.getTooltip && l.getTooltip()) t = l.getTooltip().getContent(); });"
                              " return t; }")
            ok("Ensaios executados" in (tip or ""), "o tooltip diz o critério em uso",
               (tip or "")[:70])
            usa("servico")

            print("")
            print("8. AVANÇO PONDERADO POR EXTENSÃO, NÃO POR CONTAGEM DE CÉLULA")
            # o ultimo segmento do eixo e' a sobra (menos de 1 km). Marcado sozinho, ele nao
            # pode valer um quilometro inteiro: e' a diferenca entre «quantas celulas» e
            # «quanto da obra andou», e a palavra do cartao e' AVANCO.
            m = pg.evaluate("""() => {
                S.dados = {};
                document.querySelector('#kmIni').value = 0;
                document.querySelector('#kmIni').dispatchEvent(new Event('change'));
                document.querySelector('#kmFim').value = Math.ceil(S.segs[S.segs.length-1].fim);
                document.querySelector('#kmFim').dispatchEvent(new Event('change'));
                const ult = S.segs[S.segs.length - 1];
                linhasMatriz().forEach(l => { S.dados[chave(l, ult.id)] = 'C'; });
                render();
                const ids = segsNoTrecho().map(s => s.id);
                const a = avancoEm(ids);
                const kmTot = S.segs.reduce((x, s) => x + kmNoTrecho(s), 0);
                return {pct: a.pct, celulas: a.C / a.val, sobra: ult.ext, kmTot,
                        esperado: ult.ext / kmTot}; }""")
            ok(abs(m["pct"] - m["esperado"]) < 1e-6,
               "avanço = extensão concluída ÷ extensão do trecho",
               f"{m['pct']*100:.2f}% para sobra de {m['sobra']:.3f} km em {m['kmTot']:.2f} km")
            ok(m["celulas"] > m["pct"] * 1.5,
               "contar célula inflaria o número — é o viés que se está evitando",
               f"por célula seria {m['celulas']*100:.2f}%")

            print("")
            print("9. RECORTE EM KM QUEBRADO NÃO PERDE AS PONTAS")
            # a tela so aceita KM inteiro (`step=1`), mas o trecho tambem chega por projeto
            # salvo e por codigo. O que se prova aqui e a conta: `kmNoTrecho` tem de recortar
            # o segmento PARCIAL das pontas, senao a obra declarada de 5,80 km vira 5,00 km
            # na matriz e a diferenca nao aparece em lugar nenhum.
            q = pg.evaluate("""() => {
                S.kmIni = 12.5; S.kmFim = 18.3; render();
                const segs = segsNoTrecho();
                const medido = segs.reduce((a, s) => a + kmNoTrecho(s), 0);
                const cheios = segs.filter(s => s.ini >= S.kmIni && s.fim <= S.kmFim).length;
                return {declarado: S.kmFim - S.kmIni, medido, colunas: segs.length,
                        cheios: cheios}; }""")
            ok(abs(q["declarado"] - q["medido"]) < 1e-6,
               "a quilometragem contada é a obra declarada",
               f"declarado {q['declarado']:.2f} km · medido {q['medido']:.2f} km")
            ok(q["colunas"] == q["cheios"] + 2,
               "as pontas parciais entram como coluna, além dos quilômetros cheios",
               f"{q['colunas']} colunas · {q['cheios']} cheias")
            pg.evaluate("""() => { S.kmIni = 0;
                S.kmFim = S.segs[S.segs.length - 1].fim; render(); }""")

            print("")
            print("10. QUADRO DA OBRA E AVANÇO SOBRE O CONTRATADO")
            pg.click("#abas button[data-v='painel']")
            pg.wait_for_timeout(900)
            # innerText devolve o texto RENDERIZADO: `.grEns` é uppercase por CSS, então a
            # comparação tem de ser insensível a caixa — do contrário a prova reprovaria por
            # causa de folha de estilo, não de conteúdo.
            ok("QUADRO DA OBRA" in pg.inner_text("#vPainel").upper(),
               "o quadro por serviço abre o painel")
            # sem quantidade contratada informada, nao existe «% do contrato» — e o grafico
            # do contratado nao pode aparecer zerado: ausencia de base nao e zero por cento
            svgs = pg.eval_on_selector_all("#vPainel svg text",
                "es => es.map(e => e.textContent).filter(t => t.indexOf('contratado') >= 0)")
            ok(not svgs, "sem contratado informado, o gráfico do contratado não aparece")
            # a quantidade contratada mora no proprio servico (`km_contratado`), que e' de
            # onde `kmContratado()` a le — nao num saco separado de dados do contrato
            n = pg.evaluate("""() => {
                const q = quadroObra();
                if (!q.length) return null;
                S.svc[0].km_contratado = 20;              // 20 km contratados
                render();
                return {svc: S.svc[0].nome, tem: quadroObra()[0].pctContrato}; }""")
            pg.wait_for_timeout(700)
            t = pg.inner_text("#vPainel")
            ok(n is not None and n["tem"] is not None,
               "informar o contratado produz «% do contrato»",
               f"{n['svc']}: {n['tem']:.3f}" if n and n["tem"] is not None else "sem quadro")
            ok("AVANÇO SOBRE O CONTRATADO" in t.upper(),
               "e o gráfico do contratado passa a existir")
            ok("% DO CONTRATO" in t.upper(), "a coluna «% do contrato» entra no quadro")

        print(f"\nERROS DE CONSOLE: {len(console)}")
        for c in console[:6]:
            print("  ", c)
        print("\nRESULTADO:", "OK — o painel opera" if not falhas and not console
              else f"{len(falhas)} FALHA(S)")
        for f in falhas:
            print("   falhou:", f)
        return 1 if falhas or console else 0


if __name__ == "__main__":
    sys.exit(main())
