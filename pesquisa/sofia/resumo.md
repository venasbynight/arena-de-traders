# Sofia SMC: pesquisa do Plano 6

**Conclusão: nenhuma combinação de ativo e tempo gráfico passou.** Nenhuma variante cumpriu os quatro critérios no desenvolvimento: positiva com estresse, pelo menos 100 trades, fator de lucro de pelo menos 1,2 e vizinhos de ±1 passo também positivos. Os PARAMS da Sofia continuam os de antes, em todos os ativos. As regras novas ficaram no código desligadas (o padrão reproduz o baseline trade a trade) e têm testes.

## Como foi feito
- **Triagem:** cada variante rodou no desenvolvimento em blocos de 3 meses, com conta nova a cada bloco (como o walk-forward faz), com e sem 1 tick de estresse. Script: `pesquisa/sofia/rodar.py`; rodadas em `pesquisa/sofia/rodadas/`. A conta nova importa porque no WDO e no WIN a corrida contínua quebra os R$ 5.000 e para de operar.
- **Walk-forward ancorado:** `harness.walk_forward` (script `pesquisa/sofia/wf.py`) para os dois únicos candidatos.
- **Contagem:** 25 conjuntos de parâmetros/regra e 217 combinações variante × ativo × tf na triagem, mais 2 walk-forwards (grade de 6 candidatos cada) e 2 finalistas na validação. Com 217 tentativas centradas em PF ≈ 0,8–0,9, é de se esperar que umas poucas passem de 1,2 por sorte.
- **Diagnóstico inicial** (motivos de bloqueio e perfil dos trades):
  - Os stops são minúsculos: no WDO, 3 a 7 ticks; no EURUSD, cerca de 1,7 pip; no BTC, cerca de US$ 20.
  - No BTC o custo de R$ 1 por trade (5 contratos) é maior que o risco do trade (cerca de R$ 0,54). Os 3.128 trades do baseline pagaram mais de R$ 3.000 de custo.
  - No WDO, o estresse de 2 ticks por trade come cerca de 50% do risco.
  - O bloqueio mais comum é "risco:retorno abaixo de 1". Ele acontece quando a liquidez mais próxima está a menos de 1 R.

## Hipóteses (uma frase cada) e o que deu
| # | Hipótese | Parâmetro | Resultado no desenvolvimento |
|---|---|---|---|
| H1 | Zona pequena é ruído e deixa o stop menor que o custo; exigir altura mínima em amplitudes médias (14 candles) | `zona_min_atr` 0,5 / 1 / 1,25 / 1,5 / 2 | O PF sobe com o tamanho (WDO 0,46→1,11; WIN 0,68→1,04), mas os trades caem abaixo de 100 antes de chegar a 1,2, e com estresse tudo fica negativo. |
| H2 | Alvo na 1ª liquidez além de X R, em vez da mais próxima | `alvo_r` 1 / 2 | Pior em todos os ativos. Os trades que o mínimo de 1 R bloqueava (liquidez logo à frente) são ruins. |
| H5 | Discount/premium: comprar só na metade de baixo do dia, vender só na de cima | `desconto` 0,5 | Neutro a pior. |
| H6 | Limitada mais perto da borda da zona, contra a seleção adversa da entrada no meio | `entrada_frac` 0 / 0,25 | Ruído (USDJPY 1,21 com frac 0,25, mas 0,87 com frac 0). |
| H7 | Gatilho: esperar o 1º toque na zona fechar rejeitando e entrar com stop no rompimento do candle (o "golden zone + gatilho" das anotações) | `gatilho` | Forex 5: GBPUSD PF 1,28 e USDJPY 1,21, os únicos que passaram em PF, estresse e trades. Nos outros 5 pares ficou entre 0,71 e 0,98. B3 0,67–0,75; BTC 0,63; Forex 15 com menos de 100 trades. |
| H8 | Gatilho + alvo além de 1 R ou 1,5 R, para o mínimo de 1 R não barrar os gatilhos | `alvo_r` | Pior em quase tudo (o mesmo efeito de H2). |
| H9 | Horário das anotações (B3 de manhã 09–12; Forex Londres+NY 04–17 em Brasília) | `horario` | Análise das operações já rodadas, sem rodada nova: as manhãs da B3 são **piores** que a tarde, e no Forex não há melhora consistente. Descartado. |
| H10 | Ações no 60: com zonas só do dia (7 candles) quase não há trade; zonas da semana | `dias_zona` 5 | Chega a 100+ trades, com PF de 0,26 a 0,82. Quase nenhum alvo é atingido no mesmo dia, porque o motor zera no fim do pregão; os stops matam. |

