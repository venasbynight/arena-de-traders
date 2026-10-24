# Arena de Traders — especificação

Data: 2026-10-24. Status: aguardando revisão do usuário.

## Objetivo

Um ambiente próprio onde vários "traders" (robôs com estilos operacionais
diferentes) operam o mesmo mercado em contas simuladas, lado a lado, para o
usuário comparar os resultados e se inspirar. Dois modos na mesma tela:

- **Backtest:** o usuário escolhe ativo e período (de uma data até outra), dá
  play e acompanha todos operando candle a candle; no fim vê o resultado de
  todos.
- **Ao vivo:** os mesmos traders operam durante o pregão real, com dados do
  MT5, em contas simuladas.

Nenhuma ordem vai para a corretora. Não é recomendação de investimento.

## Escopo da primeira versão

Dentro:

- Ativos: mini-dólar (WDO) e mini-índice (WIN), série contínua do MT5.
- Traders: **Sofia SMC** e **Caio Contrafluxo** (regras abaixo).
- Backtest com replay sincronizado de todos os gráficos e tela de resultado.
- Modo ao vivo lendo o MT5.
- Risco e tamanho de posição pelas skills `trader-risk` e `trader-budget`
  (já adaptadas para WDO e WIN em `.claude/skills/`).
- Gamificação leve (seção "Gamificação"): ficha de RPG do trader, rivais de
  controle na liga, painel de pensamento e letreiro de eventos.

Segunda versão:

- Escritório isométrico da firma (mockup em `mockups/escritorio.png`).

Fora (depois):

- Traders Didi Agulhada, Rafa Rompimento, Vera VWAP e Leo Liquidez (cada um
  vira um arquivo em `traders/` quando o motor estiver pronto).
- Execução "Morena" (microtrades dentro da posição) do Caio.
- Envio de ordens reais, ProfitDLL, importação de CSV do Profit.
- Variantes de parâmetros salvas e otimização automática.

## Telas

Mockups aprovados em `mockups/` (dados ilustrativos):

- `mockups/sala.png` — **sala de operações** (tela principal): topo com modo
  (Backtest | Ao vivo), ativo (WDO | WIN), período, play/pause, velocidade e
  barra de tempo; no centro um gráfico por trader, todos com o mesmo mercado,
  cada um desenhando o próprio estudo e as próprias operações; à direita o
  placar de todos e o diário do que cada um está fazendo.
- `mockups/resultado.png` — **resultado do backtest**: ranking final
  (resultado, trades, acerto, fator de lucro, drawdown, pior dia, confiança),
  curva de capital de cada trader e acesso ao diário de cada um.

O gráfico do Caio mostra o delta de cada candle embaixo dos candles.

## Regras comuns a todos os traders

- Uma operação por vez por trader.
- Contratos calculados pelo `trader-budget`; toda entrada passa pelo
  `trader-risk` antes de executar. BLOCK descarta a ordem e vai para o diário.
- Conta simulada de R$ 5.000 por trader, com as regras de
  `trader/config.json` (modelo em `.claude/skills/trader-budget/config.example.json`):
  perda máxima por trade, perda máxima do dia, 3 stops encerram o dia,
  risco:retorno mínimo, margem e custos por ativo.
- Sem entrada nos últimos 30 minutos do pregão; zera no último candle do dia.
- Valores de ponto: WDO 1 ponto = R$ 10, tick 0,5; WIN 1 ponto = R$ 0,20, tick 5.

## Trader 1 — Sofia SMC

Tendência no 60 minutos, entrada no 5 minutos, na volta a order block ou FVG.

1. **Topo e fundo:** topo quando a máxima é a maior entre os 2 candles antes e
   os 2 depois; fundo é o inverso. Só vale depois que os 2 candles seguintes
   fecham.
2. **Tendência (60 min):** alta quando o último rompimento foi fechamento
   acima do último topo; baixa quando foi fechamento abaixo do último fundo.
   Usa só candles de 60 já fechados. Compra só na alta, vende só na baixa.
3. **FVG (5 min):** três candles em que a mínima do terceiro fica acima da
   máxima do primeiro (alta), ou o espelho (baixa). Zona = o buraco entre os
   dois. Tamanho mínimo: 1 ponto no WDO, 50 pontos no WIN.
4. **Order block (5 min):** o último candle contrário antes da perna que
   rompeu um topo (alta) ou fundo (baixa). Zona = mínima à máxima desse
   candle.
