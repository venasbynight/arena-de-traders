"""Relatórios do gerente: um HTML por trader, gerente.html (resumo da firma) e briefing.md para a mente de IA.

Todo texto vindo do estado passa por html.escape: a firma embute o gerente.html num iframe.
"""
import json
import os
import re
import threading
import time
import unicodedata
from datetime import datetime
from html import escape

from motor import preco, size

STATUS = {"promovido": "promovido", "pausado": "pausado", "experiencia": "em experiência"}
CSS = """<link rel="stylesheet" href="/web/estilo.css">
<style>
html,body{height:auto}
body{display:block;min-height:0;max-width:1100px;margin:0 auto;padding:20px}
h1{font-size:20px;margin-bottom:4px}h3{margin:20px 0 8px}
p{margin-bottom:6px}ul{margin-left:18px}li{margin-bottom:4px}a{color:var(--acc)}
.chip{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px;margin-right:6px}
#curva{height:320px;border:1px solid var(--line);border-radius:8px}
</style>"""


def gravar(caminho, texto):
    """Grava inteiro ou nada (arquivo temporário + os.replace): o servidor pode ler a qualquer momento."""
    tmp = f"{caminho}.{os.getpid()}.{threading.get_ident()}.tmp"  # único por processo e thread
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(texto)
    for _ in range(20):
        try:
            return os.replace(tmp, caminho)
        except PermissionError:  # Windows: quem lê está com o arquivo aberto neste instante
            time.sleep(0.05)
    os.replace(tmp, caminho)


def slug(nome):
    """Nome do arquivo do trader, igual ao slug da firma.js: ascii minúsculo, o resto vira '-'."""
    ascii_ = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")


def brl(v):
    """+R$ 1.234 / −R$ 56 / R$ 0 (sem centavos, milhar com ponto)."""
    v = round(v or 0)
    return ("−" if v < 0 else "+" if v > 0 else "") + "R$ " + f"{abs(v):,}".replace(",", ".")


def num(v, casas=2):
    """1.234,56 / −29,79 (o mesmo sinal de menos do brl)."""
    return "—" if v is None else f"{v:,.{casas}f}".replace(",", "_").replace(".", ",").replace("_", ".").replace("-", "−")


def pct(v):
    return "—" if v is None else f"{round(v * 100)}%"


def _cls(v):
    return "up" if (v or 0) > 0 else "dn" if (v or 0) < 0 else "mut"


def _cambio(premissas):
    """A premissa de câmbio como ela entra na conta: o ponto_rs fixo no config dos ativos cotados fora da B3."""
    ativos = premissas.get("ativos") or {}
    extras = [f"{a} {format(e['ponto_rs'], 'g').replace('.', ',')} R$/1,0" for a, e in ativos.items()
              if a not in size.ATIVOS and e.get("ponto_rs") is not None]
    return f"ponto_rs fixo no config: {' · '.join(extras)} (câmbio de referência {num(premissas.get('usd_brl'))})"


def _params(p):
    return " · ".join(f"{k} = {v}" for k, v in (p or {}).items()) or "padrão"


def _pagina(titulo, corpo, cabeca=""):
    return (f'<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>{escape(titulo)}</title>\n'
            f'{CSS}\n{cabeca}</head>\n<body>\n{corpo}\n</body></html>\n')


def _placar(t):
    linhas = [("Resultado", lambda x: f'<span class="{_cls(x.get("resultado"))}">{brl(x.get("resultado"))}</span>'),
              ("Trades", lambda x: str(x.get("trades", "—"))),
              ("Acerto", lambda x: pct(x.get("acerto"))),
              ("Fator de lucro", lambda x: num(x.get("fator_lucro"))),
              ("Drawdown", lambda x: brl(x.get("drawdown"))),
              ("Pior dia", lambda x: brl(x.get("pior_dia"))),
              ("Confiança", lambda x: escape(str(x.get("confianca", "—"))))]
    treino, prova = t.get("treino") or {}, t.get("prova") or {}
    return ("<table><tr><th></th><th>Treino</th><th>Prova</th></tr>"
            + "".join(f"<tr><td>{rot}</td><td>{f(treino)}</td><td>{f(prova)}</td></tr>" for rot, f in linhas)
            + "</table>")


def _periodos(sala):
    p = sala.get("periodos")
    if not p:
        return ""
    fmt = lambda x: f'{escape(x["de"])} a {escape(x["ate"])} ({x["pregoes"]} pregões)'
    return f'<p class="mut">treino {fmt(p["treino"])} · prova {fmt(p["prova"])}</p>'


def _segundos(iso):
    # Lightweight Charts lê segundos UTC; marcar o horário de Brasília como UTC mostra a hora certa no eixo
    return int((datetime.fromisoformat(iso) - datetime(1970, 1, 1)).total_seconds())


