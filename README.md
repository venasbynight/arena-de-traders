# Arena de Traders

Laboratório local onde robôs de regras fixas ("traders") operam o mesmo mercado em
contas simuladas, lado a lado, em backtest. Uma sala de operações web reproduz o
período candle a candle, e uma firma 3D estilo The Sims 4 mostra a equipe: um gerente
roda todo dia, testa cada trader e diz o que falta para ele sair do backtest.

**Nada aqui envia ordem para corretora. Não é recomendação de investimento.**

## Rodar

Windows, Python 3.12+.

```
pip install -r requirements.txt
mkdir trader
copy .claude\skills\trader-budget\config.example.json trader\config.json
python servidor.py
```

Abre `http://127.0.0.1:8765` (sala de operações) e `http://127.0.0.1:8765/firma` (firma 3D).

- WDO e WIN: MetaTrader 5 de uma corretora com dados da B3, aberto e logado (o código
  nunca pede senha). Ajuste `terminal`, margem e custo em `trader/config.json`.
- EURUSD: MetaTrader 5 com uma conta demo de Forex.
- BTCUSDT: API pública da Binance, sem conta.

Gerente manual: `python gerente.py` (~5 min). Testes: `python -m unittest discover -s testes`.

## Onde está cada coisa

- `docs/superpowers/specs/` e `docs/superpowers/plans/`: especificação e planos.
- `docs/prompt-chatgpt.md`: prompt para recriar o sistema com outra IA.
- `traders/`: Sofia SMC (por ora o único; Didi Agulhada e Caio Contrafluxo estão planejados).
- `motor.py`: simulação honesta (execução com 1 tick de folga, stop antes do alvo, custos).
- `gerente.py`: ciclo diário treino/prova, requisitos para a demo, promoção e pausa.
- `web/`: sala de operações (`index.html`, `sala.js`) e firma 3D (`firma.*`).
- `mockups/`: capturas das telas.
