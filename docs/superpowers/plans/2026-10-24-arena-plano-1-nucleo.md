# Arena de Traders — Plano 1: núcleo (backtest da Sofia com replay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodar o backtest da Sofia SMC em WDO ou WIN com candles do MT5 e assistir ao replay na sala de operações, terminando na tela de resultado.

**Architecture:** Funções puras de estudo (`estudos.py`) alimentam traders que só enxergam candles já fechados. O `motor.py` simula as contas, dimensiona e confere cada ordem com o código das skills `trader-budget` e `trader-risk`, e produz uma lista de eventos com horário. O `servidor.py` (biblioteca padrão) entrega essa lista em JSON, e a página `web/` só reproduz os eventos no play.

**Tech Stack:** Python 3.14, `MetaTrader5` (única dependência), `unittest` da biblioteca padrão, HTML/JS puro com Lightweight Charts 4.2 via CDN.

**Spec:** `docs/superpowers/specs/2026-10-24-arena-de-traders-design.md`

## Roteiro dos planos

| Plano | Entrega |
|---|---|
| **1 — Núcleo (este)** | Dados do MT5, estudos SMC, Sofia, motor de contas, servidor, sala com replay e tela de resultado |
| 2 — Caio Contrafluxo | Ticks do MT5, delta por candle, Caio, histograma de delta no gráfico, laboratório do delta do WDO |
| 3 — Ao vivo | Laço que lê o MT5 durante o pregão, estado ao vivo na mesma sala |
| 4 — Gamificação | Rivais "Cara ou Coroa" e "Só Tendência", liga, ficha de RPG, painel de pensamento, letreiro, prova final |

Cada plano é escrito quando o anterior estiver pronto.

## Global Constraints

- Python 3.14; única dependência externa: `MetaTrader5`. Testes com `unittest` (`python -m unittest discover -s testes -v`).
- Nenhuma ordem vai para corretora. Contas simuladas de R$ 5.000 por trader.
- WDO: 1 ponto = R$ 10, tick 0,5. WIN: 1 ponto = R$ 0,20, tick 5. Fonte única: `ATIVOS` em `.claude/skills/trader-budget/size.py`.
- Toda entrada passa por `dimensionar()` (trader-budget) e `checar()` (trader-risk), carregados das skills, sem cópia do código.
- Horário de Brasília (UTC-3 fixo). O MT5 das corretoras da B3 entrega o horário do servidor em Brasília; conferir na primeira conexão.
- Decisão só no fechamento do candle; ordem vale a partir do candle seguinte.
- Limitada (entrada e alvo) executa só se o preço passar 1 tick além. Stop executa 1 tick pior. Zeragem do fim do dia paga 1 tick. Stop e alvo no mesmo candle: stop. No candle da entrada, só se confere o stop.
- `trader/` e `dados/` ficam fora do git (já no `.gitignore`).
- Textos da interface e do diário em português.

## Review Focus

1. **MT5 fechado, sem login ou com símbolo inexistente:** espera-se uma mensagem clara ("abra o MT5 e faça login" / "símbolo WDO$ não encontrado, ajuste em trader/config.json"), nunca um traceback. Teste na Task 2.
2. **Período sem pregão (fim de semana, feriado, datas antes do histórico):** a API responde `{"erro": "sem candles entre ..."}` e a sala mostra a mensagem. Teste na Task 8.
3. **Dia com pregão encurtado ou candles faltando:** a zeragem acontece no último candle que existe naquele dia, não num horário fixo. Teste na Task 6.
4. **Abertura do candle já além do stop (gap):** o stop executa na abertura menos 1 tick, não no preço do stop. Teste na Task 6.
5. **Zonas de ontem:** uma zona criada num dia nunca gera ordem no dia seguinte (protege da virada de contrato). Teste na Task 5.

---

### Task 1: Tipos e candles em CSV

**Files:**
- Create: `tipos.py`, `dados.py`, `testes/__init__.py`, `testes/test_dados.py`

