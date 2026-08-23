# -*- coding: utf-8 -*-
"""Mede a simplicidade da tela: quantas coisas há para clicar SEM ROLAR, quanto texto de
   ajuda ocupa a lateral, e quantos gestos custa o PRIMEIRO lançamento.

   A régua está escrita aqui dentro, porque «30» só quer dizer alguma coisa se quem
   confere contar do mesmo jeito. Interativo VISÍVEL é `button, input, select, textarea,
   a[href], summary, [role=button]` que ocupa área na tela agora — o que está em
   `<details>` fechado, `.hidden` ou painel fechado não conta, porque não disputa a atenção
   de quem abre a página. PRIMEIRA DOBRA é o que cruza a janela de 1500x900 sem rolar
   nada: 12 serviços e 20 ensaios mais abaixo são o trabalho, não confusão.

   A lista item a item vem junto do total de propósito: duas réguas dão dois números e
   ninguém sabe qual está certo até ver os itens.

   Uso:  python ferramentas/medir-simplicidade.py [pasta-do-repo]
"""
import functools, http.server, os, socketserver, sys, threading
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

RAIZ = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else \
       os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_DOBRA, META_CLIQUES = 30, 5

Q = ("'button, input:not([type=hidden]), select, textarea, a[href], summary, "
     "[role=button]'")

VISIVEL = """
  const visivel = e => {
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    if (e.closest('details:not([open])')) return false;
    // `<details>` fechado deixa RETÂNGULO FANTASMA: o conteúdo não é pintado e mesmo assim
    // getBoundingClientRect devolve a última medida, com largura, altura e posição. Contar
    // por retângulo conta o que ninguém vê. `checkVisibility` responde a pergunta certa, e
    // `elementFromPoint` no centro do elemento é a conferência de quem duvidar.
    if (e.checkVisibility && !e.checkVisibility({checkOpacity: true,
        checkVisibilityCSS: true, contentVisibilityAuto: true})) return false;
    for (let n = e; n; n = n.parentElement){
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden'
          || n.classList.contains('hidden')) return false;
    }
    return true;
  };
  const naDobra = e => { const r = e.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0; };
"""

CONTA = "([sel, dobra]) => {" + VISIVEL + """
  const raiz = sel ? document.querySelector(sel) : document;
  if (!raiz) return 0;
  let els = [...raiz.querySelectorAll(""" + Q + """)].filter(visivel);
  if (dobra) els = els.filter(naDobra);
  return els.length;
}"""

ITENS = "() => {" + VISIVEL + """
  const onde = e => e.closest('header') ? 'topo' : e.closest('#abas') ? 'abas'
                  : e.closest('aside') ? 'lateral' : 'corpo';
  const nome = e => e.id || (e.textContent || '').trim().slice(0, 20)
                 || e.placeholder || e.type || e.tagName.toLowerCase();
  const m = {};
  [...document.querySelectorAll(""" + Q + """)].filter(visivel).filter(naDobra)
    .forEach(e => { const k = onde(e); (m[k] = m[k] || []).push(nome(e)); });
  return m;
}"""

AJUDA = """() => {
  const a = document.querySelector('aside');
  if (!a) return [];
  return [...a.querySelectorAll('.dica, .min')]
    .filter(e => e.getBoundingClientRect().height > 0 && !e.closest('details:not([open])'))
    .map(e => [e.id || e.className, e.textContent.trim().length]);
}"""

