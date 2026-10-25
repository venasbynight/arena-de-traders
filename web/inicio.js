// Página inicial: cartões de mercado (cache local), placar da firma (estado do gerente) e, na sala de replay antes do
// Rodar, um gráfico grande de 5 min do ativo escolhido. Atualiza sozinha a cada 5 minutos.
// Usa $, seg, brl, CORES e OPCOES da sala.js (carregada antes).
(() => {
  const CASAS = {WDO: 1, WIN: 0, EURUSD: 5, BTCUSDT: 2};
  const STATUS = {promovido: "promovido", experiencia: "em experiência", pausado: "pausado",
                  aguardando: "aguardando gerente", sem_dados: "sem dados"};
  const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const fmt = (v, a) => v.toLocaleString("pt-BR", {minimumFractionDigits: CASAS[a] ?? 2, maximumFractionDigits: CASAS[a] ?? 2});
  const pct = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + "%";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
  const temGraficos = () => typeof LightweightCharts !== "undefined";  // o CDN pode falhar: o placar segue sem gráficos
  const painel = $("#painel");
  let dados = null, aberta = null, minis = [];

  function recolher(sim) {
    painel.classList.toggle("recolhido", sim);
    const b = $("#recolher"); if (!b) return;  // Rodar antes de o painel chegar: os cartões nascem recolhidos
    b.textContent = sim ? "▾ placar" : "recolher ▴";
    b.title = sim ? "Mostrar o placar e os gráficos do mercado" : "Recolher para dar espaço ao replay";
    // mini gráfico criado com o painel recolhido nasceu com largura 0: reenquadra quando aparece
    if (!sim) requestAnimationFrame(() => minis.forEach(c => c.timeScale().fitContent()));
  }

  const ativoAtual = () => $("#ativos button.sel")?.dataset.ativo;
  function marcarAtivo() {
    const a = ativoAtual();
    document.querySelectorAll(".mc").forEach(c => {
      c.classList.toggle("sel", c.dataset.ativo === a); c.setAttribute("aria-pressed", c.dataset.ativo === a);
    });
  }

  function cartao(m) {
    const el = document.createElement("div");
    el.className = "mc"; el.dataset.ativo = m.ativo; el.tabIndex = 0; el.setAttribute("role", "button");
    el.title = `Usar ${m.ativo} no replay`;
    if (m.sem_dados) {
      el.innerHTML = `<div class="mc-top"><b class="tk">${esc(m.ativo)}</b><span class="nm">${esc(m.nome)}</span></div>
        <div class="mc-px"><span class="px mut">—</span></div><div class="semdados">sem candles no cache · rode o gerente</div>`;
      return el;
    }
    const v = m.variacao_pct, cls = v > 0 ? "up" : v < 0 ? "dn" : "mut";
    const seta = {alta: "▲", baixa: "▼", indefinida: "◆"}[m.tendencia60] || "";
    el.innerHTML = `<div class="mc-top"><b class="tk">${esc(m.ativo)}</b><span class="nm">${esc(m.nome)}</span>
        <span class="t60 ${esc(m.tendencia60)}" title="Tendência no gráfico de 60 min, pela regra da Sofia"><span class="rot">60 · </span>${seta} ${esc(m.tendencia60)}</span></div>
      <div class="mc-px"><span class="px">${fmt(m.ultimo, m.ativo)}</span><span class="var ${cls}">${v == null ? "—" : pct(v)}</span>
        <span class="dia">pregão ${m.dia.slice(8, 10)}/${m.dia.slice(5, 7)}</span></div><div class="mini"></div>`;
    return el;
  }

  const CANDLE = {upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350"};
  const formato = a => ({type: "price", precision: CASAS[a] ?? 2, minMove: 10 ** -(CASAS[a] ?? 2)});

  function miniGrafico(box, m) {
    const chart = LightweightCharts.createChart(box, {
      autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5", fontSize: 10, attributionLogo: false},  // atribuição em texto, no gráfico da sala
      grid: {vertLines: {visible: false}, horzLines: {visible: false}},
      rightPriceScale: {visible: false}, leftPriceScale: {visible: false},
      timeScale: {visible: false, rightOffset: 1}, crosshair: {mode: 2, vertLine: {visible: false}, horzLine: {visible: false}},
      handleScroll: false, handleScale: false,
    });
    minis.push(chart);
    const serie = chart.addCandlestickSeries({...CANDLE, priceLineVisible: false, lastValueVisible: false, priceFormat: formato(m.ativo)});
    serie.setData(m.candles.map(k => ({time: seg(k.t), open: k.o, high: k.h, low: k.l, close: k.c})));
    if (m.fechamento_anterior != null)  // referência da variação do dia
      serie.createPriceLine({price: m.fechamento_anterior, color: "#5b6b7c", lineWidth: 1, lineStyle: 2, axisLabelVisible: false});
    chart.timeScale().fitContent();
  }

  // ---- sala de replay antes do Rodar: gráfico grande de 5 min do ativo escolhido (últimos pregões do cache).
  // O Rodar troca pelos cards dos traders (a sala.js limpa o #grid); daí em diante ele não volta.
  let sala = null, rodou = false;

  function criarSala() {
    $("#grid").innerHTML = `<section class="card padrao"><div class="padrao-top"></div><div class="ohlc"></div>
      <div class="grafico"><canvas class="zonas"></canvas></div>
      <div class="rodape"><span>replay: escolha o período na barra abaixo e clique em <b>Rodar</b> para ver os traders operando candle a candle</span>
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener">gráficos: TradingView Lightweight Charts</a></div></section>`;
    const el = $("#grid .padrao"), box = el.querySelector(".grafico");
    const chart = LightweightCharts.createChart(box, {...OPCOES, crosshair: {mode: 0},
      timeScale: {...OPCOES.timeScale, barSpacing: 6, rightOffset: 6}});
    const serie = chart.addCandlestickSeries(CANDLE);
    serie.priceScale().applyOptions({scaleMargins: {top: 0.08, bottom: 0.22}});
    const vol = chart.addHistogramSeries({priceScaleId: "", priceFormat: {type: "volume"}, priceLineVisible: false, lastValueVisible: false});
    chart.priceScale("").applyOptions({scaleMargins: {top: 0.82, bottom: 0}});
    sala = {el, box, chart, serie, vol, canvas: box.querySelector("canvas"), linha: null, m: null, inicios: []};
    chart.subscribeCrosshairMove(p => ohlc(p.time == null ? null : p.seriesData.get(serie), p.time == null ? null : p.seriesData.get(vol)));
    // as coordenadas novas só valem no desenho seguinte ao aviso: redesenha no próximo quadro
    const agendar = () => requestAnimationFrame(separadores);
    chart.timeScale().subscribeVisibleLogicalRangeChange(agendar);
    sala.obs = new ResizeObserver(agendar); sala.obs.observe(box);
  }

  // linha pontilhada e o dia no começo de cada pregão
  function separadores() {
    if (!sala) return;
    const cv = sala.canvas, w = sala.box.clientWidth, h = sala.box.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const largura = w - sala.chart.priceScale("right").width(), ts = sala.chart.timeScale();
    g.font = "11px Segoe UI"; g.setLineDash([3, 4]); g.strokeStyle = "#2a3646"; g.fillStyle = "#6b7a8c";
    for (const [i, iso] of sala.inicios) {
      const x = (ts.logicalToCoordinate(i - 1) + ts.logicalToCoordinate(i)) / 2;  // entre o último candle e o primeiro
      if (!(x > 0 && x < largura)) continue;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 28); g.stroke();
      const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
      if (x + 70 < largura) g.fillText(`${SEMANA[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`, x + 6, 14);
    }
  }

  function ohlc(c, v) {
    const m = sala.m; if (!m?.pregoes) { sala.el.querySelector(".ohlc").innerHTML = ""; return; }
    if (!c) { const k = m.pregoes.at(-1); c = {open: k[1], high: k[2], low: k[3], close: k[4]}; v = {value: k[5]}; }
    const cls = c.close >= c.open ? "up" : "dn", f = x => fmt(x, m.ativo);
    const varia = c.open ? (c.close / c.open - 1) * 100 : 0;
    sala.el.querySelector(".ohlc").innerHTML = `<span class="${cls}">Ab <b>${f(c.open)}</b></span><span class="${cls}">Máx <b>${f(c.high)}</b></span>`
      + `<span class="${cls}">Mín <b>${f(c.low)}</b></span><span class="${cls}">Fech <b>${f(c.close)}</b></span><span class="${cls}"><b>${pct(varia)}</b></span>`
      + (v?.value ? `<span>Vol <b>${v.value.toLocaleString("pt-BR", {maximumFractionDigits: 2})}</b></span>` : "");
  }

  function graficoSala() {
    if (rodou || !dados) return;
    const m = dados.mercado.find(x => x.ativo === ativoAtual());
    if (!m) return;
    if (!temGraficos()) {
      $("#grid").innerHTML = `<div class="espera"><b>Sala de replay</b><span>a biblioteca de gráficos (TradingView Lightweight Charts) não carregou: confira a internet e recarregue a página</span></div>`;
      return;
    }
    if (!sala) criarSala();
    const mudou = sala.m?.ativo !== m.ativo;
    sala.m = m;
    const v = m.variacao_pct, cls = v > 0 ? "up" : v < 0 ? "dn" : "mut";
    sala.el.querySelector(".padrao-top").innerHTML = `<b class="tk">${esc(m.ativo)}</b><span class="nm">${esc(m.nome)}</span><span class="tf">5 min</span>`
      + (m.sem_dados ? "" : `<span class="px">${fmt(m.ultimo, m.ativo)}</span><span class="var ${cls}">${v == null ? "—" : pct(v)}</span>
         <span class="t60 ${esc(m.tendencia60)}" title="Tendência no gráfico de 60 min, pela regra da Sofia">60 · ${esc(m.tendencia60)}</span>`)
      + `<span class="dica">${m.sem_dados ? "sem candles no cache para este ativo · rode o gerente"
          : `últimos ${new Set(m.pregoes.map(k => k[0].slice(0, 10))).size} pregões do cache`}</span>`;
    const ks = m.pregoes || [];
    sala.serie.applyOptions({priceFormat: formato(m.ativo)});
    sala.serie.setData(ks.map(([t, o, h, l, c]) => ({time: seg(t), open: o, high: h, low: l, close: c})));
    sala.vol.setData(ks.map(([t, o, , , c, vol]) => ({time: seg(t), value: vol, color: c >= o ? "rgba(38,166,154,.35)" : "rgba(239,83,80,.35)"})));
    if (sala.linha) sala.serie.removePriceLine(sala.linha);
    sala.linha = m.fechamento_anterior == null ? null : sala.serie.createPriceLine({price: m.fechamento_anterior, color: "#5b6b7c",
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "fech. anterior"});
    sala.inicios = ks.map((k, i) => [i, k[0]]).filter(([i, t]) => i > 0 && t.slice(0, 10) !== ks[i - 1][0].slice(0, 10));
    // abre nos dois últimos pregões (B3) ou nas últimas ~20 h (forex, bitcoin); o resto fica na rolagem
    if (mudou && ks.length) sala.chart.timeScale().setVisibleLogicalRange({from: Math.max(0, ks.length - 230), to: ks.length + 6});
    ohlc(null);
    requestAnimationFrame(separadores);
  }

  function descartarSala() {
    rodou = true;
    if (!sala) return;
    sala.obs.disconnect(); sala.chart.remove(); sala = null;
  }

  function sparkline(curva) {
    if (curva.length < 2) return `<svg class="spark" viewBox="0 0 100 30"><line x1="0" y1="15" x2="100" y2="15" stroke="#2a3542" stroke-dasharray="3 3"/></svg>`;
    const min = Math.min(...curva), max = Math.max(...curva), amp = max - min || 1;
    const y = v => (27 - (v - min) / amp * 24).toFixed(1);
    const pts = curva.map((v, i) => `${(i / (curva.length - 1) * 100).toFixed(1)},${y(v)}`).join(" ");
    const cor = curva.at(-1) >= curva[0] ? "#26a69a" : "#ef5350";
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <line x1="0" y1="${y(curva[0])}" x2="100" y2="${y(curva[0])}" stroke="#3a4757" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
      <polygon points="0,30 ${pts} 100,30" fill="${cor}" opacity=".12"/>
      <polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function celula(t, a, c) {
    const chip = `<span class="chip ${esc(c.status)}">${STATUS[c.status] || esc(c.status)}</span>`;
    if (c.status === "aguardando" || c.status === "sem_dados")
      return `<div class="cel" tabindex="0" role="button" aria-expanded="false" data-trader="${esc(t.nome)}" data-ativo="${a}">${chip}<span class="nota">${
        c.status === "aguardando" ? "entra no próximo ciclo do gerente" : "a sala ficou sem candles neste ciclo"}</span></div>`;
    const r = c.prova_resultado ?? 0, segs = Array.from({length: c.requisitos_total}, (_, i) => `<i class="${i < c.requisitos_ok ? "ok" : ""}"></i>`).join("");
    return `<div class="cel" tabindex="0" role="button" aria-expanded="false" data-trader="${esc(t.nome)}" data-ativo="${a}" title="Prova do gerente: clique para ver o que falta">
      <span>${chip}<div class="res ${r > 0 ? "up" : r < 0 ? "dn" : ""}">${brl(Math.round(r))}</div></span>
      ${sparkline(c.curva)}
      <span class="req"><span><b>${c.requisitos_ok}</b> de ${c.requisitos_total} requisitos</span><span class="segs">${segs}</span></span></div>`;
  }

  function mostrarFaltam(el) {
    document.querySelectorAll(".cel.sel").forEach(x => { x.classList.remove("sel"); x.setAttribute("aria-expanded", "false"); });
    const chave = el && el.dataset.trader + "|" + el.dataset.ativo;
    if (!el || chave === aberta) { aberta = null; $("#faltam").innerHTML = ""; return; }
    aberta = chave; el.classList.add("sel"); el.setAttribute("aria-expanded", "true");
    const c = dados.traders.find(t => t.nome === el.dataset.trader).por_ativo[el.dataset.ativo];
    const tit = `<div class="tit"><b>${esc(el.dataset.trader)} · ${esc(el.dataset.ativo)}</b><span class="chip ${esc(c.status)}">${STATUS[c.status] || esc(c.status)}</span>`;
    let corpo;
    if (c.status === "aguardando") corpo = `<span class="mut">o gerente ainda não avaliou este trader nesta sala; ele entra no próximo ciclo (00:30, com a repescagem das 19:30).</span></div>`;
    else if (c.status === "sem_dados") corpo = `<span class="mut">a sala ficou sem candles no último ciclo; veja as pendências na firma.</span></div>`;
    else if (!c.faltam.length) corpo = `<span class="mut">todos os ${c.requisitos_total} requisitos cumpridos</span></div>`;
    else corpo = `<span class="mut">faltam ${c.faltam.length} de ${c.requisitos_total} requisitos</span></div><ul>${c.faltam.map(f => `<li>${esc(f)}</li>`).join("")}</ul>`;
    $("#faltam").innerHTML = tit + corpo;
  }

  function montar(d) {
    dados = d;
    const mercado = $("#mercado");
    minis.forEach(c => c.remove()); minis = [];  // a cada atualização os cartões são refeitos
    mercado.innerHTML = "";
    for (const m of d.mercado) {
      const el = cartao(m);
      mercado.appendChild(el);
      if (m.sem_dados) continue;
      try { miniGrafico(el.querySelector(".mini"), m); }
      catch { el.querySelector(".mini").outerHTML = `<div class="semdados">gráfico indisponível</div>`; }  // sem a biblioteca: preço e selo seguem
    }
    mercado.insertAdjacentHTML("beforeend", `<button id="recolher"></button>`);
    $("#recolher").onclick = () => recolher(!painel.classList.contains("recolhido"));
    recolher(painel.classList.contains("recolhido"));
    marcarAtivo();
    const ativos = d.mercado.map(m => m.ativo);
    $("#ciclo").textContent = d.ciclo ? `· ciclo de ${d.ciclo.slice(8, 10)}/${d.ciclo.slice(5, 7)}` : "· o gerente ainda não rodou";
    $("#quadro").innerHTML = `<tr><th>Trader</th>${ativos.map(a => `<th>${esc(a)}</th>`).join("")}</tr>` +
      d.traders.map((t, k) => `<tr><td><div class="quem"><span class="av" style="background:${CORES[k % CORES.length]}">${esc(t.nome[0])}</span>
        <span style="min-width:0"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span></div></td>${
        ativos.map(a => `<td>${celula(t, a, t.por_ativo[a])}</td>`).join("")}</tr>`).join("");
    const antes = aberta; aberta = null;  // o detalhe aberto continua aberto depois da atualização
    if (antes) mostrarFaltam([...document.querySelectorAll(".cel")].find(x => x.dataset.trader + "|" + x.dataset.ativo === antes));
    graficoSala();
  }

  async function carregar() {
    try {
      const r = await fetch("/api/painel");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
      montar(d);
    } catch (e) {
      if (dados) return console.warn("painel: atualização falhou; fica o último", e);  // mantém os números da última leitura
      $("#mercado").innerHTML = `<div class="aviso" style="grid-column:1/-1">não consegui carregar o mercado e o placar (${esc(e.message)})</div>`;
      if (!rodou) $("#grid").innerHTML = `<div class="espera"><b>Sala de replay</b><span>escolha o ativo e o período na barra abaixo e clique em <b>Rodar</b></span></div>`;
    }
  }

  $("#mercado").addEventListener("click", e => {
    const c = e.target.closest(".mc"); if (!c) return;
    $(`#ativos button[data-ativo="${c.dataset.ativo}"]`)?.click();
  });
  $("#quadro").addEventListener("click", e => mostrarFaltam(e.target.closest(".cel")));
  painel.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const alvo = e.target.closest(".mc, .cel"); if (!alvo) return;
    e.preventDefault(); alvo.click();
  });
  $("#ativos").addEventListener("click", () => setTimeout(() => { marcarAtivo(); graficoSala(); }));
  $("#rodar").addEventListener("click", () => { descartarSala(); recolher(true); });  // o replay ganha a tela; o botão traz o placar de volta

  carregar();
  setInterval(carregar, 5 * 60 * 1000);  // o gerente roda às 00:30 e o cache muda: a aba aberta não fica velha
})();