**Interfaces:**
- Produces:
  - `tipos.Candle` — `@dataclass(frozen=True)`: `t: datetime` (abertura do candle, Brasília, sem tzinfo), `o: float`, `h: float`, `l: float`, `c: float`, `v: float = 0.0`, `delta: float = 0.0`.
  - `tipos.Zona` — `@dataclass`: `criada: int` (índice do candle que a confirmou), `lado: str` (`"alta"`/`"baixa"`), `topo: float`, `fundo: float`, `tipo: str` (`"fvg"`/`"ob"`).
  - `tipos.Pivo` — `@dataclass(frozen=True)`: `i: int`, `conf: int` (índice em que passa a valer), `tipo: str` (`"topo"`/`"fundo"`), `preco: float`.
  - `tipos.Plano` — `@dataclass`: `lado: str` (`"compra"`/`"venda"`), `tipo: str` (`"limite"`/`"mercado"`), `entrada: float | None`, `stop: float`, `alvo: float`, `setup: str`.
  - `tipos.Decisao` — `@dataclass`: `planos: list[Plano]`, `desenhos: list[dict]`, `pensamento: list[str]`.
  - `dados.salvar_csv(candles: list[Candle], caminho: str) -> None` e `dados.ler_csv(caminho: str) -> list[Candle]` (cabeçalho `t,o,h,l,c,v,delta`, `t` em ISO).
  - `dados.agrupar(candles: list[Candle], minutos: int) -> list[Candle]` — agrupa por dia em blocos ancorados no primeiro candle do dia (09:00 → 09:00–09:59 para 60).
  - `dados.por_dia(candles) -> dict[date, list[Candle]]`.

- [ ] **Step 1: Write the failing tests** em `testes/test_dados.py`:
  - `test_csv_ida_e_volta`: salva 3 candles num arquivo temporário e `ler_csv` devolve a lista igual.
  - `test_agrupar_60`: 24 candles de 5 min de 09:00 a 10:55 de um dia → 2 candles; o primeiro tem `t=09:00`, `o` do candle 09:00, `c` do 09:55, `h`/`l` extremos, `v` e `delta` somados.
  - `test_agrupar_nao_mistura_dias`: 12 candles às 17:00–17:55 de um dia mais 12 às 09:00–09:55 do seguinte → 2 candles de 60, um por dia.
  - `test_por_dia`: separa as datas e mantém a ordem.
- [ ] **Step 2: Run** `python -m unittest testes.test_dados -v` — Expected: FAIL (`ModuleNotFoundError: tipos`).
- [ ] **Step 3: Implement** `tipos.py` e as quatro funções de `dados.py` com `csv` e `datetime` da biblioteca padrão.
- [ ] **Step 4: Run** `python -m unittest testes.test_dados -v` — Expected: 4 testes OK.
- [ ] **Step 5: Commit** `git add tipos.py dados.py testes && git commit -m "feat: candle types, CSV storage and timeframe grouping"`

### Task 2: Histórico do MT5 com cache

**Files:**
- Modify: `dados.py`
- Create: `requirements.txt` (uma linha: `MetaTrader5`)
- Test: `testes/test_dados.py`

**Interfaces:**
- Consumes: `Candle`, `salvar_csv`, `ler_csv` (Task 1).
- Produces:
  - `dados.ErroDados(Exception)` — mensagem pronta para o usuário.
  - `dados.baixar_mt5(simbolo: str, de: date, ate: date, mt5=None) -> list[Candle]` — `mt5` é o módulo `MetaTrader5` (importado só quando `None`, para o teste injetar um falso). Usa `initialize()`, `symbol_select(simbolo, True)`, `copy_rates_range(simbolo, TIMEFRAME_M5, de, ate+1 dia)`; `v` = `real_volume`.
  - `dados.historico(ativo: str, de: date, ate: date, cfg: dict, pasta="dados", mt5=None) -> list[Candle]` — lê `pasta/{ativo}_M5.csv`; se faltar algum dia útil do intervalo, baixa do MT5 o símbolo `cfg["ativos"][ativo]["simbolo_mt5"]` (padrão `"WDO$"` / `"WIN$"`), junta sem duplicar `t`, salva e devolve só o intervalo pedido.

