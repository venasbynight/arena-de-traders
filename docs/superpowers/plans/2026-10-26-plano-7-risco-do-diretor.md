# Risco do Diretor (Plano 7)

**Decisões do Diretor (2026-10-26):**
- "O risco-retorno é variável, de acordo com o alvo" para Sofia, Didi e Caio. Sem alvo de proteção e sem saída antecipada: a operação termina **só no stop ou no alvo** (a zeragem do fim do pregão nos ativos de day trade continua, porque é regra da B3 e do config).
- "Não entra na operação se der risco-retorno menor que 3 para 1." → `rr_minimo` = 3,0 para todos (config).
- "A quantidade de contrato é calculada de acordo com o tamanho do stop: stop curto, mais contratos até o stop chegar a R$ 100; stop longo, às vezes 1 contrato." → a perda máxima por operação (R$ 100) é quem manda; o teto fixo de 5 contratos sai do caminho (`max_contratos` alto o bastante para não decidir; a margem do capital continua limitando).
- Stops: Sofia como está (2 ticks além da zona). Didi "um pouquinho mais" (hoje 1 tick além do candle do gatilho). Caio "um pouquinho mais" (hoje 2 ticks além do extremo).

**Rulings do controlador (o Diretor não deu número):**
- Didi: stop 3 ticks além do candle do gatilho; Caio: stop 4 ticks além do extremo. Sensibilidade testada com vizinhos (Didi 2–5, Caio 3–6) e reportada.
- Didi passa a ter alvo de verdade: o topo confirmado mais próximo acima da entrada (compra) ou o fundo abaixo (venda), na mesma regra de topo/fundo da Sofia; sem topo/fundo à frente, não entra. A saída por banda fechando / MA3 cruzando deixa de existir no padrão (fica como opção desligada).
- `max_contratos`: 50 (a margem limita antes: R$ 5.000 / R$ 150 no WDO ≈ 33).

## Tarefa
1. Config (`.claude/skills/trader-budget/config.example.json` → mescla no `trader/config.json` do usuário; conferir que o valor do usuário muda também, porque é decisão dele): `rr_minimo` 3.0, `max_contratos` 50. Rodar os autotestes das skills (ajustar os testes delas se fixavam 5 contratos ou R:R 1, sem afrouxar o que testam).
2. Didi: stop com folga configurável (`folga_stop_ticks`, padrão 3), alvo no próximo topo/fundo confirmado (padrão), saídas por sinal desligadas no padrão (`saida: "alvo"`), sem `alvo_x` no padrão. TDD; "não ver o futuro" mantido.
3. Caio: folga do stop padrão 4 ticks. TDD.
4. Sofia: sem mudança de regra (só passa a sentir o R:R 3 e o fim do teto de contratos).
5. Refazer os testes com o mesmo método do Plano 6 (`pesquisa/harness.py`, `pesquisa/divisao.json`, desenvolvimento até 2026-04-30, validação depois, estresse 1 tick, ≥ 100 operações, PF ≥ 1,2, platô): os padrões novos dos três em todos os mercados e tempos gráficos do Diretor (WDO/WIN/BTC 5 min; 7 Forex 5 e 15; 12 ações 60 com posição de vários dias; Caio só WDO/WIN e BTC). Tabela antes × depois (padrão do Plano 6 × padrão novo) no desenvolvimento; validação só para os que passarem nas regras do desenvolvimento (no máximo 1 por trader × mercado × tempo, em série). Sensibilidade do stop do Didi e do Caio.
6. Entregar: commit, `pesquisa/plano7/resumo.md` e relatório.
