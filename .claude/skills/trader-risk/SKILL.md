---
name: trader-risk
description: >-
  Gestor de risco para mini-dólar (WDO) e mini-índice (WIN). Confere cada ordem contra os
  limites antes de ela seguir: stop obrigatório, perda no stop dentro do
  limite por trade, risco:retorno mínimo, perda do dia, trades por dia, stops
  por dia (para depois de 3), uma posição por vez, margem, máximo de
  contratos, tick do ativo e horário da B3. Saída nunca é bloqueada. Imprime
  PASS ou BLOCK com o motivo e grava os veredictos. Use quando o usuário
  disser "confere essa ordem", "posso entrar", "isso quebra minhas regras",
  "quanto já arrisquei hoje", e sempre antes de uma ordem seguir na arena.
argument-hint: "[caminho do orders.json]"
---

# trader-risk (WDO e WIN)

É o portão entre a proposta e a execução, inclusive nas contas simuladas da
arena. Um BLOCK é final para aquela ordem. Adaptado da day-trader-skill (MIT).

`${CLAUDE_SKILL_DIR}` é a pasta desta skill.

```bash
python "${CLAUDE_SKILL_DIR}/check.py"                           # grava trader/state/risk.json
python "${CLAUDE_SKILL_DIR}/check.py" --json --no-write
python "${CLAUDE_SKILL_DIR}/check.py" --now "2026-10-23 10:15"  # fixa o relógio (Brasília)
python "${CLAUDE_SKILL_DIR}/check.py" --teste                   # autoteste
```

## Arquivos

| arquivo | o quê |
| --- | --- |
| `trader/orders.json` | ordens propostas (o trader-budget grava) |
| `trader/config.json` | os limites (modelo em `trader-budget/config.example.json`) |
| `trader/state/dia.json` | o dia até agora: `data`, `trades`, `stops`, `resultado` (R$), `posicao_aberta` |
| `trader/state/risk.json` | os veredictos que ele grava, com a impressão digital de cada ordem |

`dia.json` de outra data é ignorado: dia novo começa zerado.

## Entrada e saída

Ordem com `"saida": true` só zera posição. Sair tem que ser sempre possível:
ela só é conferida no formato. Nenhum limite do dia nem horário bloqueia uma
saída.

## O que bloqueia uma entrada

| checagem | bloqueia quando |
| --- | --- |
| formato | sem símbolo, lado diferente de `compra`/`venda`, contratos não inteiro, tipo diferente de `mercado`/`limite`, preço fora do tick do ativo (WDO 0,5; WIN 5) |
| ativo | as 3 primeiras letras do símbolo fora de `ativos` do config |
| stop / alvo | sem stop, sem alvo, ou do lado errado da entrada |
| perda | contratos x (pontos de risco x valor do ponto + 2 x custo); WDO R$ 10, WIN R$ 0,20 acima de `max_perda_por_trade` |
| risco:retorno | abaixo de `rr_minimo` |
| perda do dia | o já perdido hoje mais a perda máxima desta acima de `max_perda_dia` |
| contratos / margem | acima de `max_contratos`, ou margem acima do capital |
| posição | já existe posição aberta (uma por vez) |
| stops do dia | `max_stops_dia` stops já tomados hoje |
| trades do dia | `max_trades_dia` entradas hoje |
| horário | fim de semana, feriado em `feriados`, antes de `sem_entrada_antes` ou depois de `sem_entrada_depois` |

As ordens são conferidas em sequência, como se cada PASS tivesse executado, e
cada PASS conta a perda máxima inteira no resto do lote. Horário é o de
Brasília (UTC-3, sem horário de verão), calculado no próprio script.

## Passos

1. Rode `check.py`. Código 0 = tudo passou; 1 = alguma bloqueada.
2. Diga o resultado em palavras simples, ordem por ordem: perda máxima,
   risco:retorno e quanto dos limites do dia ela usa. No BLOCK, diga o motivo e
   a saída (menos contratos, stop mais perto, esperar o horário, ou pular).
   Nunca mude um limite sozinho.
3. Se a ordem mudar, confira de novo: o veredicto vale para aquela ordem exata.

## O que nunca faz

Nunca envia ordem, nunca edita uma ordem para passar, nunca afrouxa limite e
nunca bloqueia uma saída. PASS é conferência de regras, não recomendação.