- [ ] **Step 1: Write the failing tests** com um objeto falso de MT5 (classe com os métodos acima):
  - `test_mt5_fechado`: `initialize()` devolve `False` → `ErroDados` com "abra o MT5 e faça login".
  - `test_simbolo_inexistente`: `symbol_select` devolve `False` → `ErroDados` contendo `"WDO$"` e `"trader/config.json"`.
  - `test_cache_evita_baixar_de_novo`: primeira chamada baixa e grava o CSV; a segunda, com o mesmo intervalo, não chama `copy_rates_range` (o falso conta as chamadas).
  - `test_historico_recorta_intervalo`: cache com 3 dias; pedir o do meio devolve só os candles dele.
- [ ] **Step 2: Run** `python -m unittest testes.test_dados -v` — Expected: os 4 novos FAIL.
- [ ] **Step 3: Implement** `ErroDados`, `baixar_mt5` e `historico`; adicione `"simbolo_mt5"` a WDO e WIN em `.claude/skills/trader-budget/config.example.json`.
- [ ] **Step 4: Run** a suíte — Expected: 8 OK.
- [ ] **Step 5: Verificação manual com o usuário (MT5 aberto e logado):** `python -c "import dados,json,datetime as d;c=dados.historico('WDO',d.date(2026,9,1),d.date(2026,9,5),json.load(open('trader/config.json')));print(len(c),c[0],c[-1])"` — Expected: algumas centenas de candles, o primeiro perto das 09:00. Se o horário vier deslocado, anotar o deslocamento no config e corrigir em `baixar_mt5`.
- [ ] **Step 6: Commit** `git commit -am "feat: MT5 history download with CSV cache"` (incluir `requirements.txt`).

### Task 3: Topos, fundos e tendência

**Files:**
- Create: `estudos.py`, `testes/test_estudos.py`

**Interfaces:**
- Produces:
  - `estudos.pivos(candles: list[Candle], n: int = 2) -> list[Pivo]` — topo em `i` quando `h[i]` é estritamente maior que as máximas dos `n` candles antes e dos `n` depois; fundo é o espelho; `conf = i + n`. Só considera `i` com `n` vizinhos de cada lado.
  - `estudos.tendencia(candles: list[Candle], n: int = 2) -> str | None` — olhando a lista inteira (que já contém só candles fechados): percorre os candles; a cada fechamento acima do último topo confirmado (`conf <= j`) marca `"alta"`, abaixo do último fundo confirmado marca `"baixa"`; devolve o último estado ou `None`.

- [ ] **Step 1: Write the failing tests:**
  - `test_pivo_topo_confirmado_depois_de_n`: máximas `[1,2,5,3,2,1]` → um `Pivo(i=2, conf=4, tipo="topo", preco=5)`.
  - `test_pivo_ignora_empate`: máximas `[1,5,5,1,1]` → nenhum topo.
  - `test_pivo_sem_vizinhos_suficientes`: topo nos últimos 2 candles não aparece.
  - `test_tendencia_alta_ao_romper_topo`, `test_tendencia_vira_baixa`, `test_tendencia_none_sem_rompimento` com séries montadas à mão.
- [ ] **Step 2: Run** `python -m unittest testes.test_estudos -v` — Expected: FAIL.
- [ ] **Step 3: Implement** as duas funções em `estudos.py`.
- [ ] **Step 4: Run** — Expected: 6 OK.
- [ ] **Step 5: Commit** `git commit -m "feat: confirmed pivots and market-structure trend"` (com os arquivos novos).

### Task 4: FVG e order block

**Files:**
- Modify: `estudos.py`
- Test: `testes/test_estudos.py`

**Interfaces:**
- Consumes: `Pivo`, `pivos` (Task 3), `Zona` (Task 1).
- Produces:
  - `estudos.fvgs(candles, minimo: float) -> list[Zona]` — para cada `i >= 2`: alta se `l[i] > h[i-2]` com `l[i] - h[i-2] >= minimo` → `Zona(criada=i, lado="alta", topo=l[i], fundo=h[i-2], tipo="fvg")`; baixa é o espelho (`h[i] < l[i-2]`).
  - `estudos.order_blocks(candles, n: int = 2) -> list[Zona]` — percorre `j`; quando `c[j]` fecha acima do último topo confirmado até `j` (rompimento de alta, só o primeiro fechamento acima de cada topo), acha o candle de menor mínima entre o topo rompido e `j`, recua até o último candle de baixa (`c < o`) nesse trecho, inclusive ele; zona = mínima/máxima desse candle, `criada=j`, `lado="alta"`, `tipo="ob"`. Venda é o espelho.

