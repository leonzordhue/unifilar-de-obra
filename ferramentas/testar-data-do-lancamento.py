# -*- coding: utf-8 -*-
"""Prova ALVO da data no lancamento: escrita, preservacao, sobrevivencia e saida no CDE.

Ela nasce VERMELHA, de proposito, e e' o alvo da frente da Cortanna nesta rodada -- do mesmo
jeito que a `testar-contagem-km.py` do HAL9000 nasceu vermelha e virou o alvo da dele.

O que ela guarda nao e' «existe um campo de data». E' que o numero que a data vai produzir --
ritmo, e depois previsao -- nao seja construido sobre dado que se apaga sozinho. Tres buracos
mediram-se por leitura de codigo antes de existir implementacao, e cada um vira um bloco aqui:

  1. carimbar na ESCRITA e nao na MUDANCA: o clique gira o estado (CICLO), e a volta completa
     traz de volta o MESMO valor -- trocando uma data de junho pela de hoje sem nada mudar no
     dado. Perda silenciosa de historico.
  2. `S.datas` fora do `projetoAtual()`: a data vive so na aba aberta, e salvar/reabrir devolve
     todos os lancamentos com zero datas. O ritmo recomeca do zero sem avisar.
  3. sem coluna de data nos CSV: o zip e' o que chega ao ambiente comum de dados, e «257 km
     concluidos» sem dizer quando e' a foto parada de que o cliente reclamou.

E dois blocos que nasceram DEPOIS, de escrever a prova e de ver o produto andar:

  4. projeto anterior ao registro nao pode ganhar a data de hoje ao exportar -- senao 760
     lancamentos sem data viram 760 feitos hoje, e o ritmo da primeira semana e' o maior da
     obra inteira;
  5. `marcaKm` tem de ser o UNICO que escreve lancamento. Um quarto caminho escrevendo direto
     em `S.dados[...]` grava estado sem data, e o defeito so aparece no ritmo, meses depois.
     Guarda estatica: o defeito nasce ao escrever a linha, nao ao rodar a tela.

Formato acordado com a Cortanna em 23/08 04h20:
  S.datas[catId|servico|lado|km] = 'AAAA-MM-DD'   (data local, nao UTC)
  marcaKm(l, id, v): muda valor -> carimba; mesmo valor -> preserva; limpa -> apaga os dois
  projetoAtual(): datas    ·    aplicaProjeto(): S.datas = p.datas || {}
  CSV da matriz: coluna DATA    ·    CSV das faixas: coluna LANCADO_ATE (a mais recente)

Uso: python ferramentas/testar-data-do-lancamento.py
"""
import datetime
import functools
import glob
import http.server
import io
import os
import re
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


