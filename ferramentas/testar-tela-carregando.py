# -*- coding: utf-8 -*-
"""A tela durante o CARREGAMENTO — o estado que a suíte inteira não media.

   Em 23/08 o cliente abriu o relatório 1,2 s depois de escolher o eixo e recebeu um documento
   sem mapa. A suíte estava verde com 24 portões: todas as provas começam com
   `wait_for_timeout(2600)` e medem a plataforma **estabilizada**. Ele usa a plataforma
   **carregando** — e nesse estado a tela dizia «Escolha um eixo na lateral», que é a mesma
   frase de quando não se escolheu nada.

   Silêncio durante o carregamento é indistinguível de tela vazia. Esta prova exige o
   contrário: quem depende de dado a caminho **declara** o que está esperando, e some sozinho
   quando o dado chega.

   Uso:  python ferramentas/testar-tela-carregando.py
"""
import functools, http.server, os, socketserver, sys, threading, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
falhas = []


def ok(cond, titulo, detalhe=''):
    print('  %-5s %s%s' % ('OK' if cond else 'FALHA', titulo, '  → ' + detalhe if detalhe else ''))
    if not cond:
        falhas.append(titulo)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def atrasa_ramais(route):
    """Atrasa o acervo de ramais na REDE DO NAVEGADOR, e não no servidor.

    A primeira versão desta prova atrasava no `SimpleHTTPRequestHandler`, e a corrida não
    acontecia: depois da primeira leitura o navegador servia o arquivo do próprio cache, sem
    pedir nada, e o «carregando» durava zero. Interceptar aqui pega os dois casos — é o mesmo
    erro de instrumento que a casa vem catalogando o dia inteiro, agora no meu teste."""
    time.sleep(1.5)
    route.continue_()


srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Silencioso, directory=RAIZ))
porta = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_context(viewport={'width': 1500, 'height': 900}).new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)[:140]))
    pg.route('**/acervo-ramais.json', atrasa_ramais)
    pg.goto('http://127.0.0.1:%d/index.html' % porta, wait_until='domcontentloaded')
    pg.wait_for_timeout(2500)

    print('=' * 74)
    print('A TELA ENQUANTO O DADO ESTA A CAMINHO')
    print('=' * 74)

    print('\n1. ESCOLHER UM EIXO QUE DEMORA: A TELA DIZ O QUE ESTA ESPERANDO')
    pg.evaluate("""() => { const b = document.querySelector('#segFonte button[data-f="ramal"]');
        if (b) b.click(); }""")
    pg.wait_for_timeout(2200)
    pg.evaluate("""() => { const b = [...document.querySelectorAll('#abas button[data-v]')]
        .find(x => x.dataset.v === 'matriz'); if (b) b.click(); }""")
    pg.wait_for_timeout(300)
    # escolhe e olha IMEDIATAMENTE, sem esperar: é o gesto do cliente
    pg.evaluate("""() => {
        // o acervo fica em `S.acervo[tipo]` depois da primeira leitura: sem limpar o cache, a
        // segunda escolha e' instantanea e a corrida que se quer medir nao acontece
        S.acervo.ramal = null;
        const s = document.querySelector('#selAcervo');
        s.value = '0'; s.dispatchEvent(new Event('change'));
    }""")
    pg.wait_for_timeout(250)
    durante = pg.evaluate("""() => ({
        matriz: (document.querySelector('#vMatriz') || {}).textContent || '',
        estado: S.carregando || ''
    })""")
    ok('caminho' in durante['estado'] or 'carregando' in durante['estado'].lower(),
       'o estado declara o que está a caminho', durante['estado'] or '(nada)')
    ok('Escolha um eixo' not in durante['matriz'],
       'a grade NÃO diz «escolha um eixo» enquanto o eixo está vindo',
       durante['matriz'].strip()[:60])
    ok('carregando' in durante['matriz'].lower() or 'caminho' in durante['matriz'].lower(),
       'ela diz o que está esperando', durante['matriz'].strip()[:60])

    print('\n2. QUANDO O DADO CHEGA, O AVISO SAI SOZINHO')
    pg.wait_for_timeout(4000)
    depois = pg.evaluate("""() => ({
        estado: S.carregando || '',
        temEixo: !!S.eixo,
        celulas: document.querySelectorAll('#vMatriz td.cel').length
    })""")
    ok(depois['estado'] == '', 'o aviso de carregamento sumiu', depois['estado'] or '(vazio)')
    ok(depois['temEixo'] and depois['celulas'] > 0,
       'e a grade apareceu sem ninguém clicar de novo', '%d células' % depois['celulas'])

    print('\n3. AS QUATRO VISTAS RESPEITAM O ESTADO — nenhuma fica calada')
    vistas = pg.evaluate("""() => {
        S.carregando = 'montando o traçado…';
        const eixo = S.eixo, segs = S.segs;
        S.eixo = null; S.segs = [];
        // `render()` pinta so a vista ATIVA: ler o DOM das outras devolveria o que ficou da
        // vez passada. Cada pintor e' chamado de propósito, que e' o que acontece quando a
        // pessoa abre aquela aba durante o carregamento.
        const ler = id => (document.querySelector(id) || {}).textContent || '';
        pintaMatriz();
        const matriz = ler('#vMatriz');
        pintaRel();
        const rel = ler('#vRel');
        if (typeof pintaPainel === 'function') pintaPainel();
        const painel = ler('#vPainel');
        if (typeof pintaFaixa === 'function') pintaFaixa();
        const faixa = ler('#faixa');
        S.eixo = eixo; S.segs = segs; S.carregando = '';
        render();
        return {matriz, rel, painel, faixa};
    }""")
    for nome, txt in vistas.items():
        ok('montando o traçado' in txt,
           'a vista «%s» declara o carregamento em vez de dizer que está vazia' % nome,
           txt.strip()[:50] or '(vazia)')

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
print('RESULTADO: OK — nenhuma vista fica calada enquanto o dado está a caminho')
