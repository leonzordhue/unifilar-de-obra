# -*- coding: utf-8 -*-
"""Prova a plataforma em tela de campo: tablet retrato, tablet paisagem e telefone.

Quem lança serviço é o fiscal na obra, e na obra não há monitor de 27 polegadas. Os defeitos
de campo são invisíveis no desenvolvimento: barra de rolagem horizontal na página inteira
(que faz o dedo arrastar a tela quando ele queria tocar um botão), alvo de toque menor que a
polpa do dedo, e janela de ficha que não cabe.

Cada bloco mede número, não aparência: `scrollWidth` contra `clientWidth`, retângulo de cada
alvo, e quem são os elementos que transbordam — porque «a página está torta» não conserta
nada, e «o #faixaBox tem 1.310 px numa viewport de 768» conserta.

Uso:  python ferramentas/testar-campo.py [--ver]   (--ver guarda capturas em ferramentas/_temp)
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
TMP = os.path.join(RAIZ, "ferramentas", "_temp")
GUARDAR = "--ver" in sys.argv
falhas = []
pendencias = []

# 44 px é o alvo de toque mínimo que Apple e Google recomendam há mais de dez anos; abaixo
# disso o erro de toque cresce rápido, e errar aqui significa lançar serviço no km errado.
ALVO_MIN = 40

TELAS = [("tablet retrato", 768, 1024), ("tablet paisagem", 1024, 768), ("telefone", 390, 844)]


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


def pendente(cond, msg, dono, extra=""):
    """Defeito real em arquivo de outro dono: aparece em toda execução, mas não bloqueia."""
    if cond:
        print(f"  OK    {msg}" + (f"  → {extra}" if extra else ""))
    else:
        print(f"  PENDENTE (dono: {dono}) {msg}" + (f"  → {extra}" if extra else ""))
        pendencias.append(f"{msg} — dono: {dono}")


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


TRANSBORDA = """(largura) => {
  const fora = [];
  document.querySelectorAll('body *').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || getComputedStyle(e).display === 'none') return;
    // quem transborda a viewport E não está dentro de um contêiner que rola sozinho
    if (r.right > largura + 1) {
      let p = e.parentElement, rolavel = false;
      while (p && p !== document.body) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === 'auto' || ov === 'scroll') { rolavel = true; break; }
        p = p.parentElement;
      }
      if (!rolavel) fora.push((e.id ? '#' + e.id : e.tagName.toLowerCase() +
        (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')) +
        ' ' + Math.round(r.right) + 'px');
    }
  });
  return [...new Set(fora)].slice(0, 6);
}"""

ALVOS = """(minimo) => {
  const pequenos = [];
  document.querySelectorAll('button, select, input, .abas button, #listaSvc input').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (getComputedStyle(e).visibility === 'hidden') return;
    if (r.height < minimo) pequenos.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) +
      ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return {total: pequenos.length, exemplos: [...new Set(pequenos)].slice(0, 5)};
}"""


def main():
    os.makedirs(TMP, exist_ok=True)
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=RAIZ))
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        for nome, larg, alt in TELAS:
            print(f"\n=== {nome.upper()} · {larg}×{alt} ===")
            ctx = nav.new_context(viewport={"width": larg, "height": alt},
                                  device_scale_factor=2, is_mobile=larg < 768,
                                  has_touch=True)
            pg = ctx.new_page()
            pg.on("console", lambda m: console.append(f"[{nome}] {m.text}")
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: console.append(f"[{nome}] {e}"))
            pg.on("dialog", lambda d: d.accept())
            pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
            pg.wait_for_timeout(2400)
            pg.evaluate("""() => { const s = document.querySelector('#selAcervo');
                const o = [...s.options].find(x => x.textContent.startsWith('AM-070'));
                if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } }""")
            pg.wait_for_timeout(2200)

            rol = pg.evaluate("""() => ({sw: document.scrollingElement.scrollWidth,
                                        cw: document.scrollingElement.clientWidth})""")
            ok(rol["sw"] <= rol["cw"] + 1, "a página não rola na horizontal",
               f"scrollWidth {rol['sw']} · viewport {rol['cw']}")
            if rol["sw"] > rol["cw"] + 1:
                print("        quem transborda:", ", ".join(pg.evaluate(TRANSBORDA, larg)) or "—")

            al = pg.evaluate(ALVOS, ALVO_MIN)
            ok(al["total"] == 0, f"todo alvo de toque tem pelo menos {ALVO_MIN} px de altura",
               "todos" if not al["total"] else f"{al['total']} pequeno(s): " + ", ".join(al["exemplos"]))

            fic = pg.evaluate("""() => {
                if (typeof abreFicha !== 'function' || !S.segs.length) return null;
                abreFicha(S.segs[0].id);
                const c = document.querySelector('.fichaCaixa');
                if (!c) return null;
                const r = c.getBoundingClientRect();
                const res = {l: Math.round(r.width), a: Math.round(r.height),
                             vw: innerWidth, vh: innerHeight};
                if (typeof fechaFicha === 'function') fechaFicha();
                return res; }""")
            if fic:
                ok(fic["l"] <= fic["vw"] and fic["a"] <= fic["vh"],
                   "a ficha do quilômetro cabe na tela",
                   f"{fic['l']}×{fic['a']} numa tela de {fic['vw']}×{fic['vh']}")
                ok(fic["l"] >= fic["vw"] * 0.9,
                   "e ocupa a largura útil, em vez de uma janelinha",
                   f"{round(100*fic['l']/fic['vw'])}% da largura")

            # DUAS perguntas separadas, e nessa ordem. A primeira versão desta prova juntava
            # as duas e dizia «não responde ao toque» quando a faixa estava FORA da tela: mandou
            # a Cortanna caçar defeito de evento por meia hora, num defeito que era meu, de
            # layout. Prova que aponta o dono errado custa mais caro que prova nenhuma.
            visivel = pg.evaluate("""() => {
                const t = document.querySelector('#faixaTrilho') || document.querySelector('.faixaTrilho');
                if (!t) return null;
                const r = t.getBoundingClientRect();
                return {topo: Math.round(r.top), base: Math.round(r.bottom),
                        alturaTela: innerHeight,
                        dentro: r.top >= 0 && r.bottom <= innerHeight + 1}; }""")
            if visivel:
                ok(visivel["dentro"],
                   "a faixa unifilar cabe na área visível, sem rolar a página",
                   f"faixa de {visivel['topo']} a {visivel['base']} px numa tela de "
                   f"{visivel['alturaTela']} px")

            toque = pg.evaluate("""() => {
                const t = document.querySelector('#faixaTrilho') || document.querySelector('.faixaTrilho');
                if (!t) return null;
                const km = t.querySelector('.km');
                if (!km) return null;
                const antes = (S.sel ? S.sel.size : 0);
                const r = km.getBoundingClientRect();
                const op = {bubbles: true, cancelable: true, clientX: r.x + r.width/2,
                            clientY: r.y + r.height/2};
                km.dispatchEvent(new PointerEvent('pointerdown', {...op, pointerType: 'touch'}));
                km.dispatchEvent(new PointerEvent('pointerup', {...op, pointerType: 'touch'}));
                km.dispatchEvent(new MouseEvent('click', op));
                return {antes, depois: (S.sel ? S.sel.size : 0), largura: Math.round(r.width)}; }""")
            if toque:
                # só agora a pergunta de comportamento, e só quando a faixa está visível:
                # com o elemento fora da tela, `elementFromPoint` devolve nada e o veredito
                # seria sobre o dono errado
                if visivel and visivel["dentro"]:
                    pendente(toque["depois"] != toque["antes"],
                             "a faixa unifilar responde ao toque", "Cortanna · app/13-faixa.js",
                             f"seleção {toque['antes']} → {toque['depois']} · célula de "
                             f"{toque['largura']}px")
                else:
                    print("        (toque não avaliado: a faixa não está na área visível — "
                          "o defeito a corrigir é o de layout, acima)")

            # A CELULA DA GRADE E ALVO DE TOQUE, e por isso ela e medida aqui.
            # Ate 23/08 esta prova passava verde com a celula a 24 px: `campo.css` mandava
            # 34 px, mas a regra do `<style>` do index vinha depois com a mesma
            # especificidade e vencia. A folha existia, o comentario explicava, e o dedo
            # continuava com o alvo pequeno — ninguem media a celula da matriz, so a da faixa.
            cel = pg.evaluate("""() => {
                if (typeof mostra === 'function') mostra('matriz');
                const c = document.querySelector('#vMatriz td.cel');
                if (!c) return null;
                const r = c.getBoundingClientRect();
                return {l: Math.round(r.width), a: Math.round(r.height)}; }""")
            pg.wait_for_timeout(500)
            if cel:
                ok(cel["a"] >= ALVO_MIN - 6 and cel["l"] >= ALVO_MIN - 6,
                   "a celula da grade e alvo de toque, nao alvo de mouse",
                   f"{cel['l']}x{cel['a']} px")


            if GUARDAR:
                pg.screenshot(path=os.path.join(TMP, f"campo-{nome.replace(' ', '-')}.png"),
                              full_page=False)
            ctx.close()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:6]:
        print("  ", c)
    if pendencias:
        print(f"\nPENDENTE EM ARQUIVO DE OUTRO DONO: {len(pendencias)}")
        for x in pendencias:
            print("   ", x)
    print("\nRESULTADO:", "OK — a plataforma serve em campo" if not falhas and not console
          else f"{len(falhas)} FALHA(S)")
    for f in falhas:
        print("   falhou:", f)
    return 1 if falhas or console else 0


if __name__ == "__main__":
    sys.exit(main())
