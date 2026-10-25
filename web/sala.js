// Sala de operações: reproduz o backtest candle a candle em um gráfico por trader.
const $ = s => document.querySelector(s);
const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
// preço abaixo de 10 (forex, ex.: 1,08612) pede 5 casas; índices, dólar e bitcoin ficam com 2
const casas = v => Math.abs(v) < 10 ? 5 : 2;
const num = v => v.toLocaleString("pt-BR", {maximumFractionDigits: casas(v)});
// horário de Brasília tratado como UTC no gráfico, para o eixo mostrar a hora do pregão
const seg = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +iso.slice(14, 16)) / 1000;
const hhmm = iso => iso.slice(11, 16);
const ddmm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const CORES = ["#1e3a5f", "#3d2e5c", "#21452f", "#4d3a1a", "#4a1f24", "#1f3f4a"];

const arena = window.arena = {dados: null, cursor: 0, tocando: false, traders: [], mostrarResultado() {}};
let ativo = "WDO";

function hojeMenos(dias) {
  const d = new Date(Date.now() - dias * 864e5);
  return d.toISOString().slice(0, 10);
}
$("#ate").value = hojeMenos(1);
$("#de").value = hojeMenos(8);

$("#ativos").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  ativo = b.dataset.ativo;
  document.querySelectorAll("#ativos button").forEach(x => x.classList.toggle("sel", x === b));
});
// /?ativo=EURUSD (link vindo da firma) já abre com o ativo escolhido
const ativoPedido = new URLSearchParams(location.search).get("ativo");
[...document.querySelectorAll("#ativos button")].find(b => b.dataset.ativo === ativoPedido)?.click();

$("#rodar").onclick = async () => {
  pausar();
  $("#relogio").textContent = "calculando o backtest…";
  descartar();
  $("#grid").innerHTML = "";
  $("#rodar").disabled = true;
  try {
    const r = await fetch(`/api/backtest?ativo=${ativo}&de=${$("#de").value}&ate=${$("#ate").value}`);
    const dados = await r.json();
    if (!r.ok) return aviso(dados.erro || "erro no backtest");
    montar(dados);
  } catch (e) {
    aviso("não consegui falar com o servidor da arena: ele está rodando? (" + e.message + ")");
  } finally {
    $("#rodar").disabled = false;
  }
};

function aviso(msg) {
  $("#grid").innerHTML = `<div class="aviso"></div>`;
  $("#grid .aviso").textContent = msg;
  $("#relogio").textContent = "";
  ["#inicio", "#play", "#fim", "#barra"].forEach(s => $(s).disabled = true);
}

// solta os gráficos do backtest anterior: só remove() libera os listeners e os dados que o Lightweight Charts segura
function descartar() {
  for (const tr of arena.traders) { tr.obs.disconnect(); (tr.didi ? tr.didi.charts : tr.delta ? tr.delta.charts : [tr.chart]).forEach(c => c.remove()); }
  arena.traders = [];
}

function montar(dados) {
  arena.dados = dados;
  const candles = dados.candles.map(([t, o, h, l, c]) => ({iso: t, time: seg(t), open: o, high: h, low: l, close: c}));
  arena.candles = candles;
  arena.porTempo = new Map(candles.map((c, i) => [c.time, i]));
  arena.dias = [...new Set(candles.map(c => c.iso.slice(0, 10)))];
  $("#grid").innerHTML = "";
  arena.traders = Object.entries(dados.traders).map(([nome, t], k) => criarCard(nome, t, k));
  $("#grid").insertAdjacentHTML("beforeend", `<section class="card vazio"><div style="font-size:30px">+</div><div>Adicionar trader</div><div style="font-size:11px">em breve</div></section>`);
  $("#barra").max = candles.length; $("#barra").value = 0;
  ["#inicio", "#play", "#fim", "#barra"].forEach(s => $(s).disabled = false);
  irPara(0);
}

const OPCOES = {
  autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5"},
  grid: {vertLines: {color: "#18212c"}, horzLines: {color: "#18212c"}},
  timeScale: {timeVisible: true, secondsVisible: false, borderColor: "#1f2a36", barSpacing: 7},
  rightPriceScale: {borderColor: "#1f2a36"}, crosshair: {mode: 0},
};

