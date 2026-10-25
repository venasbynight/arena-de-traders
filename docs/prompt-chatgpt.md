# Prompt para recriar a Arena de Traders (ChatGPT ou outra IA)

Copie tudo a partir de "Você vai construir" e cole na IA. É grande de propósito: a IA
precisa das regras exatas. Peça uma etapa por vez (a IA perde detalhes quando tenta
fazer tudo de uma vez) e rode os testes de cada etapa antes de pedir a próxima.

---

Você vai construir comigo, por etapas, a **Arena de Traders**: um laboratório local onde
vários "traders" (robôs de regras fixas, não IA) operam o mesmo mercado em contas
simuladas, lado a lado, em backtest. O resultado aparece numa sala de operações web e numa
"firma" 3D estilo The Sims 4, onde os traders são funcionários e um "gerente" decide quem
está pronto para sair do backtest. Eu sou o "Diretor".

Regras inegociáveis:
- Nenhuma ordem real vai para corretora. Tudo é simulado. Não é recomendação de investimento.
- Nenhuma senha no código: o MetaTrader 5 já fica aberto e logado por mim.
- Textos da interface em português do Brasil.

## Etapas (entregue uma por vez, com testes, e espere meu "ok")

1. Dados e estudos (`dados.py`, `estudos.py`, `tipos.py`)
2. Motor de simulação, risco e tamanho (`motor.py`)
3. Os três traders (`traders/`): Sofia SMC, Didi Agulhada e Caio Contrafluxo
4. Servidor e sala de operações (`servidor.py`, `web/index.html`, `web/sala.js`)
5. Gerente e relatórios (`gerente.py`, `relatorio.py`)
6. Firma 3D (`web/firma.html`, `web/firma.js`, `web/firma.css`)

## Stack

- Python 3.12+ só com biblioteca padrão, mais o pacote `MetaTrader5` (Windows).
  Testes com `unittest` em `testes/` (`python -m unittest discover -s testes`).
- Servidor HTTP da biblioteca padrão (`http.server`), porta 8765, só em 127.0.0.1.
- Web sem build: HTML, CSS e JS puros. Gráficos com Lightweight Charts 4.2 via CDN
  (`https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js`).
  3D com Three.js 0.160 via importmap do jsDelivr (`three` e `three/addons/`).
- Tema escuro: fundo #0b0f14, painel #121821, linha #1f2a36, texto #e6edf3, apagado #8b98a5,
  alta #26a69a, baixa #ef5350, destaque #4c8dff, aviso #f0b429.

## Ativos e configuração (`trader/config.json`, fora do git; modelo versionado)

```json
{
  "capital": 5000, "usd_brl": 5.4,
  "ativos": {
    "WDO":    {"ponto_rs": 10,     "tick": 0.5,     "margem_por_contrato": 150, "custo_por_contrato": 0.5,  "fonte": "mt5", "simbolo": "WDO$", "fuso_servidor": "brasilia", "sessao": {"dias": [0,1,2,3,4], "inicio": "09:05", "fim": "18:00", "feriados_b3": true}},
    "WIN":    {"ponto_rs": 0.2,    "tick": 5,       "margem_por_contrato": 100, "custo_por_contrato": 0.25, "fonte": "mt5", "simbolo": "WIN$", "fuso_servidor": "brasilia", "sessao": {"dias": [0,1,2,3,4], "inicio": "09:05", "fim": "18:00", "feriados_b3": true}},
    "EURUSD": {"ponto_rs": 5400,   "tick": 0.00001, "margem_por_contrato": 200, "custo_por_contrato": 0.05, "fonte": "mt5", "simbolo": "EURUSD", "fuso_servidor": "europa", "sessao": {"dias": [0,1,2,3,4], "inicio": "00:05", "fim": "23:30"}},
    "BTCUSDT":{"ponto_rs": 0.0054, "tick": 0.01,    "margem_por_contrato": 300, "custo_por_contrato": 0.1,  "fonte": "binance", "simbolo": "BTCUSDT", "sessao": {"dias": [0,1,2,3,4,5,6], "inicio": "00:05", "fim": "23:30"}}
  },
  "max_contratos": 5, "max_perda_por_trade": 100, "max_perda_dia": 300,
  "max_trades_dia": 10, "max_stops_dia": 3, "rr_minimo": 1.0, "simulado": true
}
```