def _trader(ativo, sala, t, operacoes, estado):
    premissas = estado.get("premissas") or {}
    tick = ((premissas.get("ativos") or {}).get(ativo) or {}).get("tick")
    pontos = [{"time": _segundos(iso), "value": saldo} for iso, saldo in t.get("equity", [])]
    dados_js = json.dumps(pontos).replace("<", "\\u003c")
    ops = "".join(
        f'<tr><td>{escape(o["entrada_t"].replace("T", " ")[:16])}</td><td>{escape(o["saida_t"][11:16])}</td>'
        f'<td>{escape(o["lado"])}</td><td>{o["contratos"]}</td><td>{preco(o["entrada"], tick)}</td><td>{preco(o["saida"], tick)}</td>'
        f'<td class="{_cls(o["resultado_rs"])}">{num(o["resultado_rs"])}</td><td>{escape(o["motivo_saida"])}</td>'
        f'<td>{escape(str(o.get("setup", "")))}</td></tr>' for o in operacoes)
    nome = t["nome"]
    corpo = f"""<h1>{escape(nome)} <span class="mut">· {escape(ativo)}</span></h1>
<p class="mut">{escape(t.get("estilo", ""))} · ciclo de {escape(estado.get("dia", ""))}</p>
<p><span class="chip">{escape(STATUS.get(t["status"], t["status"]))}</span>{'<span class="chip dn">overfit</span>' if t.get("overfit") else ""}</p>
<h3>Decisão do gerente</h3><p>{escape(t.get("decisao", ""))}</p>
{('<p class="warn">' + escape(sala["motivo"]) + "</p>") if sala.get("motivo") else ""}
<h3>Placar</h3>{_periodos(sala)}{_placar(t)}
<h3>Parâmetros</h3><p>{escape(_params(t.get("parametros")))}</p>
<h3>Curva de capital na prova</h3><div id="curva"></div>
<h3>Operações da prova ({len(operacoes)})</h3>
<table><tr><th>Entrada</th><th>Saída</th><th>Lado</th><th>Contratos</th><th>Preço entrada</th><th>Preço saída</th><th>R$</th><th>Motivo</th><th>Setup</th></tr>{ops}</table>
<h3>Diário do último dia da prova</h3><ul>{"".join(f"<li>{escape(l)}</li>" for l in t.get("diario", [])) or '<li class="mut">sem anotações</li>'}</ul>
<p class="mut">Premissa: {escape(_cambio(premissas))}. Conta simulada; nenhuma ordem real.</p>
<script>
const pontos = {dados_js};
if (window.LightweightCharts && pontos.length) {{
  const el = document.getElementById("curva");
  const grafico = LightweightCharts.createChart(el, {{autoSize: true,
    layout: {{background: {{color: "#121821"}}, textColor: "#e6edf3"}},
    grid: {{vertLines: {{color: "#1f2a36"}}, horzLines: {{color: "#1f2a36"}}}},
    timeScale: {{timeVisible: true}}}});
  grafico.addLineSeries({{color: "#4c8dff", lineWidth: 2}}).setData(pontos);
  grafico.timeScale().fitContent();
}}
</script>"""
    cabeca = ('<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/'
              'lightweight-charts.standalone.production.js"></script>\n')
    return _pagina(f"{nome} · {ativo} · {estado.get('dia', '')}", corpo, cabeca)


def _gerente(estado):
    """Resumo da firma, sem script (a firma embute este arquivo num iframe sem allow-scripts)."""
    salas = []
    for ativo, sala in estado["salas"].items():
        if sala["status"] != "ok":
            salas.append(f'<h3>{escape(ativo)}</h3><p class="warn">aguardando dados: {escape(sala.get("motivo", ""))}</p>')
            continue
        linhas = "".join(
            f'<tr><td><a href="{escape(ativo.lower() + "-" + slug(t["nome"]) + ".html")}" target="_blank">'
            f'{escape(t["nome"])}</a></td><td>{escape(STATUS.get(t["status"], t["status"]))}{" · overfit" if t.get("overfit") else ""}</td>'
            f'<td class="{_cls(t["treino"]["resultado"])}">{brl(t["treino"]["resultado"])}</td><td>{t["treino"]["trades"]}</td>'
            f'<td class="{_cls(t["prova"]["resultado"])}">{brl(t["prova"]["resultado"])}</td><td>{t["prova"]["trades"]}</td>'
            f'<td>{num(t["prova"]["fator_lucro"])}</td><td>{brl(t["prova"]["drawdown"])}</td>'
            f'<td>{escape(_params(t.get("parametros")))}</td></tr><tr><td colspan="9" class="mut">{escape(t["decisao"])}</td></tr>'
            for t in sala["traders"])
        salas.append(f'<h3>{escape(ativo)}</h3>{_periodos(sala)}'
                     + (f'<p class="warn">{escape(sala["motivo"])}</p>' if sala.get("motivo") else "")
                     + '<table><tr><th>Trader</th><th>Status</th><th>Treino</th><th>Trades</th><th>Prova</th>'
                       '<th>Trades</th><th>Fator</th><th>Drawdown</th><th>Parâmetros</th></tr>' + linhas + "</table>")
    ranking = "".join(f'<tr><td>{i}</td><td>{escape(r["nome"])}</td><td>{escape(r["sala"])}</td>'
                      f'<td class="{_cls(r["prova_resultado"])}">{brl(r["prova_resultado"])}</td></tr>'
                      for i, r in enumerate(estado.get("ranking", []), 1))
    pend = "".join(f"<li>{escape(p)}</li>" for p in estado.get("pendencias", [])) or '<li class="mut">nenhuma</li>'
    premissas = estado.get("premissas") or {}
    corpo = f"""<h1>Relatório do gerente · {escape(estado.get("dia", ""))}</h1>
<p class="mut">gerado em {escape(estado.get("gerado_em", "").replace("T", " "))} · {escape(_cambio(premissas))} ·
treino = tudo menos os últimos 21 pregões; prova = últimos 21 · contas simuladas de R$ 5.000, nenhuma ordem real</p>
<h3>Pendências</h3><ul>{pend}</ul>
<h3>Ranking (resultado na prova)</h3>
<table><tr><th>#</th><th>Trader</th><th>Sala</th><th>Prova</th></tr>{ranking}</table>
{"".join(salas)}"""
    return _pagina(f"Gerente · {estado.get('dia', '')}", corpo)