## Os dois candidatos (gatilho no Forex 5)
- **Vizinhos:** `folga_ticks` 1 e 3, `zona_min_atr` 0,25 e `dias_zona` 2 ficaram positivos. **`n` = 3 ficou negativo** nos dois pares (GBPUSD PF 0,93; USDJPY 0,98), então o platô falha.
- **No GBPUSD**, um bloco (jun–ago/2025: +370) responde por quase todo o resultado.
- **Walk-forward** (grade: `folga_ticks` 1/2/3 × `zona_min_atr` 0/0,25), fora da amostra:

| Par | Trades | Resultado | PF | Resultado c/ estresse | PF c/ estresse |
|---|---:|---:|---:|---:|---:|
| GBPUSD | 108 | −61 | 0,94 | −119 | 0,89 |
| USDJPY | 118 | +72 | 1,10 | +81 | 1,13 |

- **Validação:** os dois foram para a validação (uma chamada cada, em série). Foi para informação: não cumpriam o platô e não voltei a ajustar nada depois.
  - GBPUSD: 98 trades, **−437**, PF 0,55; com estresse −490.
  - USDJPY: 73 trades, **+179**, PF 1,52; com estresse +154, PF 1,43.

  Um a favor, outro contra: é o padrão de ruído. O USDJPY no gatilho fica como candidato para acompanhar fora da amostra, não como resultado.

## Tabela por ativo × tf (desenvolvimento)
O padrão: no WDO, no WIN e no EURUSD 5/15 é a triagem em blocos; nos outros 5 min/15 min é o baseline do passo A (corrida contínua). A "melhor" é a de maior PF com pelo menos 100 trades. A validação só foi feita nos dois candidatos acima. R$ arredondados.

