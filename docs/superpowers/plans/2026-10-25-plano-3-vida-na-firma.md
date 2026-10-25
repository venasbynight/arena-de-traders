# Vida na firma (Plano 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Traders e gerente se comportam como funcionários reais na firma 3D (só trabalham quando há tarefa real; ociosos vão para a sala de descanso ou conversam), duas salas novas (Descanso e jogos; Ações/Opções) e um quadro de status em cada sala dizendo o que falta para cada operacional ir para a demo.

**Decisões do usuário (2026-10-25, conversa):** planta aprovada — Descanso e jogos no noroeste, corredor a oeste do hall, Ações/Opções no sudoeste; gerente fica ocioso salvo durante o ciclo real; ninguém "trabalha" sem tarefa dada pelo Diretor ou gerente; sala Ações/Opções sem operacional por ora — o quadro lista as pendências que o Diretor decidirá depois (como escolher a opção: call/put, strike, vencimento; quais ações; quais operacionais no 60 min; fonte de dados das opções; saída e tamanho). Sala de descanso: sofá, videogame, café, refri (e pebolim/pufes, escolha do controlador).

**Architecture:** O gerente passa a gravar, por trader, a lista `requisitos` (os mesmos critérios de promoção, cada um com ok/falta e valor) e uma sala extra `OPCOES` sem traders ativos. O servidor expõe `/api/atividade` com o que está rodando agora (ciclo do gerente: sala e trader em processamento; senão tudo ocioso). A firma 3D lê `/api/firma` (30 s) e `/api/atividade` (5 s) e move cada boneco entre mesa, descanso e corredor com caminhada por waypoints.

**Tech Stack:** Python 3.14 stdlib; Three.js 0.160 (mesmo importmap); `unittest`.

## Global Constraints
- Suite verde: `python -m unittest discover -s testes`; skills `--teste` verdes; `node --check web/firma.js`.
- Nenhuma ordem real; regras de risco e de promoção inalteradas (só expostas).
- Textos pt-BR; sem assets externos; padrão visual Sims da firma (ver mockups/firma-cima-*.png).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Teto de uso: parar se o uso semanal do plano passar de 20% (ledger).

## Task 1: Requisitos, sala OPCOES e atividade ao vivo (Python)
**Files:** gerente.py, servidor.py, relatorio.py (só se precisar exibir), testes/test_gerente.py, testes/test_servidor.py, web/firma.exemplo.json (acrescentar requisitos/OPCOES ao exemplo).
**Interfaces (produz):**
- Cada trader em `estado.salas[ATIVO].traders[]` ganha `"requisitos": [{"item": str, "ok": bool, "valor": str}]`, na ordem: "50+ trades no treino", "50+ trades na prova", "treino positivo", "prova positiva", "fator ≥ 1,2 na prova", "sem overfit", "drawdown da prova acima de −R$ 1.500", "sem 5 dias seguidos negativos"; derivados da mesma lógica de `decidir` (refatorar para uma função `requisitos(treino, prova, equity, n_treino, n_prova) -> list` usada por `decidir`, sem mudar resultados). Trader com 0 trades por recusa de risco ganha também `{"item": "caber no risco por trade", "ok": false, "valor": <motivo mais comum>}`.
- `estado.salas["OPCOES"] = {"status": "sem_tarefa", "nome": "Ações / Opções", "motivo": "aguardando definição do Diretor", "pendencias": [<5 itens do usuário>], "traders": [{"nome","estilo","status": "sem_tarefa"} for Sofia, Rafa, Vera]}` — escrito em todo ciclo; o ciclo não roda backtest para OPCOES.
- `GET /api/atividade` → `{"gerente": {"estado": "ocioso"|"trabalhando", "sala": ATIVO|null, "trader": NOME|null, "desde": iso}, "atualizado": iso}`; `gerente.ciclo` aceita `ao_progresso(sala, trader)` (callback) e o servidor guarda o último valor num dict protegido por lock; fora do ciclo → ocioso.
- [ ] Testes primeiro (requisitos batem com `decidir` em 4 casos: promovido, pausado, treino negativo, 0 trades; OPCOES presente sem backtest; `/api/atividade` ocioso fora do ciclo e trabalhando com o callback simulado). [ ] Implementar. [ ] Suite verde. [ ] Commit `feat: promotion checklist, options room and live activity API`.

