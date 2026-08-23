# -*- coding: utf-8 -*-
"""Prova ORDEM POR ORDEM o que o cliente pediu na reprovacao de 23/08.

O Paulo reprovou a plataforma duas vezes. Na segunda ele foi item a item, e cada frase dele
virou uma asserção aqui, com a citação junto — para que ninguem precise lembrar o que foi
pedido, nem discutir se foi atendido: abre-se o arquivo e le-se a frase ao lado da medida.

Esta prova NAO substitui as outras. As outras medem se a plataforma esta certa; esta mede se
ela e a que ele pediu. Sao perguntas diferentes, e ja aconteceu de a primeira estar verde com
a segunda vermelha — foi exatamente essa a reprovacao de 23/08: dezenove portoes verdes e o
cliente dizendo «muito confuso, visualmente pobre».

Uso:  python ferramentas/testar-pedidos-do-cliente.py [--autoteste]
"""
import functools
import http.server
import io
import json
import os
import re
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.join(RAIZ, "11-CONTROLE AM-010",
                       "projeto-am-010-ct-00057-2022-seinfra.json")
AUTOTESTE = "--autoteste" in sys.argv
falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  -> {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(defeito=False):
    if not os.path.exists(PROJETO):
        print("projeto real do cliente nao encontrado:", PROJETO)
        return 1
    proj = json.load(io.open(PROJETO, encoding="utf-8"))
    srv = socketserver.TCPServer(("127.0.0.1", 0),
                                 functools.partial(Silencioso, directory=RAIZ))
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_context(viewport={"width": 1500, "height": 900}).new_page()
        pg.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2600)

        print('1. "quando digo que ta no KM 5 ele acha que tem 5km"')
        pg.evaluate("(pj) => { aplicaProjeto(pj); mostra('matriz'); }", proj)
        pg.wait_for_timeout(1800)
        if defeito:
            # AUTOTESTE: devolve a contagem por EXTENSAO somada, que e o defeito que ele
            # apontou. Se esta prova nao reprovar aqui, ela nao esta medindo a ordem dele.
            pg.evaluate("""() => { const o = quadroObra;
                window.quadroObra = () => o().map(q => ({...q, C: q.kmC})); }""")
        m = pg.evaluate("""() => {
            const q = quadroObra();
            const rem = q.find(x => x.svc.indexOf('REMENDO') === 0);
            return {inteiros: q.every(x => Number.isInteger(x.C) && Number.isInteger(x.E)),
                    remendo: rem ? rem.C : null}; }""")
        ok(m["inteiros"], "a contagem e em quilometro inteiro, nunca em extensao somada")
        # 257 e o numero que a equipe dele le na planilha: o KM 268 da AM-010 tem 62 m de
        # sobra e conta como um quilometro, igual a qualquer outra linha da planilha
        ok(m["remendo"] == 257, "REMENDO PROFUNDO conta 257 km, como na planilha da equipe",
           str(m["remendo"]))

        print('\n2. "as pinturas ja era pra ser feita por quadradinhos como se fosse uma planilha"')
        g = pg.evaluate("""() => {
            const mt = document.querySelector('#vMatriz'), pn = document.querySelector('#vPainel');
            const b = mt.getBoundingClientRect();
            return {celulas: mt.querySelectorAll('td.cel').length,
                    linhas: mt.querySelectorAll('tbody tr:not(.gr)').length,
                    topo: Math.round(b.top),
                    antesDoPainel: !!(pn && (mt.compareDocumentPosition(pn) & 4))}; }""")
        ok(g["celulas"] > 1000, "a grade tem uma celula por servico e quilometro",
           f"{g['celulas']} celulas em {g['linhas']} linhas")
        # a grade estava a 1.779 px de rolagem, atras de um painel de 1.684 px: existia e
        # ninguem via. «Antes do resumo» e a ordem no documento, nao a aparencia
        ok(g["antesDoPainel"], "e abre ANTES do resumo, nao atras dele")
        ok(g["topo"] < 400, "visivel sem rolar a tela", f"topo em {g['topo']} px")

        print('\n3. "nessa lista nao precisa constar rodovia planejada, elas nao existem, sao ideias"')
        a = pg.evaluate("""() => {
            const itens = [...document.querySelector('#selAcervo').options]
                .map(o => o.textContent);
            const txt = document.body.innerText.toLowerCase();
            return {n: itens.length,
                    soPlanejadas: itens.filter(t => /planejad/i.test(t) && !/implantad/i.test(t)),
                    avisa: txt.indexOf('planejadas ficam fora') >= 0}; }""")
        ok(not a["soPlanejadas"], "nenhuma rodovia so planejada na lista",
           f"{a['n']} rodovias" if not a["soPlanejadas"] else str(a["soPlanejadas"][:2]))
        ok(a["avisa"], "e a tela declara quantas ficaram fora, e por que")

        print('\n4. "quantidade contratada por servico por enquanto nao ... nao fazer a medicao agora"')
        t = pg.evaluate("() => document.body.innerText.toUpperCase()")
        ok("% DO CONTRATO" not in t, "a coluna «% do contrato» nao aparece")
        ok("SOBRE O CONTRATADO" not in t, "nem o grafico de avanco sobre o contratado")
        ok("QUANTIDADE CONTRATADA POR SERVI" not in t,
           "nem o campo de quantidade contratada na lateral")

        print('\n5. "os KM no mapa tem que ter uma linha preta de separacao"')
        pg.evaluate("() => mostra('mapa')")
        pg.wait_for_timeout(2500)
        mp = pg.evaluate("""() => { let divisas = 0, marcos = 0, casing = 0;
            S.camadas.eachLayer(l => { const o = l.options || {};
              if (o.divisa) divisas++; if (o.casing) casing++; if (o.icon) marcos++; });
            return {divisas, marcos, casing, segs: S.segs.length}; }""")
        ok(mp["divisas"] >= mp["segs"] - 1, "ha uma divisa desenhada em cada quilometro",
           f"{mp['divisas']} divisas para {mp['segs']} km")
        ok(mp["marcos"] > 0, "e marcos numerados dizendo em que quilometro se esta",
           f"{mp['marcos']} marcos")
        ok(mp["casing"] > 0, "o tracado tem contorno escuro e nao some no satelite",
           f"{mp['casing']} segmentos contornados")

        print('\n6. "o tracado dividido a cada 1km, a tabela de resumo embaixo do mapa e a'
              ' extensao total"')
        pg.evaluate("() => { S.kmIni = 10; S.kmFim = 40; render(); mostra('croqui'); }")
        pg.wait_for_timeout(4500)
        cq = pg.evaluate("""() => { const i = document.querySelector('#vCroqui img');
            return {tem: !!(i && i.src.indexOf('data:image') === 0),
                    alt: i ? i.naturalHeight : 0, larg: i ? i.naturalWidth : 0}; }""")
        ok(cq["tem"], "o croqui e gerado como imagem, para entrar no relatorio")
        # a faixa de resumo entra ABAIXO do mapa, dentro da mesma imagem: por isso o desenho
        # e mais alto que largo. Aferir assim evita depender de OCR sobre o canvas
        ok(cq["alt"] > cq["larg"], "com a faixa de resumo abaixo do mapa, na mesma imagem",
           f"{cq['larg']}x{cq['alt']} px")
        fonte = io.open(os.path.join(RAIZ, "app", "05-croqui.js"), encoding="utf-8").read()
        ok("extensão total do eixo" in fonte, "e a extensao total do eixo escrita na faixa")

        print('\n7. "a parte de relatorio ficou bom, gostei" — o que ele aprovou nao pode piorar')
        pg.evaluate("() => mostra('rel')")
        pg.wait_for_timeout(2500)
        rel = pg.evaluate("""() => { const v = document.querySelector('#vRel');
            const t = v.innerText.toUpperCase();
            return {svg: v.querySelectorAll('svg').length,
                    controle: t.indexOf('CONTROLE DA OBRA') >= 0, texto: t}; }""")
        # RENAME NAO BASTA. Aferir so o titulo deixa passar «renomear a secao e pronto» —
        # aviso do jarvisIV, e ele tem razao: reconhecer a aba e metade do pedido, a outra
        # metade e o quadro nao mentir. As colunas tem de estar nos nomes que a equipe usa,
        # e o quadro tem de dizer sobre QUE trecho esta falando: foi por nao declarar o
        # trecho que a erosao apareceu com 262,5% as 12h05.
        ok(rel["controle"], "o quadro se identifica como CONTROLE DA OBRA")
        ok(all(c in rel["texto"] for c in ("SEM PLANEJAMENTO", "SALDO PLANEJADO",
                                           "EM ANDAMENTO", "REALIZADO")),
           "com as colunas da aba deles, nos nomes deles")
        ok(bool(re.search(r"KM\s*[\d.,]+\s*(a|-|–)\s*[\d.,]+", rel["texto"])),
           "e declara qual trecho esta contando")

        print('\n8. O CLIENTE ABRIU E NAO TINHA MAPA - o caminho real, sem esperar')
        # 23/08: ele carregou o eixo e foi direto ao Relatorio. O croqui e montado em segundo
        # plano e demora alguns segundos; quem abre antes recebia o documento SEM a secao
        # «Localizacao do trecho», e ela nunca chegava depois. Medido na epoca: 1,2 s apos o
        # eixo -> 0 imagem; 7 s apos -> 1 imagem. O MESMO documento, dois conteudos, decididos
        # por quanto a pessoa demorou a clicar. A suite inteira estava verde.
        pg.evaluate("() => location.reload()")
        pg.wait_for_timeout(2600)
        pg.evaluate("""() => { const s = document.querySelector('#selAcervo');
            const o = [...s.options].find(x => x.textContent.indexOf('AM-239') === 0);
            if (o){ s.value = o.value; s.dispatchEvent(new Event('change')); } }""")
        pg.wait_for_timeout(900)          # o cliente nao espera o croqui: clica
        pg.evaluate("() => mostra('rel')")
        pg.wait_for_timeout(9000)         # e depois olha o documento
        img = pg.evaluate("() => document.querySelectorAll('#vRel img').length")
        ok(img >= 1, "o relatorio traz o mapa mesmo quando aberto antes de o croqui ficar pronto",
           f"{img} imagem(ns)")

        # e o nome digitado tem de chegar ao documento ja aberto: na captura dele o campo
        # dizia «AM-020» e o cabecalho do relatorio dizia «AM-239», que e o nome do EIXO
        nome = pg.evaluate("""() => { const i = document.querySelector('#nomeObra');
            i.value = 'AM-020 — teste'; i.dispatchEvent(new Event('input'));
            return null; }""")
        pg.wait_for_timeout(1200)
        cab = pg.evaluate("() => document.querySelector('#vRel').innerText.slice(0, 400)")
        ok("AM-020" in cab, "e o nome digitado da obra chega ao documento ja aberto",
           "AM-020" if "AM-020" in cab else cab.split(chr(10))[2][:60])


        nav.close()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:5]:
        print("  ", c)
    print("\nRESULTADO:", "OK — a plataforma e a que ele pediu" if not falhas and not console
          else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


def autoteste():
    """Prova que a prova reprova: devolve a contagem por extensao, o defeito original."""
    print("AUTOTESTE — quadro contando extensao somada, que foi o que ele reprovou\n")
    falhas.clear()
    main(defeito=True)
    pegou = bool(falhas)
    print("\n   " + ("OK    a prova reprova o defeito que o cliente apontou"
                     if pegou else "FALHA a prova NAO pegou o defeito do cliente"))
    return 0 if pegou else 1


if __name__ == "__main__":
    sys.exit(autoteste() if AUTOTESTE else main())
