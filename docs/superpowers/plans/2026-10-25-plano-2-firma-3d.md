# Firma 3D (Plano 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatro salas de mercado (WDO, WIN, EURUSD, BTCUSDT) com três traders cada, um gerente em código que roda ciclos, decide e escreve relatórios, e um escritório 3D com câmera de cima e primeira pessoa alimentado por `estado/firma.json`.

**Architecture:** O motor e as skills passam a ler a especificação do ativo do config (`ponto_rs`, `tick`, `sessao`, `fonte`). `dados.py` ganha a fonte Binance e o terminal MT5 por ativo. `gerente.py` orquestra backtests treino/prova, grade de parâmetros, promoção e relatórios HTML/JSON. `web/firma.*` desenha a firma em Three.js lendo `/api/firma`.

**Tech Stack:** Python 3.14 stdlib + `MetaTrader5`; `unittest`; Three.js 0.160 via jsdelivr (ES module) com OrbitControls e PointerLockControls dos `examples/jsm`; Lightweight Charts já usado.

**Spec:** `docs/superpowers/specs/2026-10-25-firma-3d-design.md` (e a base `docs/superpowers/specs/2026-10-24-arena-de-traders-design.md`).

## Global Constraints

- Python 3.14; única dependência pip: `MetaTrader5`. Testes: `python -m unittest discover -s testes` deve ficar verde ao fim de cada task; skills: `python .claude/skills/trader-budget/size.py --teste` e `python .claude/skills/trader-risk/check.py --teste`.
- Nenhuma ordem real. Contas simuladas de R$ 5.000 por trader por sala. Toda entrada passa por `size.dimensionar` e `check.checar` (skills carregadas por importlib em `motor.py`).
- Especificação de ativo vem de `cfg["ativos"][ATIVO]` com os valores da tabela do spec; `size.ATIVOS` mantém apenas os padrões de WDO/WIN e é sobrescrito pelo config quando o config traz `ponto_rs`/`tick`.
- Horários internos em Brasília (UTC-3, sem tzinfo). Binance entrega UTC em ms; MT5 MetaQuotes entrega horário do servidor (tratar como UTC+3 em outubro: verificar com o candle das 00:00 e anotar no código); MT5 Genial entrega Brasília.
- Regras de execução honesta do Plano 1 continuam (1 tick além para limitada, stop 1 tick pior, zeragem no último candle do dia).
- `dados/`, `trader/`, `estado/`, `relatorios/` ficam fora do git (`.gitignore`).
- Textos de interface, relatórios e diário em português. Sem assets externos no 3D.
- Modelo de subagente: implementadores em `sonnet`; revisores em `sonnet` para diffs mecânicos e `opus` para o motor/gerente e a revisão final.

## Padrão visual (The Sims 4) — vale para as Tasks 5 e 6

O usuário quer o escritório **visualmente próximo do The Sims 4** (referências: `mockups/escritorio.png` e as capturas do jogo enviadas). Critérios que o revisor cobra:

1. **Câmera de cima estilo Sims:** vista 3/4 em perspectiva (não ortográfica), inclinação 35°–55°, giro suave com Q/E ou botão direito, zoom com scroll entre "sala inteira" e "mesa de perto", pan com WASD/arrasto do botão do meio; foco inicial na Diretoria.
2. **Paredes recortadas (cutaway):** paredes com 2,8 m, mas quando a câmera está de cima elas aparecem com 1,0 m de altura ("paredes baixas" do Sims); em primeira pessoa voltam à altura total. Rodapés e molduras de porta/janela.
3. **Iluminação:** luz hemisférica + direcional com sombras (`PCFSoftShadowMap`), tom quente de interior, luminárias de teto emissivas por sala, `ACESFilmicToneMapping`, `sRGB`.
4. **Materiais com textura procedural (canvas):** piso de madeira em tábuas no hall, carpete por sala com cor própria, paredes claras com leve ruído, janelas com vidro translúcido e vista para um gramado com calçada e arbustos fora do prédio (chão verde, sem céu preto: fundo em gradiente ou céu claro).
5. **Mobiliário por sala:** mesa em L ou reta com pernas, cadeira de escritório com rodinhas (cilindros), monitor com moldura e tela canvas, teclado, caneca, planta em vaso, lixeira, quadro na parede; hall com sofá, mesa de centro, tapete, bebedouro e quadro de ranking grande; Diretoria com mesa maior, duas cadeiras de visita, estante e troféu.
6. **Personagens:** boneco de 1,7 m com cabeça, tronco, braços, pernas, cabelo e cor de pele/roupa variando por trader (6 paletas), sentado na cadeira com os braços sobre a mesa; animação leve (respiração/tecla digitando: braços sobem e descem 2 cm em 1 s) para parecer vivo; plumbob verde sobre a cabeça do trader selecionado; sprite de nome/status com fundo arredondado e sombra.
7. **UI do jogo:** painel lateral e HUD com o mesmo tema escuro da sala de operações; cursor muda para "mão" sobre um trader; ao passar o mouse, o trader ganha contorno.
8. **Desempenho:** 60 fps numa GPU integrada com as 5 salas (geometrias reutilizadas via `InstancedMesh` ou `Mesh` compartilhando geometria/material; sombras só na luz direcional; `renderer.setPixelRatio(min(devicePixelRatio, 2))`).

