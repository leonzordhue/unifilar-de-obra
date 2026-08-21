# -*- coding: utf-8 -*-
"""Junta as fatias de pesquisa de normas no catalogo, conferindo antes de deixar entrar.

Duas pessoas pesquisando normas ao mesmo tempo no MESMO arquivo se sobrescrevem. Cada uma
escreve a sua fatia em `dados/_normas/*.json`, e este script junta — recusando o que nao
cumpre a regra da casa.

A conferencia nao e burocracia. `confirmado: true` num item sem fonte e exatamente o modo
como norma errada entra num sistema de fiscalizacao: alguem teve pressa, marcou como
conferido, e a partir dali ninguem mais duvida. O script recusa e diz por que.

Uso:  python ferramentas/juntar-normas.py            confere e junta
      python ferramentas/juntar-normas.py --conferir  só confere, não grava
"""
import glob
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FATIAS = os.path.join(RAIZ, "dados", "_normas")
CATALOGO = os.path.join(RAIZ, "dados", "catalogo-ensaios.json")

# campos que a plataforma le; o resto e ignorado em silencio
CAMPOS = ("norma_metodo", "norma_especificacao", "criterio", "limite_min", "limite_max",
          "frequencia", "por_km", "confirmado", "observacao", "unidade", "camada")


def erro(lista, cod, msg):
    lista.append(f"{cod}: {msg}")


def confere(item, cod, problemas):
    """Devolve True quando o item pode entrar. Recusa o que se declara conferido sem sê-lo."""
    conf = bool(item.get("confirmado"))
    nm = item.get("norma_metodo") or {}
    ne = item.get("norma_especificacao") or {}
    if conf:
        if not (nm.get("codigo") or "").strip():
            erro(problemas, cod, "confirmado sem código de norma de método")
            return False
        if not (nm.get("titulo") or "").strip():
            erro(problemas, cod, "confirmado sem título da norma — código sozinho não permite"
                                 " a ninguém checar se é a norma certa")
            return False
        if not (nm.get("fonte") or "").strip():
            erro(problemas, cod, "confirmado sem fonte — é o campo que torna a conferência"
                                 " refazível por outra pessoa")
            return False
    else:
        if (nm.get("codigo") or "").strip():
            erro(problemas, cod, "tem código de norma mas está como não confirmado; a "
                                 "plataforma não exibe, e o trabalho se perde")
    for k in ("limite_min", "limite_max", "por_km"):
        v = item.get(k)
        if v is not None and not isinstance(v, (int, float)):
            erro(problemas, cod, f"{k} não é número: {v!r}")
            return False
    if item.get("por_km") is not None and item["por_km"] <= 0:
        erro(problemas, cod, "por_km deve ser maior que zero")
        return False
    mn, mx = item.get("limite_min"), item.get("limite_max")
    if mn is not None and mx is not None and mn > mx:
        erro(problemas, cod, f"limite mínimo ({mn}) maior que o máximo ({mx})")
        return False
    if ne.get("codigo") and not (ne.get("titulo") or "").strip():
        erro(problemas, cod, "especificação com código e sem título")
    return True


