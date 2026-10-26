// Ao vivo: gráficos puros direto da fonte (MT5 ou Binance), via /api/aovivo. Só acompanha: sem ordens e sem estudos.
// Cada gráfico tem o seu ativo e o seu tempo gráfico; a tela mostra 1, 2 ou 4 deles. Clicar num gráfico o seleciona e
// clicar num ativo da lista troca o ativo do selecionado, como no TradingView. Os desenhos da barra da esquerda são do
// desenho.js (os mesmos do backtest), guardados por ativo neste navegador. Cada gráfico pede de novo depois que a resposta anterior chega e
// só enquanto aparece na tela; a lista de ativos vem do /api/cotacoes (uma leitura por fonte para todos).
// Usa da sala.js: $, seg, esc, pct, brl, fmtPreco, STATUS, CORES, CATALOGO, NOMES, CHEVRON, graficoPuro e o painel
// flutuante (abrirPainel, listaAtivos). Lê o /api/painel sozinho.
(() => {
  const TEMPOS = [[1, "1m"], [5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"], [240, "4h"], [1440, "D"]];
  const binance = a => a.endsWith("USDT");
  // bitcoin e ethereum até o 5 min a cada 5 s; o resto a cada 15 s; 4h e diário mudam devagar: 1 min
  const espera = Q => Q.tf >= 240 ? 60000 : binance(Q.ativo) && Q.tf <= 5 ? 5000 : 15000;
  const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---- estado lembrado neste navegador: layout, gráfico selecionado, ativo e tempo de cada gráfico, desenhos
  const PADRAO = [{ativo: "WIN", tf: 5}, {ativo: "WDO", tf: 5}, {ativo: "EURUSD", tf: 5}, {ativo: "BTCUSDT", tf: 5}];
  const salvo = ler("tq.vivo", {});
  const tela = {layout: [1, 2, 4].includes(salvo.layout) ? salvo.layout : 4, sel: 0,
                q: PADRAO.map((p, i) => {
                  const s = salvo.q?.[i];
                  return s && s.ativo in NOMES && TEMPOS.some(([m]) => m === s.tf) ? {ativo: s.ativo, tf: s.tf} : {...p};
                })};
  tela.sel = Math.min(Math.max(0, salvo.sel | 0), 3);
  const guardar = () => gravar("tq.vivo", {layout: tela.layout, sel: tela.sel, q: q.map(Q => ({ativo: Q.ativo, tf: Q.tf}))});
  let painel = null, cot = {}, cotHora = null;
  const visivel = () => document.body.classList.contains("vivo") && !document.hidden;

  // ---- barra de ferramentas (os desenhos vêm do desenho.js) e a grade dos gráficos
  const botao = Desenho.botao;
  $("#vivo").innerHTML = `<nav class="ferr" aria-label="Ferramentas de desenho e layout">
      ${Desenho.botoes()}
      <i class="sep"></i>
      ${[1, 2, 4].map(n => botao(`data-layout="${n}"`, "l" + n, n === 1 ? "1 gráfico" : `${n} gráficos`)).join("")}
    </nav><div id="quadros"></div>`;
  const rotulo = tf => TEMPOS.find(([m]) => m === tf)[1];

  const q = tela.q.map((s, i) => {
    const el = document.createElement("section");
    el.className = "card quad"; el.dataset.i = i;
    el.innerHTML = `<div class="q-top"><button class="q-sym" aria-haspopup="dialog" aria-expanded="false"
        aria-label="Trocar o ativo do gráfico ${i + 1}"><b></b>${CHEVRON}</button>
      <span class="nm"></span><button class="q-tfb" aria-haspopup="dialog" aria-expanded="false"
        aria-label="Trocar o tempo gráfico do gráfico ${i + 1}"></button>
      <span class="px"></span><span class="var"></span><span class="estado mut">conectando…</span></div><div class="grafico"></div>`;
    $("#quadros").appendChild(el);
    const Q = {...s, i, el, box: el.querySelector(".grafico"), g: null, ver: 0, T: [], rascunho: null, alvo: -1};
    return Q;
  });

  $("#vivo .ferr").addEventListener("click", e => {
    const b = e.target.closest("[data-layout]"); if (b) { tela.layout = +b.dataset.layout; aplicarLayout(); }
  });

  // ---- um gráfico: (re)monta ao trocar de ativo ou de tempo
  function montar(Q) {
    Q.ver++; clearTimeout(Q.timer);
    Q.ks = null; Q.T = []; Q.hora = null; Q.erro = null;
    Desenho.soltar(Q);  // a barra do desenho sai junto com a caixa
    Q.el.querySelector(".q-sym b").textContent = Q.ativo;
    Q.el.querySelector(".q-tfb").textContent = rotulo(Q.tf);
    Q.el.querySelector(".nm").textContent = NOMES[Q.ativo];
    Q.g?.remove(); Q.g = null; Q.cv = null; Q.box.replaceChildren();
    try { Q.g = graficoPuro(Q.box, Q.ativo, Q.tf < 240); }
    catch { Q.box.innerHTML = `<div class="espera">a biblioteca de gráficos não carregou: confira a internet e recarregue a página</div>`; }
    if (Q.g) Desenho.registrar(Q);
    cabecalho(Q);
    puxar(Q);
  }

  // preço, variação do dia (a da lista, quando já chegou) e se o mercado está andando agora
  function resumo(Q) {
    const ks = Q.ks; if (!ks?.length) return null;
    const ult = ks.at(-1), dia = ult[0].slice(0, 10), c = cot[Q.ativo];
    const ref = c?.ref ?? ks.findLast(k => k[0].slice(0, 10) < dia)?.[4];
    const aberto = !!Q.hora && (Q.tf >= 1440 ? Q.hora.slice(0, 10) === dia : seg(Q.hora) - seg(ult[0]) < Q.tf * 60 + 15 * 60);
    return {preco: ult[4], variacao: ref ? (ult[4] / ref - 1) * 100 : null, ultimo: ult[0], aberto};
  }

  function cabecalho(Q) {
    const r = resumo(Q), top = Q.el.querySelector(".q-top");
    top.querySelector(".px").textContent = r ? fmtPreco(r.preco, Q.ativo) : "";
    const v = top.querySelector(".var");
    v.className = "var " + (r?.variacao > 0 ? "up" : r?.variacao < 0 ? "dn" : "mut");
    v.textContent = r?.variacao == null ? "" : pct(r.variacao);
    // só o texto muda a cada resposta: refazer o ponto reiniciaria o pulso dele
    const est = top.querySelector(".estado"), modo = Q.erro ? "warn" : r ? (r.aberto ? "vivo" : "mut") : "mut";
    if (est.className !== "estado " + modo) {
      est.className = "estado " + modo;
      est.innerHTML = (modo === "vivo" ? `<i class="ponto"></i>` : "") + "<span></span>";
    }
    est.title = Q.erro || "";
    est.lastChild.textContent = Q.erro ? Q.erro : !r ? "conectando…" : r.aberto ? `ao vivo · ${Q.hora.slice(11, 19)}`
      : `mercado fechado · último ${Q.tf >= 1440 ? ddmm(r.ultimo) : `${hhmm(r.ultimo)} de ${ddmm(r.ultimo)}`}`;
  }

  async function puxar(Q) {
    if (!Q.g || Q.ocupado || !visivel() || Q.el.hidden) return;  // sem gráfico ou escondido: para; layout, "modo" ou a volta da aba recomeçam
    Q.ocupado = true; clearTimeout(Q.timer);
    const ver = Q.ver;
    try {
      const r = await fetch(`/api/aovivo?ativo=${Q.ativo}&tf=${Q.tf}`), d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
      if (ver === Q.ver) {
        Q.erro = null; Q.ks = d.candles; Q.hora = d.atualizado; Q.T = d.candles.map(k => seg(k[0]));
        Q.g?.dados(d.candles); Desenho.redesenhar(Q);
      }
    } catch (e) {
      if (ver === Q.ver) Q.erro = e instanceof TypeError ? "sem conexão com o servidor da arena" : e.message;
    } finally { Q.ocupado = false; }
    if (ver !== Q.ver) return puxar(Q);  // trocou de ativo no meio do pedido: a resposta velha não vale
    cabecalho(Q); lista();
    Q.timer = setTimeout(() => puxar(Q), espera(Q));
  }
  const todos = () => q.forEach(puxar);
  document.addEventListener("modo", todos);
  document.addEventListener("tema", () => q.forEach(Q => {  // cores novas nos gráficos que já estão na tela, sem baixar de novo
    Q.g?.chart.applyOptions({layout: OPCOES.layout, grid: OPCOES.grid, timeScale: {borderColor: OPCOES.timeScale.borderColor},
                             rightPriceScale: OPCOES.rightPriceScale});
    Q.g?.serie.applyOptions(CANDLE);
  }));
  document.addEventListener("visibilitychange", () => { todos(); cotacoes(); });

  // ---- layout e seleção: com 1 ou 2 gráficos, o selecionado fica na tela (primeiro) e os outros esperam escondidos
  function aplicarLayout() {
    $("#quadros").className = "l" + tela.layout;
    const vis = tela.layout === 4 ? [0, 1, 2, 3] : [tela.sel, ...[0, 1, 2, 3].filter(i => i !== tela.sel)].slice(0, tela.layout);
    q.forEach(Q => {
      Q.el.hidden = !vis.includes(Q.i); Q.el.style.order = vis.indexOf(Q.i);
      Q.el.classList.toggle("sel", Q.i === tela.sel && tela.layout > 1);
    });
    document.querySelectorAll(".ferr [data-layout]").forEach(b => b.classList.toggle("sel", +b.dataset.layout === tela.layout));
    guardar(); lista(); todos();
  }
  function selecionar(i) {
    if (i === tela.sel) return;
    tela.sel = i;
    q.forEach(Q => Q.el.classList.toggle("sel", Q.i === i && tela.layout > 1));
    guardar(); lista();
  }
  function trocar(Q, ativo, tf) {
    if (ativo === Q.ativo && tf === Q.tf) return;
    Q.ativo = ativo; Q.tf = tf; guardar(); montar(Q); lista();
  }
  $("#quadros").addEventListener("pointerdown", e => { const el = e.target.closest(".quad"); if (el) selecionar(+el.dataset.i); });
  $("#quadros").addEventListener("click", e => {
    const b = e.target.closest(".q-sym, .q-tfb"); if (!b) return;
    const Q = q[+b.closest(".quad").dataset.i], tipo = b.classList.contains("q-sym") ? "ativo" : "tf";
    if (painelAberto(b)) return fecharPainel();
    if (tipo === "ativo") abrirPainel(b, {
      rotulo: "Escolher o ativo", busca: "Buscar: PETR4, dólar, bitcoin…",
      lista: t => listaAtivos(t, Q.ativo, a => {
        const {preco, v} = cotacao(a);
        return `<span class="px">${preco == null ? "—" : fmtPreco(preco, a)}</span>
          <span class="var ${v > 0 ? "up" : v < 0 ? "dn" : "mut"}">${v == null ? "—" : pct(v)}</span>`;
      }),
      escolher: a => trocar(Q, a, Q.tf)});
    else abrirPainel(b, {
      rotulo: "Escolher o tempo gráfico", classe: "tf",
      lista: () => GRUPOS_TEMPO.map(([g, ms]) => `<div class="pop-g">${g}</div><div class="pop-tfs">${ms.map(m =>
        `<button class="pop-it pop-tf ${m === Q.tf ? "sel" : ""}" data-v="${m}" aria-pressed="${m === Q.tf}">${NOME_TEMPO[m]}</button>`).join("")}</div>`).join(""),
      escolher: m => trocar(Q, Q.ativo, +m)});
  });
  const GRUPOS_TEMPO = [["Minutos", [1, 5, 15, 30]], ["Horas", [60, 240]], ["Dias", [1440]]];
  const NOME_TEMPO = {1: "1 min", 5: "5 min", 15: "15 min", 30: "30 min", 60: "1 hora", 240: "4 horas", 1440: "Diário"};

  // ---- lateral: lista de ativos (clique troca o ativo do gráfico selecionado) e placar da firma
  // preço mais novo que houver (gráfico aberto, cotação ou cache do painel) e a variação do dia
  function cotacao(a) {
    const vivo = q.find(Q => Q.ativo === a && Q.ks?.length), m = painel?.mercado.find(x => x.ativo === a), c = cot[a];
    const preco = vivo ? vivo.ks.at(-1)[4] : c?.preco ?? (m?.sem_dados ? null : m?.ultimo);
    return {preco, v: c?.ref && preco != null ? (preco / c.ref - 1) * 100 : m?.variacao_pct, m};
  }
  function lista() {
    const ativoSel = q[tela.sel].ativo;
    $("#vivo-hora").textContent = cotHora ? cotHora.slice(11, 16) : "";
    $("#vivo-ativos").innerHTML = CATALOGO.map(([grupo, ativos]) => `<div class="wl-g">${grupo}</div>` + Object.keys(ativos).map(a => {
      const {preco, v, m} = cotacao(a);
      const t = m?.tendencia60, seta = {alta: "▲", baixa: "▼", indefinida: "◆"}[t];
      const nos = q.filter(Q => Q.ativo === a && !Q.el.hidden).map(Q => Q.i + 1);
      return `<button class="wl ${a === ativoSel ? "sel" : ""}" data-ativo="${a}" title="${esc(NOMES[a])}: abrir no gráfico selecionado">
        <span class="tk">${a}${nos.length ? `<i class="nos">${nos.join("·")}</i>` : ""}</span><span class="nm">${esc(NOMES[a])}</span>
        <span class="px">${preco == null ? "—" : fmtPreco(preco, a)}</span>
        <span class="var ${v > 0 ? "up" : v < 0 ? "dn" : "mut"}">${v == null ? "—" : pct(v)}</span>
        <span class="t60 ${t ? esc(t) : "vazio"}" ${t ? `title="Tendência no gráfico de 60 min, pela regra da Sofia"` : ""}>${seta || ""}</span></button>`;
    }).join("")).join("");
  }
  $("#vivo-ativos").addEventListener("click", e => {
    const b = e.target.closest(".wl"); if (!b) return;
    const Q = q[tela.sel]; trocar(Q, b.dataset.ativo, Q.tf);
  });

  async function cotacoes() {
    if (!visivel()) return;
    try {
      const r = await fetch("/api/cotacoes"), d = await r.json();
      if (r.ok) { cot = d.cotacoes; cotHora = d.atualizado; lista(); q.forEach(cabecalho); }
    } catch {}  // a lista segue com o que tem; os gráficos mostram o erro da fonte
  }

  const spark = curva => {
    if (curva.length < 2) return `<svg class="spark"></svg>`;
    const lo = Math.min(...curva), hi = Math.max(...curva), k = hi - lo || 1;
    const pts = curva.map((v, i) => `${(i / (curva.length - 1) * 60).toFixed(1)},${(16 - (v - lo) / k * 14).toFixed(1)}`).join(" ");
    return `<svg class="spark ${curva.at(-1) >= curva[0] ? "up" : "dn"}" viewBox="0 0 60 18" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
  };
  function placar() {
    $("#ciclo-vivo").textContent = painel.ciclo ? `· ${painel.ciclo.slice(8, 10)}/${painel.ciclo.slice(5, 7)}` : "· o gerente ainda não rodou";
    const conta = {};
    const blocos = painel.traders.map((t, k) => {
      const salas = Object.entries(t.por_ativo).filter(([, c]) => c.status !== "nao_opera");
      salas.forEach(([, c]) => conta[c.status] = (conta[c.status] || 0) + 1);
      const total = salas.reduce((s, [, c]) => s + (c.prova_resultado ?? 0), 0), comRes = salas.some(([, c]) => c.prova_resultado != null);
      const ok = salas.reduce((s, [, c]) => s + c.requisitos_ok, 0), req = salas.reduce((s, [, c]) => s + c.requisitos_total, 0);
      return `<div class="pf">
        <div class="pf-top"><span class="av" style="background:${CORES[k % CORES.length]}">${esc(t.nome[0])}</span>
          <span class="quem-t"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span>
          <span class="pf-tot"><b class="${total > 0 ? "up" : total < 0 ? "dn" : "mut"}">${comRes ? brl(Math.round(total)) : "—"}</b>
            <small title="Requisitos de promoção cumpridos, somando as salas">${req ? `${ok}/${req} requisitos` : "na prova"}</small></span></div>
        ${salas.map(([a, c]) => {
          const r = c.prova_resultado;
          return `<div class="pf-l"><span class="tk">${a}</span><span class="chip ${esc(c.status)}">${STATUS[c.status] || esc(c.status)}</span>
            ${spark(c.curva || [])}<span class="res ${r > 0 ? "up" : r < 0 ? "dn" : "mut"}">${r == null ? "" : brl(Math.round(r))}</span></div>`;
        }).join("")}</div>`;
    });
    const resumoStatus = ["promovido", "experiencia", "pausado", "aguardando"].filter(s => conta[s])
      .map(s => `<span class="chip ${s}">${conta[s]} ${STATUS[s]}</span>`).join("");
    $("#vivo-placar").innerHTML = (resumoStatus ? `<div class="pf-resumo">${resumoStatus}</div>` : "") + blocos.join("");
  }

  // tendência do 60 e placar: do cache e do estado do gerente, que mudam no máximo a cada ciclo
  async function carregarPainel() {
    try {
      const r = await fetch("/api/painel"), d = await r.json();
      if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
      painel = d; placar(); lista();
    } catch (e) {
      if (!painel) $("#vivo-placar").innerHTML = `<div class="warn">não consegui carregar o placar (${esc(e.message)})</div>`;
    }
  }

  aplicarLayout();
  q.forEach(montar);
  carregarPainel();
  setInterval(carregarPainel, 5 * 60 * 1000);
  cotacoes();
  setInterval(cotacoes, 20000);
})();
