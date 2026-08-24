# -*- coding: utf-8 -*-
"""Confere, controle por controle, a terceira condicao de PRONTO: «nada removido em silencio».

A simplificacao de 22/08 tirou 53 interativos da tela e a secao «Simplificacao da casca» do
COORDENACAO.md declara, numa tabela, onde cada um foi parar. Declaracao em Markdown nao e'
prova: ela envelhece no primeiro commit que mexe no `index.html`, e envelhece em silencio.

Esta prova le a tabela pelo que ela promete e confere no DOM VIVO: o controle existe, esta
dentro do lugar declarado, e e' ALCANCAVEL -- `<details>` fechado conta, `display:none` nao.

Uso: python ferramentas/testar-nada-sumiu.py
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


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


# «Alcancavel» aqui nao e' `checkVisibility()`: um controle dentro de `<details>` fechado
# esta invisivel e continua alcancavel, que e' exatamente o que a simplificacao fez. O que
# NAO vale e' `display:none`, `hidden`, ou nao existir. A conta e' esta.
ALCANCA = """(sel) => {
  const e = document.querySelector(sel);
  if (!e) return {existe: false};
  let p = e, oculto = '';
  while (p && p !== document.body){
    const cs = getComputedStyle(p);
    if (cs.display === 'none' && p.tagName !== 'DETAILS'
        && !(p.tagName === 'DIV' && p.parentElement
             && p.parentElement.tagName === 'DETAILS')) oculto = p.id || p.tagName;
    if (p.hasAttribute && p.hasAttribute('hidden')) oculto = p.id || p.tagName;
    p = p.parentElement;
  }
  const det = e.closest('details');
  return {existe: true, oculto, dentroDe: det ? det.querySelector('summary').textContent.trim()
          : (e.closest('#obras') ? 'painel Obras' : 'na tela')};
}"""


def main():
    H = functools.partial(Q, directory=RAIZ)
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)
    porta = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1600, "height": 950})
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{porta}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)
        # com eixo carregado, porque contrato e servicos so se montam depois dele
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            const i = [...sel.options].findIndex(o => o.textContent.startsWith('AM-151'));
            if (i >= 0){ sel.selectedIndex = i; sel.dispatchEvent(new Event('change')); }
        }""")
        pg.wait_for_timeout(2600)

        print("1. OS BOTOES QUE SAIRAM DO TOPO ESTAO NO PAINEL «OBRAS»")
        # O painel «Obras» nasce `hidden`, como um `<details>` fechado: invisivel e
        # alcancavel. Perguntar `checkVisibility()` com ele fechado mede a porta, nao o que
        # ha atras dela -- entao a prova ABRE pela porta que o usuario usa, e so entao olha.
        porta_visivel = pg.evaluate(
            "() => { const b = document.querySelector('#btObras');"
            "  return !!b && b.checkVisibility({checkVisibilityCSS: true}); }")
        ok(porta_visivel, "a porta «Obras» está visível no topo, sem precisar de nada antes")
        pg.evaluate("() => document.querySelector('#btObras').click()")
        pg.wait_for_timeout(500)
        for sel, rot in [("#btNovo", "Nova obra"), ("#btAbrir", "Abrir arquivo…"),
                         ("#btGuardar", "Guardar esta obra")]:
            v = pg.evaluate(f"() => {{ const e = document.querySelector('{sel}');"
                            f"  return e ? {{vis: e.checkVisibility({{checkVisibilityCSS: true}}),"
                            f"  txt: e.textContent.trim()}} : null; }}")
            ok(v and v["vis"] and v["txt"] == rot,
               f"{sel} aparece ao abrir «Obras», rotulado «{rot}»",
               (f"{v['txt']} · visível={v['vis']}" if v else "não existe"))
        pg.evaluate("() => { const f = document.querySelector('#obras');"
                    "  if (f) f.classList.add('hidden'); }")

        print("\n2. OS BLOCOS RECOLHIDOS EXISTEM, E COM O NOME DECLARADO")
        sums = pg.evaluate("""() => [...document.querySelectorAll('summary')]
                                    .map(s => s.textContent.trim())""")
        for nome in ["Sentido e estaqueamento", "Acrescentar serviço",
                     "Objeto, valor e vigências"]:
        # «Quantidade contratada por serviço» saiu desta lista de propósito: o cliente
        # mandou tirá-la da tela — «é pra gente organizar o andamento da obra e não
        # fazer a medição no momento». Remoção pedida não é remoção em silêncio, e
        # esta prova cobra a segunda, não a primeira.
            ok(nome in sums, f"«{nome}» está na tela, recolhido", "")
        print(f"         blocos recolhidos encontrados: {len(sums)} → {sums}")

        print("\n3. O QUE FOI PARA DENTRO DE «SENTIDO E ESTAQUEAMENTO»")
        for sel, nome in [("#segRef", "referência km/estaca"),
                          ("#btInverte", "inverter sentido"),
                          ("#estOff", "estaca inicial")]:
            r = pg.evaluate(ALCANCA, sel)
            ok(r["existe"] and not r["oculto"] and r.get("dentroDe") == "Sentido e estaqueamento",
               f"{nome} está dentro do bloco declarado",
               r.get("dentroDe", "não encontrado")
               + (f" · OCULTO por {r['oculto']}" if r.get("oculto") else ""))

        # O bloco 4 media os ensaios contratados. O controle tecnologico saiu inteiro em
        # 24/08 por ordem do cliente («nao e isso que eu preciso»): catalogo de 22 ensaios,
        # conformidade, previsao, fotos e laudo. Nao ha o que continuar alcancavel — a
        # remocao foi PEDIDA, e prova que guarda tela removida por ordem trava os tres.

        print("\n5. A AJUDA LONGA VIROU `title=` DO PROPRIO CONTROLE")
        for sel in ["#kmIni", "#kmFim", "#estOff"]:
            t = pg.evaluate(f"() => (document.querySelector('{sel}') || {{}}).title || ''")
            ok(len(t.strip()) > 20, f"{sel} carrega a explicação no title",
               (t[:64] + "…") if len(t) > 64 else t)

        print("\n6. A LEGENDA VIROU LINHA DENTRO DA FAIXA")
        r = pg.evaluate(ALCANCA, "#legenda")
        itens = pg.evaluate("() => document.querySelectorAll('#legenda .leg').length")
        ok(r["existe"] and not r["oculto"], "a legenda está na tela", r.get("dentroDe", ""))
        ok(itens > 0, "e tem as cores das situações", f"{itens} item(ns)")

        print("\n7. O QUE ESTAVA RECOLHIDO ABRE MESMO NO CLIQUE")
        abriu = pg.evaluate("""() => {
            const d = [...document.querySelectorAll('details')];
            d.forEach(x => x.open = false);
            const antes = d.filter(x => x.open).length;
            d.forEach(x => x.querySelector('summary').click());
            return {antes, depois: d.filter(x => x.open).length, total: d.length};
        }""")
        ok(abriu["depois"] == abriu["total"],
           "todo bloco recolhido abre pelo clique no título",
           f"{abriu['depois']} de {abriu['total']}")

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
    print("RESULTADO: OK — o que saiu da tela continua alcançável, onde a declaração diz")
    return 0


if __name__ == "__main__":
    sys.exit(main())
