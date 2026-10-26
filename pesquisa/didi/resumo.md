# Didi Agulhada: pesquisa do Plano 6

**Resultado: nenhuma combinação ativo × tempo gráfico passou.** O único finalista que cumpriu todos os critérios no
desenvolvimento (NZDUSD 15) deu +R$ 29,45 na validação sem estresse (PF 1,10) e −R$ 7,27 com 1 tick de estresse
(68 trades): não passou. O padrão do Didi fica como estava em todos os ativos, com o mesmo resultado de antes.

## 1. Velocidade (antes de qualquer grade)

- `estudos.py`: as médias, Bollinger, ADX, MME e TRIX viraram classes candle a candle (`Media`, `Bandas`, `Adx`,
  `Mme`, `Trix`). As funções de lista (`sma`, `didi`, `bollinger`, `adx`, `ema`, `trix`) só alimentam essas classes,
  com as mesmas contas na mesma ordem.
- O Didi guarda o estado dos estudos (`_Serie`) e só calcula os candles novos enquanto a lista `ontem + hoje` cresce.
  Se a lista muda (dia novo, outra janela), ele recomeça do zero.
- **Os valores são os mesmos, bit a bit.** Três provas:
  1. comparação com o `estudos.py` antigo em 816 janelas de dados reais (WDO, WIN, BTC, EURUSD, USDJPY, PETR4), com
     `==` exato, mais o TRIX e o ADX da série inteira;
  2. teste `test_valores_iguais_aos_de_antes_das_classes`, que fixa valores exatos calculados com o código antigo;
  3. teste `test_estudos_candle_a_candle_iguais_a_refazer_tudo`: o backtest com a memória e o backtest que refaz tudo
     a cada decisão dão os mesmos eventos, operações e série de indicadores, no 5, no 15 e no 60.

  Além disso, o padrão reproduziu o baseline nos 17 ativo × tf em que ele rodou (ex.: WDO 5 trades, −177,00; WIN com estresse
  211,00; BTC 6 trades, −16,94).
- Tempo, rodada sozinha no desenvolvimento inteiro: **WDO de 68 s para 6,6 s; BTC 35 s** (antes ~17 min em paralelo);
  EURUSD 5 em 8 s.

## 2. Ações no 60 (histórico de aquecimento)

Com candles base de 60, `ontem + hoje` tem só 14 candles e o Didi precisa de 27. Agora, quando o último bloco de 60
fechado que o motor entrega é o próprio candle que acabou de fechar (só acontece com base de 60), o Didi usa os 200
blocos fechados (`fechados60`) como série. Não há estado entre os dias: tudo vem do que o motor já passou, que só tem
candles fechados. Testes: `test_candles_de_60_usam_os_blocos_fechados_como_historico` e `test_60_nao_ve_o_futuro`
(cortar os dados no meio do pregão não muda nada antes do corte). Com 200 candles, a semente da MME e do Wilder pesa
menos de 1e-11 no valor. A ação é só aproximação da direção da call/put, sem preço de opção.

## 3. Hipóteses (uma frase cada) e o que mudou no código

Todas entram como parâmetro. O padrão de cada um reproduz a regra antiga.

| Parâmetro | Hipótese | Padrão |
|---|---|---|
| `trix_extremo` = 1 | O percentil 20/80 foi um chute do controlador; com o TRIX só virando a favor ("vira junto", nas notas) o Didi opera muito mais sem perder a confirmação. | 0,2 |
| `adx` = "di" / "nao" | O Diretor duvida do ADX; tirar a inclinação (ou o ADX inteiro) libera entradas sem piorar a qualidade. | "sobe" |
| `adx` = "baixo" | As notas descrevem compressão: ADX ≤ 20 antes da agulhada e subindo nela separa rompimento de ruído. | — |
| `agulhada_n` | Os dois cruzamentos em até N candles, não no mesmo candle (tolerância permitida pelo plano). | 0 |
| `janela_bandas` | Candles depois da agulhada em que as bandas ainda podem abrir (era a constante 3). | 3 |
| `recuo` | Metade das entradas a mercado parava no próprio candle de entrada; entrar limitada no Fibonacci 0,382–0,618 do candle que abriu as bandas (as notas falam em pullback de 0,382–0,618) dá stop menor e melhor relação. | 0 |
| `saida` = "ma3" | Sair só quando a MA3 volta (sem a saída das bandas fechando) deixa o movimento chegar ao alvo. | "bandas" |
| `tendencia` | Só a favor da tendência do contexto maior (`estudos.tendencia`, do 60 no 5/15, do diário no 60) corta agulhadas contra o fluxo. | False |