srv = socketserver.TCPServer(('127.0.0.1', 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=RAIZ))
porta = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
erros = []

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_context(viewport={'width': 1500, 'height': 900}).new_page()
    pg.on('pageerror', lambda e: erros.append(str(e)[:120]))
    pg.goto('http://127.0.0.1:%d/index.html' % porta, wait_until='domcontentloaded')
    pg.wait_for_timeout(2500)

    cliques = 0
    if not pg.evaluate("!!document.querySelector('#segFonte button[data-f=\"rodovia\"].on')"):
        pg.click('#segFonte button[data-f="rodovia"]'); cliques += 1
    pg.wait_for_timeout(400)
    # AM-151 é o exemplo do cliente: pouco mais de 12 km, obra entre o km 3 e o 5
    valor = pg.evaluate("""() => {
        const s = document.querySelector('#selAcervo');
        const o = [...s.options].find(x => x.textContent.includes('AM-151'))
               || [...s.options].find(x => x.textContent.includes('AM-010'));
        return o ? o.value : null;
    }""")
    pg.select_option('#selAcervo', valor); cliques += 1
    pg.wait_for_timeout(2600)

    m = {
      # só as visíveis: aba escondida não confunde ninguém, e contar DOM em vez de tela
      # foi o que fez os nossos dois números divergirem
      'abas':    pg.evaluate(CONTA, ['#abas', False]),
      'topo':    pg.evaluate(CONTA, ['header', False]),
      'blocos':  pg.evaluate("document.querySelectorAll('aside h2').length"),
      'lateral': pg.evaluate(CONTA, ['aside', False]),
      'pagina':  pg.evaluate(CONTA, [None, False]),
      'dobra':   pg.evaluate(CONTA, [None, True]),
    }
    itens_dobra = pg.evaluate(ITENS)
    itens_ajuda = pg.evaluate(AJUDA)

    # primeiro lançamento pelo gesto central do produto: marcar o km na faixa e aplicar
    pg.evaluate("""() => { const e = document.querySelector('#faixaTrilho .km:not(.fora)');
        if (e) e.scrollIntoView({block: 'center'}); }""")
    pg.click('#faixaTrilho .km:not(.fora)'); cliques += 1
    pg.wait_for_timeout(300)
    # a primeira opção de situação é «Planejado», que vale LIMPAR o quilômetro: sem escolher
    # a situação o «Aplicar» apaga em vez de lançar, e a conta de cliques mentiria
    sit = pg.evaluate("""() => {
        const o = [...document.querySelectorAll('#selSit option')].find(x => x.value);
        return o ? o.value : null;
    }""")
    pg.select_option('#selSit', sit); cliques += 1
    pg.click('#btAplica'); cliques += 1
    pg.wait_for_timeout(600)
    lancou = pg.evaluate("Object.keys(S.dados || {}).length")
    nav.close()
srv.shutdown()

ajuda = sum(n for _, n in itens_ajuda)
print('=' * 74)
print('SIMPLICIDADE DA TELA — AM-151 carregada, janela 1500x900')
print('=' * 74)
print('  abas ................................ %3d' % m['abas'])
print('  controles no topo (com os campos) ... %3d' % m['topo'])
print('  blocos na lateral ................... %3d' % m['blocos'])
print('  controles na lateral ................ %3d' % m['lateral'])
print('  texto de ajuda na lateral ........... %3d caracteres' % ajuda)
for rot, n in itens_ajuda:
    print('      - %-26s %3d' % (rot, n))
print('  interativos na página ............... %3d' % m['pagina'])
print('  ... na PRIMEIRA DOBRA (sem rolar) ... %3d   (meta <= %d)' % (m['dobra'], META_DOBRA))
for onde in ('topo', 'abas', 'lateral', 'corpo'):
    lst = itens_dobra.get(onde, [])
    if lst:
        print('      %-8s %3d   %s' % (onde, len(lst), ' · '.join(lst)))
print('  cliques até o primeiro lançamento ... %3d   (meta <= %d)' % (cliques, META_CLIQUES))
print('  lançamentos feitos .................. %3d' % lancou)
if erros:
    print('  ERRO DE CONSOLE ..................... %s' % erros[:2])
print('=' * 74)

falhou = []
if m['dobra'] > META_DOBRA:
    falhou.append('primeira dobra %d > %d' % (m['dobra'], META_DOBRA))
if cliques > META_CLIQUES:
    falhou.append('cliques %d > %d' % (cliques, META_CLIQUES))
if not lancou:
    falhou.append('o caminho medido NÃO lançou nada — a conta de cliques não vale')
if erros:
    falhou.append('erro de console')
if falhou:
    print('REPROVADO: ' + '; '.join(falhou))
    sys.exit(1)
print('APROVADO: primeira dobra com %d alvos e o primeiro lançamento em %d gestos.'
      % (m['dobra'], cliques))
