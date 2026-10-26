// Backtest: cartões de mercado (cache local) e placar da firma (estado do gerente) acima dos gráficos. Busca o
// /api/painel a cada 5 minutos e avisa as outras telas com o evento "painel" (prévias do backtest, lateral do ao vivo).
// Usa $, seg, brl, esc, pct, CASAS, CANDLE, formato, STATUS e CORES da sala.js (carregada antes).
(() => {
  const fmt = fmtPreco;
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

  function cartao(m) {
    const el = document.createElement("div");
    el.className = "mc"; el.dataset.ativo = m.ativo;
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

  function miniGrafico(box, m) {
    const chart = LightweightCharts.createChart(box, {
      autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5", fontSize: 10, attributionLogo: false},  // o logo do TradingView fica nos gráficos grandes
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
    if (c.status === "nao_opera")
      return `<div class="cel vazia"><span class="chip">${STATUS.nao_opera}</span></div>`;
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
    const ativos = d.mercado.map(m => m.ativo);
    $("#ciclo").textContent = d.ciclo ? `· ciclo de ${d.ciclo.slice(8, 10)}/${d.ciclo.slice(5, 7)}` : "· o gerente ainda não rodou";
    $("#quadro").innerHTML = `<tr><th>Trader</th>${ativos.map(a => `<th>${esc(a)}</th>`).join("")}</tr>` +
      d.traders.map((t, k) => `<tr><td><div class="quem"><span class="av" style="background:${CORES[k % CORES.length]}">${esc(t.nome[0])}</span>
        <span style="min-width:0"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span></div></td>${
        ativos.map(a => `<td>${celula(t, a, t.por_ativo[a])}</td>`).join("")}</tr>`).join("");
    const antes = aberta; aberta = null;  // o detalhe aberto continua aberto depois da atualização
    if (antes) mostrarFaltam([...document.querySelectorAll(".cel")].find(x => x.dataset.trader + "|" + x.dataset.ativo === antes));
    document.dispatchEvent(new CustomEvent("painel", {detail: d}));
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
    }
  }

  $("#quadro").addEventListener("click", e => mostrarFaltam(e.target.closest(".cel")));
  painel.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const alvo = e.target.closest(".cel"); if (!alvo) return;
    e.preventDefault(); alvo.click();
  });
  $("#rodar").addEventListener("click", () => recolher(true));  // o replay ganha a tela; o botão traz o placar de volta

  carregar();
  setInterval(carregar, 5 * 60 * 1000);  // o gerente roda às 00:30 e o cache muda: a aba aberta não fica velha
})();