Cada ativo pode ter `terminal` (caminho do `terminal64.exe` do MT5 daquela corretora).

## Etapa 1 — Dados e estudos

- `dados.py`: baixa candles de 5 min do MT5 (WDO$/WIN$ = série contínua; arredonde os
  preços ao tick, porque a série ajustada gera quebrados) ou da API pública de klines da
  Binance (BTCUSDT). Guarda em CSV em `dados/` (escrita atômica: arquivo temporário e
  renomear), para o backtest rodar com o MT5 fechado. Monta o 60 min a partir do 5 min.
  Fuso: B3 em horário de Brasília; servidores Forex em horário da Europa (UTC+2/+3 com
  horário de verão europeu, calculado por instante). Descarta candles de fim de semana
  nos ativos da B3. A chamada ao MT5 roda num subprocesso com tempo limite de 90 s (o
  pacote às vezes trava). Erros viram mensagem clara ("abra o MT5 e faça login"), nunca
  traceback.
- `estudos.py`: topos e fundos confirmados (máxima maior que os 2 candles antes e os 2
  depois; só vale depois que os 2 seguintes fecham), tendência do 60 min, FVG e order block.
- `tipos.py`: `Candle(t, o, h, l, c, v)`, `Plano(lado, tipo, entrada, stop, alvo, motivo)`,
  `Decisao(planos, desenhos, pensamento)`.

## Etapa 2 — Motor (simulação honesta)

- Conta simulada de R$ 5.000 por trader; uma operação por vez por trader.
- Tamanho: quantos contratos cabem em três limites (perda máxima por trade, margem do
  capital, máximo de contratos), dizendo qual limite decidiu. Stop longe demais para a
  perda máxima é recusa, não ordem menor.
- Risco antes de cada entrada: stop obrigatório, perda no stop dentro do limite, R:R
  mínimo, perda do dia, trades por dia, 3 stops encerram o dia, tick válido, horário.
  Recusa vai para o diário do trader com o motivo.
- Ordem limitada (entrada e alvo) só executa se o preço passar 1 tick além dela.
- Stop executa 1 tick pior; zeragem do fim do dia também paga 1 tick.
- Stop e alvo no mesmo candle: conta stop. No candle da entrada só se confere o stop.
- Custos por contrato em toda operação. Decisão só no fechamento do candle; a ordem vale
  a partir do seguinte. 60 min só com candles fechados.
- Sem entrada nos últimos 30 minutos; zera no último candle do dia.
- Teste obrigatório "não ver o futuro": o mesmo dia rodado com o histórico terminando nele
  e com dias depois dele dá o mesmo resultado.
- Placar: resultado, trades, acerto, fator de lucro, drawdown, pior dia, confiança
  ("baixa" abaixo de 50 operações) e diário de eventos.

## Etapa 3 — Traders (um arquivo cada em `traders/`)

Os traders são **Sofia SMC**, **Didi Agulhada** e **Caio Contrafluxo**. Não há trader de
VWAP nem de rompimento. Cada sala diz quem opera nela: Sofia e Didi em todos os ativos;
Caio só em WDO e WIN (os únicos com agressor).

Cada um expõe `NOME`, `ESTILO`, `PARAMS`, `GRADE` (valores que o gerente testa) e uma
classe `Trader(ativo, tick, params, sessao)` com `decidir(hoje5, ontem5, fechados60) ->
Decisao`. A decisão traz planos, o que desenhar no gráfico e o "pensamento" (explica
inclusive o que não fez, ex.: "pulei: R:R 0,8 abaixo do mínimo").

**Sofia SMC** — tendência no 60, entrada no 5, na volta a order block ou FVG.
1. Tendência (60 min): alta quando o último rompimento foi fechamento acima do último
   topo; baixa quando foi fechamento abaixo do último fundo. Compra só na alta, vende só
   na baixa.
2. FVG (5 min): três candles em que a mínima do terceiro fica acima da máxima do primeiro
   (alta), ou o espelho. Zona = o buraco. Tamanho mínimo: 1 ponto no WDO, 50 no WIN.
3. Order block (5 min): último candle contrário antes da perna que rompeu um topo (alta)
   ou fundo (baixa). Zona = mínima à máxima dele.
4. Entrada: limitada no meio da zona, a favor da tendência; vale a zona que o preço tocar
   primeiro.
