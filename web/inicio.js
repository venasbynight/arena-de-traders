// Página inicial: cartões de mercado (cache local) e placar da firma (estado do gerente), sem clicar em nada.
// Usa $, seg, brl e CORES da sala.js (carregada antes).
(() => {
  const CASAS = {WDO: 1, WIN: 0, EURUSD: 5, BTCUSDT: 2};
  const STATUS = {promovido: "promovido", experiencia: "em experiência", pausado: "pausado",
                  aguardando: "aguardando gerente", sem_dados: "sem dados"};
  const fmt = (v, a) => v.toLocaleString("pt-BR", {minimumFractionDigits: CASAS[a] ?? 2, maximumFractionDigits: CASAS[a] ?? 2});
  const pct = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + "%";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
  const painel = $("#painel");
  let dados = null, aberta = null;

  function recolher(sim) {
    painel.classList.toggle("recolhido", sim);
    $("#recolher").textContent = sim ? "▾ placar" : "recolher ▴";
    $("#recolher").title = sim ? "Mostrar o placar e os gráficos do mercado" : "Recolher para dar espaço ao replay";
  }

  function marcarAtivo() {
    const a = $("#ativos button.sel")?.dataset.ativo;
    document.querySelectorAll(".mc").forEach(c => c.classList.toggle("sel", c.dataset.ativo === a));
  }

  function cartao(m) {
    const el = document.createElement("div");
    el.className = "mc"; el.dataset.ativo = m.ativo; el.tabIndex = 0; el.setAttribute("role", "button");
    el.title = `Usar ${m.ativo} no replay`;
    if (m.sem_dados) {
      el.innerHTML = `<div class="mc-top"><b class="tk">${m.ativo}</b><span class="nm">${esc(m.nome)}</span></div>
        <div class="mc-px"><span class="px mut">—</span></div><div class="semdados">sem candles no cache · rode o gerente</div>`;
      return el;
    }
    const v = m.variacao_pct, cls = v > 0 ? "up" : v < 0 ? "dn" : "mut";
    const seta = {alta: "▲", baixa: "▼", indefinida: "◆"}[m.tendencia60];
    el.innerHTML = `<div class="mc-top"><b class="tk">${m.ativo}</b><span class="nm">${esc(m.nome)}</span>
        <span class="t60 ${m.tendencia60}" title="Tendência no gráfico de 60 min, pela regra da Sofia"><span class="rot">60 · </span>${seta} ${m.tendencia60}</span></div>
      <div class="mc-px"><span class="px">${fmt(m.ultimo, m.ativo)}</span><span class="var ${cls}">${v == null ? "—" : pct(v)}</span>
        <span class="dia">pregão ${m.dia.slice(8, 10)}/${m.dia.slice(5, 7)}</span></div><div class="mini"></div>`;
    return el;
  }

  function miniGrafico(box, m) {
    const precisao = CASAS[m.ativo] ?? 2;
    const chart = LightweightCharts.createChart(box, {
      autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5", fontSize: 10, attributionLogo: false},  // atribuição em texto, abaixo
      grid: {vertLines: {visible: false}, horzLines: {visible: false}},
      rightPriceScale: {visible: false}, leftPriceScale: {visible: false},
      timeScale: {visible: false, rightOffset: 1}, crosshair: {mode: 2, vertLine: {visible: false}, horzLine: {visible: false}},
      handleScroll: false, handleScale: false,
    });
    const serie = chart.addCandlestickSeries({upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
      wickUpColor: "#26a69a", wickDownColor: "#ef5350", priceLineVisible: false, lastValueVisible: false,
      priceFormat: {type: "price", precision: precisao, minMove: 10 ** -precisao}});
    serie.setData(m.candles.map(k => ({time: seg(k.t), open: k.o, high: k.h, low: k.l, close: k.c})));
    if (m.fechamento_anterior != null)  // referência da variação do dia
      serie.createPriceLine({price: m.fechamento_anterior, color: "#5b6b7c", lineWidth: 1, lineStyle: 2, axisLabelVisible: false});
    chart.timeScale().fitContent();
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
    const chip = `<span class="chip ${c.status}">${STATUS[c.status] || esc(c.status)}</span>`;
    if (c.status === "aguardando" || c.status === "sem_dados")
      return `<div class="cel" tabindex="0" data-trader="${esc(t.nome)}" data-ativo="${a}">${chip}<span class="nota">${
        c.status === "aguardando" ? "entra no próximo ciclo do gerente" : "a sala ficou sem candles neste ciclo"}</span></div>`;
    const r = c.prova_resultado ?? 0, segs = Array.from({length: c.requisitos_total}, (_, i) => `<i class="${i < c.requisitos_ok ? "ok" : ""}"></i>`).join("");
    return `<div class="cel" tabindex="0" data-trader="${esc(t.nome)}" data-ativo="${a}" title="Prova do gerente: clique para ver o que falta">
      <span>${chip}<div class="res ${r > 0 ? "up" : r < 0 ? "dn" : ""}">${brl(Math.round(r))}</div></span>
      ${sparkline(c.curva)}
      <span class="req"><span><b>${c.requisitos_ok}</b> de ${c.requisitos_total} requisitos</span><span class="segs">${segs}</span></span></div>`;
  }

  function mostrarFaltam(el) {
    document.querySelectorAll(".cel.sel").forEach(x => x.classList.remove("sel"));
    const chave = el && el.dataset.trader + "|" + el.dataset.ativo;
    if (!el || chave === aberta) { aberta = null; $("#faltam").innerHTML = ""; return; }
    aberta = chave; el.classList.add("sel");
    const c = dados.traders.find(t => t.nome === el.dataset.trader).por_ativo[el.dataset.ativo];
    const tit = `<div class="tit"><b>${esc(el.dataset.trader)} · ${el.dataset.ativo}</b><span class="chip ${c.status}">${STATUS[c.status] || esc(c.status)}</span>`;
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
    mercado.innerHTML = "";
    for (const m of d.mercado) {
      const el = cartao(m);
      mercado.appendChild(el);
      if (!m.sem_dados) miniGrafico(el.querySelector(".mini"), m);
    }
    mercado.insertAdjacentHTML("beforeend", `<button id="recolher"></button>`);
    $("#recolher").onclick = () => recolher(!painel.classList.contains("recolhido"));
    recolher(painel.classList.contains("recolhido"));
    marcarAtivo();
    const ativos = d.mercado.map(m => m.ativo);
    $("#ciclo").textContent = d.ciclo ? `· ciclo de ${d.ciclo.slice(8, 10)}/${d.ciclo.slice(5, 7)}` : "· o gerente ainda não rodou";
    $("#quadro").innerHTML = `<tr><th>Trader</th>${ativos.map(a => `<th>${a}</th>`).join("")}</tr>` +
      d.traders.map((t, k) => `<tr><td><div class="quem"><span class="av" style="background:${CORES[k % CORES.length]}">${esc(t.nome[0])}</span>
        <span style="min-width:0"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span></div></td>${
        ativos.map(a => `<td>${celula(t, a, t.por_ativo[a])}</td>`).join("")}</tr>`).join("");
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
  $("#ativos").addEventListener("click", () => setTimeout(marcarAtivo));
  $("#rodar").addEventListener("click", () => recolher(true));  // o replay ganha a tela; o botão traz o placar de volta

  fetch("/api/painel").then(r => r.json()).then(montar).catch(e => {
    $("#mercado").innerHTML = `<div class="aviso" style="grid-column:1/-1">não consegui carregar o mercado e o placar (${esc(e.message)})</div>`;
  });
})();