- [ ] **Step 1: Write the failing tests:**
  - `test_fvg_alta`, `test_fvg_baixa`, `test_fvg_abaixo_do_minimo_ignorado` (gap de 0,5 com mínimo 1,0).
  - `test_ob_alta_ultimo_candle_de_baixa_antes_da_perna`: série com topo confirmado, recuo com dois candles de baixa e perna de alta que fecha acima do topo → OB é o segundo candle de baixa (o último antes da perna), `criada` = índice do fechamento acima do topo.
  - `test_ob_um_por_topo_rompido`: dois fechamentos seguidos acima do mesmo topo geram um só OB.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `fvgs` e `order_blocks`.
- [ ] **Step 4: Run** — Expected: todos OK.
- [ ] **Step 5: Commit** `git commit -am "feat: fair value gaps and order blocks"`

### Task 5: Trader Sofia SMC

**Files:**
- Create: `traders/__init__.py`, `traders/sofia_smc.py`, `testes/test_sofia.py`

**Interfaces:**
- Consumes: `pivos`, `tendencia`, `fvgs`, `order_blocks`, `Plano`, `Decisao`, `Zona`.
- Produces (contrato de todo trader):
  - Constantes do módulo: `NOME = "Sofia SMC"`, `ESTILO = "OB/FVG · tendência 60→5"`, `PARAMS = {"n": 2, "fvg_min": {"WDO": 1.0, "WIN": 50.0}, "folga_ticks": 2}`.
  - `class Trader: __init__(self, ativo: str, tick: float, params: dict | None = None)` e `decidir(self, hoje5: list[Candle], ontem5: list[Candle], fechados60: list[Candle]) -> Decisao` — `hoje5` são os candles de 5 min de hoje até o que acabou de fechar; `ontem5` dá contexto para os pivôs do alvo; `fechados60` são candles de 60 min já fechados.
  - `desenhos` do `Decisao`: dicts `{"tipo": "zona", "lado", "topo", "fundo", "de": iso, "rotulo": "OB"|"FVG"}` e `{"tipo": "linha", "preco", "rotulo": "liquidez · alvo"}`.

Regras (spec, Trader 1): tendência do 60 decide o lado; zonas de hoje (OB + FVG) do lado da tendência, ainda válidas (não usadas e sem fechamento do outro lado da borda oposta); um `Plano` limitado por zona válida: entrada = meio da zona arredondado ao tick; stop = borda oposta ± `folga_ticks * tick`; alvo = pivô confirmado mais próximo além da entrada (topo acima na compra, fundo abaixo na venda) em `ontem5 + hoje5`; sem alvo, sem plano para aquela zona (registrar no `pensamento`). Uma zona usada nunca volta: o trader marca como usada quando o candle que acabou de fechar atravessou a entrada dela.

- [ ] **Step 1: Write the failing tests** com séries montadas à mão:
  - `test_sem_tendencia_sem_plano`.
  - `test_venda_no_meio_do_fvg`: tendência de baixa no 60 e FVG de baixa 5431,5–5434,5 hoje → `Plano(lado="venda", tipo="limite", entrada=5433.0, stop=5435.5, alvo=<fundo confirmado abaixo>)` no WDO (tick 0,5).
  - `test_win_compra_no_tick`: WIN (tick 5), tendência de alta, FVG de alta 128.400–128.470 → `entrada=128435.0`, `stop=128390.0`.
  - `test_meio_arredonda_ao_tick`: WIN, zona 128.400–128.475 (meio 128.437,5) → `entrada=128440.0`.
  - `test_sem_alvo_nao_entra`: compra sem topo confirmado acima → nenhum plano e `pensamento` contém `"sem alvo"`.
  - `test_zona_invalidada_por_fechamento`: candle fecha abaixo do fundo de uma zona de alta → ela some dos planos.
  - `test_zona_de_ontem_nao_vale` (Review Focus 5): FVG formado só em `ontem5` não gera plano hoje.