## 4. O que foi testado

Etapas em `pesquisa/didi/rodar.py`, tabelas em `etapa_*.txt`, linhas no `registro.csv`. Desenvolvimento = soma dos
blocos de 3 meses (cada bloco com conta nova e 30 dias de aquecimento). Walk-forward = critério do harness (maior PF
nos blocos anteriores com ≥ 50 trades).

1. **diag** (WDO, WIN, EURUSD 5): o TRIX no percentil é o que trava. Com o TRIX só na direção: 80–130 trades; com
   folga de 2 candles: 700–830. Todos negativos (PF 0,64–0,87).
2. **recuo** (16 candidatos, mesmos 3 mercados): a entrada no recuo não melhora (PF 0,52–1,16, quase tudo < 0,9).
3. **contexto** (16): tendência do 60, ADX baixo e saída só pela MA3, combinados. Nada passa de PF 1,1 com ≥ 100
   trades. Com estresse, tudo negativo.
4. **amplos** (7 candidatos em todos os mercados: 12 ações no 60, 7 Forex no 15 e no 5, BTC 5). No 5 tudo é negativo.
   As ações não chegam a 100 trades (no máximo 59) e quase tudo é negativo. O candidato 5 (sem ADX, folga de 2, a
   favor do 60) no Forex 15 deu: NZDUSD PF 1,50, GBPUSD 1,25, USDJPY 1,19, EURUSD 1,00, AUDUSD 0,90, USDCHF 0,77,
   USDCAD 0,67. Ou seja, mistura de sinais, como se espera de sorte.
5. **plato15**: vizinhos de ±1 passo (agulhada_n, janela_bandas, alvo_x) do candidato 5 no NZDUSD, GBPUSD e USDJPY 15.
   Só o NZDUSD tem todos os vizinhos positivos com estresse. No GBPUSD, agulhada_n=3 dá −27,77 com estresse; no USDJPY,
   agulhada_n=1 e alvo 4 são negativos.

**Variantes testadas: 40 conjuntos de parâmetros, 299 combinações parâmetros × ativo × tf, mais 3 na validação.**
Com 299 combinações, achar 1–3 com PF 1,2–1,5 no desenvolvimento é o que a sorte entrega. A validação confirmou isso.

## 5. Tabela final (desenvolvimento e validação lado a lado)

Formato: trades · resultado R$ · PF · resultado com estresse R$ (PF com estresse). "Melhor variante" = maior PF com
≥ 100 trades no desenvolvimento, só para mostrar o teto; o finalista do NZDUSD foi o centro do platô (alvo 3, PF 1,50),
não o pico (alvo 4, 1,62).

