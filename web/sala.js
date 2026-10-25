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

function montar(dados) {
  arena.dados = dados;
  const candles = dados.candles.map(([t, o, h, l, c]) => ({iso: t, time: seg(t), open: o, high: h, low: l, close: c}));
  arena.candles = candles;
  arena.dias = [...new Set(candles.map(c => c.iso.slice(0, 10)))];
  $("#grid").innerHTML = "";
  arena.traders = Object.entries(dados.traders).map(([nome, t], k) => criarCard(nome, t, k));
  $("#grid").insertAdjacentHTML("beforeend", `<section class="card vazio"><div style="font-size:30px">+</div><div>Adicionar trader</div><div style="font-size:11px">em breve</div></section>`);
  $("#barra").max = candles.length; $("#barra").value = 0;
  ["#inicio", "#play", "#fim", "#barra"].forEach(s => $(s).disabled = false);
  irPara(0);
}

function criarCard(nome, t, k) {
  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML = `<div class="ch"><span class="av" style="background:${CORES[k % CORES.length]}">${nome[0]}</span><span class="n">${nome}</span><span class="tag">${t.estilo}</span><span class="pl"></span></div>
    <div class="sub"><span class="tend"></span><span class="status"></span></div><div class="grafico"><canvas class="zonas"></canvas></div>`;
  $("#grid").appendChild(el);
  const box = el.querySelector(".grafico");
  const chart = LightweightCharts.createChart(box, {
    autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5"},
    grid: {vertLines: {color: "#18212c"}, horzLines: {color: "#18212c"}},
    timeScale: {timeVisible: true, secondsVisible: false, borderColor: "#1f2a36", barSpacing: 7},
    rightPriceScale: {borderColor: "#1f2a36"}, crosshair: {mode: 0},
  });
  const precisao = casas(arena.candles[0]?.close ?? 0);
  const serie = chart.addCandlestickSeries({upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    priceFormat: {type: "price", precision: precisao, minMove: 10 ** -precisao}});
  const tr = {nome, t, el, chart, serie, canvas: box.querySelector("canvas"), linhas: [], mostrados: 0};
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => desenharZonas(tr));
  new ResizeObserver(() => desenharZonas(tr)).observe(box);
  return tr;
}

// Execuções (entrada/saída) levam a hora de abertura do candle em que aconteceram: aparecem com esse candle.
// Decisões (ordem, bloqueio, estudo) levam a hora do fechamento do candle que as gerou: aparecem com ele.
const EXECUCOES = new Set(["entrada", "saida"]);
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
    if (arena.cursor) tr.chart.timeScale().scrollToRealTime();
  }
  atualizar();
}

function avancar(n) {
  const alvo = Math.min(arena.cursor + n, arena.candles.length);
  for (const tr of arena.traders)
    for (let k = tr.mostrados; k < alvo; k++) { const {iso, ...c} = arena.candles[k]; tr.serie.update(c); }
  arena.traders.forEach(tr => tr.mostrados = alvo);
  arena.cursor = alvo;
  atualizar();
  if (arena.cursor >= arena.candles.length) { pausar(); arena.mostrarResultado(); }
}

function estado(tr) {
  const ev = ate(tr.t.eventos);
  const saidas = ev.filter(e => e.tipo === "saida");
  const resultado = saidas.reduce((s, e) => s + e.resultado_rs, 0);
  const ganhos = saidas.filter(e => e.resultado_rs > 0).length;
  let posicao = null, desenhos = [], tend = "";
  for (const e of ev) {
    if (e.tipo === "entrada") posicao = e;
    if (e.tipo === "saida") posicao = null;
    if (e.tipo === "desenho") desenhos = e.desenhos;
    if (e.tipo === "pensamento") tend = e.linhas[0] || "";
  }
  const dia = arena.cursor ? arena.candles[arena.cursor - 1].iso.slice(0, 10) : "";
  const stopsHoje = saidas.filter(e => e.motivo === "stop" && e.t.startsWith(dia)).length;
  return {ev, saidas, resultado, ganhos, posicao, desenhos, tend, stopsHoje, dia};
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