5. **Entrada:** ordem limitada no meio da zona, a favor da tendência. Vale a
   zona que o preço tocar primeiro.
6. **Stop:** 2 ticks além da borda oposta da zona (WDO 1 ponto, WIN 10 pontos).
7. **Alvo:** topo confirmado mais próximo acima da entrada (compra) ou fundo
   mais próximo abaixo (venda), no 5 min. Sem topo/fundo à frente, não entra.
8. **Validade da zona:** até ser usada, até um candle fechar do outro lado
   dela, ou até o fim do dia.

Parâmetros ajustáveis: candles de confirmação (2), FVG mínimo, folga do stop,
janela final sem entradas (30 min).

## Trader 2 — Caio Contrafluxo

Opera contra quem entrou contra a tendência e tende a ser estopado. Base:
material de masterclass do usuário (confidencial; uso pessoal, não publicar).

1. **Tendência:** a do 60 minutos, regra da Sofia. Vende só na baixa, compra
   só na alta.
2. **Suporte e resistência:** topos e fundos confirmados no 5 minutos do dia
   (mesma regra de confirmação da Sofia).
3. **Chegou na região:** a máxima do candle chega a até 2 ticks do topo (ou
   passa dele); no fundo, o espelho.
4. **Delta:** volume das agressões de compra menos o das agressões de venda no
   candle, calculado dos ticks do MT5 (marcação de agressor).
5. **Gatilho:** na resistência, em tendência de baixa, delta do candle acima de
   +limite: venda. No suporte, em tendência de alta, delta abaixo de −limite:
   compra. Limite: WIN 10.000 contratos; WDO a definir no laboratório.
6. **Entrada:** a mercado, na abertura do candle seguinte ao sinal.
7. **Stop:** 2 ticks além do ponto mais extremo entre o topo/fundo e a
   máxima/mínima do candle do sinal.
8. **Alvo:** o fundo oposto mais próximo (venda) ou o topo oposto mais próximo
   (compra). Sem ele, não entra.
9. Cada topo ou fundo gera no máximo um sinal por dia.

**Laboratório do delta no WDO:** antes de fixar o limite, mostrar a
distribuição do delta por candle no período e rodar o backtest com 4 valores
lado a lado; o usuário escolhe.

Risco conhecido: o histórico de ticks no MT5 depende da corretora e pode ser
mais curto que o de candles; o backtest do Caio cobre só o período com ticks.

## Gamificação

Inspirada no jogo "Day Trader Tycoon" (vídeo analisado em 2026-10-24): a
arena vira uma firma de trading, e os traders são a equipe. Regra de ouro: o
jogo premia disciplina e consistência, nunca risco maior. Não há alavancagem
como prêmio nem dinheiro real.

Primeira versão (usa os mesmos dados do placar e do diário):

- **Ficha do trader (RPG):** nível, barra de XP, apelido de estilo e
  atributos calculados dos números reais:
  - Disciplina: proporção de ordens dentro das regras (BLOCKs evitados, dia
    nunca estourado).
  - Precisão: taxa de acerto.
  - Paciência: poucas operações por dia em relação à média dos traders.
  - Consistência: proporção de dias positivos.
  - Frieza: resultado da operação seguinte a um stop.
  - XP vem desses atributos, não só do lucro. A ficha mostra também o
    resultado desde a "contratação" e o resultado médio por operação.
- **Contratação e promoção:** trader novo entra "em experiência" no backtest;
  passando na prova final (os 3 meses reservados), é promovido para a mesa ao
  vivo. Evoluir libera mesas e ativos, nunca limites de risco maiores.
- **Liga com rivais de controle:** firmas fictícias que operam o mesmo
  mercado com as mesmas regras de risco: "Cara ou Coroa" (entradas
  aleatórias) e "Só Tendência" (segue a tendência do 60 sem gatilho). A pior
  delas para cada trader é marcada como NÊMESIS. Trader que não bate o "Cara
  ou Coroa" não tem vantagem demonstrada.
- **Painel de pensamento:** cada trader explica cada decisão, inclusive as
  que não tomou ("pulei: risco:retorno 0,8 abaixo do mínimo").
- **Letreiro no rodapé:** eventos de todos os traders passando, mais a agenda
  que mexe com dólar e índice (Copom, payroll, IPCA) quando houver fonte.