| Ativo | tf | Padrão: trades | resultado | PF | c/ estresse | PF est. | Melhor variante | trades | resultado | PF | c/ estresse | PF est. | Validação (trades, resultado, PF; c/ estresse) |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|
| WDO | 5 | 771 | −29.209 | 0,46 | −23.230 | 0,23 | H1 zona 1,25 | 159 | −1.356 | 0,82 | −4.166 | 0,55 | — |
| WIN | 5 | 1.425 | −23.436 | 0,68 | −30.832 | 0,58 | H1 zona 1,25 | 181 | −534 | 0,94 | −1.692 | 0,83 | — |
| BTCUSDT | 5 | 3.128 | −3.533 | 0,23 | −3.534 | 0,23 | H1 zona 1,5 | 514 | −404 | 0,70 | −404 | 0,70 | — |
| EURUSD | 5 | 718 | −679 | 0,77 | −1.067 | 0,67 | H6 z1 frac 0,25 | 172 | +13 | 1,01 | −80 | 0,94 | — |
| USDJPY | 5 | 764 | −1.079 | 0,41 | −1.342 | 0,35 | H7 gatilho | 145 | +184 | 1,21 | +134 | 1,15 | 73, +179, 1,52; +154 (platô falhou em n) |
| GBPUSD | 5 | 791 | −1.395 | 0,38 | −1.822 | 0,30 | H7 gatilho | 152 | +357 | 1,28 | +275 | 1,21 | 98, −437, 0,55; −490 (platô falhou em n) |
| USDCHF | 5 | 829 | −1.166 | 0,45 | −1.709 | 0,33 | H8 gatilho r1 | 919 | −1.054 | 0,85 | −1.656 | 0,78 | — |
| AUDUSD | 5 | 832 | −1.001 | 0,46 | −1.451 | 0,35 | H8 gatilho r1 | 881 | −32 | 0,99 | −507 | 0,92 | — |
| USDCAD | 5 | 820 | −877 | 0,37 | −1.194 | 0,27 | H8 gatilho r1,5 | 741 | −236 | 0,94 | −522 | 0,88 | — |
| NZDUSD | 5 | 792 | −1.178 | 0,36 | −1.605 | 0,27 | H8 gatilho r1,5 | 788 | −199 | 0,96 | −625 | 0,89 | — |
| EURUSD | 15 | 527 | −595 | 0,81 | −879 | 0,74 | H6 z0,5 frac 0 | 171 | −186 | 0,89 | −279 | 0,85 | — |
| USDJPY | 15 | 732 | −1.228 | 0,52 | −1.479 | 0,47 | H8 gatilho r1 | 311 | −1.792 | 0,58 | −1.899 | 0,56 | — |
| GBPUSD | 15 | 707 | −1.370 | 0,58 | −1.752 | 0,52 | H8 gatilho r1,5 | 243 | −1.167 | 0,73 | −1.298 | 0,70 | — |
| USDCHF | 15 | 717 | −1.474 | 0,49 | −1.943 | 0,41 | H8 gatilho r1,5 | 224 | −603 | 0,80 | −750 | 0,76 | — |
| AUDUSD | 15 | 707 | −1.449 | 0,41 | −1.831 | 0,34 | H8 gatilho r1,5 | 238 | −657 | 0,76 | −785 | 0,72 | — |
| USDCAD | 15 | 719 | −1.174 | 0,41 | −1.452 | 0,35 | H8 gatilho r1,5 | 241 | +149 | 1,08 | +56 | 1,03 | — (PF < 1,2) |
| NZDUSD | 15 | 724 | −1.102 | 0,53 | −1.492 | 0,44 | H8 gatilho r1 | 295 | −352 | 0,87 | −511 | 0,82 | — |
| 12 ações | 60 | 10–45 cada | todas negativas | 0,0–0,70 | todas negativas | — | H10 dias_zona 5 | 109–156 | todas negativas | 0,34–0,82 | todas negativas | — | — |

## Decisão e por quê
- **Os PARAMS não mudam.** Nada passou no desenvolvimento, e a regra 6 manda manter o padrão.
- **Mudanças de código, todas com o padrão igual ao baseline** (conferido: mesmos trades e mesmo resultado):
  - **No 60 minutos a tendência vem do diário**, montado dos candles de 60 já fechados, só com dias completos. Esta é a única mudança de comportamento, e só no tf 60, que não tinha baseline.
  - **Regras opcionais, desligadas por padrão:** `zona_min_atr`, `alvo_r`, `entrada_frac`, `desconto`, `gatilho`, `dias_zona` e `horario`. Cada uma aceita um valor por ativo ou o valor já resolvido pelo harness.
  - **Cache de pivôs e de tendência:** mesmo resultado, cerca de 40% mais rápido no Forex.
  - **Correção:** o tempo gráfico era deduzido dos dois últimos candles. No 1º candle do dia, o pulo da noite fazia o 5 min parecer 60. O efeito era nulo, porque com 1 candle não há zona; refiz a única rodada afetada (o vizinho `dias_zona=2`).
- **Por que não funciona, em resumo:**
  - Antes do custo, a Sofia tem PF de 0,8 a 1,0. Não há vantagem bruta para os filtros revelarem.
  - O custo (BTC) e o estresse de 1 tick (WDO/WIN, com stops de poucos ticks) transformam isso em perda.
  - No 60 das ações o motor zera no fim do dia, e a estrutura de 60 não cabe em 7 candles.

## Limites deste estudo
- **Saída parcial com stop na entrada** (das anotações): não dá para testar sem mudar o motor. O trader não sabe que está posicionado, e o motor tem uma posição com stop fixo.
- **Ações:** o backtest negocia a ação como aproximação da call/put. A margem (1.000) e o custo (1,0) são suposições do passo A.
- **Forex:** o desenvolvimento tem cerca de 10 meses (4 blocos). Um walk-forward com 3 blocos fora da amostra é fraco.