def nota(msg):
    print(f"  NOTA  {msg}")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    H = functools.partial(Q, directory=RAIZ)
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)      # porta 0, nunca fixa
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []
    hoje = datetime.date.today().isoformat()

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1600, "height": 950})
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" and not any(x in m.text for x in EXTERNO) else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)

        print("1. AS PECAS DO FORMATO EXISTEM")
        tem = pg.evaluate("""() => ({
            marcaKm: typeof marcaKm === 'function',
            datas: !!S.datas && typeof S.datas === 'object'
        })""")
        ok(tem["marcaKm"], "`marcaKm(l, id, v)` é o ponto único de escrita")
        ok(tem["datas"], "`S.datas` existe no estado")
        if not (tem["marcaKm"] and tem["datas"]):
            nota("ALVO ainda não implementado — os blocos seguintes não têm o que medir.")
            nota("Esta prova é o alvo da frente da Cortanna; ela fica vermelha até fechar.")
            print(f"\nRESULTADO: {len(falhas)} FALHA(S)")
            for f in falhas:
                print("   falhou:", f)
            nav.close()
            srv.shutdown()
            return 1

        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-151'));
            if (i >= 0){ sel.selectedIndex = i; sel.dispatchEvent(new Event('change')); }
        }""")
        pg.wait_for_timeout(2600)

        print("\n2. CARIMBA NA MUDANCA, E SO NA MUDANCA")
        r = pg.evaluate("""() => {
            const l = linhasMatriz()[0], id = S.segs[0].id, k = chave(l, id);
            S.dados = {}; S.datas = {};
            marcaKm(l, id, 'C');
            const novo = S.datas[k];
            S.datas[k] = '2026-06-01';                  // finge um lançamento antigo
            marcaKm(l, id, 'C');                        // MESMO valor: não pode carimbar
            const mesmo = S.datas[k];
            marcaKm(l, id, 'E');                        // valor diferente: tem de carimbar
            const trocado = S.datas[k];
            marcaKm(l, id, '');                         // limpar apaga os dois
            return {novo, mesmo, trocado, sobrouDado: k in S.dados, sobrouData: k in S.datas};
        }""")
        ok(r["novo"] == hoje, "marcar carimba a data de hoje", f"{r['novo']}")
        ok(r["mesmo"] == "2026-06-01",
           "marcar o MESMO valor preserva a data — o giro do ciclo não apaga histórico",
           f"{r['mesmo']} (esperado 2026-06-01)")
        ok(r["trocado"] == hoje, "mudar de valor carimba de novo", f"{r['trocado']}")
        ok(not r["sobrouDado"] and not r["sobrouData"],
           "limpar apaga estado e data juntos — nenhuma data órfã",
           f"dado={r['sobrouDado']} data={r['sobrouData']}")

        print("\n3. A DATA SOBREVIVE A SALVAR E REABRIR")
        r = pg.evaluate("""() => {
            const l = linhasMatriz()[0], id = S.segs[0].id, k = chave(l, id);
            S.dados = {}; S.datas = {};
            marcaKm(l, id, 'C');
            S.datas[k] = '2026-06-01';
            const p = JSON.parse(JSON.stringify(projetoAtual()));
            const noProjeto = !!(p.datas && p.datas[k]);
            S.dados = {}; S.datas = {};
            aplicaProjeto(p);
            return {noProjeto, depois: (S.datas || {})[k], chave: k};
        }""")
        pg.wait_for_timeout(1200)
        ok(r["noProjeto"], "`projetoAtual()` leva as datas")
        ok(r["depois"] == "2026-06-01",
           "reabrir devolve a data, e não o dia de hoje",
           f"{r['depois']} (esperado 2026-06-01)")

        print("\n4. A DATA SAI NOS DOIS CSV DO PACOTE CDE")
        r = pg.evaluate("""() => {
            const m = typeof textoCSV === 'function' ? textoCSV() : '';
            const f = typeof faixasCSV === 'function' ? faixasCSV() : '';
            return {cabM: m.split('\\r\\n')[0] || m.split('\\n')[0] || '',
                    cabF: f.split('\\r\\n')[0] || f.split('\\n')[0] || '',
                    corpoM: (m.split(/\\r?\\n/)[1] || '')};
        }""")
        ok("DATA" in r["cabM"].upper(),
           "o CSV da matriz tem coluna DATA", r["cabM"][:80])
        ok("LANCADO_ATE" in r["cabF"].upper().replace("Ç", "C").replace("Í", "I"),
           "o CSV das faixas tem coluna LANCADO_ATE", r["cabF"][:80])
        nota("LANCADO_ATE é a data MAIS RECENTE da faixa: uma faixa de 12 km não foi "
             "lançada num dia só, e a coluna não pode fingir que foi.")

        print("\n5. LANCAMENTO SEM DATA E DECLARADO, NAO CONTADO COMO HOJE")
        r = pg.evaluate("""() => {
            const l = linhasMatriz()[0], id = S.segs[1].id, k = chave(l, id);
            S.dados[k] = 'C';                    // projeto antigo: estado sem data
            delete S.datas[k];
            const m = typeof textoCSV === 'function' ? textoCSV() : '';
            const linha = m.split(/\\r?\\n/).find(x => x.indexOf(';C;') >= 0 || x.indexOf('Conclu') >= 0) || '';
            return {temDataHoje: linha.indexOf(new Date().toISOString().slice(0,10)) >= 0,
                    linha: linha.slice(0, 120)};
        }""")
        ok(not r["temDataHoje"],
           "quilômetro de projeto antigo não ganha a data de hoje no CSV",
           r["linha"] or "sem linha")

        print("\n6. `marcaKm` E O UNICO QUE ESCREVE LANCAMENTO")
        # O contrato inteiro da data repousa nisto. Se um quarto caminho escrever direto em
        # `S.dados[...]`, ele grava estado SEM data e ninguem percebe: a tela pinta, o projeto
        # salva, e so o ritmo sai errado -- meses depois, quando alguem for cobrar prazo.
        # Guarda ESTATICA de proposito: o defeito nasce ao escrever a linha, nao ao rodar a
        # tela, e uma prova de navegador so o pegaria se passasse justamente por aquele gesto.
        escrita = re.compile(r"(?:delete\s+)?S\.dados\[[^\]]*\]\s*=(?!=)"
                             r"|delete\s+S\.dados\[")
        fora = []
        for arq in sorted(glob.glob(os.path.join(RAIZ, "app", "*.js"))):
            nome = os.path.basename(arq)
            if nome == "08-persistencia.js":        # a casa do dado, onde `marcaKm` mora
                continue
            with io.open(arq, encoding="utf-8") as fh:
                for n, linha in enumerate(fh, 1):
                    if escrita.search(linha):
                        fora.append(f"{nome}:{n}  {linha.strip()[:70]}")
        ok(not fora,
           "nenhum módulo escreve em `S.dados` por fora do ponto único",
           "todos passam por marcaKm()" if not fora
           else f"{len(fora)} escrita(s) direta(s)")
        for f in fora[:6]:
            print("        ", f)

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
    print("RESULTADO: OK — a data é carimbada na mudança, sobrevive ao arquivo e chega ao CDE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