def _briefing(estado):
    dia = estado.get("dia", "")
    p = estado.get("premissas") or {}
    linhas = [f"# Briefing do gerente · {dia}", "",
              f"Para a mente de IA: comente as decisões abaixo e grave relatorios/{dia}/gerente-ia.md.",
              f"Premissas: contas simuladas de R$ 5.000; {_cambio(p)}; treino = tudo menos os "
              "últimos 21 pregões, prova = últimos 21; promoção pede treino e prova positivos, fator ≥ 1,2, ≥ 50 trades "
              "(treino e prova) e sem overfit (ganho por pregão da prova < 50% do treino); pausa com drawdown pior que "
              "−R$ 1.500 ou 5 dias seguidos perdendo R$ 25 ou mais.", "", "## Pendências"]
    linhas += [f"- {x}" for x in estado.get("pendencias", [])] or ["- nenhuma"]
    linhas.append("")
    for ativo, sala in estado["salas"].items():
        if sala["status"] != "ok":
            linhas.append(f"## {ativo}: sem dados — {sala.get('motivo', '')}")
            continue
        per = sala.get("periodos")
        linhas.append(f"## {ativo}" + (f" (treino {per['treino']['pregoes']} pregões até {per['treino']['ate']}, "
                                         f"prova {per['prova']['pregoes']} até {per['prova']['ate']})" if per else ""))
        if sala.get("motivo"):
            linhas.append(f"Aviso: {sala['motivo']}")
        for t in sala["traders"]:
            tr, pr = t["treino"], t["prova"]
            linhas.append(f"- {t['nome']} [{STATUS.get(t['status'], t['status'])}] parâmetros {_params(t['parametros'])}; "
                          f"treino {brl(tr['resultado'])} em {tr['trades']} trades (fator {num(tr['fator_lucro'])}); "
                          f"prova {brl(pr['resultado'])} em {pr['trades']} trades (fator {num(pr['fator_lucro'])}, "
                          f"drawdown {brl(pr['drawdown'])}). Decisão: {t['decisao']}")
    linhas += ["", "## Ranking (prova)"]
    linhas += [f"{i}. {r['nome']} ({r['sala']}) {brl(r['prova_resultado'])}" for i, r in enumerate(estado.get("ranking", [])[:10], 1)]
    if len(linhas) > 60:  # o briefing é curto de propósito; o detalhe está nos HTML
        linhas = linhas[:59] + ["(cortado em 60 linhas; detalhes em gerente.html)"]
    return "\n".join(linhas) + "\n"


def escrever(estado, operacoes_por_trader, pasta_dia):
    """Grava os relatórios do dia em `pasta_dia` e devolve os nomes dos arquivos.

    `operacoes_por_trader`: {(ativo, nome): operações da prova}. Por último grava `index.json` com a lista
    deste ciclo: arquivos que sobraram de um ciclo anterior do mesmo dia ficam fora dela.
    """
    os.makedirs(pasta_dia, exist_ok=True)
    arquivos = {"gerente.html": _gerente(estado)}
    for ativo, sala in estado["salas"].items():
        for t in sala["traders"]:
            ops = operacoes_por_trader.get((ativo, t["nome"]), [])
            arquivos[f"{ativo.lower()}-{slug(t['nome'])}.html"] = _trader(ativo, sala, t, ops, estado)
    arquivos["briefing.md"] = _briefing(estado)
    for nome, texto in arquivos.items():
        gravar(os.path.join(pasta_dia, nome), texto)
    gravar(os.path.join(pasta_dia, "index.json"),
           json.dumps({"dia": estado.get("dia"), "arquivos": list(arquivos)}, ensure_ascii=False))
    return list(arquivos)