Segunda versão:

- **Escritório isométrico:** cada trader é um bonequinho voxel na mesa do seu
  ativo (WDO ou WIN), com balão de status em cima ("vendida 2", "parou: 3
  stops"); clicar abre o gráfico e a ficha. O escritório cresce com o nível da
  firma (mais mesas, decoração, troféus). É uma tela "Firma" ao lado da sala de
  operações, alimentada pelos mesmos eventos.

## Arquitetura

Python 3.14 (instalado; a biblioteca `MetaTrader5` instala nele). Única
dependência Python: `MetaTrader5`. Gráficos com a Lightweight Charts
(biblioteca gratuita do TradingView, via CDN).

| Arquivo | Responsabilidade |
|---|---|
| `dados.py` | Conecta ao MT5 aberto pelo usuário (sem senha no código); baixa candles de 5 min e ticks; guarda em `dados/` para o backtest rodar com o MT5 fechado; monta o 60 min a partir do 5 min |
| `estudos.py` | Topos e fundos, tendência, order block, FVG, delta por candle (e depois médias, VWAP, faixa de abertura) |
| `traders/sofia_smc.py`, `traders/caio_contrafluxo.py` | Um arquivo por trader: recebe "fechou um candle" e devolve plano de ordem ou nada, mais o que desenhar no gráfico |
| `motor.py` | Contas simuladas: chama budget e risk, executa ordens, stop, alvo, custos, zeragem, placar e diário |
| `servidor.py` | Servidor HTTP da biblioteca padrão: entrega as telas e um JSON por rota (`/api/backtest`, `/api/ao-vivo`) |
| `web/` | Sala de operações e resultado, conforme os mockups |
| `testes/` | Testes das regras, do motor e do "não ver o futuro" |

Fluxo:

- **Backtest:** o servidor roda o período inteiro em Python e devolve a lista
  de eventos com horário (candles, desenhos de cada trader, ordens, BLOCKs,
  execuções, placar). A tela só reproduz essa lista no play, na velocidade
  escolhida, e pode pular para o resultado.
- **Ao vivo:** um laço lê o MT5 a cada poucos segundos; a cada candle fechado,
  todos os traders decidem; a tela consulta o estado a cada 2 segundos.
- O mesmo código de trader roda nos dois modos.

## Simulação honesta

- Ordem limitada (entrada e alvo) só executa se o preço passar 1 tick além
  dela.
- Stop executa 1 tick pior que o preço do stop; zeragem do fim do dia também
  paga 1 tick.
- Stop e alvo no mesmo candle: conta stop. No candle da entrada só se confere
  o stop.
- Custos por ativo do config em toda operação.
- Decisão só no fechamento do candle; ordem vale a partir do seguinte. Topo e
  fundo só depois da confirmação. 60 min só com candles fechados.
- Prova final: os últimos 3 meses do histórico ficam reservados; ajustes só no
  período anterior; a prova roda uma vez no fim.
- Coluna "confiança" no ranking: abaixo de 50 operações, "baixa".
- Limite conhecido: a série contínua tem salto na virada do contrato; as
  zonas vencem no fim do dia, mas a tendência do 60 pode sentir o salto.

## Testes

- Candles montados à mão para cada regra: FVG, order block, topo/fundo
  confirmado, tendência, toque em topo com delta, entrada no meio da zona.
- Motor: execução que precisa passar 1 tick, stop antes do alvo, 3 stops
  encerram o dia, zeragem no fim do dia, custos.
- "Não ver o futuro": o mesmo dia rodado com o histórico terminando nele e com
  dias depois dele dá o mesmo resultado.
- Autotestes existentes de `trader-risk` e `trader-budget`.

## Pronto da primeira versão

- Sofia e Caio rodam backtest em WDO e WIN com dados do MT5.
- Sala de operações reproduz o período com play, pausa e velocidade.
- Tela de resultado com o placar dos dois.
- Laboratório do delta do WDO mostra a distribuição e os 4 cenários.
- Modo ao vivo acompanha o pregão pelo MT5.
- Ficha de cada trader, liga com os rivais "Cara ou Coroa" e "Só Tendência",
  painel de pensamento e letreiro funcionando.
- Todos os testes passam.

## Pendências do usuário

- Preencher margem e custo por contrato de WDO e WIN da corretora dele.
- Ter o MT5 instalado e logado numa corretora com dados da B3.
