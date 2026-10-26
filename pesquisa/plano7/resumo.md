# Plano 7: risco do Diretor — resumo

**Resultado: nenhuma combinação trader × mercado × tempo gráfico passou.** Uma só (Sofia no EURUSD 15) cumpriu as regras do desenvolvimento e caiu na validação (65 trades, −R$ 1.477, PF 0,10). As regras novas do Diretor estão no código e no config; os números abaixo dizem o que elas fazem, não que dão lucro.

## O que mudou
- **Config** (`config.example.json` e o `trader/config.json` do usuário, editado à mão porque a mescla não troca chaves que o usuário já tem): `rr_minimo` 1,0 → **3,0**; `max_contratos` 5 → **50** (a margem limita antes: WDO 33, WIN 50, Forex 25, BTC 16, ações 5). As skills conferem R:R com tolerância de ponto flutuante (R:R 3 exato não cai mais por 2,9999…).
- **Sofia:** sem mudança de regra.
- **Caio:** stop 2 → **4 ticks** além do extremo. No BTC (sem padrão no PARAMS; base do Plano 6: percentil 95, região US$ 30) a folga dobrou de US$ 10 para US$ 20.
- **Didi** (três rodadas de decisão do Diretor no mesmo dia; vale a última):
  1. stop 1 → **3 ticks** além do candle do gatilho;
  2. prints: agulhada com os cruzamentos até **3 candles** entre si, bandas abrindo até **4 candles** depois, **ADX subindo e vindo de baixo** (mínimo dos últimos 5 ≤ percentil 30 dos últimos 120; DI não é mais exigido), **TRIX nos 30% das pontas** e virando;
  3. **saída:** no fechamento do 1º candle em que a largura do Bollinger **e** o ADX caem → sai na abertura seguinte. Sem take-profit: o plano leva um alvo de referência (3 × risco) só para o risco conferir (`Plano.alvo_ativo = False`; o motor não sai nele). O alvo no próximo topo/fundo (decisão intermediária) ficou como opção `alvo_pivo`.
  O gerente não mexe mais no alvo nem no TRIX do Didi (`GRADE = {"tf": [5]}`); `estado/parametros.json` perdeu o `alvo_x` 3,0 e o `trix_extremo` 0,2 antigos do Didi, que iam sobrepor as regras novas no replay.

## Método (o do Plano 6)
Desenvolvimento até 2026-04-30 (Caio: WDO 29/06–15/09, WIN 12/08–15/09), em blocos de 3 meses com conta nova, com e sem 1 tick de estresse. Positiva = ≥ 100 trades e positiva com e sem estresse; passar = positiva + PF ≥ 1,2 + vizinhos de ±1 passo positivos com estresse. As 12 ações em carteira (ACOES12, cada uma na sua conta, posição de vários dias). "Antes" = padrão do Plano 6 (código novo com os parâmetros antigos, conferido trade a trade contra o Plano 6: Didi WDO 5 trades −177; Caio WDO 83 trades −3.792; Sofia WDO 771 trades −29.209) com R:R 1 e teto de 5. "Depois" = padrão novo com o config do usuário. Script: `rodar.py` (etapas `antes_depois`, `sensibilidade`, `plato`, `validar`), `funil.py`, `tabela.py`; tudo em `registro.csv` e nos `.json`.

## Antes × depois (desenvolvimento)
Tabela completa (payoff, acerto, contratos médios, custo, recusas por R:R) em `tabelas.md`. Formato: trades · R$ · PF · R$ com estresse.