Antes de declarar a Task 5 pronta, o implementador tira **três capturas** (visão geral, zoom numa sala, Diretoria) e as compara com as referências; se não parecer um escritório do Sims (e sim caixas soltas), continua. O controlador repete a conferência com as próprias capturas.

## Review Focus

1. Ativo de 24h (BTCUSDT) nunca dispara "fim de semana" nem feriado da B3; zera às 23:55 e reabre 00:00 (teste na Task 1).
2. Binance fora do ar ou limitada (HTTP 429/5xx): mensagem clara, cache preservado, sem traceback (teste na Task 2).
3. Trader com menos de 50 trades no treino nunca é promovido, mesmo com lucro (teste na Task 4).
4. Sala sem dados (WDO/WIN sem Genial): gerente registra pendência e segue; firma mostra "aguardando dados" (testes nas Tasks 4 e 5).
5. Primeira pessoa não atravessa paredes e V/ESC sempre devolvem o controle (verificação manual na Task 6).

---

### Task 1: Especificação de ativo e sessão vindas do config

**Files:**
- Modify: `.claude/skills/trader-budget/size.py`, `.claude/skills/trader-risk/check.py`, `.claude/skills/trader-budget/config.example.json`, `motor.py`
- Test: `testes/test_motor.py`, autotestes das skills

**Interfaces:**
- Produces: `size.especificacao(ativo: str, cfg: dict) -> dict` com chaves `ponto_rs, tick, margem_por_contrato, custo_por_contrato, sessao` (sessao = `{"dias": [...], "inicio": "HH:MM", "fim": "HH:MM"}`; padrão B3 quando ausente: dias 0–4, 09:05–18:00). `size.dimensionar` e `check.checar` passam a usar `especificacao` (o `simbolo[:3]` só vale para WDO/WIN; para os demais, `plano["ativo"]`/`ordem["ativo"]` traz o nome do ativo e o motor sempre preenche esse campo).
- `check.janela(agora, cfg, sessao)`: bloqueia fora de `sessao.dias`, antes de `inicio`, depois de `fim`; feriados do config só valem quando `sessao.get("feriados_b3", False)` (WDO/WIN têm `true` no exemplo).
- `motor.Conta` lê `tick`, `ponto_rs`, `custo` via `size.especificacao`; `motor.rodar_backtest` agrupa "dia" pelo dia-calendário (já é) e passa `ativo` nos planos.
- `config.example.json` ganha os quatro ativos da tabela do spec, `usd_brl: 5.4` e, em WDO/WIN, `"sessao": {"dias":[0,1,2,3,4],"inicio":"09:05","fim":"18:00","feriados_b3":true}`.

