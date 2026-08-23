# -*- coding: utf-8 -*-
"""Mede quantas fotos cabem numa obra, e o que a plataforma faz quando nao cabem mais.

O item 3 do que o Paulo pediu e' «ficha tecnica por segmento: ensaio, norma de referencia,
medicao, responsavel e FOTO». A plataforma reduz cada foto (1280 px, qualidade 0,72) e
recusa a proxima quando o conjunto passa de LIMITE_FOTOS. A pergunta que esta prova responde
nao e' se o limite existe -- ele existe e esta certo, o navegador nao guarda mais que isso --
e sim QUANTAS fotos ele deixa entrar, e o que se perde na recusa.

Uso: python ferramentas/testar-limite-de-fotos.py
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


def nota(msg):
    print(f"  NOTA  {msg}")


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# Duas imagens de referencia, porque uma so mentiria. Ruido puro e' o PIOR caso para o JPEG
# (nada a jogar fora) e cena lisa com estrutura e' o MELHOR caso realista (ceu, pavimento,
# um vulto). Foto de obra de verdade fica entre as duas, e e' entre as duas que a resposta
# tem de ser dada. Deterministico (LCG) para a medida ser repetivel, o que `Math.random`
# nao daria.
FOTO_REALISTA = """(lado) => {
  const c = document.createElement('canvas');
  c.width = lado; c.height = Math.round(lado * 0.75);
  const cx = c.getContext('2d');
  const im = cx.createImageData(c.width, c.height);
  let s = 12345;
  for (let i = 0; i < im.data.length; i += 4){
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s >> 16) & 0xff;
    im.data[i] = v; im.data[i+1] = (v * 3) & 0xff; im.data[i+2] = (v * 7) & 0xff;
    im.data[i+3] = 255;
  }
  cx.putImageData(im, 0, 0);
  return c.toDataURL('image/jpeg', 0.72);
}"""


FOTO_LISA = """(lado) => {
  const c = document.createElement('canvas');
  c.width = lado; c.height = Math.round(lado * 0.75);
  const cx = c.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 0, c.height);          // ceu para pavimento
  g.addColorStop(0, '#9fb6cc'); g.addColorStop(0.45, '#cfd6d9');
  g.addColorStop(0.46, '#6d6f70'); g.addColorStop(1, '#4a4c4d');
  cx.fillStyle = g; cx.fillRect(0, 0, c.width, c.height);
  cx.strokeStyle = '#e8e4d8'; cx.lineWidth = 6;                  // faixa central
  cx.beginPath(); cx.moveTo(c.width * 0.5, c.height); cx.lineTo(c.width * 0.52, c.height * 0.47);
  cx.stroke();
  cx.fillStyle = 'rgba(60,50,40,0.35)';                          // uma erosao na borda
  cx.beginPath(); cx.ellipse(c.width * 0.22, c.height * 0.78, 130, 46, 0.3, 0, 6.3); cx.fill();
  let s = 999;                                                   // graozinho de camera
  for (let i = 0; i < 4000; i++){
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    cx.fillStyle = 'rgba(0,0,0,0.06)';
    cx.fillRect((s >> 7) % c.width, (s >> 3) % c.height, 2, 2);
  }
  return c.toDataURL('image/jpeg', 0.72);
}"""


def main():
    H = functools.partial(Q, directory=RAIZ)
    # porta 0: o sistema escolhe uma livre. Porta fixa com allow_reuse_address faz uma prova
    # servir os arquivos da outra quando duas rodam juntas -- ja aconteceu nesta casa.
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)
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

        print("1. O TAMANHO DE UMA FOTO DEPOIS DA REDUCAO DA PLATAFORMA")
        cfg = pg.evaluate("() => ({limite: LIMITE_FOTOS, lado: 1280, q: 0.72})")
        tam = pg.evaluate(f"({FOTO_REALISTA})(1280)")
        lisa = pg.evaluate(f"({FOTO_LISA})(1280)")
        n, nl = len(tam), len(lisa)
        ok(n > 0 and nl > 0, "as duas fotos de referência saíram com a redução da plataforma",
           f"ruído {n / 1024:,.0f} KB · cena lisa {nl / 1024:,.0f} KB".replace(",", "."))
        cabem_conta = int(cfg["limite"] // n)
        cabem_lisa = int(cfg["limite"] // nl)
        print(f"         limite do conjunto de fotos ......... "
              f"{cfg['limite'] / 1024 / 1024:.2f} MB")
        print(f"         cabem, no pior caso (ruído) ......... {cabem_conta}")
        print(f"         cabem, no melhor caso (cena lisa) ... {cabem_lisa}")

        print("\n2. QUANTAS ENTRAM DE VERDADE, UMA A UMA")
        r = pg.evaluate("""(foto) => {
            S.fotos = {}; let n = 0, erro = '';
            for (let i = 0; i < 400; i++){
              try { guardaFoto('p' + i, foto); n++; }
              catch (e){ erro = e.message; break; }
            }
            return {n, erro, bytes: tamanhoFotos()};
        }""", tam)
        ok(r["n"] > 0, "a plataforma aceita fotos até o limite e recusa a seguinte",
           f"{r['n']} foto(s) · {r['bytes'] / 1024 / 1024:.2f} MB")
        ok(bool(r["erro"]), "a recusa vem com mensagem, não em silêncio",
           (r["erro"][:80] + "…") if r["erro"] else "sem mensagem")
        ok(abs(r["n"] - cabem_conta) <= 1,
           "o número medido bate com a conta do limite", f"{r['n']} vs {cabem_conta}")

        print("\n3. O QUE ACONTECE QUANDO A FOTO NAO CABE")
        # Com o conjunto cheio, lanca-se um ensaio COM foto pela ficha de verdade.
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-151'));
            if (i >= 0){ sel.selectedIndex = i; sel.dispatchEvent(new Event('change')); }
        }""")
        pg.wait_for_timeout(2500)
        pronto = pg.evaluate("() => S.segs.length")
        ok(pronto > 0, "um eixo carregado para ter segmento onde lançar", f"{pronto} segmento(s)")

        pg.evaluate("""() => {
            if (!S.ens.length) montaEns();
            S.ens.forEach(e => e.on = true);
            abreFicha(S.segs[0].id);
        }""")
        pg.wait_for_timeout(400)
        # o arquivo chega ao input do jeito que chegaria da camera: um File de verdade
        pg.evaluate("""async (foto) => {
            const bin = atob(foto.split(',')[1]);
            const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            const f = new File([u], 'ensaio.jpg', {type: 'image/jpeg'});
            const dt = new DataTransfer();
            dt.items.add(f);
            document.querySelector('#fFoto').files = dt.files;
        }""", tam)
        antes = pg.evaluate("() => S.reg.length")
        pg.fill("#fValor", "97")
        pg.evaluate("() => document.querySelector('#fLanca').click()")
        pg.wait_for_timeout(1200)
        depois = pg.evaluate("() => S.reg.length")
        aviso = pg.inner_text("#fAviso")

        # REGRA DE PRODUTO (coordenação, 22/08): a medição vale mais que a imagem. Quando a
        # foto não cabe, o ensaio É lançado, sem ela, e a ficha avisa. Descartar um ensaio
        # válido para proteger a foto perderia o dado que não volta — quem tirou a foto ainda
        # a tem no celular; o 97 digitado no campo, não.
        # Estas duas asserções mediam o comportamento anterior (recusar o lançamento) e
        # reprovavam a plataforma por estar certa. Atualizadas pelo HAL9000, com aviso ao
        # jarvisIV no canal, porque prova vermelha tranca o commit dos três.
        # `semFoto` guarda a MENSAGEM do motivo, não um booleano — e o aviso escrito em
        # `#fAviso` é apagado logo depois pelo `pintaFicha()` que repinta a ficha. Por isso o
        # que se mede aqui é o que o usuário continua vendo depois do repintar: a marca no
        # registro e o texto «foto não coube» na lista de ensaios do quilômetro.
        marcado = pg.evaluate("() => { const r = S.reg[S.reg.length - 1] || {};"
                              " return {semFoto: !!r.semFoto, motivo: String(r.semFoto || '')}; }")
        naFicha = pg.evaluate("() => (document.querySelector('#fichaCorpo') || {}).textContent || ''")
        ok(depois == antes + 1,
           "o ensaio é lançado mesmo sem espaço para a foto",
           f"{antes} → {depois} registro(s)")
        ok(marcado["semFoto"], "o registro fica marcado com o motivo",
           marcado["motivo"][:70])
        ok("foto não coube" in naFicha.lower() or "sem a foto" in naFicha.lower(),
           "e a ficha continua declarando isso DEPOIS de repintar",
           "declara" if "foto não coube" in naFicha.lower() else
           "o aviso some no pintaFicha() — o usuário vê só a marca na lista")
        nota("A medição de 97 foi preservada e a imagem, não: é a inversão de prioridade que "
             "a Cortanna escreveu em app/10-ensaios.js — «medição perdida não tem volta, foto tem».")
        nota(f"Cabem entre {cabem_conta} e {cabem_lisa} fotos no total da obra, conforme a "
             "textura da imagem — o pior caso é ruído puro, o melhor é cena lisa. Numa "
             "recuperação de 12 km com ISC a cada 400 m são 30 ensaios só desse tipo "
             "(DNIT 137/2010-ES), e o catálogo tem 22 tipos de ensaio.")

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
    print("RESULTADO: OK — o limite de fotos foi medido, e a medição sobrevive à foto que não coube")
    return 0


if __name__ == "__main__":
    sys.exit(main())
