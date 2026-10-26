# Instalar o TradeQuarters no seu computador

Este guia é para quem vai ter **o seu próprio TradeQuarters**, um projeto separado do original
(`github.com/venasbynight/arena-de-traders`). Você cria uma cópia na sua conta do GitHub (um *fork*) e segue
mudando do seu jeito; nada do que você mudar vai para o projeto original, e nada do original chega no seu sem você
pedir. Tudo é de graça: o GitHub guarda só o código, e o programa roda no seu computador.

**Nada aqui envia ordem para corretora. Não é recomendação de investimento.**

## O que você precisa

- **Windows 10 ou 11.**
- **Google Chrome.** O TradeQuarters abre numa janela própria do Chrome, como um aplicativo (PWA). Sem Chrome
  ele abre no Opera ou no navegador padrão.
- **Python 3.14** — baixe em <https://www.python.org/downloads/>. Na primeira tela do instalador, **marque
  "Add python.exe to PATH"**.
- **Git** — <https://git-scm.com/download/win> (pode aceitar tudo como vem). Se preferir clicar em vez de
  digitar comandos, use o GitHub Desktop (<https://desktop.github.com>).
- **MetaTrader 5, aberto e logado** com a sua conta. O programa nunca pede a sua senha: ele só lê os candles do
  MT5 que você deixou aberto.
  - **Genial (ou outra corretora com B3):** WIN, WDO e as ações (PETR4, VALE3…).
  - **MetaQuotes (MetaTrader 5 "puro") com uma conta demo de Forex:** EURUSD e os outros pares.
  - **Bitcoin e Ethereum** vêm da Binance pela internet, sem conta.

## Passo a passo

### 1. Faça a sua cópia (fork)

1. Crie uma conta em <https://github.com> (grátis), se ainda não tiver.
2. Abra <https://github.com/venasbynight/arena-de-traders> e clique em **Fork** (canto de cima, à direita) →
   **Create fork**. Agora existe `github.com/SEU-USUARIO/arena-de-traders`: esse é o seu projeto.

### 2. Baixe a sua cópia para o computador

Abra o **Prompt de Comando** na pasta onde quer guardar (por exemplo, `Documentos`) e rode, trocando
`SEU-USUARIO` pelo seu usuário do GitHub:

```
git clone https://github.com/SEU-USUARIO/arena-de-traders.git
```

(No GitHub Desktop: *File → Clone repository* e escolha `arena-de-traders`.)

### 3. Instale com dois cliques

Abra a pasta `arena-de-traders` e dê **dois cliques em `instalar.bat`**. Ele:

- instala o que o Python precisa (o pacote do MetaTrader 5);
- cria o ícone **TradeQuarters** (o prédio) na sua área de trabalho.

Se aparecer *"Não achei o Python"*, instale o Python marcando *"Add python.exe to PATH"* e rode de novo.

### 4. Abra

Dê **dois cliques no ícone TradeQuarters** da área de trabalho. Ele liga o servidor (sem janela preta) e abre o
programa numa janela própria do Chrome. Da segunda vez em diante ele só abre a janela, porque o servidor já está
ligado.

Se quiser fixar na barra de tarefas: com o TradeQuarters aberto, clique com o botão direito no ícone dele na barra
de tarefas → **Fixar na barra de tarefas**.

### 5. Confira as suas configurações

Na primeira vez, o programa cria o arquivo `trader\config.json` com as regras padrão: **R$ 5.000 por conta
simulada, R$ 100 de risco por trade, risco:retorno mínimo de 3**. Abra no Bloco de Notas e ajuste ao seu gosto:

- `terminal`: onde está o MetaTrader 5. O padrão é
  `C:\Program Files\Genial Investimentos MetaTrader 5\terminal64.exe` (B3) e
  `C:\Program Files\MetaTrader 5\terminal64.exe` (Forex). Se o seu MT5 está em outra pasta, troque aqui
  (com barras duplas `\\`, como já está no arquivo).
- `margem_por_contrato` e `custo_por_contrato`: os valores da sua corretora.

Esse arquivo é só seu: ele não vai para o GitHub.

## Os dados históricos (candles)

Os candles ficam guardados na pasta `dados\`, que **não vai para o GitHub** (é grande e muda todo dia). Você tem
duas opções:

- **Seguir com os seus:** não faça nada. No primeiro backtest de cada ativo o programa baixa o histórico do seu
  MT5 e guarda em `dados\`. Demora alguns minutos na primeira vez; depois é rápido.
- **Começar com os do Vinícius:** peça a pasta `dados` zipada para ele e descompacte dentro de
  `arena-de-traders` (ficando `arena-de-traders\dados\WIN_M5.csv` etc.). O programa usa o que já está ali e
  baixa do seu MT5 só os dias que faltarem.

## Pegar as novidades do projeto original (se quiser)

O seu projeto anda sozinho. Se um dia quiser trazer melhorias do Vinícius:

- **Pelo site:** na página do seu fork, clique em **Sync fork → Update branch**. Depois, no seu computador:
  ```
  git pull
  ```
- **Pelo Prompt de Comando** (dentro da pasta `arena-de-traders`):
  ```
  git remote add vinicius https://github.com/venasbynight/arena-de-traders.git
  ```
  (só na primeira vez) e, sempre que quiser:
  ```
  git pull vinicius master
  ```

Se você e ele mudaram as mesmas linhas, o Git avisa um *conflito* e você escolhe qual versão fica. Se nunca quiser
nada do original, é só não fazer esta parte.

## Mudar e guardar o seu projeto

Mude o que quiser (se usar o Claude Code, abra a pasta nele e peça). Para guardar no **seu** GitHub:

```
git add -A
```
```
git commit -m "o que eu mudei"
```
```
git push
```

Isso vai para `SEU-USUARIO/arena-de-traders`, nunca para o projeto do Vinícius.

## Se algo der errado

- **"Não consegui falar com o MetaTrader 5":** abra o MT5, faça login e confira o caminho `terminal` em
  `trader\config.json`.
- **O ícone não abre nada:** abra o Prompt de Comando na pasta e rode `python servidor.py`; a mensagem de erro
  aparece ali.
- **A página não carrega:** confira se outro programa usa a porta 8765 e acesse `http://127.0.0.1:8765` no Chrome.

## Uso pessoal

O operacional **Caio Contrafluxo** vem de material de curso: é para uso pessoal. Não repasse nem venda.