function criarCard(nome, t, k) {
  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML = `<div class="ch"><span class="av" style="background:${CORES[k % CORES.length]}">${nome[0]}</span><span class="n">${nome}</span><span class="tag">${t.estilo}</span><span class="pl"></span></div>
    <div class="sub"><span class="tend"></span><span class="status"></span></div><div class="grafico"><canvas class="zonas"></canvas></div>`;
  $("#grid").appendChild(el);
  const box = el.querySelector(".grafico");
  const chart = LightweightCharts.createChart(box, OPCOES);
  const precisao = casas(arena.candles[0]?.close ?? 0);
  const serie = chart.addCandlestickSeries({upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    priceFormat: {type: "price", precision: precisao, minMove: 10 ** -precisao}});
  const tr = {nome, t, el, chart, serie, canvas: box.querySelector("canvas"), linhas: [], mostrados: 0};
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => desenharZonas(tr));
  tr.obs = new ResizeObserver(() => desenharZonas(tr)); tr.obs.observe(box);
  if (t.indicadores?.delta) montarDelta(tr); else if (t.indicadores) montarDidi(tr, precisao);
  return tr;
}

// Execuções (entrada/saída) levam a hora de abertura do candle em que aconteceram: aparecem com esse candle.
// Decisões (ordem, bloqueio, estudo) levam a hora do fechamento do candle que as gerou: aparecem com ele.
const EXECUCOES = new Set(["entrada", "saida", "cancelada"]);
const ate = (eventos) => {
  if (!arena.cursor) return [];
  const abertura = seg(arena.candles[arena.cursor - 1].iso);
  return eventos.filter(e => seg(e.t) <= (EXECUCOES.has(e.tipo) ? abertura : abertura + 300));
};

function irPara(i) {
  arena.cursor = Math.max(0, Math.min(i, arena.candles.length));
  for (const tr of arena.traders) {
    tr.serie.setData(arena.candles.slice(0, arena.cursor).map(({iso, ...c}) => c));
    tr.mostrados = arena.cursor;
    if (tr.didi) revelarDidi(tr, 0);
    if (tr.delta) revelarDidi(tr, 0, tr.delta);
    if (arena.cursor) tr.chart.timeScale().scrollToRealTime();
    if (tr.didi) { tr.didi.lider = 0; alinhar(tr); }
  }
  atualizar();
}

function avancar(n) {
  const alvo = Math.min(arena.cursor + n, arena.candles.length);
  for (const tr of arena.traders)
    for (let k = tr.mostrados; k < alvo; k++) { const {iso, ...c} = arena.candles[k]; tr.serie.update(c); }
  const antes = arena.cursor;
  arena.traders.forEach(tr => tr.mostrados = alvo);
  arena.cursor = alvo;
  arena.traders.forEach(tr => {
    if (!tr.didi) return;
    revelarDidi(tr, antes); alinhar(tr, tr.didi.lider);
    if (!tr.didi.preso) tr.didi.lider = 0;  // passada a roda do mouse, o principal volta a mandar
  });
  arena.traders.forEach(tr => tr.delta && revelarDidi(tr, antes, tr.delta));
  atualizar();
  if (arena.cursor >= arena.candles.length) { pausar(); arena.mostrarResultado(); }
}

function estado(tr) {
  const ev = ate(tr.t.eventos);
  const saidas = ev.filter(e => e.tipo === "saida");
  const resultado = saidas.reduce((s, e) => s + e.resultado_rs, 0);
  const ganhos = saidas.filter(e => e.resultado_rs > 0).length;
  let posicao = null, desenhos = [], tend = "";
  const agulhadas = [];  // marcadores do Didi: acumulam (cada desenho traz só a agulhada daquele candle)
  for (const e of ev) {
    if (e.tipo === "entrada") posicao = e;
    if (e.tipo === "saida") posicao = null;
    if (e.tipo === "desenho") { desenhos = e.desenhos; agulhadas.push(...desenhos.filter(d => d.tipo === "agulhada")); }
    if (e.tipo === "pensamento") tend = e.linhas[0] || "";
  }
  const dia = arena.cursor ? arena.candles[arena.cursor - 1].iso.slice(0, 10) : "";
  const stopsHoje = saidas.filter(e => e.motivo === "stop" && e.t.startsWith(dia)).length;
  return {ev, saidas, resultado, ganhos, posicao, desenhos, agulhadas, tend, stopsHoje, dia};
}

