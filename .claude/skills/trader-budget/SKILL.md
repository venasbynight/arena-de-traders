---
name: trader-budget
description: >-
  Gestor de tamanho para mini-dólar (WDO) e mini-índice (WIN). Lê o plano (entrada, stop, alvo,
  lado), calcula quantos contratos cabem em três limites (perda máxima por
  trade, margem do capital, máximo de contratos), diz qual limite decidiu e
  grava UMA ordem proposta em trader/orders.json. Stop longe demais para a
  perda máxima é recusa, não ordem menor. Nada é enviado. Use quando o
  usuário disser "quantos contratos", "dimensiona esse trade", "quanto posso
  arriscar", "define minhas regras", ou depois que um robô da arena gerar um
  plano.
argument-hint: "[preço limite]"
---

# trader-budget (WDO e WIN)

Transforma um plano ("vender WDO a 5432,5, stop 5437") numa ordem exata
("vender 2 contratos"), dentro das regras que o usuário define uma vez. O stop
decide o tamanho: quanto mais longe, menos contratos. Só propõe. O
trader-risk confere depois. Adaptado da day-trader-skill (MIT).

`${CLAUDE_SKILL_DIR}` é a pasta desta skill.

```bash
python "${CLAUDE_SKILL_DIR}/size.py"                  # mostra o cálculo
python "${CLAUDE_SKILL_DIR}/size.py" --write          # grava trader/orders.json
python "${CLAUDE_SKILL_DIR}/size.py" --limite 5432.5  # ordem limitada nesse preço
python "${CLAUDE_SKILL_DIR}/size.py" --now "2026-10-23 10:15"   # fixa o relógio (Brasília)
python "${CLAUDE_SKILL_DIR}/size.py" --teste          # autoteste
```

## Arquivos

| arquivo | o quê |
| --- | --- |
| `trader/config.json` | as regras (comece copiando `config.example.json` desta pasta) |
| `trader/plan.json` | o trade: `simbolo`, `lado` (`compra`/`venda`), `entrada`, `stop`, `alvo`, `setup`, `tipo`, `data` opcional, `ativo` opcional (sem ele vale o início do símbolo: WDO, WIN) |
| `trader/orders.json` | a ordem proposta, gravada com `--write` |

## Passo 1: regras, uma vez

Se `trader/config.json` não existir, copie `config.example.json` e pergunte
cada valor ao usuário em palavras simples:

- **capital**: quanto dinheiro é para isso. Só o que ele pode perder.
- **ativos**: para cada ativo (o exemplo traz WDO, WIN, EURUSD e BTCUSDT), o **ponto_rs** (R$ por 1,0 de preço por
  contrato) e o **tick**, a **margem_por_contrato** (garantia de day trade na corretora dele; confira), o
  **custo_por_contrato** (corretagem + taxas, por contrato, por lado, em R$) e a **sessao** (`dias` com 0 = segunda,
  `inicio`, `fim`, e `feriados_b3` para respeitar os feriados). WDO e WIN têm ponto e tick padrão no script; para os
  demais o config é obrigatório. Ativo fora de `ativos` é recusado.
- **max_contratos**, **max_perda_por_trade** (R$), **max_perda_dia** (R$).
- **max_trades_dia**, **max_stops_dia** (o usuário para depois de 3 stops), **rr_minimo**.
- **sem_entrada_antes** / **sem_entrada_depois** / **zerar_ate**: horário de Brasília. Os dois primeiros só valem
  para o ativo que não traz `sessao`; com `sessao`, o início e o fim dela mandam.
- **feriados**: datas `AAAA-MM-DD` sem pregão na B3 (confira o calendário da B3).
- Deixe **simulado** true.

## Passo 2: o cálculo

WDO: 1 ponto = R$ 10 por contrato, tick de 0,5. WIN: 1 ponto = R$ 0,20 por contrato, tick de 5.
EURUSD e BTCUSDT: valores do config (contrato = micro lote ou 0,001 BTC). O ativo vem de `plano.ativo`; sem ele,
das 3 primeiras letras do símbolo (WDOX26, WINZ26). Contratos inteiros.
Funciona na compra e na venda.

| limite | contratos |
| --- | --- |
| perda máxima por trade | `max_perda_por_trade` / (pontos de risco x valor do ponto + 2 x custo) |
| margem do capital | `capital` / `margem_por_contrato` |
| máximo de contratos | `max_contratos` |

Recusa, sem gravar ordem, quando: nem 1 contrato cabe, risco:retorno abaixo do
mínimo, stop ou alvo do lado errado, preço fora do tick do ativo, ativo fora de
`ativos`, ou plano de outro dia. Diga o motivo em uma linha.

## Passo 3: mostrar

Mostre os três limites, qual decidiu, os contratos e a perda máxima no stop.
Diga que stop é ordem, não promessa: em mercado rápido pode executar pior.
Depois passe para o `/trader-risk`.

## Exemplo

Venda WDO a 5432,5, stop 5437 (4,5 pontos), alvo 5420, custo R$ 0,50 por lado,
perda máxima R$ 100: cada contrato perde 4,5 x 10 + 1 = R$ 46. R$ 100 / 46 =
**2 contratos**, R$ 92 no stop, risco:retorno 2,78.

## O que nunca faz

Nunca envia, aprova ou agenda ordem. Nunca aumenta limite sozinha. Nunca
aproxima o stop para caber mais contratos. Educação e ferramenta, não
recomendação de investimento.
