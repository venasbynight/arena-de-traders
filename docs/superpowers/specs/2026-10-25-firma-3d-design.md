# Firma 3D — especificação (fase 2)

Data: 2026-10-25. Complementa `2026-10-24-arena-de-traders-design.md`.

## Objetivo

Transformar a arena numa **firma de trading jogável**: um escritório 3D no
navegador, com câmera de cima (estilo The Sims / Day Trader Tycoon) e primeira
pessoa (WASD + mouse), onde cada sala é um mercado e cada trader é um
funcionário com rotina, diário e relatório. O usuário é o **Diretor**; um
**Gerente** cuida da firma quando ele não está olhando e entrega relatórios.

## Decisões fixas (teto de uso do plano)

- Traders operam por **regras em código**, candle a candle, 24h, sem custo de
  tokens. A "mente de IA" de um trader e do gerente roda **em horários fixos**
  (1x por dia), por tarefa agendada do app, lendo arquivos e escrevendo texto.
- Nenhuma ordem real. Conta demo ao vivo só depois de aprovação na prova final
  (plano posterior). Nesta fase todos fazem backtest e testes.

## Salas e mercados

| Sala | Ativo | Fonte de dados | Sessão | Status nesta fase |
|---|---|---|---|---|
| Mini-dólar | WDO | MT5 Genial (`WDO$`) | seg–sex 09:00–18:25 BRT | aguardando liberação da Genial |
| Mini-índice | WIN | MT5 Genial (`WIN$`) | seg–sex 09:00–18:25 BRT | aguardando liberação da Genial |
| Forex | EURUSD | MT5 MetaQuotes (`C:\Program Files\MetaTrader 5\terminal64.exe`) | seg–sex 24h | dados reais desde 2026-01 |
| Bitcoin | BTCUSDT | Binance pública `GET /api/v3/klines` (sem chave) | todo dia 24h | dados reais, histórico longo |
| Diretoria | — | — | — | sala do usuário, com painel de relatórios |

Hall central: mesa do Gerente e quadro com o ranking.

## Especificação de ativo (config-driven)

`trader/config.json` → `ativos[<ATIVO>]` passa a carregar tudo que o motor e
as skills precisam; `size.ATIVOS` só guarda os padrões de WDO/WIN.

| campo | WDO | WIN | EURUSD | BTCUSDT |
|---|---|---|---|---|
| `ponto_rs` (R$ por 1,0 de preço por contrato) | 10 | 0,20 | 5400 (micro lote 1.000 × USDBRL 5,40) | 0,0054 (unidade 0,001 BTC × 5,40) |
| `tick` | 0,5 | 5 | 0,00001 | 0,01 |
| `margem_por_contrato` (R$) | 150 | 100 | 200 | 300 |
| `custo_por_contrato` (R$, por lado) | 0,50 | 0,25 | 0,05 (spread médio já vem do preço) | 0,10 |
| `fonte` | `mt5` | `mt5` | `mt5` | `binance` |
| `simbolo` | `WDO$` | `WIN$` | `EURUSD` | `BTCUSDT` |
| `terminal` (só mt5) | caminho do MT5 Genial | idem | caminho do MT5 MetaQuotes | — |
| `sessao.dias` (0=seg) | [0,1,2,3,4] | idem | [0,1,2,3,4] | [0..6] |
| `sessao.inicio` / `fim` (entradas) | 09:05 / 18:00 | idem | 00:05 / 23:30 | 00:05 / 23:30 |

"Contrato" = micro lote (EURUSD) ou 0,001 BTC (BTCUSDT). A taxa USDBRL fica em
`config.usd_brl` (padrão 5,40) e o relatório mostra a premissa. O dia de
negociação de Forex/BTC é o dia-calendário em Brasília: zera no último candle
do dia (23:55). Horário do MT5 MetaQuotes vem em UTC do servidor (GMT+3 no
verão europeu? verificar) — converter para Brasília na importação; Binance
entrega UTC em ms.

## Traders desta fase

Cada sala recebe os mesmos três estilos, cada um com sua conta de R$ 5.000:

- **Sofia SMC** (já existe): tendência no 60, OB/FVG no 5.
- **Rafa Rompimento**: faixa dos 15 primeiros minutos da sessão (`sessao.inicio` arredondado para baixo à hora cheia em B3 = 09:00; Forex/BTC = 00:00). Compra no fechamento acima da máxima da faixa, vende no fechamento abaixo da mínima; stop no lado oposto da faixa; alvo = 1× a altura da faixa; no máximo 1 rompimento por lado por dia; faixa mínima = 4 ticks.
- **Vera VWAP**: VWAP do dia (volume `v`; se `v` = 0 em todos os candles, usa volume 1 por candle) e bandas de ±1 desvio-padrão dos preços típicos do dia. Vende no fechamento acima da banda superior, compra abaixo da inferior; stop 1 desvio além da banda; alvo = VWAP. Só depois de 12 candles do dia.
- **Caio Contrafluxo** (delta) fica para quando a Genial liberar ticks.