function atualizar() {
  const n = arena.candles.length, c = arena.candles[Math.max(arena.cursor - 1, 0)];
  $("#barra").value = arena.cursor;
  const diaN = arena.cursor ? arena.dias.indexOf(c.iso.slice(0, 10)) + 1 : 0;
  $("#relogio").innerHTML = arena.cursor ? `dia ${diaN} de ${arena.dias.length} · <b>${ddmm(c.iso)} ${hhmm(c.iso)}</b>` : `${arena.dias.length} pregões · ${n} candles · dê play`;
  const linhasPlacar = [], diario = [];
  for (const tr of arena.traders) {
    const s = estado(tr);
    tr.el.querySelector(".pl").className = "pl " + (s.resultado > 0 ? "up" : s.resultado < 0 ? "dn" : "");
    tr.el.querySelector(".pl").textContent = brl(s.resultado);
    tr.el.querySelector(".tend").textContent = s.tend;
    const agora = s.posicao ? `${s.posicao.lado === "compra" ? "comprado" : "vendido"} ${s.posicao.contratos}`
      : s.stopsHoje >= 3 ? "parou: 3 stops" : "aguardando";
    tr.el.querySelector(".status").textContent = s.posicao ? `${agora} · stop ${num(s.posicao.stop)} · alvo ${num(s.posicao.alvo)}` : agora;
    marcadores(tr, s);
    tr.desenhos = s.desenhos; desenharZonas(tr);
    if (tr.didi) atualizarDidi(tr, s);
    if (tr.delta) legendaDelta(tr);
    linhasPlacar.push(`<tr><td>${tr.nome}</td><td class="${s.resultado >= 0 ? "up" : "dn"}">${brl(s.resultado)}</td><td>${s.saidas.length}</td><td>${s.saidas.length ? Math.round(100 * s.ganhos / s.saidas.length) + "%" : "–"}</td><td class="${s.posicao ? "acc" : s.stopsHoje >= 3 ? "warn" : "mut"}">${agora}</td></tr>`);
    const vistos = new Set();  // o mesmo bloqueio se repete a cada candle: mostra só o primeiro do dia
    for (const e of s.ev) {
      const txt = textoDiario(e); if (!txt) continue;
      const chave = e.tipo === "block" || e.tipo === "ordem" ? e.t.slice(0, 10) + txt : e.t + txt;
      if (vistos.has(chave)) continue;
      vistos.add(chave); diario.push([e.t, tr.nome, txt]);
    }
  }
  $("#placar").innerHTML = `<tr><th>Trader</th><th>Resultado</th><th>Trades</th><th>Acerto</th><th>Agora</th></tr>` + linhasPlacar.join("");
  $("#placar-ate").textContent = arena.cursor ? `até ${ddmm(c.iso)} ${hhmm(c.iso)}` : "";
  diario.sort((a, b) => a[0] < b[0] ? 1 : -1);
  $("#diario").innerHTML = diario.slice(0, 60).map(([t, nome, txt]) => `<div><time>${ddmm(t)} ${hhmm(t)}</time><b>${nome.split(" ")[0]}</b> ${txt}</div>`).join("");
  $("#diario-dia").textContent = arena.cursor ? ddmm(c.iso) : "";
}

function textoDiario(e) {
  if (e.tipo === "entrada") return `${e.lado === "compra" ? "comprou" : "vendeu"} ${e.contratos} a ${num(e.preco)}. Stop ${num(e.stop)}, alvo ${num(e.alvo)}.`;
  if (e.tipo === "saida") return `saiu (${e.motivo}) a ${num(e.preco)}: <span class="${e.resultado_rs >= 0 ? "up" : "dn"}">${brl(e.resultado_rs)}</span>.`;
  if (e.tipo === "block") return `ordem bloqueada: ${e.motivos[0]}.`;
  if (e.tipo === "cancelada") return `ordem stop de ${e.lado} em ${num(e.entrada)} cancelada: não executou a tempo.`;
  if (e.tipo === "ordem" && e.tipo_ordem === "stop") return `ordem stop de ${e.lado} (${e.contratos}) em ${num(e.entrada)}.`;
  if (e.tipo === "ordem") return e.tipo_ordem === "mercado"
    ? `ordem a mercado de ${e.lado} (${e.contratos}).`
    : `ordem limitada de ${e.lado} (${e.contratos}) em ${num(e.entrada)}.`;
  return "";
}

