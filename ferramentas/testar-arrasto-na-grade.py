# -*- coding: utf-8 -*-
"""A grade se pinta arrastando, como a planilha da casa.

   O cliente pediu «pintura por quadradinhos como se fosse uma planilha». A grade é a matriz
   que já existia; o que faltava era o gesto: arrastar repete nas células seguintes o estado
   que o clique acabou de aplicar.

   O que esta prova vigia, e por que cada uma:

   1. arrastar pinta o caminho — é o gesto pedido;
   2. o arrasto usa o MESMO estado do clique que o iniciou, e não gira estado a cada célula
      (girar no arrasto deixaria um rastro de estados diferentes, que é o oposto de pintar);
   3. o clique sozinho continua girando o estado — o gesto antigo não pode morrer, e é o que
      as outras provas da casa usam;
   4. no TOQUE o arrasto não pinta: ali arrastar é rolar a tabela de 269 colunas, e roubar
      esse gesto prenderia a matriz no tablet. Limite declarado, não esquecimento;
   5. o que o arrasto pinta ganha data, como qualquer lançamento — senão o histórico nasce
      com buraco no dia em que alguém lançar 40 km de uma vez.

   Uso:  python ferramentas/testar-arrasto-na-grade.py
"""
import functools, http.server, os, socketserver, sys, threading
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
falhas = []


def ok(cond, titulo, detalhe=''):
    print('  %-5s %s%s' % ('OK' if cond else 'FALHA', titulo, '  → ' + detalhe if detalhe else ''))
    if not cond:
        falhas.append(titulo)


