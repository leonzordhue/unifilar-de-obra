# -*- coding: utf-8 -*-
"""Prova o relatório IMPRESSO: gera o PDF pelo próprio Chromium e mede o que saiu.

Impressão não se confere olhando a tela. O relatório é o que sai da plataforma e vai para o
processo, e os defeitos de papel são invisíveis no navegador: tabela que atravessa a página e
deixa a segunda metade sem cabeçalho, título sozinho no pé da folha, croqui estourando a
margem, foto de ensaio ocupando meia página. Aqui o PDF é gerado e depois LIDO — posição de
texto e retângulo de imagem, página por página.

Precisa de PyMuPDF (`pip install pymupdf`).

Uso:  python ferramentas/testar-impressao.py [--ver]   (--ver guarda o PDF em ferramentas/_temp)
"""
import functools
import http.server
import os
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

try:
    import fitz                      # PyMuPDF
except ImportError:
    print("precisa de PyMuPDF: pip install pymupdf")
    sys.exit(1)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(RAIZ, "ferramentas", "_temp")
GUARDAR = "--ver" in sys.argv
falhas = []

# A4 paisagem em pontos (1 pt = 1/72"), com a margem de 10 mm do @media print do index.html.
MM = 72 / 25.4
MARGEM = 10 * MM


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# Projeto de DEMONSTRACAO: o relatorio precisa de conteudo suficiente para atravessar paginas.
# Nada aqui e' dado de obra — sao lancamentos e ensaios sinteticos, so para o papel encher.
MONTA = """() => {
  const s = document.querySelector('#selAcervo');
  const o = [...s.options].find(x => x.textContent.startsWith('AM-010'));
  s.value = o.value; s.dispatchEvent(new Event('change'));
}"""

POVOA = """() => {
  // dispara o evento: quem alimenta `S.obra` e' o `oninput`, e sem ele o rodape do
  // documento sairia sem identificacao — foi assim que esta prova pegou o vazio
  const no = document.querySelector('#nomeObra');
  no.value = 'AM-010 — recuperação (demonstração)';
  no.dispatchEvent(new Event('input'));
  const nc = document.querySelector('#numContrato') || document.querySelector('#contrato');
  if (nc){ nc.value = '017/2023-SEINFRA'; nc.dispatchEvent(new Event('input')); }
  S.svc.forEach(x => x.on = true);
  const segs = S.segs.slice(0, 60);
  linhasMatriz().forEach((l, i) => segs.forEach((sg, k) => {
    S.dados[chave(l, sg.id)] = k % 7 === 0 ? '' : (k % 3 === 0 ? 'E' : (k % 5 === 0 ? 'NA' : 'C'));
  }));
  // croqui grande de propósito: é o caso que estoura a margem se o CSS não limitar a altura
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 1400;
  const x = c.getContext('2d');
  x.fillStyle = '#2E4A63'; x.fillRect(0, 0, 1800, 1400);
  x.strokeStyle = '#FFD24A'; x.lineWidth = 14; x.beginPath();
  x.moveTo(60, 1200); x.bezierCurveTo(600, 900, 900, 500, 1740, 260); x.stroke();
  S.croqui = {url: c.toDataURL('image/png'), largura: 1800, altura: 1400};
  // ensaios com foto, para a miniatura no anexo
  if (typeof novoRegistro === 'function' && S.catEns && S.catEns.itens.length){
    const f = document.createElement('canvas'); f.width = 320; f.height = 240;
    const fx = f.getContext('2d'); fx.fillStyle = '#8C6D3F'; fx.fillRect(0, 0, 320, 240);
    const foto = f.toDataURL('image/png');
    S.ens.forEach(e => e.on = true);
    const cods = catalogoEnsaios().slice(0, 3).map(e => e.cod);
    cods.forEach((cod, i) => S.segs.slice(0, 6).forEach((sg, k) => {
      const r = novoRegistro(sg.id, cod);
      r.valor = 90 + ((i + k) % 12); r.data = '2026-08-0' + ((k % 8) + 1);
      r.resp = 'Eng. de demonstração — CREA 000000';
      if (k === 0){ r.foto = 'f' + i; S.fotos[r.foto] = foto; }
      S.reg.push(r);
    }));
  }
  render();
  return {segs: S.segs.length, lanc: Object.keys(S.dados).length, reg: S.reg.length};
}"""