function marcadores(tr, s) {
  const m = [];
  for (const e of s.ev) {
    if (e.tipo === "entrada") m.push({time: seg(e.t), position: e.lado === "compra" ? "belowBar" : "aboveBar", color: e.lado === "compra" ? "#26a69a" : "#ef5350", shape: e.lado === "compra" ? "arrowUp" : "arrowDown", text: `${e.lado} ${e.contratos} · ${num(e.preco)}`});
    if (e.tipo === "saida") m.push({time: seg(e.t), position: "inBar", color: e.resultado_rs >= 0 ? "#26a69a" : "#f0b429", shape: "circle", text: brl(e.resultado_rs)});
  }
  m.sort((a, b) => a.time - b.time);
  tr.serie.setMarkers(m);
  tr.linhas.forEach(l => tr.serie.removePriceLine(l)); tr.linhas = [];
  if (s.posicao) {
    tr.linhas.push(tr.serie.createPriceLine({price: s.posicao.stop, color: "#ef5350", lineStyle: 2, lineWidth: 1, title: "stop"}));
    tr.linhas.push(tr.serie.createPriceLine({price: s.posicao.alvo, color: "#26a69a", lineStyle: 2, lineWidth: 1, title: "alvo"}));
  }
}

function desenharZonas(tr) {
  const cv = tr.canvas, box = cv.parentElement, dpr = window.devicePixelRatio || 1;
  cv.width = box.clientWidth * dpr; cv.height = box.clientHeight * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, box.clientWidth, box.clientHeight);
  const largura = box.clientWidth - tr.chart.priceScale("right").width();
  for (const d of tr.desenhos || []) {
    if (d.tipo === "zona") {
      const y1 = tr.serie.priceToCoordinate(d.topo), y2 = tr.serie.priceToCoordinate(d.fundo);
      let x = tr.chart.timeScale().timeToCoordinate(seg(d.de));
      if (y1 == null || y2 == null) continue;
      if (x == null) x = 0;
      // FVG azul; zona neutra (sem lado) cinza; OB de alta verde, de baixa vermelho
      const cor = d.rotulo === "FVG" ? "76,141,255" : d.lado === "neutro" ? "139,152,165" : d.lado === "alta" ? "38,166,154" : "239,83,80";
      g.fillStyle = `rgba(${cor},.22)`; g.strokeStyle = `rgba(${cor},.9)`; g.setLineDash([3, 3]);
      g.fillRect(x, y1, largura - x, y2 - y1); g.strokeRect(x, y1, largura - x, y2 - y1);
      g.fillStyle = `rgba(${cor},1)`; g.font = "10px Segoe UI"; g.fillText(d.rotulo, x + 3, y1 + 11);
    }
    if (d.tipo === "linha") {
      const y = tr.serie.priceToCoordinate(d.preco); if (y == null) continue;
      const cor = /^(VWAP|banda )/.test(d.rotulo) ? "#a78bfa" : "#f0b429";  // VWAP e bandas em roxo; alvos em amarelo
      g.strokeStyle = cor; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(largura, y); g.stroke();
      g.fillStyle = cor; g.font = "10px Segoe UI"; g.fillText(d.rotulo, 4, y - 3);
    }
  }
}

// Didi: Bollinger sobre os candles e dois painéis embaixo (Didi Index, ADX/DI), cada um um gráfico com o mesmo
// eixo de tempo do principal (rolagem, zoom e cursor juntos). Os valores vêm prontos do Python (t.indicadores).
const COR = {bb: "#b39ddb", curta: "#4c8dff", longa: "#ff9800", zero: "#5d6b7a", adx: "#e6edf3", mais: "#26a69a", menos: "#ef5350"};

