# Caio Contrafluxo: pesquisa do Plano 6

**Resultado: nada passou. Confiança baixa.** O padrão do trader (PARAMS) continua o mesmo no WDO e no WIN.

## Dados

Só WDO e WIN no 5 min, só o período que tem delta (agressão de compra − venda dos ticks do MT5). Nenhum tick novo foi
baixado.

| Ativo | Desenvolvimento | Validação |
|---|---|---|
| WDO | 29/06 a 15/09/2026 (~55 pregões) | 16/09 a 23/10/2026 (~27 pregões) |
| WIN | 12/08 a 15/09/2026 (~24 pregões) | 16/09 a 23/10/2026 (~27 pregões) |

Com tão pouco tempo, nenhuma variante chega às 100 operações exigidas no desenvolvimento, com exceção de 3 que perdem
dinheiro (todas no WDO, com alvo em R:R 1,5). A regra da amostra mínima vale: o veredito é "inconclusivo" ou "negativa", nunca "positiva".

## Diagnóstico da linha de base (antes de mexer)

- WDO: 83 trades, 67 stops, 14 alvos. 42 trades saem no próprio candle da entrada. WIN: 78 trades, 69 stops, 9 alvos,
  55 saem no candle da entrada.
- **O sinal em si não tem vantagem.** Medido fora do motor: depois de um delta grande no nível, o preço segue na direção
  de quem agrediu, ou seja, contra o Caio. Nos 12 candles seguintes (1 hora), a média anda **2,7 ticks contra** no WDO e
  **29 ticks contra** no WIN (147 pontos). O alvo vem antes do stop só em 22% (WDO) e 19% (WIN) dos sinais.
- A absorção de verdade (candle que fecha contra o próprio delta) quase não existe no nível. O sinal do delta bate com
  a direção do candle em 80–87% dos casos. No desenvolvimento houve 7 candles assim no WDO e 0 no WIN.
- WDO com estresse: com stop curto entram 5 contratos. Cada tick de deslizamento custa então R$ 50 por trade (entrada e
  saída), de um risco de R$ 100.

## Hipóteses (uma frase cada) e o que deu

Todas no desenvolvimento, uma de cada vez sobre os PARAMS atuais (grupo `ablacao`). PF = fator de lucro sem estresse.

| # | Hipótese | Teste | Resultado |
|---|---|---|---|
| H1 | O stop a 2 ticks está dentro do ruído do 5 min; mais folga deixa o trade respirar | `folga_ticks` WDO 4/6/8, WIN 10/20/40 | Ajuda o PF (WIN 0,55 → 0,84; WDO 0,42 → 0,46), mas continua negativo |
| H2 | Absorção se confirma quando o candle seguinte fecha de volta abaixo do nível (venda; compra é o espelho) | `confirma` | Corta 70–80% dos trades. WIN PF 0,95 (28 trades), WDO 0,39 (16) |
| H3 | O fluxograma do Diretor usa a tendência do dia, não a do 60 | `tendencia` "dia" / "ambos" | WDO "dia" 0,58; WIN "ambos" 0,80 |
| H4 | O volume muda de dia para dia; um limite pelo percentil recente se adapta | `limite_pct` 90/95/98 de ontem + hoje | Pior que o limite fixo (WDO p90 0,27; WIN p90 0,35) |
| H5 | A abertura é leilão e ruído; o Pinotti operava só de manhã | `horario` 10–17 h e 09:05–12 h | Nada melhora (WDO só de manhã: 0,16) |
| H6 | O fundo/topo oposto às vezes fica perto demais; alvo fixo em R:R dá payoff conhecido | `alvo_rr` 1,5/2/3 | WDO 0,51–0,60; WIN pior (0,38–0,51) |
| H7 | Absorção é passar do nível e fechar de volta do lado de cá | `rejeicao` (grupo `rodada2`) | WDO 0,16–0,58; WIN 0,76–0,81 |
| H8 | Outro limite fixo de delta | grade antiga do limite | Nada positivo (WDO 14.500: 15 trades, PF 0,28) |

Combinações (grupos `rodada2` e `rodada3`) do que subiu o PF:

- **WIN, folga 40 + tendência "ambos" + limite 7.500:** +418, PF 1,21, 47 trades; com estresse +288. Os vizinhos
  limite 10.000/12.500 também ficam positivos. Mas a folga 30 ao lado é negativa (−268) e a 60 também, então não há
  platô na folga. São 47 trades num mês e 88 variantes testadas: é o que a sorte produz.
- **Walk-forward** (o harness, grade de 12 candidatos por ativo, mínimo de 20 trades no treino). WIN em blocos de 1
  mês, porque com blocos de 3 meses não sobra bloco de teste: treinou em agosto, escolheu exatamente essa variante
  (+591, PF 1,54) e perdeu em 01–15/09 (−174, PF 0,80). WDO em blocos de 3 meses: escolheu folga 10, limite 5.000 e
  perdeu em 01–15/09 (−260, PF 0,56).
- **WDO, folga 10 + tendência do dia + limite 5.000:** +158, PF 1,11, 42 trades; com estresse −262.

**Variantes testadas:** 88 no desenvolvimento (WDO 40, WIN 48), mais 2 linhas de base e 2 walk-forwards (12 candidatos
cada, quase todos repetidos), mais 4 finalistas na validação (2 por ativo). Fora do motor, 16 medições do sinal bruto
(retorno depois do sinal), que servem de diagnóstico e não escolhem nada.

## Desenvolvimento e validação lado a lado (5 min)

Finalistas escolhidos pelo desenvolvimento: o padrão atual e a variante de melhor resultado com estresse. Nenhum
passou na regra; foram para a validação só para o relatório ter o número fora da amostra. Nada foi ajustado depois.

| Ativo | Variante | Dev: trades | Dev: resultado | Dev: PF | Dev c/ estresse (PF) | Val: trades | Val: resultado | Val: PF | Val c/ estresse (PF) | Veredito |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| WDO | padrão (limite 7.500, folga 2) | 83 | −3.792 | 0,42 | −4.859 (0,21) | 57 | +476 | 1,13 | −2.029 (0,57) | não passou |
| WDO | folga 10, tendência do dia, limite 5.000 | 42 | +158 | 1,11 | −262 (0,85) | 28 | −428 | 0,67 | −708 (0,52) | não passou |
| WIN | padrão (limite 10.000, folga 2) | 78 | −2.010 | 0,55 | −2.654 (0,47) | 85 | −1.569 | 0,72 | −2.205 (0,64) | não passou |
| WIN | folga 40, tendência ambos, limite 7.500 | 47 | +418 | 1,21 | +288 (1,14) | 44 | −347 | 0,85 | −471 (0,81) | não passou |

O padrão do WDO ganha +476 na validação sem estresse e perde −2.029 com 1 tick. A vantagem dele, se existe, é menor
que 1 tick por lado.

## Decisão

- **WDO e WIN: mantido o padrão atual** (`PARAMS` e `GRADE` sem mudança). Nada passou: nenhum resultado positivo com
  estresse e ≥ 100 trades, nenhum platô, e a validação foi negativa nas 4 finalistas com estresse.
- As chaves da pesquisa (`limite_pct`, `tendencia`, `confirma`, `alvo_rr`, `horario`, `rejeicao`) ficam no código,
  desligadas no padrão, com testes. Quando houver mais meses de delta, `python pesquisa/caio/rodar.py ablacao` (e
  `rodada2`, `rodada3`, `walk_forward`) refaz tudo. Cada mês de pregão rende ~30 trades no WDO e ~80 no WIN.
- O que os dados mostram, com confiança baixa: no 5 min, um delta grande no nível de hoje é continuação, não exaustão.
  Operar a favor do agressor seria outro operacional (muda a essência do Caio); fica para o Diretor decidir.
- Caminho para amostra grande: o BTCUSDT tem volume de agressor (taker buy) nos klines da Binance desde 2024. Com isso
  daria para testar a mesma ideia em anos de dados em vez de semanas, mas exige código novo de delta.

## Arquivos

- `pesquisa/caio/registro.csv`: todas as rodadas (desenvolvimento, walk-forward, validação), com e sem estresse.
- `pesquisa/caio/rodar.py`: os grupos de variantes, o walk-forward e a validação.
- `traders/caio_contrafluxo.py` e `testes/test_caio.py`: as chaves novas e os testes, incluindo "não ver o futuro" com
  as chaves ligadas.