| Ativo | tf | Padrão (dev) | Melhor variante dev (≥100 trades) | Walk-forward fora da amostra | Validação |
|---|---|---|---|---|---|
| WDO | 5 | 5 · −177,0 · 0,10 · −297,0 | 134 · −291,0 · 0,96 · −3.415,0 (0,62) | 265 · −4.561,0 · 0,68 · −9.956,0 | não validado |
| WIN | 5 | 4 · 235,0 · 3,30 · 211,0 | 105 · −700,0 · 0,84 · −1.492,0 (0,70) | 251 · −5.328,0 · 0,58 · −7.044,0 | não validado |
| BTCUSDT | 5 | 6 · −16,94 · 0,04 · −16,94 | 269 · −163,62 · 0,74 · −163,80 (0,74) | 504 · −423,64 · 0,67 · −423,93 | não validado |
| EURUSD | 5 | 3 · 0,39 · 1,02 · −1,23 | 646 · −575,70 · 0,84 · −923,35 (0,76) | 261 · −460,63 · 0,58 · −601,15 | não validado |
| EURUSD | 15 | 1 · −26,96 · 0,00 · −27,50 | 116 · 0,26 · 1,00 · −62,27 (0,92) | 137 · −266,68 · 0,74 · −340,66 | não validado |
| USDJPY | 5 | 6 · −39,80 · 0,05 · −41,86 | 357 · −262,42 · 0,82 · −385,08 (0,75) | 272 · −435,65 · 0,67 · −529,40 | não validado |
| USDJPY | 15 | 3 · −50,18 · 0,00 · −51,20 | 139 · 178,93 · 1,20 · 131,03 (1,14) | 130 · −190,53 · 0,80 · −235,30 | 77 · −242,83 · 0,58 · −268,65 (0,55): negativa (diagnóstico) |
| GBPUSD | 5 | 5 · −28,69 · 0,22 · −31,39 | 248 · 91,24 · 1,05 · −42,58 (0,98) | 343 · 154,08 · 1,08 · −30,70 | não validado |
| GBPUSD | 15 | 2 · 35,72 · 10,55 · 34,64 | 111 · 193,15 · 1,25 · 133,43 (1,16) | 122 · 64,28 · 1,06 · −1,60 | 72 · −149,40 · 0,71 · −188,28 (0,66): negativa (diagnóstico) |
| USDCHF | 5 | 1 · −1,16 · 0,00 · −1,81 | 391 · −122,62 · 0,92 · −378,81 (0,77) | 214 · −398,40 · 0,60 · −538,29 | não validado |
| USDCHF | 15 | 2 · −18,04 · 0,00 · −19,36 | 255 · −375,90 · 0,80 · −542,19 (0,72) | 196 · −391,38 · 0,73 · −519,56 | não validado |
| AUDUSD | 5 | 4 · −29,54 · 0,00 · −31,70 | 760 · −960,77 · 0,64 · −1.371,17 (0,54) | 590 · −760,75 · 0,64 · −1.079,35 | não validado |
| AUDUSD | 15 | 1 · 1,93 · — · 1,39 | 121 · −71,84 · 0,90 · −137,18 (0,82) | 180 · −160,47 · 0,85 · −257,67 | não validado |
| USDCAD | 5 | 1 · −0,69 · 0,00 · −1,08 | 146 · −108,87 · 0,78 · −165,16 (0,69) | 248 · −401,24 · 0,49 · −496,78 | não validado |
| USDCAD | 15 | 0 · 0 · — · 0 | 245 · 115,48 · 1,12 · 21,00 (1,02) | 185 · −38,13 · 0,95 · −109,45 | não validado |
| NZDUSD | 5 | 2 · −6,40 · 0,00 · −7,48 | 252 · −391,41 · 0,69 · −527,49 (0,61) | 205 · −334,16 · 0,56 · −444,86 | não validado |
| **NZDUSD** | **15** | 2 · 46,25 · — · 45,17 | finalista: 132 · 272,31 · 1,50 · 201,03 (1,34) | 157 · 249,55 · 1,37 · 164,77 | **68 · 29,45 · 1,10 · −7,27 (0,98): não passou** |
| 12 ações | 60 | 0–2 trades por ação | nenhuma chega a 100 (máx. 59, PF 0,22–0,88) | 0–6 trades | não validado |

Finalista (NZDUSD 15): `{"adx": "nao", "agulhada_n": 2, "alvo_x": 3.0, "janela_bandas": 3, "recuo": 0,
"saida": "bandas", "tendencia": true, "tf": 5, "trix_extremo": 1.0}` (tf 5 = usar os candles base do harness, de 15).
Validação mês a mês: maio +146, depois −24, −45, −30, −33 e +16 em outubro. Todo o lucro veio de maio.

## 6. Decisão

- **Padrão sem mudança em todos os ativos** (`PARAMS` com os mesmos valores de antes; os parâmetros novos têm o valor
  que reproduz a regra antiga). `GRADE` sem mudança.
- O problema de "quase não opera" está resolvido e entendido: o percentil do TRIX era o filtro que travava. Com o TRIX
  só na direção e folga nos cruzamentos, o Didi faz 100–800 trades por ativo. Mas, do jeito que entra (fechamento do
  candle que abriu as bandas, stop além dele), perde em todos os mercados do 5 (PF 0,5–0,9). O estresse de 1 tick
  piora muito no WDO e no WIN, porque os movimentos são curtos.
- Ações no 60: agora o Didi consegue operar (histórico dos blocos fechados), mas a agulhada é rara no 60. Nenhuma ação
  chega a 100 trades em 2,3 anos: resultado inconclusivo e quase sempre negativo. O motor zera tudo às 16h, então não
  dá para segurar a posição de um dia para o outro.

## 7. O que fazer a seguir (sugestões, não testadas)

- Perguntar ao Diretor se a agulhada dele era mesmo no 5 ou se o 5 era só o gatilho de um sinal do 60/diário. Nos
  prints, os "trades lindos" vêm depois de longa compressão, e isso o código não mede bem.
- Operar a carteira das 12 ações como um único conjunto (soma dos trades) para chegar a uma amostra. Isso exigiria
  mudar a regra 5 do plano.
- Se for revisitar o ADX: no 5 e no 15 ele não mostrou valor em nenhuma das formas testadas.