- [ ] **Step 2: Run** `python -m unittest testes.test_sofia -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `traders/sofia_smc.py` com `arredondar_tick(preco, tick) = round(preco / tick) * tick`.
- [ ] **Step 4: Run** — Expected: OK.
- [ ] **Step 5: Commit** `git commit -m "feat: Sofia SMC trader"` (com os arquivos novos).

### Task 6: Motor de contas simuladas

**Files:**
- Create: `motor.py`, `testes/test_motor.py`

**Interfaces:**
- Consumes: `Candle`, `Plano`, `Decisao`; das skills via `importlib.util.spec_from_file_location`: `size.ATIVOS`, `size.dimensionar(plano: dict, cfg: dict, hoje: str, limite=None) -> (ordem, limites, decide)` levantando `size.Recusa`; `check.checar(ordens: list, cfg: dict, dia: dict | None, agora: datetime) -> list[dict]` (cada resultado tem `ok`, `motivos`).
- Produces:
  - `motor.carregar_config(caminho="trader/config.json") -> dict` — se o arquivo não existe, copia `.claude/skills/trader-budget/config.example.json` para lá e devolve.
  - `class motor.Conta: __init__(self, nome: str, ativo: str, cfg: dict)` com `executar_candle(self, c: Candle, ultimo_do_dia: bool) -> list[dict]` (eventos) e `colocar(self, planos: list[Plano], agora: datetime, simbolo: str) -> list[dict]` (eventos de ordem/BLOCK). Atributos lidos por outras tasks: `operacoes: list[dict]` (`entrada_t, saida_t, lado, contratos, entrada, saida, resultado_rs, motivo_saida`), `equity: list[tuple[datetime, float]]` (um ponto por dia).
  - Evento: `{"t": iso, "trader": nome, "tipo": "ordem"|"block"|"entrada"|"saida"|"pensamento"|"desenho", ...}`.

Regras (Global Constraints + spec):
- `colocar` só quando sem posição: substitui as ordens pendentes; cada `Plano` passa por `dimensionar` (Recusa → evento `block` com o motivo) e por `checar` com o estado do dia `{"data","trades","stops","resultado","posicao_aberta"}` e `agora` = fechamento do candle; reprovado → evento `block` com os motivos.
- `executar_candle`: limitada de compra executa se `c.l <= entrada - tick` (venda: `c.h >= entrada + tick`), ao preço da entrada; se mais de uma executaria, vale a mais próxima de `c.o`; as outras são canceladas. Mercado executa em `c.o`. No candle da entrada só o stop é conferido. Stop de compra: se `c.o <= stop` sai em `c.o - tick` (gap), senão se `c.l <= stop` sai em `stop - tick`; alvo de compra: `c.h >= alvo + tick` sai no alvo; stop e alvo no mesmo candle → stop. Venda é o espelho. `ultimo_do_dia` → zera no `c.c ∓ tick` e cancela pendentes.
- Resultado em R$: `(saida - entrada) * sinal * pontos * ponto_rs * contratos - 2 * custo * contratos`. Stop conta em `stops` do dia; resultado acumula em `resultado`.

- [ ] **Step 1: Write the failing tests** (cfg de teste montado no próprio teste, WDO):
  - `test_limitada_precisa_passar_1_tick`: compra limitada em 5430; candle com mínima 5430 → não executa; mínima 5429,5 → executa a 5430.
  - `test_stop_paga_1_tick`: stop 5426 atingido → saída 5425,5.
  - `test_gap_alem_do_stop` (Review Focus 4): abertura 5424 com stop 5426 → saída 5423,5.
  - `test_stop_e_alvo_no_mesmo_candle_conta_stop`.
  - `test_candle_da_entrada_so_confere_stop`.
  - `test_zeragem_no_ultimo_candle_existente` (Review Focus 3): dia com último candle às 13:55 → posição sai no `c` dele ∓ 1 tick.
  - `test_tres_stops_encerram_o_dia`: depois do 3º stop, `colocar` gera evento `block` contendo `"3 stops"`.
  - `test_resultado_em_reais_com_custos`: 2 contratos WDO, +8,5 pontos, custo 0,5 → R$ 168,00.
  - `test_cria_config_na_primeira_vez`: `carregar_config` em pasta temporária cria o arquivo a partir do exemplo.
- [ ] **Step 2: Run** `python -m unittest testes.test_motor -v` — Expected: FAIL.
- [ ] **Step 3: Implement** `motor.py` (sem `rodar_backtest` ainda).
- [ ] **Step 4: Run** — Expected: OK.
- [ ] **Step 5: Commit** `git commit -m "feat: simulated accounts with honest fills, sizing and risk gate"` (com os arquivos novos).

### Task 7: Backtest de ponta a ponta, placar e linha de comando

**Files:**
- Modify: `motor.py`
- Create: `arena.py`
- Test: `testes/test_motor.py`

**Interfaces:**
- Consumes: `Conta` (Task 6), `agrupar`, `por_dia`, `historico` (Tasks 1–2), módulos em `traders/` (Task 5).
- Produces:
  - `motor.placar(operacoes: list[dict], equity: list) -> dict` — chaves `resultado`, `trades`, `acerto` (0–1), `fator_lucro` (`None` sem perdas), `drawdown` (maior queda da equity diária, negativo), `pior_dia`, `confianca` (`"baixa"` < 50 trades, `"média"` < 200, `"alta"`).
  - `motor.rodar_backtest(ativo: str, candles5: list[Candle], modulos_traders: list, cfg: dict) -> dict` — `{"ativo", "candles": [[iso, o, h, l, c], ...], "traders": {nome: {"estilo", "eventos", "placar", "equity"}}}`. Para cada candle de 5 min fechado: cada conta executa o candle; depois cada trader decide com `hoje5` (até o candle), `ontem5` e `fechados60` (de `agrupar`, só blocos cujo último candle de 5 min já fechou); a conta coloca os planos. Sem novas ordens a menos de 30 min do último candle do dia (o `checar` cobre pelo horário do config).
  - `arena.py`: `python arena.py backtest --ativo WDO --de 2026-09-01 --ate 2026-09-30` imprime o ranking (uma linha por trader: resultado, trades, acerto, fator, drawdown, confiança); `ErroDados` vira mensagem sem traceback.

- [ ] **Step 1: Write the failing tests:**
  - `test_placar_basico`: 3 operações (+100, −50, +30) → resultado 80, acerto 2/3, fator 2,6, confiança "baixa".
  - `test_nao_ve_o_futuro`: com uma série sintética de 3 dias, o resultado e os eventos do dia 2 são idênticos rodando `candles5` até o fim do dia 2 e até o fim do dia 3.
  - `test_eventos_ordenados_por_horario`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `placar`, `rodar_backtest` e `arena.py` (argparse).
- [ ] **Step 4: Run** a suíte inteira e as skills: `python -m unittest discover -s testes -v`, `python .claude/skills/trader-budget/size.py --teste`, `python .claude/skills/trader-risk/check.py --teste` — Expected: tudo OK.
- [ ] **Step 5: Verificação com dados reais (MT5 do usuário):** `python arena.py backtest --ativo WDO --de 2026-09-01 --ate 2026-09-30` e o mesmo para `WIN` — Expected: ranking com a Sofia e número de trades plausível (não zero, não centenas por dia). Mostrar ao usuário.
- [ ] **Step 6: Commit** `git commit -am "feat: end-to-end backtest, scoreboard and CLI"` (com `arena.py`).

### Task 8: Servidor local e API

**Files:**
- Create: `servidor.py`, `testes/test_servidor.py`

**Interfaces:**
- Consumes: `rodar_backtest`, `historico`, `carregar_config`, `ErroDados`.
- Produces:
  - `servidor.criar_servidor(porta: int = 8765, historico_fn=None) -> ThreadingHTTPServer` (o teste injeta um `historico_fn` falso).
  - `GET /` → `web/index.html`; `GET /web/<arquivo>` → estáticos; `GET /api/backtest?ativo=WDO&de=AAAA-MM-DD&ate=AAAA-MM-DD` → JSON de `rodar_backtest`; `GET /api/traders` → `[{"nome","estilo"}]`.
  - Erros como JSON `{"erro": "..."}` com status 400: ativo fora de WDO/WIN, datas inválidas, `de > ate`, `ErroDados`, e lista de candles vazia → `"sem candles entre {de} e {ate} (fim de semana, feriado ou fora do histórico)"`.
  - `python servidor.py` abre `http://localhost:8765` no navegador padrão (`webbrowser.open`).

