# -*- coding: utf-8 -*-
"""O que sai da plataforma para fora dela: pacote de exportacao e folha impressa.

Substitui a `testar-cde.py` e a `testar-impressao.py`, apagadas em 24/08. As duas mediam um
DOSSIE DE FISCALIZACAO — ensaios em CSV, fotos numeradas, laudo, norma de referencia,
miniatura de foto no anexo — e o controle tecnologico saiu inteiro por ordem do cliente:
«nao e isso que eu preciso». Prova que guarda funcao removida por ordem trava a equipe.

O que sobrou vale, e e isto que se afere aqui: o cliente tem de poder LEVAR O TRABALHO PARA
FORA. Planilha em CSV, tracado em GeoJSON e KML, croqui em PNG, o projeto reabrivel e um
LEIA-ME que explica o pacote a quem nunca abriu a plataforma. E o relatorio tem de caber na
folha, porque e ele que instrui processo.

Uso:  python ferramentas/testar-exportacao.py [--autoteste]
"""
import csv
import functools
import http.server
import io
import os
import socketserver
import sys
import threading
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(RAIZ, "ferramentas", "_temp")
AUTOTESTE = "--autoteste" in sys.argv
falhas = []

# o que o pacote TEM de trazer. `04-ensaios.csv` saiu da lista em 24/08 junto com os ensaios.
ARQUIVOS = ["projeto.json", "01-eixo.geojson", "02-eixo.kml", "03-matriz-de-controle.csv",
            "05-croqui.png", "06-faixas.csv", "LEIA-ME.txt"]


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  -> {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# um cenario pequeno e real: eixo do acervo, quatro servicos, alguns quilometros pintados
CENARIO = """() => {
  const s = document.querySelector('#selAcervo');
  const o = [...s.options].find(x => x.textContent.indexOf('AM-151') === 0);
  s.value = o.value; s.dispatchEvent(new Event('change'));
}"""

PINTA = """() => {
  const svc = S.svc.filter(x => x.on).slice(0, 3).map(x => x.nome);
  const segs = S.segs.slice(0, 5);
  svc.forEach((nome, i) => segs.forEach((sg, j) => {
    if (j <= i + 1) marcaKm({svc: nome, lado: 'U'}, sg.id, j === 0 ? 'C' : 'E');
  }));
  render();
  return {lanc: Object.keys(S.dados).length, segs: S.segs.length};
}"""


def main(defeito=False):
    os.makedirs(TMP, exist_ok=True)
    srv = socketserver.TCPServer(("127.0.0.1", 0),
                                 functools.partial(Silencioso, directory=RAIZ))
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []
    zipe = os.path.join(TMP, "pacote-exportacao.zip")
    pdf = os.path.join(TMP, "relatorio.pdf")
    for f in (zipe, pdf):
        if os.path.exists(f):
            os.remove(f)

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1500, "height": 900},
                              accept_downloads=True)
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(str(e)))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2600)
        pg.evaluate(CENARIO)
        pg.wait_for_timeout(3000)
        na_tela = pg.evaluate(PINTA)
        pg.wait_for_timeout(800)
        print(f"   na tela: {na_tela['segs']} quilômetro(s) · {na_tela['lanc']} lançamento(s)\n")

        print("1. O PACOTE SAI COM O QUE O CLIENTE PRECISA LEVAR")
        if defeito:
            # AUTOTESTE: some com o CSV da matriz dentro do zip. E o arquivo que carrega o
            # trabalho inteiro — se a prova nao reprovar aqui, ela nao esta olhando o pacote.
            pg.evaluate("""() => { const o = textoCSV; window.textoCSV = () => ''; }""")
        with pg.expect_download(timeout=90000) as d:
            pg.evaluate("() => { const b = document.querySelector('#btExportar'); if (b) b.click(); }")
            pg.wait_for_timeout(300)
            pg.evaluate("() => document.querySelector('#btCDE').click()")
        d.value.save_as(zipe)
        pg.wait_for_timeout(500)
        with zipfile.ZipFile(zipe) as z:
            nomes = z.namelist()
            faltando = [a for a in ARQUIVOS if a not in nomes]
            ok(not faltando, "o pacote traz os sete arquivos da exportação",
               "todos" if not faltando else "faltou: " + ", ".join(faltando))
            sobrando = [n for n in nomes if "ensaio" in n.lower() or n.startswith("fotos/")]
            ok(not sobrando, "e nenhum resto do controle tecnológico",
               "nenhum" if not sobrando else ", ".join(sobrando[:3]))
            if "03-matriz-de-controle.csv" in nomes:
                mat = z.read("03-matriz-de-controle.csv").decode("utf-8-sig").splitlines()
                ok(len(mat) > 3 and mat[0].startswith("SERVICO;"),
                   "a planilha vai em CSV, com uma linha por serviço",
                   f"{len(mat)} linha(s)")
                # sem lado, o cabecalho nao tem coluna LADO: o servico e do quilometro
                ok("LADO" not in mat[0].upper().split(";"),
                   "sem coluna de lado — o serviço é do quilômetro")
            if "LEIA-ME.txt" in nomes:
                leia = z.read("LEIA-ME.txt").decode("utf-8")
                ok("ensaio" not in leia.lower(),
                   "o LEIA-ME não promete ensaio que a plataforma não tem mais")
                ok("REABRIR" in leia.upper(),
                   "e explica como reabrir o trabalho")

        print("\n2. O RELATÓRIO CABE NA FOLHA")
        pg.evaluate("() => mostra('rel')")
        pg.wait_for_timeout(7000)
        pg.pdf(path=pdf, format="A4", print_background=True,
               margin={"top": "14mm", "bottom": "14mm", "left": "12mm", "right": "12mm"})
        bruto = io.open(pdf, "rb").read()
        paginas = bruto.count(b"/Type /Page") or bruto.count(b"/Type/Page")
        ok(0 < paginas <= 8, "o relatório cabe em até oito páginas A4",
           f"{paginas} página(s)")
        img = pg.evaluate("() => document.querySelectorAll('#vRel img').length")
        ok(img >= 1, "com o croqui do trecho dentro", f"{img} imagem(ns)")
        texto = pg.evaluate("() => document.querySelector('#vRel').innerText.toUpperCase()")
        for proibido in ("CONTROLE TECNOLÓGICO", "DETALHAMENTO POR FAIXA", "NOTAS TÉCNICAS"):
            ok(proibido not in texto, f"sem a seção «{proibido.title()}», que o cliente tirou")

        ctx.close()
        nav.close()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:5]:
        print("  ", c)
    print("\nRESULTADO:", "OK — o trabalho sai da plataforma inteiro"
          if not falhas and not console else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


def autoteste():
    """Prova que a prova reprova: esvazia o CSV da matriz dentro do pacote."""
    print("AUTOTESTE — CSV da matriz esvaziado antes de gerar o pacote\n")
    falhas.clear()
    main(defeito=True)
    pegou = bool(falhas)
    print("\n   " + ("OK    a prova reprova o pacote incompleto"
                     if pegou else "FALHA a prova NAO pegou o pacote incompleto"))
    return 0 if pegou else 1


if __name__ == "__main__":
    sys.exit(autoteste() if AUTOTESTE else main())