function montarDidi(tr, precisao) {
  tr.el.classList.add("didi");
  const fmt = {type: "price", precision: precisao, minMove: 10 ** -precisao};
  const fmt1 = {type: "price", precision: 1, minMove: 0.1};
  const linha = (chart, color, extra = {}) => chart.addLineSeries({color, lineWidth: 1, priceLineVisible: false,
    lastValueVisible: false, crosshairMarkerRadius: 3, priceFormat: fmt, ...extra});
  const legenda = box => { const d = document.createElement("div"); d.className = "legenda"; box.appendChild(d); return d; };
  const painel = () => {
    const box = document.createElement("div"); box.className = "painel"; tr.el.appendChild(box);
    const chart = LightweightCharts.createChart(box, OPCOES);
    chart.priceScale("right").applyOptions({scaleMargins: {top: 0.2, bottom: 0.08}});  // espaço para a legenda
    return {box, chart};
  };
  const didi = painel(), adx = painel();
  // a mesma largura de escala nos três: as barras ficam uma embaixo da outra; só o último mostra as horas
  const charts = [tr.chart, didi.chart, adx.chart];
  // o logo do TradingView (atribuição da licença) fica só no gráfico principal
  charts.forEach((c, i) => c.applyOptions({rightPriceScale: {minimumWidth: 72}, timeScale: {visible: i === 2},
    layout: {attributionLogo: i === 0}}));
  const series = [
    ["bb_sup", linha(tr.chart, COR.bb)], ["bb_meio", linha(tr.chart, COR.bb, {lineStyle: 2})], ["bb_inf", linha(tr.chart, COR.bb)],
    ["didi_curta", linha(didi.chart, COR.curta, {lineWidth: 2})], ["didi_longa", linha(didi.chart, COR.longa, {lineWidth: 2})],
    ["adx", linha(adx.chart, COR.adx, {lineWidth: 2, priceFormat: fmt1})],
    ["di_mais", linha(adx.chart, COR.mais, {priceFormat: fmt1})], ["di_menos", linha(adx.chart, COR.menos, {priceFormat: fmt1})],
  ];
  const curta = series[3][1];
  curta.createPriceLine({price: 0, color: COR.zero, lineWidth: 1, lineStyle: 0, axisLabelVisible: false, title: "MA8"});
  // série invisível com a hora de cada candle: os painéis têm os mesmos pontos de tempo do principal (índices iguais)
  const vazios = [didi.chart, adx.chart].map(c => c.addLineSeries({visible: false}));
  // ts: hora de cada linha em segundos (busca binária do cursor); lider: gráfico que o usuário mexeu por último;
  // sobre: gráfico sob o mouse; hover: hora apontada pelo mouse (a legenda fica nela)
  tr.didi = {series, curta, vazios, charts, j: 0, ts: tr.t.indicadores.t.map(seg), lider: 0, preso: false, sobre: -1, hover: null, largura: 72,
    legendas: [legenda(tr.el.querySelector(".grafico")), legenda(didi.box), legenda(adx.box)]};

  // Faixa visível e cursor vão num sentido só, do gráfico que o usuário está mexendo para os outros: o Lightweight
  // Charts repete os avisos depois (no desenho e a cada candle novo), e o aviso velho de outro gráfico, se voltasse,
  // desfazia o replay (faixa) ou arrastava o cursor para longe do mouse.
  const D = tr.didi, alvos = [tr.serie, curta, series[5][1]];
  const boxes = [tr.el.querySelector(".grafico"), didi.box, adx.box];
  charts.forEach((c, i) => {
    boxes[i].addEventListener("pointerdown", () => { D.lider = i; D.preso = true; }, true);
    boxes[i].addEventListener("wheel", () => D.lider = i, {capture: true, passive: true});
    boxes[i].addEventListener("pointerenter", () => D.sobre = i);
    boxes[i].addEventListener("pointerleave", () => {
      if (D.sobre !== i) return;
      D.sobre = -1; D.hover = null; charts.forEach(o => o.clearCrosshairPosition()); legendasDidi(tr, null);
    });
    c.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && i === D.lider) alinhar(tr, i, r); });
    c.subscribeCrosshairMove(p => {
      if (i !== D.sobre) return;
      charts.forEach((o, j) => {
        if (j === i) return;
        const v = p.time == null ? null
          : j === 0 ? arena.candles[arena.porTempo.get(p.time)]?.close : valorEm(tr, j === 1 ? "didi_curta" : "adx", p.time);
        if (v != null) o.setCrosshairPosition(v, p.time, alvos[j]); else o.clearCrosshairPosition();
      });
      D.hover = p.time ?? null;
      legendasDidi(tr, D.hover);
    });
  });
}

