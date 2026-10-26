# Firma por operacional — design

**Data:** 2026-10-26. **Aprovado pelo Diretor** ("isso, pode desenhar a planta nova", "pode ser Sofia · Brasil e Sofia · Global, pode seguir").

## Por quê
Com só três operacionais, as salas por ativo repetiam os mesmos bonecos (uma Sofia em cada sala). O Diretor pensa por operacional, e os mercados crescem (4 + 7 pares de Forex + 12 ações): por ativo viraria um prédio de salas. Ele também quer ver no jogo os testes que pede ao Claude.

## Planta (mesma área da firma atual)
- Norte: **Sala da Sofia** e **Sala do Didi** (no lugar de WDO e WIN).
- Centro: **Hall** (gerente; telão de ranking com filtro por mercado).
- Sul: **Sala do Caio** e **Sala da Demo** (no lugar de EURUSD e BTCUSDT).
- Oeste: **Descanso e jogos** (igual), corredor (igual), **Laboratório** (no lugar de Ações/Opções; o quadro de pendências das opções vai para lá).
- Leste: **Diretoria** (igual).

## Bonecos: dois por operacional
| Boneco | Mercados | Expediente na firma |
|---|---|---|
| Sofia · Brasil, Didi · Brasil | WDO, WIN, ações (60 min) | pregão da B3 |
| Sofia · Global, Didi · Global | 7 pares de Forex (5 e 15 min), BTCUSDT | quase 24 h |
| Caio · Brasil | WDO, WIN | pregão da B3 |
| Caio · Global | BTCUSDT (único internacional com delta de agressor) | quase 24 h |

Cada sala de operacional tem as duas mesas: a do Brasil com bandeira do Brasil, a Global com um globo; roupas em tons diferentes do mesmo operacional. Monitores por mercado na mesa (B3 · ações; Forex · cripto).

## Quadros
- Sala do operacional: status por mercado de cada boneco (requisitos, prova, pausado/experiência/promovido); clique abre a ficha do mercado.
- Laboratório: a última rodada de testes (o que foi testado, variantes, quem passou, números dentro e fora da amostra) + pendências das opções.
- Demo: quem foi promovido em qual mercado.

## Vida
- Ocioso: descanso (como hoje).
- **Teste pedido ao Claude**: a ferramenta de pesquisa (`pesquisa/harness.py`) grava um aviso de atividade (`estado/atividade_pesquisa.json`: trader, grupo, mercado, variante n/N, desde); o servidor junta esse aviso ao do gerente em `/api/atividade`; o boneco correspondente vai para a mesa, a tela do mercado acende, o rótulo mostra "testando: WDO · 12/40"; o gerente fica no Laboratório. No fim, o quadro do Laboratório e o da sala mostram o resultado.
- Ciclo do gerente: como hoje, por boneco (o grupo do mercado em processamento trabalha).
- Promovido num mercado: ganha mesa na Sala da Demo com aquele mercado; pausado volta.
- Global trabalha também à noite quando há atividade; Brasil só no horário da B3.

## Fora do escopo agora
Mercados novos como salas; nomes próprios por boneco; a sala da Demo operando de verdade (a demo ao vivo é outro plano).

## Dependência
Outras sessões do Diretor estão mexendo na firma 3D, na marca TradeQuarters, na tela Ao vivo e no relatório do backtest, com alterações ainda não salvas nos mesmos arquivos. Começar só depois que elas forem salvas, para não desfazer o trabalho delas.