5. Stop: 2 ticks além da borda oposta da zona.
6. Alvo: topo confirmado mais próximo acima (compra) ou fundo abaixo (venda). Sem ele, não
   entra.
7. Zona vale até ser usada, até um candle fechar do outro lado dela ou até o fim do dia.

**Didi Agulhada** — agulhada do Didi Index confirmada pela abertura do Bollinger
(`PARAMS = {"tf": 5, "alvo_x": 3.0, "trix_extremo": 0.2}`, grade `alvo_x` 2/3/4 e
`trix_extremo` 0,1/0,2/0,3).
1. Médias simples do fechamento de 3, 8 e 20. Didi Index: curta = MA3 − MA8, longa =
   MA20 − MA8. Agulhada de compra: no mesmo candle a curta passa de ≤ 0 para > 0 e a longa
   de ≥ 0 para < 0; venda é o espelho (comparações com tolerância de tick/1000).
2. Gatilho: do candle da agulhada até 3 candles depois, o primeiro que fecha com a largura
   do Bollinger (8 períodos, 2 desvios populacionais) maior que no candle anterior. Sem
   abertura na janela, a agulhada expira.
3. Confirmações no candle do gatilho: ADX(8) de Wilder subindo com DI+ > DI− (compra) ou
   DI− > DI+ (venda); TRIX(9) (EMA tripla, variação % de um candle) numa extremidade a
   favor: compra com o TRIX no ou abaixo do percentil 20 dos últimos 120 valores e subindo;
   venda no ou acima do percentil 80 e caindo.
4. Entrada a mercado na abertura do candle seguinte ao gatilho. Stop 1 tick além da mínima
   (compra) / máxima (venda) do candle do gatilho. Alvo de proteção a `alvo_x` × risco.
5. Saída por sinal: no fechamento em que a largura do Bollinger diminui, ou em que a MA3
   cruza a MA8 contra a posição — o que vier primeiro — sai na abertura seguinte (1 tick).
6. O card dele mostra Bollinger nos candles e três painéis sincronizados: Didi Index, ADX
   com DI+/DI− e TRIX.

**Caio Contrafluxo** (delta de cada candle de 5 min = volume das agressões de compra menos
venda, somado dos ticks de negócio do MT5 com `TICK_FLAG_BUY`/`TICK_FLAG_SELL`; dia sem
ticks fica sem delta e ele não opera):
opera contra quem entrou contra a tendência do 60 (regra da Sofia). Na resistência, em
tendência de baixa, com delta do candle (agressão de compra menos venda) acima de +limite:
venda. No suporte, em alta, delta abaixo de −limite: compra. Limite no WIN 10.000
contratos (grade 10.000 a 42.000); no WDO o limite sai da distribuição do |delta| por
candle (percentis 80/90/95/98: 5.000, 7.500, 10.500, 14.500; padrão 7.500) e o gerente
escolhe no treino. Entrada a mercado no candle seguinte; stop 2 ticks além do
ponto mais extremo entre o topo/fundo e o candle do sinal; alvo no topo/fundo oposto mais
próximo (sem ele, não entra); um sinal por topo/fundo por dia.

## Etapa 4 — Servidor e sala de operações

- Rotas: `/` (sala), `/firma`, `/web/<arquivo>`, `/api/backtest?ativo=WDO&de=AAAA-MM-DD&ate=AAAA-MM-DD`,
  `/api/firma`, `/api/atividade`, `/relatorios/<dia>/<arquivo>`. Flags `--sem-navegador`
  e `--sem-gerente`.
- O backtest roda o período todo em Python e devolve a lista de eventos com horário
  (candles, desenhos de cada trader, ordens, recusas, execuções, placar). A tela só
  reproduz a lista: play, pausa, ⏮ ⏭, velocidade 1x/5x/20x/100x, barra de tempo
  arrastável, relógio "dia N de M · dd/mm hh:mm".
- Topo: Backtest | Ao vivo ("em breve"), abas por ativo, De/até, Rodar, botão "Firma".
  Centro: um gráfico por trader com o mesmo mercado, cada um com suas zonas (canvas
  sobreposto), marcadores de entrada/saída e linha do alvo. Direita: placar parcial e
  diário "o que cada um está fazendo", mais recente primeiro.