## Ações 60 min com posição de vários dias
O motor ganhou, por cherry-pick do commit `b27c400` do ramo do Didi, a opção de posição de vários dias. No config, as 12 ações ficam com `"zerar_no_dia": false` e `"max_pregoes": 10`. O config da worktree pegou as chaves ao carregar: conferi que PETR4 e EQTL3 trazem `(False, 10)` e que WDO e EURUSD não trazem nada. A tendência vem do diário.

**Carteira "ACOES12".** As 12 ações rodam juntas, cada uma na sua conta, e as operações entram somadas nas métricas. Sozinha, nenhuma ação passa de cerca de 150 trades no desenvolvimento, e quase todas as variantes ficam abaixo de 100 por ação. A triagem é em blocos de 3 meses, com e sem 1 tick de estresse. Foram 12 conjuntos de parâmetros, mais 1 walk-forward da carteira com 6 candidatos.

**Hipóteses:**
- **H10b:** com posição de vários dias, os alvos da estrutura de 60 passam a ser alcançáveis. É verdade, mas não basta: os stops dominam.
- **H12:** o stop colado na zona (2 ticks = R$ 0,02) não sobrevive ao ruído do 60 e ao gap da noite. Testei a folga em ticks (`folga_ticks` 10/25/50) e em amplitudes médias (regra nova `folga_atr` 0,5/1/1,5, desligada no padrão). O PF sobe com a folga e para em cerca de 0,96.

| Variante (desenvolvimento, ACOES12) | Trades | Resultado | PF | c/ estresse | PF est. |
|---|---:|---:|---:|---:|---:|
| M0 padrão (zonas só do dia) | 280 | −4.602 | 0,60 | −7.036 | 0,48 |
| M1 dias_zona 5 | 1.287 | −22.232 | 0,65 | −32.203 | 0,55 |
| M2 dias_zona 5 + gatilho | 96 | −823 | 0,84 | −1.307 | 0,76 |
| M3 dias_zona 5 + zona 1,0 | 365 | −5.476 | 0,77 | −7.868 | 0,69 |
| M4 dias_zona 5 + folga 10 ticks | 1.115 | −14.137 | 0,80 | −22.144 | 0,71 |
| M5 dias_zona 5 + folga 25 ticks | 834 | −2.619 | 0,94 | −6.325 | 0,87 |
| M6 dias_zona 5 + zona 1,0 + folga 10 | 338 | −3.429 | 0,83 | −5.155 | 0,76 |
| M7 dias_zona 5 + gatilho + folga 10 | 66 | −270 | 0,91 | −514 | 0,84 |
| **M8 dias_zona 5 + folga 50 ticks (melhor)** | 455 | −866 | 0,96 | −1.776 | 0,91 |
| M9 dias_zona 5 + folga_atr 0,5 / 1,0 / 1,5 | 1.018 / 740 / 464 | −7.080 / −5.166 / −5.857 | 0,88 / 0,87 / 0,76 | negativos | 0,80 / 0,79 / 0,70 |

**Walk-forward da carteira** (grade: `folga_ticks` 10/25/50 × `zona_min_atr` 0/1, com `dias_zona` 5), fora da amostra: 290 trades, −1.346, PF 0,91; com estresse −2.228, PF 0,85.

**Por ação na M8:**
- Positivas: VALE3 +1.219, AXIA3 +495, PETR3 +340, EMBJ3 +113, EQTL3 +100.
- Negativas: ITUB4 −862, RENT3 −867, BBAS3 −769, PETR4 −311, SBSP3 −212, PRIO3 −93, BBDC4 −19.
- Todas com menos de 100 trades, ou seja, inconclusivas. Escolher as que deram certo seria olhar o resultado para escolher o ativo.

**Decisão: não passou.** Nenhuma variante ficou positiva no desenvolvimento, nem sem estresse. Por isso nenhum finalista foi para a validação, e os PARAMS continuam os de antes. Com a posição de vários dias a Sofia nas ações deixa de ser um desastre (PF 0,6 → 0,96), mas não tem vantagem. A regra `folga_atr` ficou no código, desligada, com teste. O padrão continua igual ao baseline: conferi o mesmo resultado no WDO e no EURUSD.