- [ ] **Step 1: Write the failing tests** (servidor numa thread, porta 0, `urllib.request`):
  - `test_backtest_ok` (historico falso com 1 dia) → 200 e chave `"traders"` com `"Sofia SMC"`.
  - `test_periodo_sem_pregao` (Review Focus 2) → 400 e `"sem candles"` no erro.
  - `test_ativo_invalido` → 400.
  - `test_index` → 200 com `<html`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `servidor.py` com `http.server` e `json`.
- [ ] **Step 4: Run** — Expected: OK.
- [ ] **Step 5: Commit** `git commit -m "feat: local HTTP server with backtest API"` (com os arquivos novos).

### Task 9: Sala de operações com replay

**Files:**
- Create: `web/index.html`, `web/sala.js`, `web/estilo.css`

**Interfaces:**
- Consumes: `GET /api/backtest`, `GET /api/traders` (Task 8).
- Produces: `web/sala.js` expõe `window.arena = {dados, mostrarResultado()}` para a Task 10.

Layout e textos conforme `mockups/sala.png` e `mockups/sala.html` (reaproveitar o CSS do mockup). Topo: Backtest/Ao vivo (Ao vivo desabilitado com "em breve"), WDO/WIN, De/até (`<input type="date">`), botão "Rodar", ⏮ ⏸/▶ ⏭, velocidade (1x, 5x, 20x, 100x), barra de tempo arrastável e relógio "dia N de M · dd/mm hh:mm". Centro: um card por trader com Lightweight Charts 4.2 (`https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js`), candles revelados até o instante atual, zonas desenhadas num `<canvas>` sobreposto (coordenadas por `timeScale().timeToCoordinate` e `series.priceToCoordinate`, redesenhado a cada passo), marcadores de entrada/saída (`series.setMarkers`), linha do alvo (`createPriceLine`). Direita: placar parcial (resultado até o instante, trades, acerto, "agora") e diário com os eventos até o instante, mais recentes primeiro. ⏭ pula para o fim e chama `mostrarResultado()`. Erros da API aparecem como aviso no lugar dos gráficos.