- No fim: tela de resultado com ranking (resultado, trades, acerto, fator de lucro,
  drawdown, pior dia, confiança) e curva de capital de cada trader.

## Etapa 5 — Gerente

Roda sozinho no servidor depois da meia-noite (00:30) e tenta de novo às 19:30 se faltou
dado. Ciclo de ~5 min:
- Histórico dos 120 dias-calendário até ontem. Prova = últimos 21 pregões; treino = o
  resto (se o histórico for curto, prova = último terço).
- Para cada ativo e trader: testa a `GRADE` no treino (um parâmetro por vez), escolhe o
  melhor, roda a prova uma vez.
- Lista `requisitos` por trader, com ok/falta e valor, na ordem: 50+ trades no treino;
  50+ trades na prova; treino positivo; prova positiva; fator de lucro ≥ 1,2 na prova; sem
  overfit (prova rende por pregão pelo menos 50% do treino); drawdown da prova acima de
  −R$ 1.500; sem 5 dias seguidos negativos (dia negativo = perder R$ 25 ou mais). Trader
  com 0 trades por recusa de risco ganha "caber no risco por trade" com o motivo.
- Promovido (pronto para conta demo) só com todos os requisitos ok. Pausado se drawdown
  da prova < −R$ 1.500 ou 5 dias seguidos negativos. Senão segue "em experiência".
- Grava `estado/firma.json` e relatórios HTML em `relatorios/<dia>/`. Sala extra
  `OPCOES` ("Ações / Opções") com status `sem_tarefa` e a lista de pendências que o Diretor
  ainda vai decidir; nunca roda backtest nem entra no ranking.
- Durante o ciclo, `/api/atividade` diz `{"gerente": {"estado": "trabalhando"|"ocioso",
  "sala", "trader", "desde"}}` (dict protegido por lock; volta a ocioso no `finally`).

## Etapa 6 — Firma 3D (visual The Sims 4)

- Tudo procedural (caixas, cilindros) com texturas desenhadas em canvas; sombras suaves,
  luz quente, pisos diferentes por sala, plantas, quadros, tapetes, janelas, árvores lá
  fora. Bonecos estilo voxel com cabeça, tronco, braços e pernas articulados.
- Planta: hall central (gerente na mesa + telão "Ranking da firma"); salas WDO, WIN,
  EURUSD, BTCUSDT (3 mesas cada, monitores com gráfico); Diretoria (minha sala); a oeste,
  corredor ligando "Descanso e jogos" (noroeste: sofá em L, TV com videogame, café,
  máquina de refri, pebolim, pufes) e "Ações / Opções" (sudoeste, 3 mesas apagadas).
- Câmera de cima: arrastar com o botão esquerdo move (cursor de mão fechada), botão
  direito ou Q/E gira, scroll aproxima, WASD move. V alterna para primeira pessoa
  (pointer lock, WASD anda com colisão nas paredes, E interage, ESC solta o mouse).
  Paredes baixam para 1 m na vista de cima.
- Quadro de status na parede de cada sala: "Equipe <sala> · status", resumo ("ninguém
  pronto para a demo" / "N prontos") e, por trader, os requisitos com ✅/❌ e valor. Na
  Ações/Opções, as pendências com ☐. Clicar abre o mesmo conteúdo no painel lateral.
- Comportamento: a página lê `/api/firma` a cada 30 s e `/api/atividade` a cada 5 s. Um
  trader só trabalha (anda até a mesa e senta) quando o gerente está processando a sala
  dele; pausado nunca trabalha; quem sentou fica pelo menos 30 s depois do fim. Fora
  disso, ociosos vão para vagas do descanso (sofá jogando, café com caneca, refri,
  pebolim, pufe) ou conversam em pares no corredor com balão "…", trocando de atividade a
  cada 2–5 min. Caminhada por rotas que passam pelas portas (nunca atravessa parede), 1,3
  m/s, pernas e braços balançando. Rótulo acima da cabeça com nome · sala e atividade
  ("trabalhando: backtest WIN", "no café", "pausado"). Falha no servidor = todos ociosos.
- Clicar num trader abre a ficha: status, decisão do gerente, placar treino/prova,
  parâmetros, diário, link do relatório.

Comece pela Etapa 1. Antes de escrever código, me diga quais arquivos vai criar e quais
testes vão provar cada regra.