- [ ] **Step 1: Testes falhando** — em `testes/test_motor.py`: `test_btc_opera_no_domingo` (Conta BTCUSDT, candle de domingo 10:00, `colocar` → evento `ordem`, não `block`); `test_eurusd_dimensiona_micro_lotes` (entrada 1.08500, stop 1.08400, alvo 1.08700, ponto_rs 5400, custo 0.05 → risco por contrato R$ 5,50; com `max_perda_por_trade` 100 → 18 contratos, limitado por `max_contratos` 5 → 5); `test_wdo_continua_igual` (o caso de 2 contratos a R$ 92 do Plano 1). Nos autotestes das skills: `size.py --teste` ganha o caso EURUSD; `check.py --teste` ganha BTCUSDT em domingo (passa) e EURUSD em sábado (bloqueia "fora da sessão").
- [ ] **Step 2: Run** `python -m unittest testes.test_motor` e os `--teste` — Expected: FAIL.
- [ ] **Step 3: Implement** `especificacao`, a nova `janela`, os ajustes em `dimensionar`/`checar`/`Conta` e o config de exemplo.
- [ ] **Step 4: Run** suíte + autotestes — Expected: tudo OK.
- [ ] **Step 5: Commit** `feat: asset specs and sessions from config (WDO, WIN, EURUSD, BTCUSDT)`.

### Task 2: Fontes de dados: Binance e MT5 por terminal

**Files:**
- Modify: `dados.py`
- Test: `testes/test_dados.py`

**Interfaces:**
- Consumes: `cfg["ativos"][ativo]` com `fonte`, `simbolo`, `terminal` (Task 1).
- Produces:
  - `dados.baixar_binance(simbolo, de, ate, abrir_url=None) -> list[Candle]` — `GET https://api.binance.com/api/v3/klines?symbol=...&interval=5m&startTime=<ms>&endTime=<ms>&limit=1000`, pagina até cobrir o intervalo, `t` = abertura UTC convertida para Brasília (−3h), `v` = volume base; `abrir_url` injeta um substituto de `urllib.request.urlopen` nos testes. HTTP 429/5xx ou falha de rede → `ErroDados("Binance indisponível agora (HTTP 429); tente de novo em alguns minutos")`.
  - `dados.baixar_mt5(simbolo, de, ate, mt5=None, terminal=None, deslocamento_h=0)` — `initialize(path=terminal)` quando informado; subtrai `deslocamento_h` horas do horário do servidor.
  - `dados.historico(ativo, de, ate, cfg, ...)` escolhe a fonte por `cfg["ativos"][ativo]["fonte"]` (`"mt5"` | `"binance"`), passa `terminal` e `deslocamento_h` do config; cache por ativo como hoje. Dias úteis de cobertura: para `sessao.dias` com 7 dias, todo dia conta.