- [ ] **Step 1: Implement** as três peças.
- [ ] **Step 2: Verify** com `python servidor.py` e o navegador do app (skill `run`): rodar WDO num período de 1 semana; conferir play, pausa, velocidade, arrastar a barra, zonas e marcadores aparecendo na hora certa, diário e placar acompanhando. Rodar um período de fim de semana e ver o aviso "sem candles".
- [ ] **Step 3: Screenshot** da sala para o usuário.
- [ ] **Step 4: Commit** `git commit -m "feat: trading room with synchronized replay"` (com `web/`).

### Task 10: Tela de resultado

**Files:**
- Create: `web/resultado.js`
- Modify: `web/index.html`, `web/sala.js`

**Interfaces:**
- Consumes: `window.arena.dados` (Task 9), `placar` e `equity` de cada trader.

Conforme `mockups/resultado.png`: título com ativo, período, pregões e número de traders; quatro destaques (melhor trader, pior trader, total de operações, dias em que todos ganharam); ranking (resultado, trades, acerto, fator de lucro, drawdown, pior dia, confiança) com a nota "Resultados já descontam custos e 1 tick de derrapagem nos stops" e a explicação da confiança; curva de capital de cada trader (Lightweight Charts, uma `LineSeries` por trader); botões "Ver replay de um dia" (volta à sala no início do dia escolhido) e "Rodar outro período".

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Verify** no navegador do app: terminar um replay e ver o resultado; números iguais aos do `python arena.py backtest` do mesmo período.
- [ ] **Step 3: Screenshot** para o usuário.
- [ ] **Step 4: Commit** `git commit -m "feat: backtest result screen"`.