// fim do arraste: o gráfico arrastado passa a faixa para os outros e o principal volta a mandar
const soltar = () => arena.traders.forEach(tr => {
  if (!tr.didi?.preso) return;
  tr.didi.preso = false; alinhar(tr, tr.didi.lider); tr.didi.lider = 0;
});
addEventListener("pointerup", soltar, true); addEventListener("pointercancel", soltar, true);

// copia a faixa visível do gráfico `de` (o principal, por padrão) para os outros do card. Sem comparar antes: a faixa
// pedida só vale no próximo desenho (e um setData no painel a descarta), então a leitura do painel engana.
// Também iguala a largura das escalas de preço (o rótulo do WIN, 208.240,00, passa dos 72 px): com larguras
// diferentes a mesma faixa dá barras fora de prumo.
function alinhar(tr, de = 0, r = tr.didi.charts[de].timeScale().getVisibleLogicalRange()) {
  const D = tr.didi, w = Math.max(...D.charts.map(c => c.priceScale("right").width()));
  if (w > D.largura) { D.largura = w; D.charts.forEach(c => c.applyOptions({rightPriceScale: {minimumWidth: w}})); }
  if (r) D.charts.forEach((c, i) => i !== de && c.timeScale().setVisibleLogicalRange(r));
}

// índice da última linha já revelada com t <= time (sem time: a última revelada); busca binária
function linhaEm(tr, time) {
  const {ts, j} = tr.didi;
  if (time == null) return j - 1;
  let lo = 0, hi = j;  // primeira linha com ts > time, entre as reveladas
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] > time) hi = m; else lo = m + 1; }
  return lo - 1;
}
function valorEm(tr, chave, time) { const j = linhaEm(tr, time); return j < 0 ? null : tr.t.indicadores[chave][j]; }

function legendasDidi(tr, time) {
  const ind = tr.t.indicadores, j = linhaEm(tr, time), p = casas(arena.candles[0].close);
  const v = (chave, d) => j < 0 || ind[chave][j] == null ? "–"
    : ind[chave][j].toLocaleString("pt-BR", {minimumFractionDigits: d, maximumFractionDigits: d});
  const it = (cor, nome, valor) => `<span style="color:${cor}">${nome} <b>${valor}</b></span>`;
  const [bb, didi, adx] = tr.didi.legendas;
  bb.innerHTML = `<span class="mut">BB 8 · 2</span>` + it(COR.bb, "sup", v("bb_sup", p)) + it(COR.bb, "meio", v("bb_meio", p)) + it(COR.bb, "inf", v("bb_inf", p));
  didi.innerHTML = `<span class="mut">Didi Index 3 · 8 · 20</span>` + it(COR.curta, "MA3", v("didi_curta", p)) + it(COR.longa, "MA20", v("didi_longa", p)) + it(COR.zero, "MA8", "0");
  adx.innerHTML = `<span class="mut">ADX 8</span>` + it(COR.adx, "ADX", v("adx", 1)) + it(COR.mais, "DI+", v("di_mais", 1)) + it(COR.menos, "DI−", v("di_menos", 1));
}

// revela os indicadores até o cursor do replay; `inicio` é o primeiro candle novo (0 = refaz tudo)
// D: os painéis do Didi ou o do delta do Caio (mesma forma: series, vazios, j)
function revelarDidi(tr, inicio, D = tr.didi) {
  const ind = tr.t.indicadores, n = arena.cursor;
  const ponto = (chave, j) => ind[chave][j] == null ? null : {time: D.ts ? D.ts[j] : seg(ind.t[j]), value: ind[chave][j],
    ...(chave === "delta" && {color: ind[chave][j] >= 0 ? COR.mais : COR.menos})};
  if (inicio === 0) {
    const vazio = arena.candles.slice(0, n).map(c => ({time: c.time}));
    D.vazios.forEach(s => s.setData(vazio));
    let j = 0; while (j < ind.k.length && ind.k[j] < n) j++;
    D.j = j;
    for (const [chave, s] of D.series) s.setData([...Array(j).keys()].map(i => ponto(chave, i)).filter(Boolean));
    return;
  }
  for (let k = inicio; k < n; k++) D.vazios.forEach(s => s.update({time: arena.candles[k].time}));
  for (; D.j < ind.k.length && ind.k[D.j] < n; D.j++)
    for (const [chave, s] of D.series) { const pt = ponto(chave, D.j); if (pt) s.update(pt); }
}

