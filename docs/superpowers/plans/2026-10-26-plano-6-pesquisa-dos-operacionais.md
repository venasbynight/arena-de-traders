# Pesquisa dos operacionais (Plano 6)

**Pedido do Diretor (2026-10-26, noite):** "vai testando todos os operacionais em todos os mercados e pode ir fazendo os ajustes nesses operacionais até que no resultado dos backtests comecem a dar positivos. E depois disso eu quero que você me entregue o relatório de como você conseguiu fazer isso." Teto de uso: 27% do limite semanal (início: 12%).

**Objetivo honesto:** achar variantes de Sofia SMC, Didi Agulhada e Caio Contrafluxo que sejam positivas **fora da amostra** e robustas — não números bonitos no período em que foram ajustadas. Se uma combinação trader × ativo não ficar positiva sem truque, o relatório diz isso.

## Regras do jogo (valem para todos os pesquisadores)

1. **Dados.** Estender o cache: WDO$ e WIN$ (MT5 Genial, 5 min desde 2024-01), BTCUSDT (Binance, desde 2024-01) e as **7 principais de Forex** (o Diretor mandou a lista: EURUSD, USDJPY, GBPUSD, USDCHF, AUDUSD, USDCAD, NZDUSD), do MT5 MetaQuotes, com o histórico que ele tiver (EURUSD hoje só 2026; se o terminal entregar só ~10 meses, a divisão do Forex usa desenvolvimento até 2026-07-31). Cada par novo ganha entrada em `trader/config.json` com `ponto_rs` coerente com o EURUSD (valor de 1 ponto do lote mínimo em R$ pelo `usd_brl`; pares com USD na frente convertem pela própria cotação) — Sofia e Didi testam nos 7. Delta do Caio: só o que já existe (WDO desde 2026-06-29, WIN desde 2026-08-12).
2. **Divisão fixa por ativo** (gravada em `pesquisa/divisao.json` antes de qualquer teste): **desenvolvimento** = tudo até 2026-04-30; **validação** = 2026-05-01 até o último pregão do cache. A validação só é olhada no fim, uma vez por variante finalista (no máximo 3 finalistas por trader × ativo). Caio (pouco delta): desenvolvimento = até 2026-09-15, validação = depois; marcar confiança baixa.
3. **Dentro do desenvolvimento:** walk-forward em blocos de 3 meses (ajusta nos anteriores, testa no seguinte) para escolher parâmetros; preferir platôs (vizinhos de ±1 passo também positivos) a picos.
4. **Atrito:** custos do config + teste de estresse com 1 tick extra de deslizamento em entrada e saída. Uma variante só conta como positiva se continuar positiva com o estresse.
5. **Amostra:** pelo menos 100 operações no desenvolvimento e 30 na validação para chamar de resultado; abaixo disso, "inconclusivo".
6. **O que pode mudar:** parâmetros; filtros (horário, tendência, volatilidade, dia da semana não); forma de saída (alvo, stop, saída por tempo, parcial com stop na entrada); janelas de tolerância (ex.: agulhada com até N candles entre os cruzamentos). **O que não pode:** a ideia central de cada operacional (Sofia = SMC/OB/FVG a favor do 60; Didi = agulhada + Bollinger abrindo; Caio = delta contra a tendência em S/R), as regras de risco (`trader/config.json`), a simulação honesta do motor, olhar o futuro.
7. **Registro:** todo teste vai para `pesquisa/<trader>/registro.csv` (variante, parâmetros, janela, trades, resultado, fator de lucro, drawdown, com e sem estresse). O número total de variantes testadas entra no relatório (quanto mais variantes, maior a chance de sorte).
8. **Finalistas:** a variante escolhida vira a padrão do trader (PARAMS/GRADE e, se mudou a regra, o código com testes), sem quebrar os testes existentes; a decisão vai para o relatório com os números de desenvolvimento e de validação lado a lado.

## Entregáveis
- `pesquisa/` com harness, divisão, registros e um resumo por trader.
- Código dos traders ajustado (com testes) e ciclo do gerente rodado.
- Relatório em HTML para o Diretor: o que foi testado, o que funcionou, o que não funcionou, números dentro e fora da amostra, e o que fazer a seguir.