- [ ] **Step 1: Testes falhando**: `test_binance_pagina_e_converte_horario` (falso devolve 2 páginas de klines; `t` do primeiro candle = UTC 03:00 → 00:00 Brasília); `test_binance_429_vira_erro_dados` (Review Focus 2; cache anterior intacto); `test_historico_escolhe_fonte` (BTCUSDT não chama o MT5 falso); `test_mt5_terminal_e_deslocamento` (falso recebe `path` e candle 03:00 vira 00:00 com `deslocamento_h=3`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** suíte — Expected: OK. Verificação real: `python -c "import dados,datetime as d,motor;c=dados.historico('BTCUSDT',d.date(2026,10,20),d.date(2026,10,21),motor.carregar_config());print(len(c),c[0],c[-1])"` → 576 candles, primeiro às 00:00; o mesmo para `EURUSD` com o terminal MetaQuotes (anotar o deslocamento observado no config de exemplo).
- [ ] **Step 5: Commit** `feat: Binance source and per-asset MT5 terminal`.

### Task 3: Traders Rafa Rompimento e Vera VWAP; salas

**Files:**
- Create: `traders/rafa_rompimento.py`, `traders/vera_vwap.py`, `testes/test_rafa_vera.py`
- Modify: `traders/__init__.py`, `traders/sofia_smc.py` (só `GRADE`)

**Interfaces:**
- Contrato de trader (Plano 1): `NOME`, `ESTILO`, `PARAMS`, `Trader(ativo, tick, params=None).decidir(hoje5, ontem5, fechados60) -> Decisao`. Novo: `GRADE: dict[str, list]` (parâmetros que o gerente testa) e `Trader` recebe `sessao` opcional: `Trader(ativo, tick, params=None, sessao=None)`.
- `traders/__init__.py`: `TODOS = [sofia_smc, rafa_rompimento, vera_vwap]` e `SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": TODOS, "BTCUSDT": TODOS}`.
- Rafa: `PARAMS = {"minutos_faixa": 15, "alvo_x": 1.0, "faixa_min_ticks": 4}`, `GRADE = {"alvo_x": [1.0, 1.5, 2.0]}`; regras do spec; plano `tipo="mercado"`, `setup="rompimento"`; desenhos: `{"tipo":"zona","topo":max,"fundo":min,"de":iso,"rotulo":"faixa 15 min","lado":"neutro"}`.
- Vera: `PARAMS = {"desvios": 1.0, "candles_min": 12}`, `GRADE = {"desvios": [1.0, 1.5, 2.0]}`; desenhos: `{"tipo":"linha","preco":vwap,"rotulo":"VWAP"}` e duas linhas de banda.
- Sofia: `GRADE = {"folga_ticks": [1, 2, 3]}`.
- [ ] **Step 1: Testes falhando**: Rafa — `test_rompe_maxima_compra_a_mercado` (faixa 100–104, candle fecha 104.5 → Plano compra mercado, stop 100, alvo 108.5 com alvo_x 1), `test_um_por_lado_por_dia`, `test_faixa_estreita_ignora`, `test_sem_faixa_antes_de_15_min`; Vera — `test_vende_acima_da_banda`, `test_espera_12_candles`, `test_volume_zero_usa_peso_1`; `test_salas_tem_tres_traders`.
- [ ] **Step 2: Run** — Expected: FAIL. **Step 3: Implement.** **Step 4: Run** suíte — OK.
- [ ] **Step 5: Commit** `feat: Rafa Rompimento and Vera VWAP traders; rooms`.

### Task 4: Gerente, estado e relatórios

**Files:**
- Create: `gerente.py`, `relatorio.py`, `testes/test_gerente.py`
- Modify: `motor.rodar_backtest` (aceitar `params` por trader: `modulos_traders` pode ser lista de `(modulo, params)`), `servidor.py` (rotas `/api/firma`, `/relatorios/<dia>/<arquivo>`, thread diária às 19:30 e ciclo no arranque se não houver `estado/firma.json` de hoje; `--sem-gerente` desliga), `.gitignore`

**Interfaces:**
- `gerente.ciclo(cfg, hoje: date, historico_fn=dados.historico, salas=traders.SALAS, raiz=".") -> dict` (o estado) — regras 1–5 do spec. Treino = todos os dias disponíveis menos os últimos 21 pregões; prova = últimos 21. Sem dados ou `ErroDados` → sala com `"status": "sem_dados", "motivo": <mensagem>`.
- `estado/firma.json`: `{"gerado_em", "salas": {ATIVO: {"status": "ok"|"sem_dados", "motivo", "traders": [{"nome","estilo","status","parametros","overfit","treino": placar,"prova": placar,"equity": [[iso,saldo]],"diario": [str],"decisao": str}]}}, "ranking": [{"sala","nome","prova_resultado"}], "pendencias": [str]}`.
- `estado/parametros.json`: `{ATIVO: {NOME: params}}` — `rodar_backtest` e o servidor usam quando existe.
- `relatorio.escrever(estado, operacoes_por_trader, pasta_dia) -> list[str]` — `gerente.html`, `<ativo>-<slug>.html`, `briefing.md` (texto com números e decisões, ≤ 60 linhas). HTML simples com o `estilo.css` existente; curva de capital com Lightweight Charts.
- `/api/firma` → estado + `"relatorios": {"dia": "AAAA-MM-DD", "arquivos": [...]}`; sem estado → `{"erro": "o gerente ainda não rodou; execute python gerente.py"}` 404.
- CLI: `python gerente.py` (ciclo de hoje, imprime decisões) e `python gerente.py --dia AAAA-MM-DD`.
- [ ] **Step 1: Testes falhando** (historico falso com dias sintéticos de `testes/test_motor.dias_sinteticos`, 60 dias, só BTCUSDT e EURUSD; WDO/WIN com `ErroDados`): `test_divide_treino_e_prova_em_21_pregoes`, `test_grade_escolhe_melhor_fator_lucro`, `test_nao_promove_com_menos_de_50_trades` (Review Focus 3), `test_marca_overfit`, `test_pausa_por_drawdown`, `test_sala_sem_dados_vira_pendencia` (Review Focus 4), `test_escreve_estado_e_relatorios` (arquivos existem, `briefing.md` ≤ 60 linhas), `test_api_firma` em `testes/test_servidor.py`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** suíte — OK. Verificação real: `python gerente.py` com Forex e Bitcoin reais termina em menos de 5 min e gera os arquivos; anotar o tempo.
- [ ] **Step 5: Commit** `feat: manager cycle, firm state and reports`.

### Task 5: Firma 3D — cena, salas, traders e câmera de cima

**Ordem de execução:** Tasks 5 e 6 rodam ANTES das Tasks 1–4 (prioridade visual do usuário). Até a Task 4 existir, `GET /api/firma` devolve o arquivo de exemplo.

**Files:**
- Create: `web/firma.html`, `web/firma.js`, `web/firma.css`, `estado/firma.exemplo.json` → NÃO: `estado/` é ignorado pelo git; criar em `web/firma.exemplo.json` (versionado) com 4 salas (WDO e WIN `sem_dados`; EURUSD e BTCUSDT `ok` com 3 traders cada, equity de 21 pontos, diário de 4 linhas, placar treino/prova) no formato da Task 4
- Modify: `servidor.py` (`GET /firma` → `firma.html`; `GET /api/firma` → `estado/firma.json` se existir, senão `web/firma.exemplo.json` com `"exemplo": true`), `web/index.html` (seletor com 4 ativos + link "Firma")

**Interfaces:**
- Consumes `GET /api/firma` (formato da Task 4; nesta ordem, o exemplo). Three.js: `import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"`, `OrbitControls` de `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js` (usar `importmap` com `"three"`).
- Produces: `window.firma = {estado, modo: "cima"|"fp", abrirPainel(trader), salas}`; planta fixa exportada em `firma.js` como `PLANTA` (hall 12×8 m no centro; salas 8×6 m: WDO e WIN ao norte, Forex e Bitcoin ao sul, Diretoria a leste; portas de 1,2 m; paredes 2,8 m com 0,2 m de espessura) e `COLISORES` (lista de AABB das paredes) para a Task 6.
- Conforme o spec: piso colorido por sala, placa com nome, 3 mesas por sala, boneco voxel por trader, sprite com nome/status/resultado do dia, monitor com textura canvas da curva de capital, sala sem dados com monitores apagados e placa "aguardando dados"; hall com mesa do gerente e quadro de ranking (sprite canvas); OrbitControls limitado (polar 20°–60°, distância 3–40), Q/E giram; clique (raycast) em trader abre o painel lateral com placar treino/prova, status, decisão, diário e links (`/relatorios/<dia>/<arquivo>` e `/?ativo=<ATIVO>`); poll de 30 s; sem estado → aviso "o gerente ainda não rodou".
- [ ] **Step 1: Implement.** **Step 2: Verify** no navegador do app com `python servidor.py --sem-navegador` após um `gerente.py` real: 5 salas, bonecos, sprites, clique abre painel, salas WDO/WIN "aguardando dados", sem erros no console. Screenshot para o usuário.
- [ ] **Step 3: Commit** `feat: 3D firm with top-down camera`.

### Task 6: Firma 3D — primeira pessoa, interação e Diretoria

**Files:**
- Modify: `web/firma.js`, `web/firma.html`

**Interfaces:**
- Consumes `PLANTA`, `COLISORES`, `window.firma` (Task 5). `PointerLockControls` de `.../examples/jsm/controls/PointerLockControls.js`.
- Produces: tecla **V** alterna cima↔primeira pessoa (posição inicial na Diretoria, altura 1,7 m, velocidade 3 m/s, Shift 5 m/s); colisão AABB com `COLISORES` por eixo (desliza na parede); **E** interage com o objeto a até 2,5 m na mira (trader → painel; monitor da Diretoria → painel de relatórios com `gerente.html` em iframe); ESC solta o mouse e mostra a dica "clique para voltar"; HUD com a dica de teclas.
- [ ] **Step 1: Implement.** **Step 2: Verify** no navegador do app: V alterna, WASD anda, não atravessa paredes (Review Focus 5), E abre painéis, ESC devolve o cursor, sem erros no console. Screenshots (cima e primeira pessoa) para o usuário.
- [ ] **Step 3: Commit** `feat: first-person mode and director's office`.