srv = socketserver.TCPServer(('127.0.0.1', 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=RAIZ))
porta = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_context(viewport={'width': 1500, 'height': 900}, has_touch=True).new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)[:140]))
    pg.goto('http://127.0.0.1:%d/index.html' % porta, wait_until='domcontentloaded')
    pg.wait_for_timeout(2500)
    pg.evaluate("""() => {
        const s = document.querySelector('#selAcervo');
        const o = [...s.options].find(x => x.textContent.includes('AM-151'));
        s.value = o.value; s.dispatchEvent(new Event('change'));
    }""")
    pg.wait_for_timeout(2600)
    pg.evaluate("""() => { const b = [...document.querySelectorAll('#abas button[data-v]')]
        .find(x => x.dataset.v === 'matriz'); if (b) b.click(); }""")
    pg.wait_for_timeout(1200)

    print('=' * 74)
    print('A GRADE SE PINTA ARRASTANDO')
    print('=' * 74)

    cx = pg.evaluate("""() => {
        const c = id => document.querySelector(`#vMatriz td.cel[data-l="0"][data-id="${id}"]`);
        const r = id => { const b = c(id).getBoundingClientRect();
            return {x: b.left + b.width / 2, y: b.top + b.height / 2}; };
        c(0).scrollIntoView({block: 'center'});
        return {p0: r(0), p1: r(1), p4: r(4), existe: !!c(0)};
    }""")
    ok(cx['existe'], 'a grade tem célula de serviço por quilômetro')

    print('\n1. ARRASTAR PINTA O CAMINHO')
    pg.mouse.move(cx['p0']['x'], cx['p0']['y'])
    pg.mouse.down()
    for i in range(1, 6):
        alvo = pg.evaluate("""(i) => { const c = document.querySelector(
            `#vMatriz td.cel[data-l="0"][data-id="${i}"]`); const b = c.getBoundingClientRect();
            return {x: b.left + b.width / 2, y: b.top + b.height / 2}; }""", i)
        pg.mouse.move(alvo['x'], alvo['y'])
    pg.mouse.up()
    pg.wait_for_timeout(400)
    r = pg.evaluate("""() => {
        const l = linhasMatriz()[0];
        const v = id => S.dados[chave(l, id)] || '';
        return {vals: [0, 1, 2, 3, 4, 5].map(v), fora: v(6),
                datas: [0, 1, 2, 3, 4, 5].map(id => S.datas[chave(l, id)] || '')};
    }""")
    pintadas = [x for x in r['vals'] if x]
    ok(len(pintadas) == 6, 'as seis células do caminho ficaram pintadas',
       '%d de 6 · %s' % (len(pintadas), ' '.join(v or '-' for v in r['vals'])))
    ok(len(set(pintadas)) == 1, 'todas com o MESMO estado — arrastar pinta, não gira',
       ' '.join(pintadas))
    ok(r['fora'] == '', 'a célula fora do caminho não foi tocada', r['fora'] or 'vazia')

    print('\n2. O QUE O ARRASTO PINTOU GANHA DATA')
    hoje = pg.evaluate("hoje()")
    ok(all(d == hoje for d in r['datas']),
       'todas as células do arrasto têm a data de hoje', ' '.join(set(r['datas'])) or 'sem data')

    print('\n3. O CLIQUE SOZINHO CONTINUA GIRANDO O ESTADO')
    giro = pg.evaluate("""() => {
        const l = linhasMatriz()[0], id = 8, k = chave(l, id);
        const td = document.querySelector(`#vMatriz td.cel[data-l="0"][data-id="${id}"]`);
        const antes = S.dados[k] || '';
        td.click();
        const um = S.dados[k] || '';
        td.click();
        return {antes, um, dois: S.dados[k] || ''};
    }""")
    ok(giro['um'] != giro['antes'] and giro['dois'] != giro['um'],
       'dois cliques passam por dois estados diferentes',
       '«%s» → «%s» → «%s»' % (giro['antes'], giro['um'], giro['dois']))

    print('\n4. NO TOQUE, ARRASTAR NAO PINTA — ROLAR A TABELA CONTINUA POSSIVEL')
    toque = pg.evaluate("""() => {
        const l = linhasMatriz()[0];
        const c = id => document.querySelector(`#vMatriz td.cel[data-l="0"][data-id="${id}"]`);
        [10, 11, 12].forEach(id => delete S.dados[chave(l, id)]);
        const dispara = (el, tipo, extra) => {
            const b = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent(tipo, Object.assign({
                bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
                clientX: b.left + b.width / 2, clientY: b.top + b.height / 2}, extra || {})));
        };
        dispara(c(10), 'pointerdown');
        dispara(c(11), 'pointermove');
        dispara(c(12), 'pointermove');
        dispara(c(12), 'pointerup');
        return [10, 11, 12].map(id => S.dados[chave(l, id)] || '');
    }""")
    ok(all(v == '' for v in toque),
       'o arrasto por toque não pintou nenhuma célula', ' '.join(v or '-' for v in toque))

    print('\n5. A GRADE ABRE NO QUILOMETRO QUE A PESSOA ESCOLHEU')
    # 269 colunas: sem isto, quem marca o km 130 na faixa e abre a grade cai no km 0 e rola com
    # a mão. `marcaColuna()` existia desde o refactor e ninguém chamava — o manual prometia
    # «clicar num quilômetro no mapa leva à coluna correspondente» e nada acontecia.
    # eixo longo de propósito: na AM-151, de 13 quilômetros, tudo cabe na tela e o teste não
    # provaria nada. A AM-010 tem 269 colunas, que é o caso do cliente.
    pg.evaluate("""() => {
        const s = document.querySelector('#selAcervo');
        const o = [...s.options].find(x => x.textContent.includes('AM-010'));
        s.value = o.value; s.dispatchEvent(new Event('change'));
    }""")
    pg.wait_for_timeout(3200)
    pg.evaluate("""() => { const b = [...document.querySelectorAll('#abas button[data-v]')]
        .find(x => x.dataset.v === 'matriz'); if (b) b.click(); }""")
    pg.wait_for_timeout(1200)
    r = pg.evaluate("""() => {
        S.sel = new Set([130]);
        pintaMatriz();
        return new Promise(res => setTimeout(() => {
            const td = document.querySelector('#vMatriz td.cel[data-id="130"]');
            if (!td) return res({achou: false});
            const b = td.getBoundingClientRect();
            const sv = document.querySelector('#vMatriz tbody th.sv');
            const s = sv ? sv.getBoundingClientRect() : {left: -1, right: -1};
            res({achou: true, visivel: b.left > 0 && b.right < innerWidth,
                 servicoAVista: s.left >= 0 && s.right < innerWidth});
        }, 1200));
    }""")
    ok(r.get('achou') and r.get('visivel'),
       'a coluna do km 130 está na tela sem ninguém rolar', str(r))
    ok(r.get('servicoAVista'),
       'e a coluna de serviço continua à vista, mesmo rolada a 130 km')

    print('\nERROS DE CONSOLE: %d' % len(erros))
    for e in erros[:3]:
        print('   ', e)
    if erros:
        falhas.append('erro de console')
    nav.close()
srv.shutdown()

print()
if falhas:
    print('RESULTADO: %d FALHA(S)' % len(falhas))
    for f in falhas:
        print('   falhou:', f)
    sys.exit(1)
print('RESULTADO: OK — arrastar pinta a grade, o clique continua girando, o toque rola')
