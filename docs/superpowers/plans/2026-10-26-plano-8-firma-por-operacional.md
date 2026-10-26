# Firma por operacional (Plano 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Spec:** `docs/superpowers/specs/2026-10-26-firma-por-operacional-design.md` (aprovado pelo Diretor).

**Architecture:** O backend continua avaliando por mercado (`estado.salas[ATIVO].traders[]`); a firma 3D reagrupa por boneco = (operacional, grupo). Grupos em `traders/__init__.py`: `GRUPOS = {"Brasil": ["WDO", "WIN", <ações do config>], "Global": [<7 pares Forex>, "BTCUSDT"]}` e `grupo_do_ativo(ativo)`. A pesquisa avisa o que está fazendo num arquivo que o servidor junta ao `/api/atividade`.

## Global Constraints
- Suite verde (`python -m unittest discover -s testes`), autotestes das skills, `node --check web/*.js`.
- Nenhuma ordem real. Visual no padrão Sims da firma (ver `mockups/firma-v3-*.png`). Textos pt-BR.
- Não desfazer o trabalho recente de outras sessões na firma (Diretor que anda por clique e senta, marca TradeQuarters, nomes e logos): construir por cima.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Grupos, atividade da pesquisa e quadro do laboratório (Python)
**Files:** traders/__init__.py, pesquisa/harness.py, servidor.py, testes/test_servidor.py, testes/test_pesquisa.py.
**Produz (contrato para a Task 2):**
- `traders.GRUPOS`, `traders.grupo_do_ativo(ativo) -> "Brasil" | "Global"`.
- `pesquisa.harness.anunciar(trader_nome, ativo, n, total, rotulo="")` grava `estado/atividade_pesquisa.json` = `{"trader", "grupo", "ativo", "n", "total", "rotulo", "desde", "batida"}` (escrita atômica); `avaliar()` chama `anunciar` sozinho a cada execução (n/total opcionais, padrão 1/1); `pesquisa.harness.concluir(titulo, linhas)` grava `estado/laboratorio.json` = `{"titulo", "quando", "linhas": [{"trader","grupo","ativo","tf","variante","trades","resultado","pf","passou": bool, "obs"}]}` e apaga o aviso de atividade.
- `GET /api/atividade` passa a ter também `"pesquisa": null | {trader, grupo, ativo, n, total, rotulo, desde}` — só se `batida` tiver menos de 120 s (aviso velho = ninguém testando). O `gerente` continua igual e ganha `"grupo"` quando há sala.
- `GET /api/laboratorio` → conteúdo de `estado/laboratorio.json` ou `{}`.
- [ ] Testes primeiro (grupos; aviso gravado e lido; aviso velho ignorado; laboratorio vazio e cheio). [ ] Implementar. [ ] Commit `feat: research activity and lab board data for the firm`.

## Task 2: Planta por operacional, dois bonecos por operacional (web)
**Files:** web/firma.js, web/firma.css, web/firma.html, web/firma.exemplo.json.
- Salas: norte Sofia e Didi (lugar de WDO/WIN); sul Caio e Demo (lugar de EURUSD/BTCUSDT); oeste Descanso (igual), corredor, Laboratório (lugar de Ações/Opções; quadro de pendências das opções vai para ele); Hall e Diretoria iguais. Placas novas; cores próprias por sala.
- Bonecos: "Sofia · Brasil", "Sofia · Global", "Didi · Brasil", "Didi · Global", "Caio · Brasil", "Caio · Global". Mesa Brasil com bandeirinha do Brasil, mesa Global com globo; mesmo cabelo/rosto do operacional, roupa em dois tons. Monitores por grupo de mercado.
- Dados por boneco: juntar de `estado.salas[ATIVO]` os mercados do grupo (via contrato da Task 1 ou a mesma tabela no JS lida de `/api/firma` se o servidor expuser `grupos`) — status do boneco = melhor status entre os mercados (promovido > experiência > pausado), com o detalhe por mercado no quadro e na ficha.
- Quadro de cada sala: dois blocos (Brasil e Global), uma linha por mercado com status e "N de M requisitos"; clique abre a ficha por mercado.
- Laboratório: quadro com `/api/laboratorio` (última rodada; "nenhuma rodada ainda" se vazio) + pendências das opções; o gerente fica lá quando `pesquisa` não é nulo.
- Demo: mesa para cada (boneco, mercado) promovido; hoje vazia com a placa "ninguém promovido ainda".
- Atividade: `gerente.estado == "trabalhando"` → os bonecos do grupo da sala em processamento vão à mesa (regra de hoje, por grupo); `pesquisa` não nulo → o boneco (trader, grupo) da pesquisa vai à mesa, tela do mercado acesa, rótulo "testando: WDO · 12/40"; Global pode trabalhar à noite, Brasil só das 9h às 18h (quando não há atividade, todos no descanso como hoje).
- [ ] Implementar. [ ] Capturas `mockups/firma-v4-1.png` (visão geral), `-2` (sala do Didi com os dois bonecos), `-3` (laboratório com teste simulado em andamento). [ ] Gate visual Sims. [ ] Commit `feat: firm rooms by operacional with Brasil and Global staff`.
