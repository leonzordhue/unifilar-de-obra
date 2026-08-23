# -*- coding: utf-8 -*-
"""Prova os caminhos que a prova de interface nao cobre.

A prova de interface percorre o caminho principal — rodovia do acervo, matriz, croqui,
relatorio. Aqui ficam os caminhos que um usuario percorre e que, se quebrarem, quebram
calados: carregar KMZ e KML, salvar e reabrir um projeto, exportar CSV, deslocar o
estaqueamento, escolher ramal, escolher rodovia com descontinuidade no tracado, e comecar
de novo. Cada um e operado num Chromium de verdade e conferido por numero.

Uso:  python ferramentas/testar-fluxos.py
"""
import functools
import http.server
import io
import json
import os
import socketserver
import sys
import threading
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(RAIZ, "ferramentas", "_temp")
# Porta EFEMERA, de proposito. Porta fixa + allow_reuse_address deixava duas
# provas simultaneas subirem servidor na mesma porta, e o Chromium de uma era
# atendido pelo servidor da outra — a prova media a copia achando que media o
# produto. Com porta 0 o SO escolhe uma livre; a porta real sai de
# srv.server_address[1] depois de subir.
PORTA = 0

falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def monta_arquivos():
    """Gera um KML e um KMZ a partir do acervo, para o teste usar traçado real."""
    os.makedirs(TMP, exist_ok=True)
    acv = json.load(io.open(os.path.join(RAIZ, "dados", "acervo-rodovias-estaduais.json"),
                            encoding="utf-8"))
    it = next(i for i in acv["itens"] if i["nome"] == "AM-070")
    linhas = "".join(
        "<Placemark><name>AM-070 parte %d</name><LineString><coordinates>%s"
        "</coordinates></LineString></Placemark>"
        % (k, " ".join(f"{x},{y},0" for x, y in c))
        for k, c in enumerate(it["linhas"]))
    kml = ('<?xml version="1.0" encoding="UTF-8"?>'
           '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
           '<name>AM-070 (teste)</name>' + linhas + '</Document></kml>')
    pk = os.path.join(TMP, "eixo-teste-am-070.kml")
    io.open(pk, "w", encoding="utf-8", newline="\n").write(kml)
    pz = os.path.join(TMP, "eixo-teste-am-070.kmz")
    with zipfile.ZipFile(pz, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", kml)
    return pk, pz, it["km_geometria"]


def main():
    kml, kmz, km_ref = monta_arquivos()
    print(f"arquivos de teste: AM-070 com {km_ref:.3f} km de geometria\n")
    H = functools.partial(Silencioso, directory=RAIZ)
    srv = socketserver.TCPServer(("127.0.0.1", PORTA), H)
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console, baixados = [], []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1600, "height": 950},
                              accept_downloads=True)
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if (m.type == "error" and "arcgisonline" not in m.text
                  and "Failed to load resource" not in m.text) else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        # A imagem de satelite e' de servidor externo (Esri World Imagery) e o
        # croqui degrada para fundo neutro quando ela nao vem — isso esta no
        # README e nao e' defeito da plataforma. Sem este filtro, rodar sem rede
        # gerava 24 "erros" de tile e escondia o que importa. O que NAO e' tile
        # continua contando: 404 de arquivo local e defeito de verdade.
        EXTERNO = ("arcgisonline.com", "server.arcgisonline")

        def externo(url):
            return any(h in url for h in EXTERNO)

        pg.on("requestfailed", lambda r: None if externo(r.url)
              else console.append(f"[requestfailed] {r.url[:120]}"))
        pg.on("response", lambda r: None if (r.status < 400 or externo(r.url))
              else console.append(f"[http {r.status}] {r.url[:120]}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2200)

        print("1. BIBLIOTECAS SERVIDAS DA PRÓPRIA PASTA")
        ok(pg.evaluate("typeof L") == "object" and pg.evaluate("typeof JSZip") == "function",
           "Leaflet e JSZip carregam sem CDN")
        # o atributo, não a propriedade: `e.src` resolve para http://127.0.0.1 e daria
        # falso positivo em qualquer recurso, inclusive nos locais
        # Só o CÓDIGO da página: a imagem de satélite é, por definição, de servidor externo
        # (Esri World Imagery), e o croqui degrada para fundo neutro quando ela não vem.
        externos = pg.evaluate("""[...document.querySelectorAll('script[src],link[href]')]
             .map(e => e.getAttribute('src') || e.getAttribute('href'))
             .filter(u => /^https?:/i.test(u || ''))""")
        ok(not externos, "nenhum script ou folha de estilo vem de servidor externo",
           ", ".join(externos)[:80] if externos else "todos locais")

        print("\n2. KMZ")
        pg.evaluate("document.querySelector(\"#segFonte button[data-f='arquivo']\").click()")
        pg.wait_for_timeout(400)
        pg.set_input_files("#fileGeo", kmz)
        pg.wait_for_timeout(3500)
        ext = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)")
        nome = pg.evaluate("S.eixo ? S.eixo.nome : ''")
        ok(abs(ext - km_ref) < 0.01, "KMZ lido e dividido com a mesma extensão do acervo",
           f"{ext:.3f} km (acervo {km_ref:.3f})")
        ok(nome != "", "nome do eixo vem do arquivo", nome)
        sent = pg.evaluate("document.querySelector('#dicaSentido').textContent")
        ok("não verificado" in sent, "KMZ avisa que o sentido não foi verificado",
           sent.strip()[:70])

        print("\n3. KML SOLTO")
        pg.set_input_files("#fileGeo", kml)
        pg.wait_for_timeout(3500)
        ext2 = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)")
        ok(abs(ext2 - km_ref) < 0.01, "KML lido com a mesma extensão", f"{ext2:.3f} km")

        print("\n4. ESTACA INICIAL DESLOCADA")
        pg.evaluate("""() => {
            document.querySelector("#segRef button[data-r='est']").click();
            const e = document.querySelector('#estOff');
            e.value = 1200; e.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1200)
        pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
        pg.wait_for_timeout(1200)
        # 7 colunas fixas antes do primeiro quilômetro: Serviço/lado, C, E, PA, S, NA, %.
        # Eram 6 até 23/08, quando «PA» virou coluna própria — paralisado estava sendo somado
        # em «previsto», e obra que parou não é obra que vai acontecer.
        rot = pg.evaluate("""[...document.querySelectorAll('#vMatriz thead th')]
            .slice(7, 10).map(e => e.textContent.trim())""")
        # o cabecalho agora nomeia a posicao («E 1.200» em vez de «1200»), porque numero nu
        # era o que fazia ler posicao como quantidade. A conta medida aqui e a mesma.
        limpa = [r.replace("E", "").replace(" ", " ").replace(".", "").strip() for r in rot]
        ok(limpa == ["1200", "1250", "1300"],
           "estaca inicial desloca todas as colunas", " ".join(rot))
        ok(all(r.strip().startswith("E") for r in rot),
           "e o cabecalho diz que aquilo e estaca, nao quantidade", " ".join(rot))
        pg.evaluate("""() => {
            const e = document.querySelector('#estOff');
            e.value = 0; e.dispatchEvent(new Event('input'));
            document.querySelector("#segRef button[data-r='km']").click();
        }""")
        pg.wait_for_timeout(900)

        print("\n5. EXPORTAR CSV")
        pg.evaluate("""() => {
            for (let k = 0; k < 5; k++){
                const c = document.querySelector(`#vMatriz td.cel[data-id="${k}"]`);
                if (c) c.click();
            }
        }""")
        pg.wait_for_timeout(600)
        with pg.expect_download() as d:
            pg.evaluate("document.querySelector('#btCSV').click()")
        arq = d.value
        alvo = os.path.join(TMP, "exportado.csv")
        arq.save_as(alvo)
        txt = io.open(alvo, encoding="utf-8-sig", newline="").read()
        linhas_csv = [l for l in txt.split("\n") if l.strip()]
        cab = linhas_csv[0].split(";")
        ok(len(linhas_csv) > 20 and "KM 0" in txt,
           "CSV sai com cabeçalho por quilômetro",
           f"{len(linhas_csv)} linha(s) × {len(cab)} coluna(s)")
        ok(txt.count("Concluído") >= 5, "os lançamentos aparecem no CSV",
           f"{txt.count('Concluído')} célula(s) concluída(s)")

        print("\n6. SALVAR E REABRIR")
        marcadas = pg.evaluate("Object.keys(S.dados).length")
        pg.evaluate("""() => {
            document.querySelector('#nomeObra').value = 'Obra de teste — AM-070';
            const a = document.querySelector('#kmIni'), b = document.querySelector('#kmFim');
            a.value = 5; a.dispatchEvent(new Event('input'));
            b.value = 30; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1200)
        with pg.expect_download() as d:
            pg.evaluate("document.querySelector('#btSalvar').click()")
        proj = os.path.join(TMP, "projeto-salvo.json")
        d.value.save_as(proj)
        dados = json.load(io.open(proj, encoding="utf-8"))
        ok(isinstance(dados, dict) and dados.get("dados"),
           "arquivo de projeto salvo com os lançamentos",
           f"{len(json.dumps(dados)) // 1024} KB · {len(dados.get('dados', {}))} lançamento(s)")
        pg.evaluate("document.querySelector('#btNovo').click()")
        pg.wait_for_timeout(1200)
        ok(pg.evaluate("!S.eixo") and pg.evaluate("Object.keys(S.dados).length") == 0,
           "«Novo» limpa o eixo e os lançamentos")
        pg.set_input_files("#fileProjeto", proj)
        pg.wait_for_timeout(3500)
        ok(pg.evaluate("Object.keys(S.dados).length") == marcadas,
           "reabrir devolve os mesmos lançamentos",
           f"{pg.evaluate('Object.keys(S.dados).length')} de {marcadas}")
        ok(pg.evaluate("[S.kmIni, S.kmFim]") == [5, 30], "reabrir devolve o trecho",
           str(pg.evaluate("[S.kmIni, S.kmFim]")))
        ok(pg.evaluate("document.querySelector('#nomeObra').value") == "Obra de teste — AM-070",
           "reabrir devolve a identificação da obra")
        ok(abs(pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)") - km_ref) < 0.01,
           "reabrir devolve o traçado íntegro")

        print("\n7. RODOVIA COM DESCONTINUIDADE (AM-254)")
        pg.evaluate("document.querySelector(\"#segFonte button[data-f='rodovia']\").click()")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-254'));
            sel.selectedIndex = i; sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(3000)
        info = pg.evaluate("document.querySelector('#infoTopo').textContent")
        n = pg.evaluate("S.segs.length")
        ext3 = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)")
        ok(abs(ext3 - 307.474) < 0.05, "extensão da AM-254 sem somar o vazio",
           f"{ext3:.3f} km em {n} segmento(s)")
        pg.evaluate("document.querySelector(\".abas button[data-v='rel']\").click()")
        pg.wait_for_timeout(2500)
        rel = pg.evaluate("document.querySelector('#vRel').textContent")
        # A AM-254 tem 6 trechos de cadastro contíguos: depois da correção da costura,
        # nenhuma rodovia do acervo tem vazio no traçado. O relatório não deve inventar um.
        ok(pg.evaluate("(S.eixo.meta.saltos_km || []).length") == 0
           and "Descontinuidade" not in rel,
           "sem descontinuidade no acervo, o relatório não declara nenhuma")
        ok("Origem da quilometragem" in rel, "relatório declara a origem do KM 0")

        print("\n8. RAMAL")
        pg.evaluate("document.querySelector(\"#segFonte button[data-f='ramal']\").click()")
        pg.wait_for_timeout(3500)
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            sel.selectedIndex = 0; sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)
        nome_r = pg.evaluate("S.eixo ? S.eixo.nome : ''")
        ext4 = pg.evaluate("S.segs.reduce((a, s) => a + s.ext, 0)")
        ok(ext4 > 0 and pg.evaluate("S.segs.length") >= 1, "ramal dividido por quilômetro",
           f"{nome_r} · {ext4:.3f} km em {pg.evaluate('S.segs.length')} segmento(s)")
        sr = pg.evaluate("document.querySelector('#dicaSentido').textContent")
        ok("ponto de início" in sr, "ramal declara o KM 0 no ponto de início do cadastro",
           sr.strip()[:70])
        pg.evaluate("document.querySelector(\".abas button[data-v='croqui']\").click()")
        pg.wait_for_timeout(12000)
        img = pg.evaluate("""() => { const i = document.querySelector('#vCroqui img');
            return i ? i.naturalWidth + 'x' + i.naturalHeight : ''; }""")
        ok(img != "", "croqui do ramal gerado", img)

        print("\n9. TRECHO INVERTIDO E FORA DE FAIXA")
        pg.evaluate("""() => {
            const sel = document.querySelector("#segFonte button[data-f='rodovia']");
            sel.click();
        }""")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-070'));
            sel.selectedIndex = i; sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => {
            const a = document.querySelector('#kmIni'), b = document.querySelector('#kmFim');
            a.value = 60; a.dispatchEvent(new Event('input'));
            b.value = 20; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1500)
        ok(pg.evaluate("S.kmIni <= S.kmFim"),
           "KM inicial maior que o final não passa", str(pg.evaluate("[S.kmIni, S.kmFim]")))
        pg.evaluate("""() => {
            const b = document.querySelector('#kmFim');
            b.value = 9999; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1200)
        ok(pg.evaluate("S.kmFim") <= 84, "KM final além do eixo é limitado à extensão",
           str(pg.evaluate("S.kmFim")))

        print("\n9b. TRECHO FRACIONÁRIO")
        # a plataforma passou a medir o pedaço do quilômetro que é obra; o campo tinha
        # step="1" e recusava a fração, então o caso nunca era exercitado de verdade
        pg.evaluate("""() => {
            const a = document.querySelector('#kmIni'), b = document.querySelector('#kmFim');
            a.value = 12.5; a.dispatchEvent(new Event('input'));
            b.value = 18.3; b.dispatchEvent(new Event('input'));
        }""")
        pg.wait_for_timeout(1400)
        faixa = pg.evaluate("[S.kmIni, S.kmFim]")
        ok(faixa == [12.5, 18.3], "o campo aceita KM com fração", str(faixa))
        med = pg.evaluate("segsNoTrecho().reduce((a, s) => a + kmNoTrecho(s), 0)")
        ok(abs(med - 5.8) < 0.02, "a extensão medida é a do trecho declarado",
           f"{med:.3f} km de 5,800 declarados")
        pontas = pg.evaluate("""() => {
            const s = segsNoTrecho();
            return [kmNoTrecho(s[0]), kmNoTrecho(s[s.length - 1])];
        }""")
        ok(abs(pontas[0] - 0.5) < 0.02 and abs(pontas[1] - 0.3) < 0.02,
           "o quilômetro da ponta entra pelo pedaço que é obra",
           f"{pontas[0]:.3f} km na primeira ponta · {pontas[1]:.3f} km na última")
        val = pg.evaluate("document.querySelector('#kmIni').validity.valid")
        ok(val, "o navegador não reprova a fração no campo")

        print("\n10. NENHUM SERVIÇO MARCADO")
        pg.evaluate("document.querySelector('#btNenhum').click()")
        pg.wait_for_timeout(1000)
        pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
        pg.wait_for_timeout(900)
        av = pg.evaluate("document.querySelector('#vMatriz').textContent")
        ok(len(av.strip()) > 10, "matriz sem serviço mostra aviso, não tabela vazia",
           av.strip()[:60])
        pg.evaluate("document.querySelector(\".abas button[data-v='rel']\").click()")
        pg.wait_for_timeout(1200)
        ok(pg.evaluate("document.querySelectorAll('#vRel').length") == 1,
           "relatório sem serviço não quebra")

        print("\n11. TROCA DE CATÁLOGO — o lançamento vaza entre obras? (J5)")
        # BASE e IMPRIMACAO existem nos DOIS catalogos, com o mesmo nome e os
        # mesmos lados. A chave do lancamento e `nome|lado|id do segmento`
        # (app/06-matriz.js:11), sem o catalogo. Entao a pergunta nao e' de
        # opiniao: marca-se no catalogo A, troca-se para B e olha-se se a marca
        # esta la. Quem escreveu o seletor pediu para nao ser quem prova isso.
        pg.evaluate("""() => {
            document.querySelector("#segFonte button[data-f='rodovia']").click();
        }""")
        pg.wait_for_timeout(500)
        pg.evaluate("""() => {
            const s = document.querySelector('#selAcervo');
            const o = [...s.options].find(x => x.textContent.includes('AM-070'));
            s.value = o.value; s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)

        # garante o catalogo de RECUPERACAO e marca BASE|LD no primeiro segmento
        pg.evaluate("""() => {
            const s = document.querySelector('#selCat');
            s.value = 'recuperacao'; s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(1200)
        marcou = pg.evaluate("""() => {
            const l = linhasMatriz().find(x => x.svc === 'BASE' && x.lado === 'LD');
            if (!l) return null;
            const id = S.segs[0].id;
            // chave(l, id) e' a funcao do PRODUTO (app/06-matriz.js), no escopo
            // global da pagina. Montar a chave a mao aqui fazia a prova medir a si
            // mesma: no formato antigo ela injetava chave orfa e depois a achava.
            const k = chave(l, id);
            S.dados[k] = 'C';
            return { chave: k, total: Object.keys(S.dados).length };
        }""")
        ok(marcou is not None, "BASE|LD existe no catálogo de recuperação",
           marcou["chave"] if marcou else "não achou a linha")

        # troca para IMPLANTACAO e olha se a marca sobreviveu
        vaza = pg.evaluate("""() => {
            const s = document.querySelector('#selCat');
            s.value = 'implantacao'; s.dispatchEvent(new Event('change'));
            return null;
        }""")
        pg.wait_for_timeout(1500)
        depois = pg.evaluate("""() => {
            const cat = S.catId || (document.querySelector('#selCat') || {}).value;
            const l = linhasMatriz().find(x => x.svc === 'BASE' && x.lado === 'LD');
            const id = S.segs[0].id;
            const k = l ? chave(l, id) : null;
            return { cat, achou: !!l, marcado: k ? (S.dados[k] || null) : null,
                     nLanc: Object.keys(S.dados).length,
                     pct: l ? resumoLinha(l).pct : null };
        }""")
        ok(depois["cat"] == "implantacao", "catálogo trocou para implantação",
           str(depois["cat"]))
        vazou = depois["achou"] and depois["marcado"] == "C"
        ok(not vazou,
           "lançamento de BASE feito na RECUPERAÇÃO não aparece na IMPLANTAÇÃO",
           ("VAZOU: a marca sobreviveu à troca (%s lançamento(s), linha em %s%%)"
            % (depois["nLanc"], depois["pct"])) if vazou
           else "não vazou")

        # e um servico que existe SO num catalogo nao pode aparecer no outro
        so_um = pg.evaluate("""() => {
            const nomes = linhasMatriz().map(x => x.svc);
            return { temCBUQ: nomes.includes('CBUQ'),
                     temEROSOES: nomes.some(n => n.startsWith('EROS')) };
        }""")
        ok(so_um["temCBUQ"] and not so_um["temEROSOES"],
           "a matriz mostra só os serviços do catálogo escolhido",
           f"CBUQ={so_um['temCBUQ']} EROSOES={so_um['temEROSOES']}")

        print("\n12. REPINTURA PARCIAL x REPINTURA COMPLETA (otimização da matriz)")
        # O clique repinta só o que mudou. Se esquecer de atualizar algo, a tela
        # divergi do dado em silêncio. Aqui o DOM do caminho rápido é comparado
        # com o DOM de um pintaMatriz() completo — tem de dar igual.
        pg.evaluate("""() => {
            document.querySelector("#segFonte button[data-f='rodovia']").click();
        }""")
        pg.wait_for_timeout(500)
        pg.evaluate("""() => {
            const s = document.querySelector('#selAcervo');
            const o = [...s.options].find(x => x.textContent.includes('AM-070'));
            s.value = o.value; s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2600)
        pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
        pg.wait_for_timeout(1500)

        # retrato do DOM que interessa: texto e cor de cada célula, os totais de
        # cada linha e o rodapé de cada coluna
        RETRATO = """() => {
            const cels = [...document.querySelectorAll('#vMatriz td.cel')].map(td =>
                td.dataset.l + '|' + td.dataset.id + '|' + td.textContent.trim() +
                '|' + td.style.background);
            const tot = [...document.querySelectorAll('#vMatriz tbody tr')].map(tr =>
                [...tr.querySelectorAll('td:not(.cel)')].map(x => x.textContent.trim()).join(','));
            const pe = [...document.querySelectorAll('#vMatriz tfoot td')].map(x =>
                x.textContent.trim());
            return JSON.stringify({cels, tot, pe});
        }"""

        # caminho RÁPIDO: cliques de verdade, incluindo uma faixa com shift
        pg.evaluate("""() => {
            const q = i => document.querySelector(`#vMatriz td.cel[data-l="0"][data-id="${i}"]`);
            [2, 3, 7].forEach(i => { const c = q(i); if (c) c.click(); });
            const a = q(10), b = q(14);
            if (a) a.click();
            if (b) b.dispatchEvent(new MouseEvent('click', {shiftKey: true, bubbles: true}));
            const outra = document.querySelector('#vMatriz td.cel[data-l="3"][data-id="5"]');
            if (outra) { outra.click(); outra.click(); }
        }""")
        pg.wait_for_timeout(1200)
        rapido = pg.evaluate(RETRATO)
        lanc = pg.evaluate("Object.keys(S.dados).length")

        # agora o caminho COMPLETO, sobre o MESMO estado
        pg.evaluate("pintaMatriz()")
        pg.wait_for_timeout(1200)
        completo = pg.evaluate(RETRATO)

        ok(lanc > 0, "os cliques do teste lançaram de fato", f"{lanc} lançamento(s)")
        if rapido == completo:
            ok(True, "repintura parcial idêntica à repintura completa",
               "célula, totais da linha e rodapé")
        else:
            import json as _j
            a, b = _j.loads(rapido), _j.loads(completo)
            det = []
            dif = [(x, y) for x, y in zip(a["cels"], b["cels"]) if x != y]
            if len(a["cels"]) != len(b["cels"]):
                det.append(f'nº de células {len(a["cels"])} vs {len(b["cels"])}')
            if dif:
                det.append(f'{len(dif)} célula(s), ex.: {dif[0][0]} vs {dif[0][1]}')
            if a["tot"] != b["tot"]:
                d2 = [(x, y) for x, y in zip(a["tot"], b["tot"]) if x != y]
                det.append(f'totais de linha divergem: {d2[:2]}')
            if a["pe"] != b["pe"]:
                det.append(f'rodapé divergе: {a["pe"][:4]} vs {b["pe"][:4]}')
            ok(False, "repintura parcial idêntica à repintura completa",
               " · ".join(det) or "diferença não localizada")

        ctx.close()
        nav.close()
    srv.shutdown()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:10]:
        print("   ", c[:160])
    print("\nRESULTADO:", f"{len(falhas)} FALHA(S)" if falhas or console
          else "OK — todos os fluxos operaram")
    for f in falhas:
        print("   falhou:", f)
    return 1 if (falhas or console) else 0


if __name__ == "__main__":
    sys.exit(main())