Nomes e estilos aparecem na firma como funcionários; cada um tem um `diario`
(as linhas de `pensamento` do dia) e `status` (`experiencia`, `promovido`,
`pausado`).

## Gerente

`gerente.py` roda um **ciclo** (manual, no arranque do servidor se não houve
ciclo hoje, e todo dia às 19:30 BRT numa thread do servidor):

1. Para cada sala com dados, baixa/atualiza o histórico e roda o backtest de
   todos os traders em **treino** (tudo menos os últimos 21 pregões) e **prova**
   (últimos 21 pregões; 3 meses quando houver histórico).
2. **Ajuste de parâmetros**: para cada trader, testa no treino a grade pequena
   declarada em `GRADE` do módulo (ex.: Sofia `folga_ticks ∈ {1,2,3}`,
   Rafa `alvo_x ∈ {1,1.5,2}`, Vera `desvios ∈ {1,1.5,2}`), escolhe o melhor
   fator de lucro com ≥ 50 trades e grava em `estado/parametros.json`. Marca
   `overfit: true` quando o resultado na prova < 50% do resultado no treino.
3. **Promoção/rebaixamento**: `promovido` quando prova positiva, fator ≥ 1,2,
   ≥ 50 trades e não overfit; `pausado` quando drawdown da prova pior que
   −R$ 1.500 ou 5 dias seguidos negativos; senão `experiencia`.
4. Escreve `estado/firma.json` (salas, traders, status, placar treino/prova,
   parâmetros, última decisão com motivo) e `relatorios/AAAA-MM-DD/` com um
   HTML por trader (placar, curva, operações, diário) e `gerente.html`
   (resumo da firma, decisões do dia, pendências: ex. "Genial sem dados").
5. Gera `relatorios/AAAA-MM-DD/briefing.md`: texto curto com os números e as
   decisões, para a mente de IA (tarefa agendada do app) comentar e gravar
   `relatorios/AAAA-MM-DD/gerente-ia.md`. Sem tarefa agendada, o briefing
   basta.

Tudo determinístico e testável; limites de risco continuam nas skills.

## Firma 3D (`web/firma.html`, `web/firma.js`)

- Three.js (CDN jsdelivr, módulo ES). Sem assets externos: tudo são caixas
  coloridas (voxel), texto em sprites de canvas.
- Planta: hall central (gerente + quadro de ranking) ligado a 5 salas: WDO,
  WIN, Forex, Bitcoin e Diretoria. Cada sala: mesas com monitor por trader,
  placa com o nome da sala na porta, cor própria no piso.
- Cada trader: boneco voxel sentado na mesa; sobre a cabeça, sprite com nome,
  status e resultado do dia (verde/vermelho). Monitor mostra uma textura canvas
  com a curva de capital do trader. Salas sem dados: monitores apagados e
  placa "aguardando dados".
- **Câmera de cima**: OrbitControls limitado (ângulo polar 20°–60°, zoom
  3–40 m), teclas Q/E giram, scroll aproxima; clique num trader abre o painel
  lateral HTML (placar, status, decisão do gerente, diário do dia, link para o
  relatório e para a sala de operações com o ativo dele).
- **Primeira pessoa**: PointerLockControls, WASD/Shift, altura 1,7 m, colisão
  simples com paredes (AABB), tecla **V** alterna de/para a câmera de cima,
  **E** interage com o trader ou painel à frente (mesmo painel lateral), ESC
  solta o mouse.
- Diretoria: mesa do usuário com um "monitor" que, ao interagir, abre o painel
  com a lista de relatórios do dia e o `gerente.html`.
- Dados: `GET /api/firma` (conteúdo de `estado/firma.json` + lista de
  relatórios) a cada 30 s; `GET /relatorios/<dia>/<arquivo>` serve os HTML.
- A sala de operações (`index.html`) ganha o seletor de ativo com os 4
  mercados e um link "Firma".

## Fora desta fase

Conta demo ao vivo, Caio/delta, Didi, Leo, escritório crescendo com nível,
liga com rivais (continua no plano 4 anterior), mente de IA por trader.

## Pronto

- `python gerente.py` roda um ciclo completo com Forex e Bitcoin reais e
  gera `estado/firma.json` + `relatorios/<hoje>/`.
- `python servidor.py` → `/firma` mostra o escritório com as 4 salas, traders
  nas mesas, alternância de câmera com V, painel do trader e relatórios.
- WDO/WIN aparecem como "aguardando dados" sem quebrar nada.
- Testes verdes.
