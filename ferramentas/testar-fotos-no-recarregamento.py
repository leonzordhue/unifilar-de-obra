# -*- coding: utf-8 -*-
"""A foto do ensaio sobrevive ao recarregamento quando o armazenamento está cheio?

   Existe porque duas correções de 22/08 se cruzavam, e o cruzamento só aparece com as duas
   juntas:

   1. `salvaLocal()` degrada quando o projeto não cabe: grava SEM as fotos, que têm chave
      própria (CHAVE_FOTOS). Serve para o quilômetro lançado não se perder.
   2. `aplicaProjeto()` passou a TROCAR o conjunto de fotos (`S.fotos = p.fotos || {}`) em vez
      de acrescentar, para a foto de uma obra fechada não comer o teto da obra seguinte.

   Juntas, sem ressalva, apagavam a foto do trabalho em curso: o projeto degradado dizia
   «fotos: {}» e a reabertura acreditava. A ressalva é o campo `fotosOmitidas`, e é isto que
   esta prova vigia — se alguém tirar a marca, ou fizer a reabertura ignorá-la, a foto some
   em silêncio no recarregamento seguinte.

   O armazenamento é enchido de verdade e o salvamento é o da plataforma: a primeira versão
   desta medição escrevia o projeto degradado à mão e, com isso, media a si mesma em vez de
   medir o código.

   Uso:  python ferramentas/testar-fotos-no-recarregamento.py
"""
import functools, http.server, os, socketserver, sys, threading
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = socketserver.TCPServer(('127.0.0.1', 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=RAIZ))
porta = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

falhas = []
def ok(cond, titulo, detalhe=''):
    print('  %-5s %s%s' % ('OK' if cond else 'FALHA', titulo, '  → ' + detalhe if detalhe else ''))
    if not cond:
        falhas.append(titulo)

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_context(viewport={'width': 1400, 'height': 900}).new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.goto('http://127.0.0.1:%d/index.html' % porta, wait_until='domcontentloaded')
    pg.wait_for_timeout(2500)
    pg.evaluate("""() => {
        const s = document.querySelector('#selAcervo');
        const o = [...s.options].find(x => x.textContent.includes('AM-010'));
        s.value = o.value; s.dispatchEvent(new Event('change'));
    }""")
    pg.wait_for_timeout(2800)

    antes = pg.evaluate("""() => {
        S.fotos['R1'] = 'data:image/jpeg;base64,' + 'A'.repeat(400 * 1024);
        S.reg.push({id: 'R1', foto: 'R1', cod: 'GC-ATERRO', seg: 1, valor: 97,
                    data: '22/08/2026', resp: 'medição de campo'});
        salvaFotos();
        // enche o armazenamento sem tocar na chave das fotos
        const g = 'x'.repeat(512 * 1024), m = 'y'.repeat(16 * 1024);
        try { for (let i = 0; i < 40; i++) localStorage.setItem('lixoG' + i, g); } catch (e){}
        try { for (let i = 0; i < 400; i++) localStorage.setItem('lixoM' + i, m); } catch (e){}
        salvaLocal();
        let proj = {};
        try { proj = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '{}'); } catch (e){}
        return {
          gravou: !!localStorage.getItem(CHAVE_LOCAL),
          fotosDentro: Object.keys(proj.fotos || {}).length,
          marcado: !!proj.fotosOmitidas,
          tarja: (document.querySelector('#marcaSalvo') || {}).textContent || '',
          naChave: Object.keys(JSON.parse(localStorage.getItem(CHAVE_FOTOS) || '{}')).length
        };
    }""")

    print('=' * 74)
    print('A FOTO DO ENSAIO SOBREVIVE AO RECARREGAMENTO COM O ARMAZENAMENTO CHEIO')
    print('=' * 74)
    print('\n1. SALVAMENTO COM O ARMAZENAMENTO CHEIO')
    ok(antes['gravou'], 'o projeto foi gravado mesmo sem espaço para tudo')
    ok(antes['fotosDentro'] == 0, 'degradou: as fotos ficaram fora do projeto',
       '%d foto(s) dentro' % antes['fotosDentro'])
    ok(antes['marcado'], 'o projeto degradado está marcado com fotosOmitidas')
    ok('Fotos sem espaço' in antes['tarja'], 'a tela avisa que as fotos não couberam',
       antes['tarja'] or '(sem tarja)')
    ok(antes['naChave'] == 1, 'a foto está guardada na chave própria')

    pg.reload(wait_until='domcontentloaded')
    pg.wait_for_timeout(3200)
    depois = pg.evaluate("""() => ({
        naChave: Object.keys(JSON.parse(localStorage.getItem(CHAVE_FOTOS) || '{}')).length,
        naMemoria: Object.keys(S.fotos || {}).length,
        registros: (S.reg || []).length,
        comFoto: (S.reg || []).filter(r => r.foto && (S.fotos || {})[r.foto]).length
    })""")
    print('\n2. O USUARIO RECARREGA A PAGINA')
    ok(depois['naChave'] == 1, 'a foto continua no navegador', '%d na chave' % depois['naChave'])
    ok(depois['registros'] == 1, 'o ensaio voltou', '%d registro(s)' % depois['registros'])
    ok(depois['comFoto'] == 1, 'o ensaio voltou COM a foto',
       '%d de %d com imagem' % (depois['comFoto'], depois['registros']))
    nav.close()
srv.shutdown()

print()
if falhas:
    print('RESULTADO: %d FALHA(S)' % len(falhas))
    for f in falhas:
        print('   falhou: ' + f)
    sys.exit(1)
print('RESULTADO: OK — o salvamento degradado não apaga a foto do trabalho em curso.')