| Trader | Mercado | tf | Antes | Depois | tr/pregão antes → depois | veredito depois |
|---|---|---|---|---|---|---|
| Sofia | WDO | 5 | 771 · −29.209 · 0,46 · −23.230 | 603 · −29.068 · 0,46 · −32.725 | 1,33 → 1,04 | negativa |
| Sofia | WIN | 5 | 1.425 · −23.437 · 0,68 · −30.833 | 576 · −9.153 · 0,81 · −16.113 | 2,45 → 0,99 | negativa |
| Sofia | BTCUSDT | 5 | 3.128 · −3.540 · 0,23 · −3.542 | 2.621 · −7.958 · 0,28 · −7.960 | 3,68 → 3,08 | negativa |
| Sofia | Forex 5 (7 pares) | 5 | 718–834 · −677 a −1.400 · 0,34–0,77 | 241–702 · +210 a −3.984 · 0,43–1,04 | ~3,5 → 1,1–3,1 | todas negativas |
| Sofia | EURUSD | 15 | 527 · −581 · 0,81 · −865 | **188 · +1.178 · 1,22 · +636** | 2,35 → 0,84 | **positiva** |
| Sofia | outros 6 pares | 15 | 708–734 · −1.126 a −1.502 · 0,41–0,58 | 507–587 · −2.131 a −3.674 · 0,41–0,76 | ~3,2 → ~2,3 | negativas |
| Sofia | ACOES12 | 60 | 282 · −4.667 · 0,60 · −7.117 | 212 · −3.522 · 0,60 · −5.422 | 0,04 → 0,03 | negativa |
| Didi | WDO | 5 | 5 · −177 · 0,10 · −297 | 64 · +1.457 · 1,65 · +277 | 0,009 → 0,11 | inconclusiva |
| Didi | WIN | 5 | 4 · +235 · 3,30 · +211 | 51 · −1.195 · 0,55 · −1.595 | 0,007 → 0,09 | inconclusiva |
| Didi | BTCUSDT | 5 | 6 · −17 · 0,04 · −17 | 154 · −804 · 0,46 · −805 | 0,007 → 0,18 | negativa |
| Didi | Forex 5 (7 pares) | 5 | 1–6 cada | 40–56 cada; GBPUSD +759 (1,64), NZDUSD +306 (1,35), os outros 5 negativos | ~0,01 → ~0,2 | inconclusivas |
| Didi | Forex 15 (7 pares) | 15 | 0–3 cada | 12–29 cada; NZDUSD +387, USDCAD +146, GBPUSD +72; 4 negativos | ~0,01 → ~0,1 | inconclusivas |
| Didi | ACOES12 | 60 | 4 · −26 · 0,59 · −48 | 44 · +786 · 1,38 · +474 | 0,001 → 0,006 | inconclusiva |
| Caio | WDO | 5 | 83 · −3.792 · 0,42 · −5.706 | 35 · −2.378 · 0,24 · −3.240 | 1,48 → 0,63 | inconclusiva |
| Caio | WIN | 5 | 78 · −2.010 · 0,55 · −2.654 | 65 · −1.982 · 0,66 · −2.229 | 3,25 → 2,71 | inconclusiva |
| Caio | BTCUSDT | 5 | 1.794 · −1.597 · 0,55 · −1.598 | 1.017 · −2.479 · 0,63 · −2.481 | 2,11 → 1,20 | negativa |

## Validação
Só a Sofia no EURUSD 15 passou no desenvolvimento (vizinhos `folga_ticks` 1: 204 trades +1.011 PF 1,18, estresse +440; 3: 175 trades +1.228 PF 1,23, estresse +714). Validação (2026-05-01 a 2026-10-23, uma chamada, em série): **65 trades, −1.477, PF 0,10, acerto 3%; com estresse −1.602**. Não passou. Com 29 combinações testadas no desenvolvimento, uma com PF 1,22 é o que a sorte entrega.

## Sensibilidade do stop
- **Didi** (stop 2 / 3 / 4 / 5 ticks): o número de trades não muda (é o sinal que decide; o stop só muda o tamanho). WDO +2.222 / +1.457 / +1.026 / +740 (estresse +742 / +277 / −14 / −160): o resultado cai com o stop maior, não há platô positivo com estresse. GBPUSD 5 e NZDUSD 15 ficam positivos nos 4 stops, mas com 45 e 21 trades.
- **Caio** (3 / 4 / 5 / 6 ticks; BTC US$ 15/20/25/30): WDO −3.428 / −2.378 / −2.501 / −1.668 com 44 / 35 / 26 / 17 trades (o stop maior + R:R 3 corta trades); WIN −1.907 / −1.982 / −2.448 / −2.708; BTC PF 0,63 / 0,63 / 0,68 / 0,67. Tudo negativo.