function atualizarDidi(tr, s) {
  const m = s.agulhadas.map(a => ({time: seg(a.t), position: a.lado === "compra" ? "belowBar" : "aboveBar",
    color: a.lado === "compra" ? "#26a69a" : "#ef5350", shape: a.lado === "compra" ? "arrowUp" : "arrowDown", text: "agulhada"}));
  tr.didi.curta.setMarkers(m.sort((a, b) => a.time - b.time));
  legendasDidi(tr, tr.didi.hover);  // com o mouse em cima, a legenda fica no candle apontado
}

// Caio: histograma do delta de cada candle num painel embaixo (verde comprador, vermelho vendedor) com as linhas
// ±limite; mesmo eixo de tempo do gráfico principal. Os valores vêm do Python (t.indicadores.delta e .limite).
function montarDelta(tr) {
  tr.el.classList.add("didi");  // o card alto com painéis embaixo é o mesmo do Didi
  const box = document.createElement("div"); box.className = "painel"; tr.el.appendChild(box);
  const chart = LightweightCharts.createChart(box, OPCOES);
  chart.priceScale("right").applyOptions({scaleMargins: {top: 0.2, bottom: 0.05}});  // espaço para a legenda
  const charts = [tr.chart, chart];
  charts.forEach((c, i) => c.applyOptions({rightPriceScale: {minimumWidth: 72}, timeScale: {visible: i === 1},
    layout: {attributionLogo: i === 0}}));
  const lim = tr.t.indicadores.limite.find(v => v != null);
  const hist = chart.addHistogramSeries({priceFormat: {type: "volume"}, priceLineVisible: false, lastValueVisible: false,
    // a escala sempre mostra as linhas do limite, mesmo quando o delta da tela não chega nelas
    autoscaleInfoProvider: base => { const r = base(); if (r && lim != null) {
      r.priceRange.maxValue = Math.max(r.priceRange.maxValue, lim); r.priceRange.minValue = Math.min(r.priceRange.minValue, -lim); }
      return r; }});
  if (lim != null) for (const p of [lim, -lim])
    hist.createPriceLine({price: p, color: "#f0b429", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: p > 0 ? "+limite" : "−limite"});
  const legenda = document.createElement("div"); legenda.className = "legenda"; box.appendChild(legenda);
  tr.delta = {series: [["delta", hist]], vazios: [chart.addLineSeries({visible: false})], j: 0, legenda, lim, charts};
  let sinc = false;
  charts.forEach((c, i) => c.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (sinc || !r) return;
    sinc = true; charts[1 - i].timeScale().setVisibleLogicalRange(r); sinc = false;
  }));
}

function legendaDelta(tr) {
  const D = tr.delta, v = D.j ? tr.t.indicadores.delta[D.j - 1] : null;
  const fmt = x => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("pt-BR");
  D.legenda.innerHTML = `<span class="mut">Delta 5 min · limite ±${D.lim == null ? "–" : D.lim.toLocaleString("pt-BR")}</span>`
    + (v == null ? `<span class="mut">sem delta neste dia</span>` : `<span style="color:${v >= 0 ? COR.mais : COR.menos}">último <b>${fmt(v)}</b></span>`);
}

// reprodução
let ultimoQuadro = 0, sobra = 0;
function quadro(ts) {
  if (!arena.tocando) return;
  if (ultimoQuadro) {
    sobra += (ts - ultimoQuadro) / 1000 * +$("#vel").value;
    const n = Math.floor(sobra);
    if (n > 0) { sobra -= n; avancar(n); }
  }
  ultimoQuadro = ts;
  requestAnimationFrame(quadro);
}
function tocar() { if (arena.cursor >= arena.candles.length) irPara(0); arena.tocando = true; ultimoQuadro = 0; sobra = 0; $("#play").textContent = "⏸"; requestAnimationFrame(quadro); }
function pausar() { arena.tocando = false; $("#play").textContent = "▶"; }
$("#play").onclick = () => arena.tocando ? pausar() : tocar();
$("#inicio").onclick = () => { pausar(); irPara(0); };
$("#fim").onclick = () => { pausar(); irPara(arena.candles.length); arena.mostrarResultado(); };
$("#barra").oninput = e => { pausar(); irPara(+e.target.value); };
arena.irPara = irPara;