## Task 2: Salas novas, mobília e quadros (web)
**Files:** web/firma.js, web/firma.css, web/firma.html (dica, se preciso).
**Interfaces:** `PLANTA.salas` ganha `DESCANSO {nome: "Descanso e jogos", x: -12, z: -7, w: 8, d: 6, porta: [-12, -4]}`, `OPCOES {nome: "Ações / Opções", x: -12, z: 7, w: 8, d: 6, porta: [-12, 4]}` e um `CORREDOR {x: -11, z: 0, w: 10, d: 8}` ligado ao hall por porta em `[-6, 0]` (ajuste fino de coordenadas livre, mantendo a disposição aprovada; COLISORES atualizados; câmera de cima abrange a firma toda).
- Descanso: sofá em L com TV e console (2 controles), balcão de café com cafeteira e canecas, máquina de refri, mesa de pebolim, 2 pufes, planta, tapete; registrar "vagas" nomeadas para os bonecos: `VAGAS_DESCANSO = [{tipo: "sofa"|"cafe"|"refri"|"pebolim"|"pufe", pos, rot, pose: "sentado"|"em_pe"}]` (≥ 8 vagas) e `VAGAS_CONVERSA` no corredor (≥ 2 pares frente a frente). Exportar ambos para a Task 3.
- Ações/Opções: 3 mesas iguais às de mercado (monitores apagados), placa da sala, cor própria.
- Quadro branco/lousa na parede de cada sala de mercado e de OPCOES (canvas texture 1024×768): título "Equipe <sala> · status", linha de resumo ("ninguém pronto para a demo" / "N prontos"), por trader: nome, status, e os `requisitos` com ✅/❌ e valor; OPCOES: pendências com ☐. Clique no quadro (câmera de cima) ou E (primeira pessoa) abre o mesmo conteúdo no painel lateral. Sem `requisitos` no estado (estado antigo): quadro mostra "aguardando próximo ciclo do gerente".
- [ ] Implementar. [ ] Capturas: visão geral com as 7 salas, Descanso de perto, quadro da WIN de perto → `mockups/firma-v3-1..3.png` (≤ 600 KB). [ ] Gate visual Sims. [ ] Commit `feat: rest room, options room and status boards`.

## Task 3: Comportamento dos funcionários (web)
**Files:** web/firma.js (e firma.css se preciso). **Consome:** `/api/atividade`, `requisitos/status` do estado, `VAGAS_*` e `PLANTA` da Task 2.
- Estado de cada boneco a cada poll (5 s): `trabalhando` só se `atividade.gerente.estado == "trabalhando"` e `sala == ATIVO do trader` (todos os traders daquela sala trabalham durante o processamento dela) — no futuro, demo ao vivo; `pausado` (status do estado) → vaga no Descanso com selo "pausado"; `sem_tarefa` (OPCOES) e demais → ocioso. Gerente: `trabalhando` → sentado na mesa do hall; ocioso → vaga "cafe" ou conversa.
- Ociosos escolhem vagas de forma determinística por nome (estável entre recargas) e trocam de atividade a cada 2–5 min (seed por nome + hora); pares conversando ganham balão "…" animado.
- Caminhada: rota por waypoints (porta da sala → hall → porta oeste → corredor → porta destino → vaga), velocidade 1,3 m/s, pernas e braços balançando, giro suave para a direção; sem atravessar paredes (waypoints pelas portas). Sentado: pose de sentado; em pé no café: segurando caneca; videogame: braços à frente.
- Sprite acima da cabeça mostra a atividade real ("trabalhando: backtest WIN", "no café", "jogando videogame", "pausado", "aguardando tarefa").
- Primeira pessoa: bonecos andando colidem só visualmente (não bloqueiam o jogador).
- [ ] Dev hook `firma.simularAtividade(json)` para testes sem ciclo real. [ ] Capturas: equipe toda no descanso (sem ciclo), WIN trabalhando (atividade simulada) → `mockups/firma-v3-4..5.png`. [ ] Commit `feat: employees move between desks and the rest room by real activity`.
