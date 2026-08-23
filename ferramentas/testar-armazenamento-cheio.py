# -*- coding: utf-8 -*-
"""Auditoria adversarial: o que acontece com o trabalho quando o armazenamento
do navegador enche.

Ponto levantado pela Cortanna: "o acervo local estoura a cota do navegador? O que
acontece com o que ja estava guardado?"

A hipotese que eu quero provar ou derrubar: `salvaLocal()` engole a excecao de
cota num catch vazio (app/08-persistencia.js). Se for isso, o usuario lanca
quilometro por uma hora, a tela mostra tudo, nada e' gravado, e ao recarregar o
trabalho sumiu — sem um aviso em nenhum momento.

O teste enche o localStorage de proposito, lanca, recarrega e conta o que sobrou.
"""
import functools
import http.server
import os
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=RAIZ)
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
porta = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

alertas = []

with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_context(viewport={'width': 1500, 'height': 900}).new_page()
    pg.on('dialog', lambda d: (alertas.append(d.message[:120]), d.accept()))
    pg.goto(f'http://127.0.0.1:{porta}/index.html', wait_until='domcontentloaded')
    pg.wait_for_timeout(2500)

    # escolhe um eixo e lanca algumas celulas, com o armazenamento LIVRE
    pg.evaluate("document.querySelector(\"#segFonte button[data-f='rodovia']\").click()")
    pg.wait_for_timeout(400)
    pg.evaluate("""() => {
        const s = document.querySelector('#selAcervo');
        s.value = [...s.options].find(x => x.textContent.includes('AM-010')).value;
        s.dispatchEvent(new Event('change'));
    }""")
    pg.wait_for_timeout(2600)
    pg.evaluate("document.querySelector(\".abas button[data-v='matriz']\").click()")
    pg.wait_for_timeout(1400)
    pg.evaluate("""() => {
        for (let i = 0; i < 5; i++){
            const c = document.querySelector(`#vMatriz td.cel[data-l="0"][data-id="${i}"]`);
            if (c) c.click();
        }
    }""")
    pg.wait_for_timeout(900)
    antes = pg.evaluate("Object.keys(S.dados).length")
    gravado_antes = pg.evaluate(
        "((localStorage.getItem('controle-obra-unifilar-v1')||'').length)")

    # agora ENCHE o armazenamento e continua lancando
    enchido = pg.evaluate("""() => {
        let n = 0;
        // enche com bloco grande e depois com bloco pequeno, para nao sobrar
        // folga: o objetivo e' o proprio PROJETO nao caber, nao o lixo
        const g = 'x'.repeat(512 * 1024), m = 'y'.repeat(16 * 1024);
        try {
            for (let i = 0; i < 40; i++){ localStorage.setItem('lixoG' + i, g); n++; }
        } catch (e){ /* segue com bloco pequeno */ }
        try { for (let i = 0; i < 400; i++){ localStorage.setItem('lixoM' + i, m); n++; } }
        catch (e){ return {blocos: n, erro: e.name}; }
        return {blocos: n, erro: null};
    }""")
    alertas.clear()
    # foto em base64, que e' o que a plataforma guarda de verdade nos ensaios
    pg.evaluate("""() => {
        S.fotos = S.fotos || {};
        S.reg = S.reg || [];
        for (let f = 0; f < 3; f++){
            const nome = 'foto' + f + '.jpg';
            S.fotos[nome] = 'data:image/jpeg;base64,' + 'A'.repeat(400 * 1024);
            S.reg.push({id: 'R' + f, foto: nome, ens: 'GC-ATERRO', km: f});
        }
    }""")
    pg.evaluate("""() => {
        for (let i = 10; i < 25; i++){
            const c = document.querySelector(`#vMatriz td.cel[data-l="1"][data-id="${i}"]`);
            if (c) c.click();
        }
    }""")
    pg.wait_for_timeout(1200)
    depois_memoria = pg.evaluate("Object.keys(S.dados).length")
    gravado_depois = pg.evaluate(
        "((localStorage.getItem('controle-obra-unifilar-v1')||'').length)")
    avisou = len(alertas)
    # a tela mostra o trabalho?
    pintadas = pg.evaluate("""() =>
        [...document.querySelectorAll('#vMatriz td.cel')].filter(td =>
            td.textContent.trim()).length""")

    # o usuario recarrega
    pg.reload(wait_until='domcontentloaded')
    pg.wait_for_timeout(3000)
    sobrou = pg.evaluate("Object.keys(S.dados || {}).length")

    nav.close()
srv.shutdown()

print('=' * 76)
print('AUDITORIA: ARMAZENAMENTO CHEIO x TRABALHO LANÇADO')
print('=' * 76)
print(f'  lançamentos antes de encher .............. {antes}')
print(f'  bytes gravados no localStorage ........... {gravado_antes}')
print(f'  blocos de 512 KB que couberam ............ {enchido["blocos"]}'
      f'  ({enchido["erro"] or "sem erro"})')
print()
print(f'  lançamentos em memória depois ............ {depois_memoria}')
print(f'  células PINTADAS na tela ................. {pintadas}')
print(f'  bytes gravados depois .................... {gravado_depois}')
print(f'  avisos mostrados ao usuário .............. {avisou}'
      + (f'  -> {alertas[:2]}' if alertas else ''))
print()
print(f'  APÓS RECARREGAR, lançamentos que sobraram  {sobrou}')
print('=' * 76)

perdidos = depois_memoria - sobrou
if perdidos > 0 and avisou == 0:
    print(f'ACHADO: {perdidos} lançamento(s) perdidos SEM UM ÚNICO AVISO.')
    print('        A tela mostrava o trabalho; o armazenamento recusou; o catch de')
    print('        salvaLocal() (app/08-persistencia.js) está vazio.')
    sys.exit(1)
if perdidos > 0:
    print(f'ACHADO PARCIAL: {perdidos} perdidos, mas o usuário foi avisado {avisou}x.')
    sys.exit(1)
# Carimbo de veredito, no formato que a casa usa: sem ele a `rodar-todas.py` classifica
# este arquivo como RELATO e o tira da conta dos portoes. Ele E' portao -- sai 1 quando
# perde lancamento --, so nao estava dizendo isso na linguagem que o contador le.
print('RESULTADO: OK — o armazenamento cheio não leva lançamento embora em silêncio')