## Didi: frequência e funil (WDO 5, desenvolvimento, 582 pregões)
| Didi | agulhadas | bandas abriram | ADX | TRIX | plano | ordem | trades | tr/pregão |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| antes (Plano 6) | 208 | 220* | 157 | 6 | 6 | 5 | 5 | 0,009 |
| depois (Diretor) | 1.566 | 1.505 | 784 | 81 | 81 | 64 | 64 | 0,110 |
| depois, TRIX 0,2 | 1.566 | 1.505 | 784 | 24 | 24 | 18 | 18 | 0,031 |
| depois, TRIX 1,0 (só a direção) | 1.566 | 1.505 | 784 | 711 | 711 | 568 | 568 | 0,976 |

(*) a agulhada no último candle do dia não é decidida pelo motor; as bandas abrindo no dia seguinte contam. Plano → ordem: planos que chegam com posição aberta ou com o stop longe demais para R$ 100.
**O TRIX no percentil é o filtro que deixa o Didi mais raro que a experiência do Diretor** (um trade a cada 1–2 pregões): com o TRIX 30% ele opera 1 vez a cada ~9 pregões no WDO; só com a direção do TRIX (1,0) opera ~1 vez por pregão, mas perde (WDO 568 trades +3.003, PF 1,12, com estresse −8.060; WIN −9.010).

## Didi: R:R realizado (sem take-profit)
Ganho médio / perda média em múltiplos do risco de entrada, % de trades ≥ 3R: WDO 1,81R / −0,84R, 3,1%; WIN 1,15R / −0,86R, 2,0%; Forex 5: 1,25–3,73R / −0,77 a −1,01R, 0–11%; ACOES12 2,80R / −0,95R, 6,8%. A saída pelas bandas fechando e o ADX caindo raramente deixa o trade chegar a 3R. (No BTC o stop de 3 ticks = US$ 0,03 deixa o R sem sentido.)

## Contratos e custos
Sem o teto de 5, o tamanho vai para o limite de R$ 100 ou para a margem: Sofia no Forex 5 → 20–25 contratos (antes 5), BTC 5 → 13,7, WIN 4,5 → 8,1; Didi no Forex ~24, BTC 16; Caio WIN 4,1 → 6,8, BTC 5 → 15,4. O custo e o estresse sobem junto: Sofia USDJPY 5 paga R$ 1.514 de custo (antes 382), e o estresse de 1 tick, que é por contrato, piora quase todas as linhas. O R:R 3 corta trades (Sofia WIN 1.425 → 576, Caio WDO 83 → 35) e sobe o payoff (Sofia 1,4–3,9 → 2,0–5,9), mas o acerto cai na mesma proporção (Sofia 12–28% → 8–22%).

## Leitura honesta
- O R:R 3 e o tamanho pelo stop não criam vantagem onde ela não existia: trocam muitos trades pequenos por poucos com payoff maior e acerto menor; o resultado por trade quase não muda e o custo por trade sobe com os contratos.
- A Sofia melhorou no WIN e no EURUSD, piorou no Forex e no BTC; o único sinal positivo (EURUSD 15) não sobreviveu à validação.
- O Didi do Diretor finalmente opera (0,1–0,25 trade por pregão) e tem números bons em WDO, GBPUSD 5, NZDUSD 5/15 e nas ações, mas nenhum chega a 100 trades: inconclusivo, e o WDO perde quase tudo com 1 tick de estresse (+1.457 → +277).
- O Caio continua negativo nos três mercados; o stop maior não ajudou.
