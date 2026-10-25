# Didi Agulhada (Plano 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Novo trader "Didi Agulhada" em todos os ativos, com o gráfico completo do Didi (Bollinger no preço, painel do Didi Index, painel do ADX/DI) na sala de operações.

**Decisões do usuário (2026-10-25, conversa):** traders da firma = Sofia SMC, Didi Agulhada e (depois) Caio Contrafluxo; Rafa e Vera removidos. Didi "é assim" (versão clássica descrita abaixo), com ADX e Bollinger, "o gráfico do Didi completo", em todos os ativos. Escolhas do controlador, aprovadas pelo usuário ("isso, pode seguir"): 5 min como padrão e 15 min testado pelo gerente; alvo de proteção a 3× o risco.

**Regras do Didi (exatas):**
- Médias aritméticas simples do fechamento: 3, 8 e 20 períodos. Didi Index: curta = MA3 − MA8, longa = MA20 − MA8 (a linha da 8 é o zero).
- Agulhada de compra: no mesmo candle, MA3 cruza a MA8 para cima (curta passa de ≤ 0 para > 0) e MA20 cruza a MA8 para baixo (longa passa de ≥ 0 para < 0). Venda: espelho.
- ADX de 8 períodos (Wilder, com DI+ e DI−): compra só com ADX maior que no candle anterior e DI+ > DI−; venda com ADX subindo e DI− > DI+.
- Bollinger de 8 períodos, 2 desvios (desvio populacional), centro MA8: só com as bandas abrindo (largura maior que no candle anterior).
- Entrada: ordem stop 1 tick além da máxima (compra) / mínima (venda) do candle da agulhada, válida só no candle seguinte; não executou, cancela.
- Stop: 1 tick além da mínima (compra) / máxima (venda) do candle da agulhada.
- Saída por sinal: MA3 cruza de volta a MA8 (curta muda de sinal contra a posição) no fechamento → sai a mercado na abertura do candle seguinte (paga 1 tick como a zeragem).
- Alvo de proteção: entrada ± 3 × risco (risco = |entrada − stop|), para o R:R e como take-profit.
- `PARAMS = {"tf": 5, "alvo_x": 3.0}`, `GRADE = {"tf": [5, 15], "alvo_x": [2.0, 3.0, 4.0]}`. Com tf 15, o trader agrega os candles de 5 em 15 (ontem5 + hoje5) e só decide no fechamento de um candle de 15.
- Indicadores precisam de histórico: usar ontem5 + hoje5 (mesmo dia de ontem para aquecer as médias); sem candles suficientes, pensamento explica e não opera.

**Architecture:** O motor ganha (a) `Plano.tipo == "stop"` (entrada stop válida por um candle; executa se a máxima passar 1 tick além do gatilho na compra, preço = max(gatilho, abertura) — gap pior, nunca melhor) e (b) `Decisao.sair = True` (fecha a posição aberta na abertura do candle seguinte). Os indicadores ficam em `estudos.py` (fonte única). O Didi envia, a cada decisão, um desenho `{"tipo": "indicadores", "t", "bb_sup", "bb_meio", "bb_inf", "didi_curta", "didi_longa", "adx", "di_mais", "di_menos"}` que a sala acumula e desenha; marcadores de agulhada como desenho `{"tipo": "agulhada", "t", "lado"}`.

**Tech Stack:** Python 3.14 stdlib; Lightweight Charts 4.2 (já usado em `web/sala.js`); `unittest`.

## Global Constraints
- Suite verde: `python -m unittest discover -s testes`; `python .claude/skills/trader-budget/size.py --teste`; `python .claude/skills/trader-risk/check.py --teste`; `node --check web/sala.js web/firma.js`.
- Nenhuma ordem real; regras de risco existentes inalteradas; "não ver o futuro" vale para o Didi (teste).
- Textos pt-BR. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Motor, indicadores e trader (Python)
**Files:** tipos.py, motor.py, estudos.py, traders/didi_agulhada.py, traders/__init__.py (`TODOS = [sofia_smc, didi_agulhada]`), testes/test_motor.py, testes/test_estudos.py, testes/test_didi.py.
- [ ] Testes primeiro: SMA/Didi/ADX/Bollinger com valores calculados à mão em séries curtas; agulhada de compra e de venda; sem ADX subindo ou sem bandas abrindo não entra; ordem stop executa só no candle seguinte, cancela depois, gap abre pior; saída por sinal na abertura seguinte com 1 tick; alvo 3× risco; tf 15 decide só nos fechamentos de 15; não ver o futuro.
- [ ] Implementar. [ ] Suite verde. [ ] Commit `feat: Didi Agulhada trader with stop entries and signal exits`.

## Task 2: Gráfico do Didi na sala de operações (web)
**Files:** web/sala.js, web/estilo.css (se preciso), servidor.py só se o JSON precisar.
- No card do Didi: Bollinger (3 linhas, centro tracejado) sobre os candles; abaixo, painel do Didi Index (curta azul, longa laranja, linha zero = MA8 cinza, marcador em cada agulhada); abaixo, painel do ADX (ADX branco, DI+ verde, DI− vermelho). Painéis como gráficos Lightweight Charts empilhados com eixo de tempo sincronizado ao gráfico principal (rolagem e zoom juntos), revelados até o instante do replay, como os candles. Cards dos outros traders inalterados.
- [ ] Implementar. [ ] Captura `mockups/didi-1.png` (≤ 600 KB) com um backtest real de WDO. [ ] Commit `feat: full Didi chart in the trading room`.

## Task 3: Página inicial com mercado e placar (web + servidor)
**Decisão do usuário (2026-10-25):** "quero ver o mercado e o placar dos traders logo de cara"; desenho aprovado ("isso, pode seguir").
**Files:** servidor.py, web/index.html, web/sala.js (ou um novo web/inicio.js), web/estilo.css, testes/test_servidor.py.
- `GET /api/painel` → `{"mercado": [{"ativo", "nome", "ultimo", "variacao_pct", "dia", "tendencia60": "alta"|"baixa"|"indefinida", "candles": [{t,o,h,l,c}] (5 min do último pregão do cache)}], "traders": [{"nome", "estilo", "por_ativo": {ATIVO: {"status", "prova_resultado", "requisitos_ok", "requisitos_total", "curva": [números da equity da prova], "faltam": [itens ❌]}}}], "ciclo": <data do ciclo do gerente>}`. Só lê o cache em `dados/` e `estado/firma.json` (nunca chama MT5/Binance; ativo sem cache → `"sem_dados": true`). Tendência do 60 pela regra da Sofia (`estudos`). Variação = último fechamento vs fechamento do pregão anterior.
- Página inicial (`/`): ao abrir, sem clicar em nada: (1) faixa de cartões de mercado por ativo — último preço, variação do dia verde/vermelha, mini gráfico de candles (Lightweight Charts) do último pregão, selo de tendência do 60; clicar seleciona o ativo do replay; (2) placar: linha por trader (TODOS), coluna por ativo; célula com status (chip), resultado da prova, sparkline da curva, "N de M requisitos"; clicar mostra os itens que faltam; (3) abaixo, o replay atual (período, Rodar, play); depois de Rodar, a área de gráficos e o placar do backtest aparecem como hoje (os cartões podem recolher para dar espaço).
- Tema escuro existente; sem dependências novas; responsivo até 1280 px.
- [ ] Teste do `/api/painel` (cache falso, estado falso, ativo sem cache). [ ] Implementar. [ ] Captura `mockups/inicio-1.png` (≤ 600 KB) com os dados reais. [ ] Commit `feat: home page with market cards and trader scoreboard`.
