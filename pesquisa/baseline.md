# Baseline do Plano 6 (2026-10-26)

PARAMS atuais de cada trader, sem nenhum ajuste, só no **desenvolvimento** de `divisao.json` (validação intocada).
Custos do `trader/config.json`; "estresse" = +1 tick de deslizamento em cada entrada e cada saída. Capital R$ 5.000,
regras de risco do config. Números completos (acerto, payoff, sequência de perdas, pior dia) em `baseline.csv`;
cada linha também está em `pesquisa/<trader>/registro.csv`. Rodar de novo: `python pesquisa/harness.py --baseline`.

| Trader | Ativo | tf | Trades | Resultado (R$) | PF | Estresse (R$) | PF estresse | Veredito |
|---|---|---|---:|---:|---:|---:|---:|---|
| Sofia | WDO | 5 | 159 | −4.871,00 | 0,56 | −4.855,00 | 0,28 | negativa (conta quebra) |
| Sofia | WIN | 5 | 235 | −4.911,00 | 0,57 | −4.905,50 | 0,51 | negativa (conta quebra) |
| Sofia | BTCUSDT | 5 | 3.128 | −3.532,61 | 0,23 | −3.533,66 | 0,23 | negativa |
| Sofia | EURUSD | 5 | 718 | −679,22 | 0,77 | −1.066,94 | 0,67 | negativa |
| Sofia | EURUSD | 15 | 527 | −594,52 | 0,81 | −879,10 | 0,74 | negativa |
| Sofia | USDJPY | 5 | 764 | −1.079,27 | 0,41 | −1.342,02 | 0,35 | negativa |
| Sofia | USDJPY | 15 | 732 | −1.227,50 | 0,52 | −1.479,43 | 0,47 | negativa |
| Sofia | GBPUSD | 5 | 791 | −1.395,04 | 0,38 | −1.822,18 | 0,30 | negativa |
| Sofia | GBPUSD | 15 | 707 | −1.370,05 | 0,58 | −1.751,83 | 0,52 | negativa |
| Sofia | USDCHF | 5 | 829 | −1.166,16 | 0,45 | −1.709,41 | 0,33 | negativa |
| Sofia | USDCHF | 15 | 717 | −1.473,57 | 0,49 | −1.943,37 | 0,41 | negativa |
| Sofia | AUDUSD | 5 | 832 | −1.001,36 | 0,46 | −1.450,64 | 0,35 | negativa |
| Sofia | AUDUSD | 15 | 707 | −1.449,16 | 0,41 | −1.830,94 | 0,34 | negativa |
| Sofia | USDCAD | 5 | 820 | −877,15 | 0,37 | −1.193,72 | 0,27 | negativa |
| Sofia | USDCAD | 15 | 719 | −1.174,29 | 0,41 | −1.451,55 | 0,35 | negativa |
| Sofia | NZDUSD | 5 | 792 | −1.177,65 | 0,36 | −1.605,33 | 0,27 | negativa |
| Sofia | NZDUSD | 15 | 724 | −1.101,53 | 0,53 | −1.492,49 | 0,44 | negativa |
| Didi | WDO | 5 | 5 | −177,00 | 0,10 | −297,00 | 0,00 | inconclusivo |
| Didi | WIN | 5 | 4 | 235,00 | 3,30 | 211,00 | 2,92 | inconclusivo |
| Didi | BTCUSDT | 5 | 6 | −16,94 | 0,04 | −16,94 | 0,04 | inconclusivo |
| Didi | EURUSD | 5 | 3 | 0,39 | 1,02 | −1,23 | 0,94 | inconclusivo |
| Didi | EURUSD | 15 | 1 | −26,96 | 0,00 | −27,50 | 0,00 | inconclusivo |
| Didi | USDJPY | 5 | 6 | −39,80 | 0,05 | −41,86 | 0,04 | inconclusivo |
| Didi | USDJPY | 15 | 3 | −50,18 | 0,00 | −51,20 | 0,00 | inconclusivo |
| Didi | GBPUSD | 5 | 5 | −28,69 | 0,22 | −31,39 | 0,18 | inconclusivo |
| Didi | GBPUSD | 15 | 2 | 35,72 | 10,55 | 34,64 | 9,09 | inconclusivo |
| Didi | USDCHF | 5 | 1 | −1,16 | 0,00 | −1,81 | 0,00 | inconclusivo |
| Didi | USDCHF | 15 | 2 | −18,04 | 0,00 | −19,36 | 0,00 | inconclusivo |
| Didi | AUDUSD | 5 | 4 | −29,54 | 0,00 | −31,70 | 0,00 | inconclusivo |
| Didi | AUDUSD | 15 | 1 | 1,93 | sem perdas | 1,39 | sem perdas | inconclusivo |
| Didi | USDCAD | 5 | 1 | −0,69 | 0,00 | −1,08 | 0,00 | inconclusivo |
| Didi | USDCAD | 15 | 0 | 0,00 | — | 0,00 | — | inconclusivo |
| Didi | NZDUSD | 5 | 2 | −6,40 | 0,00 | −7,48 | 0,00 | inconclusivo |
| Didi | NZDUSD | 15 | 2 | 46,25 | sem perdas | 45,17 | 197,39 | inconclusivo |
| Caio | WDO | 5 | 83 | −3.792,00 | 0,42 | −4.859,00 | 0,21 | inconclusivo (< 100) |
| Caio | WIN | 5 | 78 | −2.010,00 | 0,55 | −2.654,00 | 0,47 | inconclusivo (< 100) |

Janelas: WDO/WIN 2024-01-02 a 2026-04-30; BTCUSDT 2024-01-01 a 2026-04-30; Forex 2025-06-23 a 2026-04-30;
Caio (divisão própria, confiança baixa) WDO 2026-06-29 a 2026-09-15 e WIN 2026-08-12 a 2026-09-15.

## Leitura

- **Sofia** perde em todo ativo e tempo gráfico; no WDO e no WIN a conta de R$ 5.000 quebra em poucos meses (a margem
  deixa de caber e ela para de operar), então o número de trades é o que coube até quebrar. No estresse o WDO "perde
  menos" pelo mesmo motivo (quebra antes). Forex no 15 tende a PF melhor que no 5, ainda abaixo de 1.
- **Didi** quase não opera (0 a 6 trades em 10 a 28 meses): agulhada no mesmo candle + bandas abrindo em 3 candles +
  ADX subindo + DI + TRIX no extremo é filtro demais. Nada a concluir antes de afrouxar a entrada.
- **Caio** perde no pouco delta que existe, e o estresse pesa muito (stop curto, 1 tick é grande perto do risco).

## Não rodados: precisa adaptar o trader

- **12 ações no 60 min** (PETR4, VALE3, ITUB4, BBDC4, AXIA3, BBAS3, SBSP3, PETR3, EMBJ3, PRIO3, RENT3, EQTL3): o
  histórico H1 está no cache e o harness roda com `tf=60`, mas a Sofia usaria o próprio 60 como "tendência maior" (o
  Diretor quer o diário) e o Didi precisa de 27 candles de ontem + hoje (o pregão tem 7 candles de 60). Opera-se a
  ação como aproximação da direção da call/put (não há preço histórico de opções).
- **Caio fora de WDO/WIN**: sem delta (agressor) nas outras fontes.
