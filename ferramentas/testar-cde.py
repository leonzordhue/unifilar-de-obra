# -*- coding: utf-8 -*-
"""Prova o pacote CDE e o acervo local de tracado.

O pacote e o que sai da plataforma para o ambiente comum de dados: se ele chegar la
incompleto, ou com numero que nao confere com a tela, o erro so aparece na medicao. Aqui o
zip e aberto de verdade, arquivo por arquivo, e cada numero e conferido contra o que a
plataforma mostra.

Uso: python ferramentas/testar-cde.py
"""
import csv
import functools
import http.server
import io
import json
import os
import socketserver
import sys
import threading
import zipfile

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = os.path.join(RAIZ, "ferramentas", "_temp")
PORTA = 8757

falhas = []


def ok(cond, msg, extra=""):
    print(f"  {'OK   ' if cond else 'FALHA'} {msg}" + (f"  → {extra}" if extra else ""))
    if not cond:
        falhas.append(msg)


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    os.makedirs(TMP, exist_ok=True)
    H = functools.partial(Q, directory=RAIZ)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORTA), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    console = []

    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1600, "height": 950}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append(f"[{m.type}] {m.text}")
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))
        pg.on("dialog", lambda d: d.accept())
        pg.goto(f"http://127.0.0.1:{PORTA}/index.html", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)

        print("1. UMA OBRA COM O QUE TEM DE ENTRAR NO PACOTE")
        pg.evaluate("""() => {
            const sel = document.querySelector('#selAcervo');
            sel.selectedIndex = [...sel.options].findIndex(o => o.textContent.startsWith('AM-151'));
            sel.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)
        pg.evaluate("""() => {
            document.querySelector('#nomeObra').value = 'AM-151 — recuperação de erosões';
            const c = document.querySelector('#contrato');
            c.value = 'CT-00099/2026-SEINFRA'; c.dispatchEvent(new Event('input'));
            const o = document.querySelector('[data-ct="objeto"]');
            o.value = 'Recuperação de erosões'; o.dispatchEvent(new Event('input'));
            const l = {svc: 'EROSÕES', lado: 'U'};
            [3, 4].forEach(id => S.dados[chave(l, id)] = 'C');
            S.dados[chave(l, 9)] = 'E';
            const e = S.ens.find(x => x.cod === 'GC-BASE'); if (e) e.on = true;
            const r = novoRegistro(4, 'GC-BASE');
            r.valor = 92; r.lim_min = 95; r.resp = 'Fiscal do DMOB'; r.data = '2026-08-14';
            S.reg.push(r);
            pintaEns(); render();
        }""")
        pg.wait_for_timeout(1500)
        na_tela = pg.evaluate("""() => ({
            segs: S.segs.length,
            lanc: Object.keys(S.dados).length,
            reg: S.reg.length,
            conf: quadroObra().find(x => x.svc === 'EROSÕES').C
        })""")
        print(f"   na tela: {na_tela['segs']} segmentos · {na_tela['lanc']} lançamentos · "
              f"{na_tela['reg']} ensaio · {na_tela['conf']:.2f} km concluídos de erosões")

        print("\n2. O PACOTE É MONTADO E BAIXADO")
        with pg.expect_download(timeout=120000) as d:
            pg.evaluate("document.querySelector('#btCDE').click()")
        alvo = os.path.join(TMP, "pacote-cde.zip")
        d.value.save_as(alvo)
        tam = os.path.getsize(alvo)
        ok(tam > 20000, "o pacote saiu", f"{tam / 1024:,.0f} KB".replace(",", "."))
        z = zipfile.ZipFile(alvo)
        nomes = z.namelist()
        esperados = ["LEIA-ME.txt", "projeto.json", "01-eixo.geojson", "02-eixo.kml",
                     "03-matriz-de-controle.csv", "04-ensaios.csv", "05-croqui.png"]
        faltam = [n for n in esperados if n not in nomes]
        ok(not faltam, "todos os arquivos previstos estão no pacote",
           f"{len(nomes)} arquivo(s)" + (f" · faltam {faltam}" if faltam else ""))

        print("\n3. O GEOJSON TEM UMA FEIÇÃO POR QUILÔMETRO, COM OS NÚMEROS DA TELA")
        gj = json.loads(z.read("01-eixo.geojson").decode("utf-8"))
        ok(gj["type"] == "FeatureCollection" and len(gj["features"]) == na_tela["segs"],
           "uma feição por quilômetro", f"{len(gj['features'])} feição(ões)")
        ok(all(f["geometry"]["type"] == "LineString" and len(f["geometry"]["coordinates"]) >= 2
               for f in gj["features"]), "toda feição tem geometria de linha")
        km4 = next((f["properties"] for f in gj["features"]
                    if abs(f["properties"]["km_inicial"] - 4) < 1e-6), None)
        ok(km4 is not None and "EROSÕES" in (km4.get("servicos") or ""),
           "o serviço lançado aparece no KM 4", (km4 or {}).get("servicos", ""))
        ok(km4 and km4.get("ensaios_nao_conformes") == 1,
           "o ensaio não conforme aparece no KM 4",
           str((km4 or {}).get("ensaios_nao_conformes")))
        soma = sum(f["properties"]["extensao_km"] for f in gj["features"])
        ok(abs(soma - 12.525) < 0.02, "a extensão somada confere com o eixo",
           f"{soma:.3f} km")

        print("\n4. O KML ABRE NO GOOGLE EARTH")
        kml = z.read("02-eixo.kml").decode("utf-8")
        ok(kml.startswith("<?xml") and "<kml" in kml and "</kml>" in kml, "KML bem formado")
        ok(kml.count("<Placemark>") == na_tela["segs"],
           "um Placemark por quilômetro", str(kml.count("<Placemark>")))
        import xml.etree.ElementTree as ET
        try:
            ET.fromstring(kml)
            ok(True, "o XML do KML é válido")
        except ET.ParseError as e:
            ok(False, "o XML do KML é válido", str(e))

        print("\n5. OS CSV BATEM COM A TELA")
        mat = z.read("03-matriz-de-controle.csv").decode("utf-8-sig").splitlines()
        ok(len(mat) > 5 and mat[0].startswith("SERVICO;"), "matriz em CSV",
           f"{len(mat)} linha(s)")
        ens = list(csv.DictReader(io.StringIO(
            z.read("04-ensaios.csv").decode("utf-8-sig")), delimiter=";"))
        ok(len(ens) == na_tela["reg"], "um registro de ensaio por linha", f"{len(ens)}")
        if ens:
            e0 = ens[0]
            ok(e0["RESULTADO"] == "Não conforme", "o resultado do ensaio veio junto",
               e0["RESULTADO"])
            ok(e0["NORMA_METODO"] == "pendente de confirmação",
               "norma não confirmada sai declarada, e não em branco", e0["NORMA_METODO"])
            ok(e0["LIMITE_MIN"].replace(",", ".").startswith("95"),
               "o critério aplicado no aceite vai no registro", e0["LIMITE_MIN"])

        print("\n6. O LEIA-ME DECLARA PROCEDÊNCIA")
        leia = z.read("LEIA-ME.txt").decode("utf-8")
        for termo, oq in (("CT-00099/2026-SEINFRA", "o contrato"),
                          ("Vincenty", "como a extensão é medida"),
                          ("Origem da quilometragem", "de onde vem o KM 0"),
                          ("PENDENTE", "o aviso de norma pendente"),
                          ("Esri World Imagery", "o crédito da imagem")):
            ok(termo in leia, f"o LEIA-ME declara {oq}")

        print("\n7. O PACOTE REABRE NA PLATAFORMA")
        pg.evaluate("document.querySelector('#btNovo').click()")
        pg.wait_for_timeout(1500)
        ok(pg.evaluate("!S.eixo"), "tela limpa antes de reabrir")
        pg.set_input_files("#fileProjeto", alvo)
        pg.wait_for_timeout(4000)
        volta = pg.evaluate("""() => ({
            eixo: S.eixo ? S.eixo.nome : '', lanc: Object.keys(S.dados).length,
            reg: S.reg.length, contrato: document.querySelector('#contrato').value
        })""")
        ok(volta["eixo"] == "AM-151", "o eixo volta do zip", volta["eixo"])
        ok(volta["lanc"] == na_tela["lanc"], "os lançamentos voltam",
           f"{volta['lanc']} de {na_tela['lanc']}")
        ok(volta["reg"] == na_tela["reg"], "o ensaio volta", str(volta["reg"]))
        ok(volta["contrato"] == "CT-00099/2026-SEINFRA", "o contrato volta", volta["contrato"])

        print("\n8. ACERVO LOCAL — GUARDAR TRAÇADO SEM DEPENDER DE NINGUÉM")
        n0 = pg.evaluate("acervoLocal().length")
        pg.evaluate("""() => {
            // guarda o eixo atual sem passar pelo prompt do navegador
            const lista = acervoLocal();
            lista.push({tipo: 'local', id: 'Ramal de teste', nome: 'Ramal de teste',
                km_geometria: +S.segs.reduce((a, s) => a + s.ext, 0).toFixed(3),
                sentido: {metodo: 'indefinido'}, saltos_km: [], partes: S.eixo.linhas.length,
                guardado_em: '21/08/2026 20:00', linhas: S.eixo.linhas});
            gravaAcervoLocal(lista);
            document.querySelector("#segFonte button[data-f='local']").click();
        }""")
        pg.wait_for_timeout(2000)
        ok(pg.evaluate("acervoLocal().length") == n0 + 1, "o traçado entra no acervo local")
        opts = pg.evaluate("""[...document.querySelectorAll('#selAcervo option')]
            .map(o => o.textContent)""")
        ok(any("Ramal de teste" in o for o in opts),
           "aparece na quarta origem de traçado", " | ".join(opts)[:70])
        pg.evaluate("""() => {
            const s = document.querySelector('#selAcervo');
            s.selectedIndex = [...s.options].findIndex(o => o.textContent.startsWith('Ramal de teste'));
            s.dispatchEvent(new Event('change'));
        }""")
        pg.wait_for_timeout(2500)
        ok(pg.evaluate("S.eixo && S.eixo.nome") == "Ramal de teste",
           "e pode ser escolhido como eixo da obra")
        ok(pg.evaluate("S.segs.length") > 5, "com o traçado íntegro",
           f"{pg.evaluate('S.segs.length')} segmentos")
        sent = pg.evaluate("document.querySelector('#dicaSentido').textContent")
        ok("não verificado" in sent,
           "e avisando que o sentido não foi verificado — arquivo do usuário não traz isso")
        pg.evaluate("localStorage.removeItem(CHAVE_ACERVO_LOCAL)")

        nav.close()
    srv.shutdown()

    print(f"\nERROS DE CONSOLE: {len(console)}")
    for c in console[:8]:
        print("   ", c[:150])
    print("\nRESULTADO:", f"{len(falhas)} FALHA(S)" if falhas or console
          else "OK — o pacote CDE sai completo e reabre")
    for f in falhas:
        print("   falhou:", f)
    return 1 if (falhas or console) else 0


if __name__ == "__main__":
    sys.exit(main())
