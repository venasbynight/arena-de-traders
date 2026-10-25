# Caio Contrafluxo (Plano 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Trader "Caio Contrafluxo" (delta por candle a partir dos ticks do MT5 com agressor) no WDO e no WIN, com histograma de delta no gráfico.

**Spec:** `docs/superpowers/specs/2026-10-24-arena-de-traders-design.md`, seção "Trader 2 — Caio Contrafluxo" (regras exatas, 1 a 9, e "Laboratório do delta no WDO").

**Decisões (2026-10-25):** usuário: traders = Sofia, Didi e Caio ("pode seguir", "agilize"). Sonda do MT5 Genial no mesmo dia: `copy_ticks_range(..., COPY_TICKS_TRADE)` traz flags `TICK_FLAG_BUY`/`TICK_FLAG_SELL` — WDO$ com ~3 meses (desde 2026-07-28, ~12 milhões de negócios), WIN$ só desde 2026-10-22 na série contínua (testar o contrato vigente, ex. `WINZ26`, e usar o que tiver mais histórico). Rulings do controlador: Caio só em WDO e WIN (EURUSD sem agressor real; BTC fica para depois); o "laboratório do delta" vira a GRADE do limite, com 4 valores tirados da distribuição do |delta| por candle de 5 min no WDO (percentis 80, 90, 95 e 98, arredondados) e o gerente escolhe no treino como faz com os outros parâmetros; WIN usa 10.000 como padrão e a mesma lógica de grade.

## Global Constraints
- Suite verde: `python -m unittest discover -s testes`; `python .claude/skills/trader-budget/size.py --teste`; `python .claude/skills/trader-risk/check.py --teste`; `node --check web/sala.js web/firma.js`.
- Nenhuma ordem real; regras de risco inalteradas; "não ver o futuro" (teste). Textos pt-BR.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Delta no cache, trader e gráfico
**Files:** dados.py, estudos.py, traders/caio_contrafluxo.py, traders/__init__.py (SALAS: WDO e WIN ganham o Caio; EURUSD e BTCUSDT não), web/sala.js (histograma de delta abaixo dos candles no card do Caio, verde positivo, vermelho negativo, linhas ±limite), testes.
- `dados.py`: baixar ticks de negócio do MT5 em blocos (por dia, no subprocesso com timeout já existente), somar volume de agressão de compra menos venda por candle de 5 min e gravar a coluna `delta` no CSV do cache (o `Candle` já tem `delta`). Período sem ticks: delta ausente (não zero) e o Caio não opera nesses dias (pensamento explica). Não guardar ticks crus no disco.
- `traders/caio_contrafluxo.py`: regras 1–9 da spec, com `PARAMS`/`GRADE` conforme as decisões acima; desenhos: zonas de suporte/resistência e o delta do candle.
- Testes: delta agregado de ticks falsos (flags de compra, venda, ambos/nenhum ignorados); cada regra do Caio com candles montados à mão; dia sem delta não opera; não ver o futuro; roster/SALAS.
- [ ] Implementar com TDD. [ ] Baixar delta real do WDO (e WIN se houver) e rodar um backtest. [ ] Captura `mockups/caio-1.png`. [ ] Commit `feat: Caio Contrafluxo trader with delta from MT5 ticks`.