def main():
    so_confere = "--conferir" in sys.argv
    if not os.path.isdir(FATIAS):
        os.makedirs(FATIAS, exist_ok=True)
        print(f"pasta criada: {os.path.relpath(FATIAS, RAIZ)}")
    cat = json.load(io.open(CATALOGO, encoding="utf-8"))
    por_cod = {i["cod"]: i for i in cat["itens"]}

    arquivos = sorted(glob.glob(os.path.join(FATIAS, "*.json")))
    if not arquivos:
        print("nenhuma fatia em dados/_normas/ — nada a juntar.")
        print(f"catálogo atual: {len(cat['itens'])} itens · "
              f"{sum(1 for i in cat['itens'] if i.get('confirmado'))} confirmados")
        return 0

    problemas, entraram, desconhecidos, por_autor = [], 0, [], {}
    for arq in arquivos:
        nome = os.path.basename(arq)
        try:
            fatia = json.load(io.open(arq, encoding="utf-8"))
        except json.JSONDecodeError as e:
            problemas.append(f"{nome}: JSON inválido — {e}")
            continue
        itens = fatia.get("itens", fatia if isinstance(fatia, list) else [])
        autor = fatia.get("autor", nome)
        n = 0
        for it in itens:
            cod = (it.get("cod") or "").strip()
            if not cod:
                problemas.append(f"{nome}: item sem `cod`")
                continue
            if cod not in por_cod:
                desconhecidos.append(f"{cod} (em {nome})")
                continue
            if not confere(it, cod, problemas):
                continue
            alvo = por_cod[cod]
            # Só entra o que ACRESCENTA. Uma fatia ainda em branco tem `confirmado: false` e
            # dicionários de norma com campos vazios — e ambos são valores «preenchidos» para
            # uma cópia ingênua. Juntar assim rebaixaria item já confirmado por outra pessoa,
            # em silêncio, que é o pior jeito de perder trabalho conferido.
            for k in CAMPOS:
                if k not in it:
                    continue
                v = it[k]
                if v is None or v == "":
                    continue
                if k == "confirmado" and not v:
                    continue
                if isinstance(v, dict) and not any((str(x) or "").strip() for x in v.values()):
                    continue
                alvo[k] = v
            if it.get("confirmado"):
                alvo["confirmado"] = True
                alvo["conferido_por"] = autor
            n += 1
            entraram += 1
        por_autor[autor] = por_autor.get(autor, 0) + n
        # O que a fatia declara como não conferido entra na lista da raiz, deduplicado pelo
        # CÓDIGO do ensaio. Comparar o objeto inteiro fazia a mesma declaração entrar duas
        # vezes assim que alguém acrescentasse um campo a ela — e a lista que existe para
        # dizer o que falta passava a mentir sobre quantos faltam.
        raiz = cat.setdefault("nao_confirmados", [])
        for nc in fatia.get("nao_confirmados", []):
            cod = nc.get("cod") if isinstance(nc, dict) else None
            if cod is None:
                if nc not in raiz:
                    raiz.append(nc)
                continue
            atual = next((x for x in raiz if isinstance(x, dict) and x.get("cod") == cod), None)
            if atual is None:
                raiz.append(nc)
            else:
                # a declaração que já está na raiz manda: pode ter sido revista à mão
                for k, v in nc.items():
                    atual.setdefault(k, v)

    # Contradição: confirmado E declarado não confirmado. Sai no mesmo documento, dizendo as
    # duas coisas. O caso legítimo é a conferência PARCIAL — método conferido, critério não —,
    # e esse se declara com `parcial: true`.
    declarados = {n.get("cod"): n for n in cat.get("nao_confirmados", []) if isinstance(n, dict)}
    for i in cat["itens"]:
        d = declarados.get(i["cod"])
        if i.get("confirmado") and d and not d.get("parcial"):
            problemas.append(f"{i['cod']}: está confirmado e também declarado como NÃO "
                             "confirmado. Se a conferência foi parcial — método sim, critério "
                             "não —, marque `parcial: true` na declaração; se foi completa, "
                             "tire da lista.")

    conf = sum(1 for i in cat["itens"] if i.get("confirmado"))
    print(f"fatias lidas: {len(arquivos)}")
    for a, n in sorted(por_autor.items()):
        print(f"   {a}: {n} item(ns) aceito(s)")
    if desconhecidos:
        print(f"\n{len(desconhecidos)} código(s) que não existem no catálogo — ignorados:")
        for d in desconhecidos[:10]:
            print("   ", d)
    if problemas:
        print(f"\n{len(problemas)} RECUSA(S) — não entraram, e o motivo é o que segue:")
        for p in problemas:
            print("   ", p)
    print(f"\ncatálogo: {len(cat['itens'])} itens · {conf} confirmados · "
          f"{len(cat.get('nao_confirmados', []))} declarados como não confirmados")

    if so_confere:
        print("\n(--conferir: nada foi gravado)")
        return 1 if problemas else 0
    if conf:
        cat["estado"] = "parcial" if conf < len(cat["itens"]) else "completo"
    io.open(CATALOGO, "w", encoding="utf-8", newline="\n").write(
        json.dumps(cat, ensure_ascii=False, indent=1) + "\n")
    print(f"gravado: dados/catalogo-ensaios.json")
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