def main():
    os.makedirs(TMP, exist_ok=True)
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=RAIZ))
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []
    pdf_bytes = None

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pg = nav.new_context(viewport={"width": 1600, "height": 950}).new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2600)
        pg.evaluate(MONTA)
        pg.wait_for_timeout(2600)
        info = pg.evaluate(POVOA)
        pg.wait_for_timeout(800)
        print(f"projeto de demonstração: {info['segs']} km · {info['lanc']} lançamento(s) · "
              f"{info['reg']} ensaio(s)\n")
        pg.click("#abas button[data-v='rel']")
        pg.wait_for_timeout(1800)
        # `print` para o Chromium aplicar as regras de media=print, e não as de tela
        pg.emulate_media(media="print")
        pdf_bytes = pg.pdf(format="A4", landscape=True, print_background=True,
                           margin={"top": "10mm", "bottom": "14mm", "left": "10mm", "right": "10mm"})

    if GUARDAR:
        caminho = os.path.join(TMP, "relatorio-impresso.pdf")
        open(caminho, "wb").write(pdf_bytes)
        print(f"PDF guardado em {caminho}\n")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    paginas = [pg_.get_text() for pg_ in doc]

    print("1. O DOCUMENTO SAI EM PÁGINAS")
    ok(len(doc) >= 3, "o relatório ocupa várias páginas", f"{len(doc)} página(s)")
    largura, altura = doc[0].rect.width, doc[0].rect.height
    ok(largura > altura, "sai em paisagem, como o @page manda",
       f"{largura:.0f} × {altura:.0f} pt")
    print("")
    print("2. O RELATÓRIO CABE PARA SER IMPRESSO")
    # Medida anterior: 47 páginas, 38 delas na tabela de «Detalhamento por faixa». Ela virou
    # um unifilar desenhado — uma barra por serviço, cor por situação, como na planilha da
    # casa. O que saiu do papel (faixa a faixa, com extensão) continua no CSV e no pacote
    # CDE, e o próprio documento declara onde está.
    ok(len(doc) <= 14, "o relatório de uma obra de 269 km cabe em até 14 páginas",
       f"{len(doc)} página(s)")
    todo = chr(10).join(paginas)
    ok("Situação de cada serviço ao longo do trecho" in todo,
       "o unifilar impresso entrou no lugar da tabela")
    ok("CSV" in todo and "CDE" in todo,
       "e o documento diz onde está a relação faixa a faixa que saiu do papel")

    print("")
    print("2-B. CABEÇALHO DE TABELA EM TODA PÁGINA QUE TEM LINHA")
    # as tabelas que restam (avanço geral, quadro por serviço, ensaios) ainda podem
    # atravessar página, e ali o cabeçalho repetido segue obrigatório
    paginas_quadro = [i for i, t in enumerate(paginas) if "% DO TRECHO" in t.upper()]
    orfas = [i + 1 for i in paginas_quadro if "SERVIÇO" not in paginas[i].upper()]
    ok(bool(paginas_quadro), "o quadro por serviço entrou no PDF",
       f"{len(paginas_quadro)} página(s)")
    ok(not orfas, "nenhuma página do quadro ficou sem cabeçalho",
       "sem órfãs" if not orfas else f"páginas órfãs: {orfas}")


    print("\n3. TÍTULO DE SEÇÃO NÃO FICA SOZINHO NO PÉ DA PÁGINA")
    pior = None
    for i, pagina in enumerate(doc):
        for bloco in pagina.get_text("blocks"):
            x0, y0, x1, y1, texto = bloco[0], bloco[1], bloco[2], bloco[3], bloco[4]
            linha = texto.strip().split("\n")[0]
            if not linha or "." not in linha[:3]:
                continue
            if not linha[0].isdigit():
                continue
            folga = altura - MARGEM - y1        # espaço abaixo do título até o fim da área útil
            if pior is None or folga < pior[1]:
                pior = (linha[:40], folga, i + 1)
    ok(pior is not None, "os títulos de seção foram localizados no PDF",
       pior[0] if pior else "nenhum")
    ok(pior is None or pior[1] > 40,
       "o título mais baixo ainda tem conteúdo abaixo dele",
       f"«{pior[0]}» na página {pior[2]} com {pior[1]:.0f} pt de folga" if pior else "")

    print("\n4. IMAGEM DENTRO DA ÁREA ÚTIL")
    fora, maior = [], 0
    for i, pagina in enumerate(doc):
        for img in pagina.get_images(full=True):
            for r in pagina.get_image_rects(img[0]):
                maior = max(maior, r.height)
                if (r.x0 < MARGEM - 2 or r.y0 < MARGEM - 2
                        or r.x1 > largura - MARGEM + 2 or r.y1 > altura - MARGEM + 2):
                    fora.append((i + 1, round(r.width), round(r.height)))
    ok(maior > 0, "o croqui entrou no relatório", f"maior imagem: {maior:.0f} pt de altura")
    ok(not fora, "nenhuma imagem estoura a margem da página",
       "todas dentro" if not fora else str(fora))
    ok(maior <= 150 * MM + 2, "o croqui cabe na altura de uma página",
       f"{maior / MM:.0f} mm (limite 150 mm)")

    print("\n5. FOTO DE ENSAIO É MINIATURA")
    pequenas = [r.height for i, pagina in enumerate(doc) for img in pagina.get_images(full=True)
                for r in pagina.get_image_rects(img[0]) if r.height < 80]
    ok(not pequenas or max(pequenas) <= 14 * MM + 2,
       "a foto do ensaio não passa de miniatura",
       f"{max(pequenas) / MM:.0f} mm" if pequenas else "nenhuma foto no anexo")
    print("")
    print("6. RODAPÉ EM TODAS AS PÁGINAS")
    sem = [i + 1 for i, t in enumerate(paginas) if "SICOR" not in t.upper()]
    ok(not sem, "o rodapé institucional se repete em cada página",
       "todas" if not sem else f"faltou em {sem}")
    # o dono do relatorio criou o `#rodapeImpressao` com contrato, obra e emissao. Documento
    # de processo tem de se identificar em QUALQUER folha que se solte do grampo.
    obra = "demonstração"
    sem_obra = [i + 1 for i, t in enumerate(paginas) if obra not in t]
    ok(not sem_obra, "e leva a identificação da obra em cada página",
       "todas" if not sem_obra else f"faltou em {sem_obra[:6]}")
    print("  NOTA  «página X de Y» não sai por CSS no Chromium (counter(page) só vale em "
          "margin box, que ele não implementa) — quem imprime pelo navegador usa a numeração "
          "do diálogo de impressão.")

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:6]:
        print("  ", c)
    print("\nRESULTADO:", "OK — o relatório imprime" if not falhas and not console
          else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


if __name__ == "__main__":
    sys.exit(main())
