// Sala de operações: reproduz o backtest candle a candle em oito gráficos (quatro na tela, quatro rolando para baixo),
// cada um com o operacional e o ativo escolhidos nele. Ativos diferentes andam numa linha do tempo só (a hora de
// Brasília): cada gráfico mostra os candles do seu ativo até a hora do replay. Também guarda o que as outras telas
// usam: $, seg, CORES, OPCOES, CASAS, graficoPuro e a troca entre Backtest e Ao vivo.
const $ = s => document.querySelector(s);
const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: 0, maximumFractionDigits: 2});
// preço abaixo de 10 (forex, ex.: 1,08612) pede 5 casas; índices, dólar e bitcoin ficam com 2
const casas = v => Math.abs(v) < 10 ? 5 : 2;
const num = v => v.toLocaleString("pt-BR", {maximumFractionDigits: casas(v)});
// horário de Brasília tratado como UTC no gráfico, para o eixo mostrar a hora do pregão
const seg = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +iso.slice(14, 16)) / 1000;
const hhmm = iso => iso.slice(11, 16);
const ddmm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const isoDe = t => new Date(t * 1000).toISOString().slice(0, 16);  // segundos do gráfico de volta à hora de Brasília
const pct = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + "%";
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
const CORES = ["#1e3a5f", "#3d2e5c", "#21452f", "#4d3a1a", "#4a1f24", "#1f3f4a"];
// todos os ativos do config, na ordem e nos grupos das listas (backtest, gráficos ao vivo, lista de ativos)
const CATALOGO = [
  ["Índices e futuros", {WIN: "Mini-índice", WDO: "Mini-dólar"}],
  ["Ações B3", {PETR4: "Petrobras PN", VALE3: "Vale ON", ITUB4: "Itaú Unibanco PN", BBDC4: "Bradesco PN",
                BBAS3: "Banco do Brasil ON", PETR3: "Petrobras ON", AXIA3: "Axia Energia ON", SBSP3: "Sabesp ON",
                EMBJ3: "Embraer ON", PRIO3: "PRIO ON", RENT3: "Localiza ON", EQTL3: "Equatorial ON"}],
  ["Forex", {EURUSD: "Euro / Dólar", GBPUSD: "Libra / Dólar", USDJPY: "Dólar / Iene", USDCHF: "Dólar / Franco suíço",
             AUDUSD: "Dólar australiano / Dólar", USDCAD: "Dólar / Dólar canadense", NZDUSD: "Dólar neozelandês / Dólar"}],
  ["Cripto", {BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum"}],
];
const NOMES = Object.assign({}, ...CATALOGO.map(([, g]) => g));
const B3 = new Set(["WDO", "WIN"]);  // pregão com hora para abrir e fechar; forex e bitcoin correm a noite toda
const CASAS = {WDO: 1, WIN: 0, EURUSD: 5, GBPUSD: 5, USDJPY: 3, USDCHF: 5, AUDUSD: 5, USDCAD: 5, NZDUSD: 5, BTCUSDT: 2, ETHUSDT: 2};
const fmtPreco = (v, a) => v.toLocaleString("pt-BR", {minimumFractionDigits: CASAS[a] ?? 2, maximumFractionDigits: CASAS[a] ?? 2});
const formato = a => ({type: "price", precision: CASAS[a] ?? 2, minMove: 10 ** -(CASAS[a] ?? 2)});
const CANDLE = {upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350"};
// as cores dos gráficos seguem o tema (variáveis do estilo.css); valem para os gráficos criados depois da troca
function coresDoTema() {
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  Object.assign(CANDLE, {upColor: v("--up"), wickUpColor: v("--up"), downColor: v("--dn"), wickDownColor: v("--dn")});
  OPCOES.layout.textColor = v("--mut");
  OPCOES.timeScale.borderColor = OPCOES.rightPriceScale.borderColor = v("--line");
}
// "carbono" é o padrão (Neon Quarters); os ids ficam os mesmos para não perder o tema já escolhido em tq.tema
const TEMAS = [["carbono", "Neon Quarters", "Preto e verde-água neon"], ["neon", "Azul-noite", "Verde-água da marca no azul-noite"],
               ["ouro", "Carbono e ouro", "Preto e dourado"], ["branco", "Branco", "Claro, para dia de sol"]];
const AMOSTRA = {neon: ["#0b0f14", "#121821", "#1de9b6", "#ef5350"], ouro: ["#0d0d0f", "#161618", "#f5b301", "#ef4444"],
                 carbono: ["#0d0d0f", "#161618", "#1de9b6", "#ff4d6d"], branco: ["#f3f5f8", "#ffffff", "#0b9e86", "#e5303f"]};
const rotularTema = () => $("#tema-nome").textContent = TEMAS.find(([id]) => id === document.documentElement.dataset.tema)?.[1] ?? TEMAS[0][1];
rotularTema();
$("#tema").addEventListener("click", e => {
  const b = e.currentTarget;
  if (painelAberto(b)) return fecharPainel();
  const atual = document.documentElement.dataset.tema;
  abrirPainel(b, {
    rotulo: "Tema de cores", classe: "tema",
    lista: () => TEMAS.map(([id, nome, txt]) => `<button class="pop-it ${id === atual ? "sel" : ""}" data-v="${id}" aria-pressed="${id === atual}">
      <span class="amostra">${AMOSTRA[id].map(c => `<i style="background:${c}"></i>`).join("")}</span>
      <span class="quem-t"><b>${nome}</b><small>${txt}</small></span></button>`).join(""),
    escolher: id => {
      document.documentElement.dataset.tema = id;
      try { localStorage.setItem("tq.tema", id); } catch {}
      coresDoTema(); rotularTema();
      document.dispatchEvent(new Event("tema"));  // os gráficos se refazem com as cores novas
    }});
});
const STATUS = {promovido: "promovido", experiencia: "em experiência", pausado: "pausado",
                aguardando: "aguardando gerente", sem_dados: "sem dados", nao_opera: "não opera aqui"};
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const CHEVRON = `<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>`;
const semAcento = t => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// ---- painel flutuante sob um botão (escolher ativo, tempo gráfico, operacional): um só aberto na página.
// lista(busca) devolve o html dos itens (.pop-it com data-v; .off e disabled = não pode); escolher(v) recebe a escolha.
const pop = document.createElement("div");
pop.className = "pop"; pop.hidden = true; pop.setAttribute("role", "dialog");
document.body.appendChild(pop);
let popBotao = null, popEscolher = null;
const painelAberto = botao => !pop.hidden && popBotao === botao;
function abrirPainel(botao, {rotulo, classe = "", busca, lista, escolher}) {
  fecharPainel();
  popBotao = botao; popEscolher = escolher; pop.dataset.tipo = classe;
  pop.setAttribute("aria-label", rotulo);
  pop.innerHTML = (busca ? `<label class="pop-busca"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>
    <input type="search" placeholder="${busca}" aria-label="Buscar" autocomplete="off" spellcheck="false"></label>` : "")
    + `<div class="pop-lista" role="listbox"></div>`;
  const desenhar = txt => {
    pop.querySelector(".pop-lista").innerHTML = lista(semAcento(txt.trim())) || `<div class="pop-vazio">Nada com “${esc(txt)}”</div>`;
    if (busca) marcarPainel(pop.querySelector(".pop-it:not(.off)"));
  };
  pop.querySelector("input")?.addEventListener("input", e => desenhar(e.target.value));
  desenhar("");
  pop.hidden = false; botao.setAttribute("aria-expanded", "true");
  const r = botao.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  const embaixo = innerHeight - r.bottom, emcima = r.top;  // abre para cima quando o botão está no rodapé
  const subir = pop.offsetHeight + 14 > embaixo && emcima > embaixo;
  pop.style.setProperty("--alt", Math.max(200, (subir ? emcima : embaixo) - 90) + "px");
  pop.style.top = (subir ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + "px";
  (pop.querySelector("input") || pop.querySelector(".pop-it.sel") || pop.querySelector(".pop-it:not(.off)"))?.focus();
}
function fecharPainel(devolverFoco) {
  if (pop.hidden) return;
  pop.hidden = true; popBotao?.setAttribute("aria-expanded", "false");
  if (devolverFoco) popBotao?.focus();
  popBotao = popEscolher = null;
}
function marcarPainel(it) {  // o realce das setas do teclado; Enter escolhe ele
  pop.querySelectorAll(".pop-it.foco").forEach(x => x.classList.remove("foco"));
  it?.classList.add("foco"); it?.scrollIntoView({block: "nearest"});
}
pop.addEventListener("click", e => {
  const it = e.target.closest(".pop-it:not(.off)"); if (!it || !popEscolher) return;
  const f = popEscolher; fecharPainel(true); f(it.dataset.v);
});
pop.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.stopPropagation(); return fecharPainel(true); }
  if (!pop.querySelector("input")) return;  // sem busca: Tab e Enter dos próprios botões
  const itens = [...pop.querySelectorAll(".pop-it:not(.off)")], k = itens.indexOf(pop.querySelector(".pop-it.foco"));
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); marcarPainel(itens[Math.max(0, Math.min(itens.length - 1, k + (e.key === "ArrowDown" ? 1 : -1)))]);
  }
  if (e.key === "Enter" && k >= 0) { e.preventDefault(); itens[k].click(); }
});
document.addEventListener("pointerdown", e => { if (!pop.contains(e.target) && !popBotao?.contains(e.target)) fecharPainel(); });
addEventListener("resize", () => fecharPainel());
// itens de ativo agrupados como no CATALOGO, filtrados pela busca (ticker ou nome, sem acento); direita(a): o fim da linha
const listaAtivos = (t, atual, direita) => CATALOGO.map(([g, ativos]) => {
  const as = Object.keys(ativos).filter(a => !t || semAcento(a + " " + ativos[a]).includes(t));
  return !as.length ? "" : `<div class="pop-g">${g}</div>` + as.map(a => `<button class="pop-it ${a === atual ? "sel" : ""}" data-v="${a}"
    role="option" aria-selected="${a === atual}"><span class="tk">${a}</span><span class="nm">${esc(NOMES[a])}</span>${direita(a)}</button>`).join("");
}).join("");

// arena.ativos: {WDO: {ativo, candles, porTempo, cursor}}; arena.tempos: a linha do tempo (segundos) de todos os
// ativos juntos; arena.cursor: quantos pontos dela já passaram
const arena = window.arena = {dados: null, cursor: 0, tocando: false, traders: [], ativos: {}, tempos: [], dias: [],
                              mostrarResultado() {}};

// ---- Backtest ou Ao vivo (a página abre no ao vivo; o vivo.js ouve o evento "modo")
function modo(m) {
  document.body.classList.toggle("vivo", m === "vivo");
  document.querySelectorAll("#modo button").forEach(b => b.classList.toggle("sel", b.dataset.modo === m));
  if (m === "vivo") pausar();
  document.dispatchEvent(new Event("modo"));
  primeiraVez();
}
$("#modo").addEventListener("click", e => { const b = e.target.closest("button"); if (b) modo(b.dataset.modo); });

// ---- os oito gráficos: [operacional, ativo] de cada um, lembrados neste navegador
const SLOTS_PADRAO = [["Sofia SMC", "WDO"], ["Didi Agulhada", "WDO"], ["Caio Contrafluxo", "WDO"], ["Sofia SMC", "WIN"],
                      ["Didi Agulhada", "WIN"], ["Caio Contrafluxo", "WIN"], ["Sofia SMC", "EURUSD"], ["Sofia SMC", "BTCUSDT"]];
let TRADERS = [];  // [{nome, estilo, salas}] da /api/traders
let slots = (() => {
  try {
    const s = JSON.parse(localStorage.getItem("arena.slots"));
    if (Array.isArray(s) && s.length === 8 && s.every(x => Array.isArray(x) && x[1] in NOMES)) return s;
  } catch {}
  return SLOTS_PADRAO.map(x => [...x]);
})();
const guardar = () => { try { localStorage.setItem("arena.slots", JSON.stringify(slots)); } catch {} };
const operaEm = (nome, a) => TRADERS.find(t => t.nome === nome)?.salas.includes(a);
// operacional que não trabalha no ativo (o Caio fora da B3) vira o primeiro que trabalha
const acertar = s => { if (!operaEm(s[0], s[1])) s[0] = TRADERS.find(t => t.salas.includes(s[1]))?.nome ?? s[0]; };

const avatar = nome => { const k = Math.max(0, TRADERS.findIndex(t => t.nome === nome));
  return `<span class="av" style="background:${CORES[k % CORES.length]}">${esc(nome[0])}</span>`; };
function cabecalho(i) {
  const [nome, a] = slots[i];
  return `<div class="ch"><button class="bt-op" data-i="${i}" aria-haspopup="dialog" aria-expanded="false"
      aria-label="Operacional do gráfico ${i + 1}: ${esc(nome)}">${avatar(nome)}<b>${esc(nome)}</b>${CHEVRON}</button>
    <button class="bt-at" data-i="${i}" aria-haspopup="dialog" aria-expanded="false" aria-label="Ativo do gráfico ${i + 1}: ${a}">${a}${CHEVRON}</button>
    <span class="st"></span><span class="pl"></span></div><div class="sub"><span class="tend"></span><span class="status"></span></div>
    <div class="ult"></div>`;
}

// ---- quantos gráficos na tela (1, 2, 4 ou 8; os primeiros dos oito) e o diário em gaveta.
// Toda abertura começa com 2 (pedido do Diretor); a troca vale até recarregar a página.
let btLayout = 2;
function aplicarBtLayout() {
  $("#grid").classList.remove("l1", "l2", "l4", "l8"); $("#grid").classList.add("l" + btLayout);
  document.querySelectorAll("#grid>.slot").forEach((el, i) => el.hidden = i >= btLayout);
  document.querySelectorAll("#bt-layout button").forEach(b => b.classList.toggle("sel", +b.dataset.layout === btLayout));
}
$("#bt-layout").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  btLayout = +b.dataset.layout;
  aplicarBtLayout(); avisarDatas(); resumoBT();
});
aplicarBtLayout();
let diarioLidos = 0, diarioTotal = 0;  // o número no botão: entradas novas desde a última vez que a gaveta ficou aberta
function gaveta(abrir) {
  $("#gaveta").classList.toggle("aberta", abrir);
  $("#abrir-diario").setAttribute("aria-expanded", abrir);
  if (abrir) diarioLidos = diarioTotal;
  contarDiario();
}
function contarDiario() {
  if ($("#gaveta").classList.contains("aberta") || diarioLidos > diarioTotal) diarioLidos = diarioTotal;
  const novos = diarioTotal - diarioLidos;
  $("#diario-novos").hidden = !novos; $("#diario-novos").textContent = novos > 99 ? "99+" : novos;
}
$("#abrir-diario").addEventListener("click", () => gaveta(!$("#gaveta").classList.contains("aberta")));
$("#fechar-diario").addEventListener("click", () => { gaveta(false); $("#abrir-diario").focus(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#gaveta").classList.contains("aberta") && pop.hidden) gaveta(false);
});

// de onde vêm os candles de cada ativo no backtest: {ativo: {tf, fonte, desde, ate, delta}} da /api/ativos
$("#ferr-bt").innerHTML = Desenho.botoes();  // desenhos do backtest: a mesma barra do ao vivo

let DADOS_BT = {};
fetch("/api/ativos").then(r => r.json()).then(l => { DADOS_BT = Object.fromEntries(l.map(x => [x.ativo, x])); }).catch(() => {});
const mesAno = iso => iso.slice(5, 7) + "/" + iso.slice(2, 4);
function dadosBT(a) {
  const d = DADOS_BT[a]; if (!d) return `<span class="dados-bt mut">—</span>`;
  const fonte = d.fonte === "binance" ? "Binance" : "MT5";
  return d.desde
    ? `<span class="dados-bt" title="Guardado de ${d.desde} a ${d.ate}; fora disso o Rodar baixa do ${fonte}"><i class="disp ok"></i>${d.tf} min · ${mesAno(d.desde)} → ${mesAno(d.ate)}${d.delta ? ` · <b>delta</b>` : ""}</span>`
    : `<span class="dados-bt" title="Nada guardado ainda: o Rodar baixa do ${fonte} (${fonte === "MT5" ? "aberto e logado" : "pela internet"})"><i class="disp baixa"></i>${d.tf} min · baixa do ${fonte}</span>`;
}

function cartaoSlot(i, corpo = `<div class="grafico"><canvas class="zonas"></canvas></div>`) {
  const el = document.createElement("section");
  el.className = "card slot"; el.hidden = i >= btLayout;
  el.innerHTML = cabecalho(i) + corpo;
  $("#grid").appendChild(el);
  return el;
}

$("#grid").addEventListener("click", e => {
  const b = e.target.closest(".bt-op, .bt-at"); if (!b) return;
  if (painelAberto(b)) return fecharPainel();
  const slot = slots[+b.dataset.i];
  if (b.classList.contains("bt-at")) abrirPainel(b, {
    rotulo: "Escolher o ativo do backtest", classe: "bt", busca: "Buscar: PETR4, dólar, bitcoin…",
    lista: t => listaAtivos(t, slot[1], dadosBT),
    escolher: a => { slot[1] = a; acertar(slot); guardar(); avisarDatas(); rodar(true); }});
  else abrirPainel(b, {
    rotulo: "Escolher o operacional", classe: "op",
    lista: () => TRADERS.map(t => {
      const ok = t.salas.includes(slot[1]);
      return `<button class="pop-it ${t.nome === slot[0] ? "sel" : ""} ${ok ? "" : "off"}" data-v="${esc(t.nome)}" ${ok ? ""
        : `disabled title="${esc(t.nome)} não opera em ${slot[1]}: precisa do delta (agressor dos negócios), que só o WDO e o WIN têm"`}>
        ${avatar(t.nome)}<span class="quem-t"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span>
        ${ok ? "" : `<span class="tag">sem delta em ${slot[1]}</span>`}
        <dl class="explica">${(t.explica || []).map(([r, x]) => `<dt>${esc(r)}</dt><dd>${esc(x)}</dd>`).join("")}</dl></button>`;
    }).join("") + `<p class="explica-pe">Todos: R$ 100 de risco por trade e risco:retorno mínimo de 3; o tamanho sai do stop.</p>`,
    escolher: nome => { slot[0] = nome; guardar(); rodar(true); }});
});

const ativoPedido = new URLSearchParams(location.search).get("ativo");  // /?ativo=EURUSD (link da firma)
fetch("/api/traders").then(r => r.json()).then(ts => {
  TRADERS = ts;
  if (ativoPedido in NOMES)  // a sala pedida nos primeiros gráficos, um por operacional dela
    TRADERS.filter(t => t.salas.includes(ativoPedido)).forEach((t, i) => slots[i] = [t.nome, ativoPedido]);
  slots.forEach(acertar);
  primeiraVez();
}).catch(e => aviso("não consegui falar com o servidor da arena: ele está rodando? (" + e.message + ")"));
if (ativoPedido in NOMES) modo("backtest");
// a primeira entrada no backtest já calcula o período padrão e mostra o fim dele: os gráficos abrem com os estudos
// de cada operacional (o ⏮ ou o play recomeçam o replay)
function primeiraVez() {
  if (!rodadas && TRADERS.length && !document.body.classList.contains("vivo")) rodar(false, true);
}

function hojeMenos(dias) {
  const d = new Date(Date.now() - dias * 864e5);
  return d.toISOString().slice(0, 10);
}
$("#ate").value = hojeMenos(1);
$("#de").value = hojeMenos(8);

// ---- calendário do De / até: painel com o mês, a faixa escolhida pintada e atalhos de período
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const diaCurto = iso => `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;
const ATALHOS = [["Ontem", 1, 1], ["7 dias", 7, 1], ["30 dias", 30, 1], ["90 dias", 90, 1], ["1 ano", 365, 1]];  // [rótulo, de, até] em dias atrás
let cal = null;  // {alvo: "de" | "ate", ano, mes} do calendário aberto
function rotularDatas() {
  document.querySelectorAll(".data-btn").forEach(b => b.querySelector("span").textContent = diaCurto($("#" + b.dataset.alvo).value));
  avisarDatas();
}

// ---- faixa acima dos gráficos: ganhos e perdas dos gráficos na tela, somados enquanto o replay anda
let resumoTrades = 0;
function resumoBT() {
  const el = $("#bt-resumo"), vistos = new Map();
  for (const tr of arena.traders) if (!tr.el.hidden && tr.s) vistos.set(tr.nome + "·" + tr.A.ativo, tr);
  if (!vistos.size) { el.innerHTML = `<span class="mut">Os ganhos e as perdas aparecem aqui enquanto o replay anda.</span>`; resumoTrades = 0; return; }
  const ops = [...vistos.values()].flatMap(tr => tr.s.saidas.map(e => ({...e, tr}))).sort((a, b) => a.t < b.t ? -1 : 1);
  const rs = ops.map(o => o.resultado_rs), soma = l => l.reduce((s, x) => s + x, 0);
  const total = soma(rs), ganhos = soma(rs.filter(x => x > 0)), perdas = soma(rs.filter(x => x < 0)), n = rs.length;
  const cor = v => v > 0 ? "up" : v < 0 ? "dn" : "mut", ult = ops.at(-1);
  let acum = 0; const curva = [0, ...rs.map(x => acum += x)], lo = Math.min(...curva), hi = Math.max(...curva), k = hi - lo || 1;
  const pts = curva.map((v, i) => `${(i / Math.max(1, curva.length - 1) * 140).toFixed(1)},${(26 - (v - lo) / k * 22).toFixed(1)}`).join(" ");
  const novo = n > resumoTrades && resumoTrades > 0;  // trade fechado agora: o total pisca na cor do resultado
  resumoTrades = n;
  el.innerHTML = `<span class="br-item br-tot ${novo ? "pisca-" + cor(ult.resultado_rs) : ""}"><small>Resultado na tela</small><b class="${cor(total)}">${brl(total)}</b></span>
    <span class="br-item"><small>Ganhos</small><b class="up">${brl(ganhos)}</b></span>
    <span class="br-item"><small>Perdas</small><b class="dn">${brl(perdas)}</b></span>
    <span class="br-item"><small>Trades</small><b>${n}${n ? ` · ${Math.round(100 * rs.filter(x => x > 0).length / n)}% de acerto` : ""}</b></span>
    <span class="br-item"><small>Maior ganho · maior perda</small><b><span class="up">${n ? brl(Math.max(0, ...rs)) : "—"}</span> · <span class="dn">${n ? brl(Math.min(0, ...rs)) : "—"}</span></b></span>
    <svg class="br-curva ${cor(total)}" viewBox="0 0 140 28" preserveAspectRatio="none" aria-label="Curva dos resultados somados"><polyline points="${pts}"/></svg>
    <span class="br-ult">${ult ? `<small>Último trade</small><span><time>${ddmm(ult.t)} ${hhmm(ult.t)}</time> ${ult.tr.nome.split(" ")[0]} ${ult.tr.A.ativo}
      · saiu (${ult.motivo}) <b class="${cor(ult.resultado_rs)}">${brl(ult.resultado_rs)}</b></span>` : `<small>Último trade</small><span class="mut">nenhum ainda</span>`}</span>`;
}

// ---- dia sem pregão: fim de semana (B3 e forex) e feriados da B3, para os ativos dos gráficos na tela
function pascoa(ano) {  // algoritmo de Meeus (calendário gregoriano)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return new Date(ano, Math.floor(n / 31) - 1, n % 31 + 1);
}
function feriadoB3(iso) {  // nome do feriado em que a B3 não abre, ou null
  const ano = +iso.slice(0, 4), p = pascoa(ano), rel = n => isoLocal(new Date(ano, p.getMonth(), p.getDate() + n));
  const moveis = {[rel(-48)]: "Carnaval", [rel(-47)]: "Carnaval", [rel(-2)]: "Sexta-feira Santa", [rel(60)]: "Corpus Christi"};
  const fixos = {"01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho", "09-07": "Independência",
                 "10-12": "Nossa Senhora Aparecida", "11-02": "Finados", "11-15": "Proclamação da República",
                 "11-20": ano >= 2024 ? "Consciência Negra" : null, "12-24": "véspera de Natal", "12-25": "Natal", "12-31": "último dia do ano"};
  return moveis[iso] ?? fixos[iso.slice(5)] ?? null;
}
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const diaDaSemana = iso => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay();
const mercado = a => a.endsWith("USDT") ? "cripto" : a in CATALOGO[2][1] ? "forex" : "b3";
// ativos que não negociam nesse dia: cripto todo dia; forex fecha no fim de semana; B3 também nos feriados
const fechados = (iso, ativos) => ativos.filter(a => {
  const fds = [0, 6].includes(diaDaSemana(iso)), m = mercado(a);
  return m === "forex" ? fds : m === "b3" && (fds || !!feriadoB3(iso));
});
const juntar = l => l.length > 1 ? l.slice(0, -1).join(", ") + " e " + l.at(-1) : l[0];
function avisarDatas() {
  const ativos = [...new Set(slots.slice(0, btLayout).map(s => s[1]))], linhas = [];
  for (const id of ["de", "ate"]) {
    const iso = $("#" + id).value, fora = fechados(iso, ativos);
    if (!fora.length || (id === "ate" && iso === $("#de").value)) continue;
    const dia = DIAS_SEMANA[diaDaSemana(iso)], fer = feriadoB3(iso), abertos = ativos.filter(a => !fora.includes(a));
    linhas.push(`<b>${ddmm(iso)} é ${dia}${fer && !["sábado", "domingo"].includes(dia) ? `, feriado na B3 (${fer})` : ""}</b>: `
      + `sem pregão de ${juntar(fora)}${abertos.length ? `; ${juntar(abertos)} ${abertos.length > 1 ? "operam" : "opera"}` : ""}.`);
  }
  // período inteiro sem um pregão sequer para algum ativo (um fim de semana só, por exemplo)
  const dias = []; for (let d = new Date($("#de").value + "T12:00"); isoLocal(d) <= $("#ate").value; d.setDate(d.getDate() + 1)) dias.push(isoLocal(d));
  const nunca = ativos.filter(a => dias.length && dias.every(iso => fechados(iso, [a]).length));
  if (nunca.length) linhas.push(`<b>Nenhum pregão de ${juntar(nunca)} no período</b>: escolha dias úteis para ${nunca.length > 1 ? "eles" : "ele"} aparecer${nunca.length > 1 ? "em" : ""}.`);
  const el = $("#aviso-data");
  el.hidden = !linhas.length; el.querySelector(".txt").innerHTML = linhas.join("<br>");
}
$("#aviso-data button").addEventListener("click", () => $("#aviso-data").hidden = true);
function htmlCalendario() {
  const hoje = isoLocal(new Date()), de = $("#de").value, ate = $("#ate").value, sel = $("#" + cal.alvo).value;
  const primeiro = new Date(cal.ano, cal.mes, 1), inicio = new Date(cal.ano, cal.mes, 1 - primeiro.getDay());
  const dias = Array.from({length: 42}, (_, k) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + k));
  return `<div class="cal-top"><button class="cal-nav" data-mes="-1" aria-label="Mês anterior">‹</button>
      <b>${MESES[cal.mes]} de ${cal.ano}</b>
      <button class="cal-nav" data-mes="1" aria-label="Próximo mês" ${cal.ano * 12 + cal.mes >= new Date().getFullYear() * 12 + new Date().getMonth() ? "disabled" : ""}>›</button></div>
    <div class="cal-sem">${["D", "S", "T", "Q", "Q", "S", "S"].map(x => `<span>${x}</span>`).join("")}</div>
    <div class="cal-dias">${dias.map(d => {
      const iso = isoLocal(d), futuro = iso > hoje;
      const fer = feriadoB3(iso), fds = [0, 6].includes(d.getDay());
      const cls = [d.getMonth() !== cal.mes && "fora", iso === hoje && "hoje", iso > de && iso < ate && "faixa", fds && "fds", fer && "fer",
                   iso === de && "ini", iso === ate && "fim", iso === sel && "sel", futuro && "off"].filter(Boolean).join(" ");
      const dica = fer ? `Feriado na B3: ${fer}` : fds ? "Fim de semana: sem pregão na B3 nem no forex" : "";
      return `<button class="pop-it cal-d ${cls}" data-v="${iso}" ${futuro ? "disabled" : ""} aria-label="${diaCurto(iso)}${dica ? ". " + dica : ""}" ${dica ? `title="${dica}"` : ""}
        aria-pressed="${iso === sel}">${d.getDate()}</button>`;
    }).join("")}</div>
    <div class="cal-atalhos">${ATALHOS.map(([r, a, b]) => `<button class="pop-it" data-v="p:${a}:${b}">${r}</button>`).join("")}</div>`;
}
document.querySelectorAll(".data-btn").forEach(b => b.addEventListener("click", () => {
  if (painelAberto(b)) return fecharPainel();
  const v = $("#" + b.dataset.alvo).value;
  cal = {alvo: b.dataset.alvo, ano: +v.slice(0, 4), mes: +v.slice(5, 7) - 1};
  abrirPainel(b, {
    rotulo: b.dataset.alvo === "de" ? "Data inicial do backtest" : "Data final do backtest", classe: "cal", lista: htmlCalendario,
    escolher: v => {
      if (v.startsWith("p:")) { const [, a, d] = v.split(":"); $("#de").value = hojeMenos(+a); $("#ate").value = hojeMenos(+d); }
      else {
        $("#" + cal.alvo).value = v;  // a outra ponta acompanha quando a faixa inverteria
        if ($("#de").value > $("#ate").value) $("#" + (cal.alvo === "de" ? "ate" : "de")).value = v;
      }
      rotularDatas();
    }});
}));
pop.addEventListener("click", e => {  // trocar de mês redesenha o calendário sem fechar o painel
  const nav = e.target.closest("[data-mes]"); if (!nav || !cal || pop.dataset.tipo !== "cal") return;
  cal.mes += +nav.dataset.mes;
  if (cal.mes < 0) { cal.mes = 11; cal.ano--; } else if (cal.mes > 11) { cal.mes = 0; cal.ano++; }
  pop.querySelector(".pop-lista").innerHTML = htmlCalendario();
});
rotularDatas();

// um backtest por ativo e período; trocar o gráfico depois do Rodar reaproveita os já calculados
const cacheBT = new Map();
function backtest(a, de, ate) {
  const k = `${a}|${de}|${ate}`;
  if (!cacheBT.has(k)) cacheBT.set(k, fetch(`/api/backtest?ativo=${a}&de=${de}&ate=${ate}`).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
    return d;
  }, e => { throw new Error("não consegui falar com o servidor da arena: ele está rodando? (" + e.message + ")"); }));
  return cacheBT.get(k).catch(e => { cacheBT.delete(k); throw e; });
}

let rodadas = 0;
// `manter`: depois de trocar um gráfico, o replay volta para a mesma hora; `noFim`: abre no fim do período
async function rodar(manter, noFim) {
  if (!TRADERS.length) return;
  const vez = ++rodadas, hora = manter && arena.cursor ? arena.tempos[arena.cursor - 1] : null;
  pausar();
  $("#relogio").textContent = "calculando o backtest…";
  $("#rodar").disabled = true;
  const de = $("#de").value, ate = $("#ate").value;
  const res = new Map(await Promise.all([...new Set(slots.map(s => s[1]))].map(a => backtest(a, de, ate).then(d => [a, d], e => [a, e]))));
  if (vez !== rodadas) return;  // outra troca chegou antes desta terminar
  $("#rodar").disabled = false;
  if (typeof LightweightCharts === "undefined")
    return aviso("a biblioteca de gráficos (TradingView Lightweight Charts) não carregou: confira a internet e recarregue a página");
  descartar();
  try { montar(res); } catch (e) { return aviso("não consegui montar os gráficos: " + e.message); }
  if (!arena.tempos.length) $("#relogio").textContent = [...res.values()].find(x => x instanceof Error)?.message ?? "sem candles no período";
  else if (hora || noFim) irPara(hora ? arena.tempos.filter(t => t <= hora).length : arena.tempos.length);
}
$("#rodar").onclick = () => { cacheBT.clear(); rodar(false); };

// "i" ao lado das datas: período guardado de cada ativo (lido a cada passada do mouse: o gerente aumenta o cache)
async function periodos() {
  const el = $("#info-dica"), dma = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  if (!el.innerHTML) el.innerHTML = `<span class="mut">lendo os dados…</span>`;
  try {
    const r = await fetch("/api/painel"), d = await r.json();
    if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
    el.innerHTML = `<h3><span>Dados para o backtest</span></h3>
      <table><tr><th>Ativo</th><th>De</th><th>Até</th><th>Delta (Caio)</th></tr>${d.mercado.map(m => `<tr><td><b>${esc(m.ativo)}</b></td>${
        m.sem_dados ? `<td colspan="2" class="mut">nada guardado</td>` : `<td>${dma(m.desde)}</td><td>${dma(m.dia)}</td>`}${
        m.delta_desde ? `<td>desde ${dma(m.delta_desde)}</td>` : `<td class="mut">—</td>`}</tr>`).join("")}</table>
      <p class="mut">Fora desse período o Rodar tenta baixar da fonte (MT5 aberto e logado; o bitcoin vem da Binance).
      O dia de hoje entra só até a hora atual. Sem delta, o Caio não opera.</p>`;
  } catch (e) {
    el.textContent = "não consegui ler o período dos dados (" + e.message + ")";
  }
}
["mouseenter", "focus"].forEach(ev => $("#info-dados").addEventListener(ev, periodos));

function aviso(msg) {
  $("#grid").innerHTML = `<div class="aviso"></div>`;
  $("#grid .aviso").textContent = msg;
  $("#relogio").textContent = "";
  ["#inicio", "#play", "#fim", "#barra"].forEach(s => $(s).disabled = true);
}

// solta os gráficos do backtest anterior: só remove() libera os listeners e os dados que o Lightweight Charts segura
function descartar() {
  for (const tr of arena.traders) { Desenho.soltar(tr.Q); tr.pararVigia(); tr.obs.disconnect(); (grupo(tr)?.charts ?? [tr.chart]).forEach(c => c.remove()); }
  arena.traders = [];
}
// painéis embaixo do gráfico de preço: os do Didi ou o do delta do Caio (mesma forma e mesma sincronia)
const grupo = tr => tr.didi || tr.delta;

// res: ativo -> resultado do /api/backtest (ou o Error dele: só os gráficos desse ativo mostram o erro)
function montar(res) {
  arena.ativos = {};
  for (const [a, d] of res) {
    if (d instanceof Error) continue;
    const candles = d.candles.map(([t, o, h, l, c]) => ({iso: t, time: seg(t), open: o, high: h, low: l, close: c}));
    arena.ativos[a] = {ativo: a, candles, porTempo: new Map(candles.map((c, i) => [c.time, i])), cursor: 0, T: candles.map(c => c.time)};
  }
  // com WDO ou WIN na tela a linha do tempo anda pelos candles da B3: a noite e o fim de semana, com a bolsa fechada,
  // ficam de fora (forex e bitcoin pulam esse trecho de uma vez). Antes do primeiro e depois do último pregão do
  // período, e só com forex ou bitcoin, ela anda pelos candles deles, 24 horas.
  const As = Object.values(arena.ativos), b3 = As.filter(A => B3.has(A.ativo)).flatMap(A => A.candles.map(c => c.time));
  const ini = b3.reduce((m, t) => Math.min(m, t), Infinity), fim = b3.reduce((m, t) => Math.max(m, t), -Infinity);
  arena.tempos = [...new Set([...b3, ...As.filter(A => !B3.has(A.ativo)).flatMap(A => A.candles.map(c => c.time))
    .filter(t => !b3.length || t < ini || t > fim)])].sort((x, y) => x - y);
  arena.dias = [...new Set(arena.tempos.map(t => isoDe(t).slice(0, 10)))];
  $("#grid").innerHTML = "";
  const traders = {};  // a tela de resultado: um por gráfico distinto (operacional · ativo)
  slots.forEach(([nome, a], i) => {
    const d = res.get(a), t = d instanceof Error ? null : d.traders[nome];
    if (!t) {
      const el = cartaoSlot(i, `<div class="aviso-slot"></div>`);
      el.querySelector(".aviso-slot").textContent = d instanceof Error ? d.message : `${nome} não opera ${a}`;
      return;
    }
    arena.traders.push(criarCard(i, arena.ativos[a], t));
    traders[`${nome} · ${a}`] = t;
  });
  arena.dados = {ativo: Object.keys(arena.ativos).join(", "), traders};
  $("#barra").max = arena.tempos.length; $("#barra").value = 0;
  ["#inicio", "#play", "#fim", "#barra"].forEach(s => $(s).disabled = !arena.tempos.length);
  irPara(0);
}
arena.inicioDoDia = dia => arena.tempos.findIndex(t => isoDe(t).startsWith(dia)) + 1;  // mostra o 1º candle do dia

// Livre na vertical, como no TradingView: arrastar o gráfico para cima ou para baixo solta a escala automática do preço
// (o Lightweight Charts só move o preço sem ela); dois cliques no eixo de preço a devolvem.
function livreNaVertical(chart, box) {
  let y0 = null;
  box.addEventListener("pointerdown", e => { y0 = e.button === 0 ? e.clientY : null; }, true);
  box.addEventListener("pointermove", e => {
    if (y0 === null || !(e.buttons & 1) || Math.abs(e.clientY - y0) < 2) return;   // antes do gráfico começar o arraste
    y0 = null;
    const escala = chart.priceScale("right");
    if (escala.options().autoScale) escala.applyOptions({autoScale: false});
  }, true);
  return chart;
}

const OPCOES = {
  autoSize: true, layout: {background: {color: "transparent"}, textColor: "#8b98a5"},
  grid: {vertLines: {visible: false}, horzLines: {visible: false}},  // sem grade atrás dos candles
  timeScale: {timeVisible: true, secondsVisible: false, borderColor: "#1f2a36", barSpacing: 7},
  rightPriceScale: {borderColor: "#1f2a36"}, crosshair: {mode: 0},
};
coresDoTema();
document.addEventListener("tema", () => { if (arena.tempos.length) rodar(true); });

// gráfico do slot i: o operacional (t, do backtest do ativo) no ativo A
function criarCard(i, A, t) {
  const el = cartaoSlot(i), nome = slots[i][0];
  const box = el.querySelector(".grafico");
  const chart = livreNaVertical(LightweightCharts.createChart(box, OPCOES), box);
  const precisao = casas(A.candles[0]?.close ?? 0);
  const serie = chart.addCandlestickSeries({...CANDLE, priceFormat: {type: "price", precision: precisao, minMove: 10 ** -precisao}});
  const tr = {nome, t, A, el, chart, serie, canvas: box.querySelector("canvas"), linhas: [], mostrados: 0};
  tr.pararVigia = Desenho.vigiar(chart, serie, () => desenharZonas(tr));   // zonas acompanham tempo e preço a cada quadro
  tr.obs = new ResizeObserver(() => desenharZonas(tr)); tr.obs.observe(box);
  if (t.indicadores?.delta) montarDelta(tr); else if (t.indicadores) montarDidi(tr, precisao);
  // desenhos do ativo (os mesmos do ao vivo); T: todos os candles do período, o replay mostra só o começo deles
  tr.Q = {ativo: A.ativo, tf: DADOS_BT[A.ativo]?.tf ?? 5, T: A.T, g: {chart, serie}, box, el};
  Desenho.registrar(tr.Q);
  return tr;
}

// Execuções (entrada/saída) levam a hora de abertura do candle em que aconteceram: aparecem com esse candle.
// Decisões (ordem, bloqueio, estudo) levam a hora do fechamento do candle que as gerou: aparecem com ele.
const EXECUCOES = new Set(["entrada", "saida", "cancelada"]);
const ate = (A, eventos) => {
  if (!A.cursor) return [];
  const abertura = seg(A.candles[A.cursor - 1].iso);
  return eventos.filter(e => seg(e.t) <= (EXECUCOES.has(e.tipo) ? abertura : abertura + 300));
};

// cursor de cada ativo: quantos candles dele têm hora até o ponto atual da linha do tempo (busca binária)
function sincronizar() {
  const t = arena.cursor ? arena.tempos[arena.cursor - 1] : -Infinity;
  for (const A of Object.values(arena.ativos)) {
    let lo = 0, hi = A.candles.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (A.candles[m].time > t) hi = m; else lo = m + 1; }
    A.cursor = lo;
  }
}

function irPara(i) {
  arena.cursor = Math.max(0, Math.min(i, arena.tempos.length));
  sincronizar();
  for (const tr of arena.traders) {
    tr.serie.setData(tr.A.candles.slice(0, tr.A.cursor).map(({iso, ...c}) => c));
    tr.mostrados = tr.A.cursor;
    const G = grupo(tr);
    if (G) revelarPaineis(tr, 0, G);
    if (tr.A.cursor) tr.chart.timeScale().scrollToRealTime();
    if (G) { G.lider = 0; alinhar(G); }
  }
  atualizar();
}

function avancar(n) {
  arena.cursor = Math.min(arena.cursor + n, arena.tempos.length);
  sincronizar();
  for (const tr of arena.traders) {
    const antes = tr.mostrados;
    for (let k = antes; k < tr.A.cursor; k++) { const {iso, ...c} = tr.A.candles[k]; tr.serie.update(c); }
    tr.mostrados = tr.A.cursor;
    const G = grupo(tr); if (!G || antes === tr.mostrados) continue;  // fora do pregão deste ativo nada muda
    revelarPaineis(tr, antes, G); alinhar(G, G.lider);
    if (!G.preso) G.lider = 0;  // passada a roda do mouse, o principal volta a mandar
  }
  atualizar();
  if (arena.cursor >= arena.tempos.length) { pausar(); arena.mostrarResultado(); }
}

function estado(tr) {
  const ev = ate(tr.A, tr.t.eventos);
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
  const dia = tr.A.cursor ? tr.A.candles[tr.A.cursor - 1].iso.slice(0, 10) : "";
  const stopsHoje = saidas.filter(e => e.motivo === "stop" && e.t.startsWith(dia)).length;
  return {ev, saidas, resultado, ganhos, posicao, desenhos, agulhadas, tend, stopsHoje, dia};
}

function atualizar() {
  const n = arena.tempos.length, c = {iso: arena.cursor ? isoDe(arena.tempos[arena.cursor - 1]) : ""};
  $("#barra").value = arena.cursor;
  $("#barra").style.setProperty("--p", (n ? 100 * arena.cursor / n : 0) + "%");
  const diaN = arena.cursor ? arena.dias.indexOf(c.iso.slice(0, 10)) + 1 : 0;
  $("#relogio").innerHTML = arena.cursor ? `dia ${diaN} de ${arena.dias.length} · <b>${ddmm(c.iso)} ${hhmm(c.iso)}</b>` : `${arena.dias.length} dias · dê play`;
  const diario = [];
  for (const tr of arena.traders) {
    const s = estado(tr);
    tr.el.querySelector(".pl").className = "pl " + (s.resultado > 0 ? "up" : s.resultado < 0 ? "dn" : "");
    tr.el.querySelector(".pl").textContent = brl(s.resultado);
    const n = s.saidas.length;
    tr.el.querySelector(".st").textContent = `${n} trade${n === 1 ? "" : "s"}${n ? ` · ${Math.round(100 * s.ganhos / n)}%` : ""}`;
    tr.el.querySelector(".tend").textContent = s.tend;
    const agora = s.posicao ? `${s.posicao.lado === "compra" ? "comprado" : "vendido"} ${s.posicao.contratos}`
      : s.stopsHoje >= 3 ? "parou: 3 stops" : "aguardando";
    tr.el.querySelector(".status").textContent = s.posicao ? `${agora} · stop ${num(s.posicao.stop)} · alvo ${num(s.posicao.alvo)}` : agora;
    tr.el.querySelector(".status").className = "status " + (s.posicao ? "acc" : s.stopsHoje >= 3 ? "warn" : "");
    marcadores(tr, s); tr.s = s;
    tr.desenhos = s.desenhos; desenharZonas(tr);
    if (tr.didi) atualizarDidi(tr, s);
    if (tr.delta) legendaDelta(tr);
    const vistos = new Set();  // o mesmo bloqueio se repete a cada candle: mostra só o primeiro do dia
    for (const e of s.ev) {
      const txt = textoDiario(e); if (!txt) continue;
      const chave = e.tipo === "block" || e.tipo === "ordem" ? e.t.slice(0, 10) + txt : e.t + txt;
      if (vistos.has(chave)) continue;
      vistos.add(chave); diario.push([e.t, tr, txt]);
      tr.ultimo = [e.t, txt];
    }
    // o último evento do trader, logo abaixo do cabeçalho do gráfico
    const u = vistos.size ? tr.ultimo : null;
    tr.el.querySelector(".ult").innerHTML = u ? `<time>${ddmm(u[0])} ${hhmm(u[0])}</time> ${u[1]}` : "";
  }
  diario.sort((a, b) => a[0] < b[0] ? 1 : -1);
  diarioTotal = diario.length; contarDiario();
  resumoBT();
  $("#diario").innerHTML = diario.slice(0, 60).map(([t, tr, txt]) => `<div><time>${ddmm(t)} ${hhmm(t)}</time><b>${tr.nome.split(" ")[0]}</b> <span class="mut">${tr.A.ativo}</span> ${txt}</div>`).join("");
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

// Didi: Bollinger sobre os candles e três painéis embaixo (Didi Index, ADX/DI, TRIX), cada um um gráfico com o mesmo
// eixo de tempo do principal (rolagem, zoom e cursor juntos). Os valores vêm prontos do Python (t.indicadores).
const COR = {bb: "#b39ddb", curta: "#4c8dff", longa: "#ff9800", zero: "#5d6b7a", adx: "#e6edf3", mais: "#26a69a", menos: "#ef5350", trix: "#5ad1e6"};

// um painel embaixo do card: gráfico próprio, com espaço em cima para a legenda
function novoPainel(tr, topo = 0.2) {
  const box = document.createElement("div"); box.className = "painel"; tr.el.appendChild(box);
  const chart = livreNaVertical(LightweightCharts.createChart(box, OPCOES), box);
  chart.priceScale("right").applyOptions({scaleMargins: {top: topo, bottom: 0.08}});
  return {box, chart};
}
const novaLegenda = box => { const d = document.createElement("div"); d.className = "legenda"; box.appendChild(d); return d; };

// Grupo de gráficos do card (o de preço + os painéis): mesma largura de escala (as barras ficam uma embaixo da
// outra), só o último mostra as horas, o logo do TradingView (atribuição da licença) só no de preço. Uma série
// invisível com a hora de cada candle dá aos painéis os mesmos pontos de tempo do principal (índices iguais).
// `chaves[i]`: a coluna dos indicadores onde o cursor do painel i pousa; `alvos[i]`: a série dela.
function grupoDePaineis(tr, paineis, series, alvos, chaves, aoMover) {
  const charts = [tr.chart, ...paineis.map(p => p.chart)];
  charts.forEach((c, i) => c.applyOptions({rightPriceScale: {minimumWidth: 72}, timeScale: {visible: i === charts.length - 1},
    layout: {attributionLogo: i === 0}}));
  // ts: hora de cada linha em segundos (busca binária do cursor); lider: gráfico que o usuário mexeu por último;
  // sobre: gráfico sob o mouse; hover: hora apontada pelo mouse (a legenda fica nela)
  const D = {series, charts, vazios: paineis.map(p => p.chart.addLineSeries({visible: false})), j: 0,
    ts: tr.t.indicadores.t.map(seg), lider: 0, preso: false, sobre: -1, hover: null, largura: 72};
  // Faixa visível e cursor vão num sentido só, do gráfico que o usuário está mexendo para os outros: o Lightweight
  // Charts repete os avisos depois (no desenho e a cada candle novo), e o aviso velho de outro gráfico, se voltasse,
  // desfazia o replay (faixa) ou arrastava o cursor para longe do mouse.
  const boxes = [tr.el.querySelector(".grafico"), ...paineis.map(p => p.box)];
  charts.forEach((c, i) => {
    boxes[i].addEventListener("pointerdown", () => { D.lider = i; D.preso = true; }, true);
    boxes[i].addEventListener("wheel", () => D.lider = i, {capture: true, passive: true});
    boxes[i].addEventListener("pointerenter", () => D.sobre = i);
    boxes[i].addEventListener("pointerleave", () => {
      if (D.sobre !== i) return;
      D.sobre = -1; D.hover = null; charts.forEach(o => o.clearCrosshairPosition()); aoMover();
    });
    c.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && i === D.lider) alinhar(D, i, r); });
    c.subscribeCrosshairMove(p => {
      if (i !== D.sobre) return;
      charts.forEach((o, j) => {
        if (j === i) return;
        const v = p.time == null ? null : j === 0 ? tr.A.candles[tr.A.porTempo.get(p.time)]?.close : valorEm(tr, D, chaves[j], p.time) ?? 0;
        if (v != null) o.setCrosshairPosition(v, p.time, alvos[j]); else o.clearCrosshairPosition();
      });
      D.hover = p.time ?? null;
      aoMover();
    });
  });
  return D;
}

function montarDidi(tr, precisao) {
  tr.el.classList.add("didi", "trix");
  const fmt = {type: "price", precision: precisao, minMove: 10 ** -precisao};
  const fmt1 = {type: "price", precision: 1, minMove: 0.1};
  const linha = (chart, color, extra = {}) => chart.addLineSeries({color, lineWidth: 1, priceLineVisible: false,
    lastValueVisible: false, crosshairMarkerRadius: 3, priceFormat: fmt, ...extra});
  const didi = novoPainel(tr), adx = novoPainel(tr), trix = novoPainel(tr, 0.28);
  trix.box.classList.add("curto");
  const series = [
    ["bb_sup", linha(tr.chart, COR.bb)], ["bb_meio", linha(tr.chart, COR.bb, {lineStyle: 2})], ["bb_inf", linha(tr.chart, COR.bb)],
    ["didi_curta", linha(didi.chart, COR.curta, {lineWidth: 2})], ["didi_longa", linha(didi.chart, COR.longa, {lineWidth: 2})],
    ["adx", linha(adx.chart, COR.adx, {lineWidth: 2, priceFormat: fmt1})],
    ["di_mais", linha(adx.chart, COR.mais, {priceFormat: fmt1})], ["di_menos", linha(adx.chart, COR.menos, {priceFormat: fmt1})],
    ["trix", linha(trix.chart, COR.trix, {lineWidth: 2, priceFormat: {type: "price", precision: 4, minMove: 0.0001}})],
  ];
  const curta = series[3][1];
  curta.createPriceLine({price: 0, color: COR.zero, lineWidth: 1, lineStyle: 0, axisLabelVisible: false, title: "MA8"});
  series[8][1].createPriceLine({price: 0, color: COR.zero, lineWidth: 1, lineStyle: 2, axisLabelVisible: false});
  tr.didi = grupoDePaineis(tr, [didi, adx, trix], series, [tr.serie, curta, series[5][1], series[8][1]],
    [null, "didi_curta", "adx", "trix"], () => legendasDidi(tr));
  tr.didi.curta = curta;
  tr.didi.legendas = [novaLegenda(tr.el.querySelector(".grafico")), novaLegenda(didi.box), novaLegenda(adx.box), novaLegenda(trix.box)];
}

// fim do arraste: o gráfico arrastado passa a faixa para os outros e o principal volta a mandar
const soltar = () => arena.traders.forEach(tr => {
  const G = grupo(tr); if (!G?.preso) return;
  G.preso = false; alinhar(G, G.lider); G.lider = 0;
});
addEventListener("pointerup", soltar, true); addEventListener("pointercancel", soltar, true);

// copia a faixa visível do gráfico `de` (o principal, por padrão) para os outros do grupo. Sem comparar antes: a faixa
// pedida só vale no próximo desenho (e um setData no painel a descarta), então a leitura do painel engana.
// Também iguala a largura das escalas de preço (o rótulo do WIN, 208.240,00, passa dos 72 px): com larguras
// diferentes a mesma faixa dá barras fora de prumo.
function alinhar(D, de = 0, r = D.charts[de].timeScale().getVisibleLogicalRange()) {
  const w = Math.max(...D.charts.map(c => c.priceScale("right").width()));
  if (w > D.largura) { D.largura = w; D.charts.forEach(c => c.applyOptions({rightPriceScale: {minimumWidth: w}})); }
  if (r) D.charts.forEach((c, i) => i !== de && c.timeScale().setVisibleLogicalRange(r));
}

// índice da última linha já revelada com t <= time (sem time: a última revelada); busca binária
function linhaEm(D, time) {
  const {ts, j} = D;
  if (time == null) return j - 1;
  let lo = 0, hi = j;  // primeira linha com ts > time, entre as reveladas
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] > time) hi = m; else lo = m + 1; }
  return lo - 1;
}
function valorEm(tr, D, chave, time) { const j = linhaEm(D, time); return j < 0 ? null : tr.t.indicadores[chave][j]; }

function legendasDidi(tr) {
  const ind = tr.t.indicadores, j = linhaEm(tr.didi, tr.didi.hover), p = casas(tr.A.candles[0].close);
  const v = (chave, d) => j < 0 || ind[chave]?.[j] == null ? "–"
    : ind[chave][j].toLocaleString("pt-BR", {minimumFractionDigits: d, maximumFractionDigits: d});
  const it = (cor, nome, valor) => `<span style="color:${cor}">${nome} <b>${valor}</b></span>`;
  const [bb, didi, adx, trix] = tr.didi.legendas;
  bb.innerHTML = `<span class="mut">BB 8 · 2</span>` + it(COR.bb, "sup", v("bb_sup", p)) + it(COR.bb, "meio", v("bb_meio", p)) + it(COR.bb, "inf", v("bb_inf", p));
  didi.innerHTML = `<span class="mut">Didi Index 3 · 8 · 20</span>` + it(COR.curta, "MA3", v("didi_curta", p)) + it(COR.longa, "MA20", v("didi_longa", p)) + it(COR.zero, "MA8", "0");
  adx.innerHTML = `<span class="mut">ADX 8</span>` + it(COR.adx, "ADX", v("adx", 1)) + it(COR.mais, "DI+", v("di_mais", 1)) + it(COR.menos, "DI−", v("di_menos", 1));
  trix.innerHTML = `<span class="mut">TRIX 9 · % por candle</span>` + it(COR.trix, "TRIX", v("trix", 4));
}

// revela os indicadores até o cursor do replay; `inicio` é o primeiro candle novo (0 = refaz tudo)
// D: o grupo de painéis (Didi ou delta do Caio)
function revelarPaineis(tr, inicio, D) {
  const ind = tr.t.indicadores, n = tr.A.cursor;
  const ponto = (chave, j) => ind[chave][j] == null ? null : {time: D.ts[j], value: ind[chave][j],
    ...(chave === "delta" && {color: ind[chave][j] >= 0 ? COR.mais : COR.menos})};
  if (inicio === 0) {
    const vazio = tr.A.candles.slice(0, n).map(c => ({time: c.time}));
    D.vazios.forEach(s => s.setData(vazio));
    let j = 0; while (j < ind.k.length && ind.k[j] < n) j++;
    D.j = j;
    for (const [chave, s] of D.series) s.setData([...Array(j).keys()].map(i => ponto(chave, i)).filter(Boolean));
    return;
  }
  for (let k = inicio; k < n; k++) D.vazios.forEach(s => s.update({time: tr.A.candles[k].time}));
  for (; D.j < ind.k.length && ind.k[D.j] < n; D.j++)
    for (const [chave, s] of D.series) { const pt = ponto(chave, D.j); if (pt) s.update(pt); }
}

function atualizarDidi(tr, s) {
  const m = s.agulhadas.map(a => ({time: seg(a.t), position: a.lado === "compra" ? "belowBar" : "aboveBar",
    color: a.lado === "compra" ? "#26a69a" : "#ef5350", shape: a.lado === "compra" ? "arrowUp" : "arrowDown", text: "agulhada"}));
  tr.didi.curta.setMarkers(m.sort((a, b) => a.time - b.time));
  legendasDidi(tr);  // com o mouse em cima, a legenda fica no candle apontado
}

// Caio: histograma do delta de cada candle num painel embaixo (verde comprador, vermelho vendedor) com as linhas
// ±limite; mesmo eixo de tempo e mesma sincronia do Didi. Os valores vêm do Python (t.indicadores.delta e .limite).
function montarDelta(tr) {
  tr.el.classList.add("didi");  // o card alto com painéis embaixo é o mesmo do Didi
  const painel = novoPainel(tr, 0.2);
  const lim = tr.t.indicadores.limite.find(v => v != null);
  const hist = painel.chart.addHistogramSeries({priceFormat: {type: "volume"}, priceLineVisible: false, lastValueVisible: false,
    // a escala sempre mostra as linhas do limite, mesmo quando o delta da tela não chega nelas
    autoscaleInfoProvider: base => { const r = base(); if (r && lim != null) {
      r.priceRange.maxValue = Math.max(r.priceRange.maxValue, lim); r.priceRange.minValue = Math.min(r.priceRange.minValue, -lim); }
      return r; }});
  if (lim != null) for (const p of [lim, -lim])
    hist.createPriceLine({price: p, color: "#f0b429", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: p > 0 ? "+limite" : "−limite"});
  tr.delta = grupoDePaineis(tr, [painel], [["delta", hist]], [tr.serie, hist], [null, "delta"], () => legendaDelta(tr));
  tr.delta.legenda = novaLegenda(painel.box);
  tr.delta.lim = lim;
}

function legendaDelta(tr) {
  const D = tr.delta, j = linhaEm(D, D.hover), v = j < 0 ? null : tr.t.indicadores.delta[j];
  const fmt = x => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("pt-BR");
  const quando = D.hover == null || j < 0 ? "último" : hhmm(tr.t.indicadores.t[j]);
  D.legenda.innerHTML = `<span class="mut">Delta 5 min · limite ±${D.lim == null ? "–" : D.lim.toLocaleString("pt-BR")}</span>`
    + (v == null ? `<span class="mut">sem delta neste candle</span>` : `<span style="color:${v >= 0 ? COR.mais : COR.menos}">${quando} <b>${fmt(v)}</b></span>`);
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
function tocar() { if (arena.cursor >= arena.tempos.length) irPara(0); arena.tocando = true; ultimoQuadro = 0; sobra = 0; $("#play").textContent = "⏸"; requestAnimationFrame(quadro); }
function pausar() { arena.tocando = false; $("#play").textContent = "▶"; }
$("#play").onclick = () => arena.tocando ? pausar() : tocar();
$("#inicio").onclick = () => { pausar(); irPara(0); };
$("#fim").onclick = () => { pausar(); irPara(arena.tempos.length); arena.mostrarResultado(); };
$("#barra").oninput = e => { pausar(); irPara(+e.target.value); };
arena.irPara = irPara;

// Gráfico só de candles de 5 min (ao vivo e prévia do backtest), sem estudo nenhum: legenda OHLC no canto e uma linha
// pontilhada com o dia no começo de cada pregão. `dados(ks)` recebe [[iso, o, h, l, c], ...]; quando a lista só
// cresceu ou mudou o último candle (o ao vivo), atualiza só o fim e o gráfico não pula.
function graficoPuro(box, ativo, separar = true) {  // separar: linha e rótulo em cada dia novo
  const chart = livreNaVertical(LightweightCharts.createChart(box, {...OPCOES, timeScale: {...OPCOES.timeScale, barSpacing: 6, rightOffset: 4}}), box);
  const serie = chart.addCandlestickSeries({...CANDLE, priceFormat: formato(ativo)});
  const cv = document.createElement("canvas"); cv.className = "zonas"; box.appendChild(cv);
  const leg = novaLegenda(box);
  const G = {chart, serie, ks: [], inicios: [], hover: false};
  const ponto = ([t, o, h, l, c]) => ({time: seg(t), open: o, high: h, low: l, close: c});

  function legenda(c) {
    if (!c) { const k = G.ks.at(-1); if (!k) return leg.innerHTML = ""; c = ponto(k); }
    const cls = c.close >= c.open ? "up" : "dn", f = x => fmtPreco(x, ativo);
    leg.innerHTML = `<span class="${cls}">Ab <b>${f(c.open)}</b></span><span class="${cls}">Máx <b>${f(c.high)}</b></span>`
      + `<span class="${cls}">Mín <b>${f(c.low)}</b></span><span class="${cls}">Fech <b>${f(c.close)}</b></span>`
      + `<span class="${cls}"><b>${pct(c.open ? (c.close / c.open - 1) * 100 : 0)}</b></span>`;
  }
  function separadores() {
    const w = box.clientWidth, h = box.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const largura = w - chart.priceScale("right").width(), ts = chart.timeScale();
    g.font = "11px Segoe UI"; g.setLineDash([3, 4]); g.strokeStyle = "#2a3646"; g.fillStyle = "#6b7a8c";
    for (const [i, iso] of G.inicios) {
      const x = (ts.logicalToCoordinate(i - 1) + ts.logicalToCoordinate(i)) / 2;  // entre o último candle e o primeiro
      if (!(x > 0 && x < largura)) continue;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 28); g.stroke();
      const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
      if (x + 60 < largura) g.fillText(`${SEMANA[d.getUTCDay()]} ${ddmm(iso)}`, x + 6, h - 36);
    }
  }
  // as coordenadas novas só valem no desenho seguinte ao aviso: redesenha no próximo quadro
  const agendar = () => requestAnimationFrame(separadores);
  chart.timeScale().subscribeVisibleLogicalRangeChange(agendar);
  const obs = new ResizeObserver(agendar); obs.observe(box);
  chart.subscribeCrosshairMove(p => { G.hover = p.time != null; legenda(G.hover ? p.seriesData.get(serie) : null); });

  G.dados = ks => {
    const velho = G.ks, n = velho.length;  // mesmo começo e o último velho no mesmo lugar: só o fim mudou
    if (n && ks.length >= n && ks[0][0] === velho[0][0] && ks[n - 1][0] === velho[n - 1][0])
      for (let i = velho.length - 1; i < ks.length; i++) serie.update(ponto(ks[i]));
    else serie.setData(ks.map(ponto));
    G.ks = ks;
    G.inicios = !separar ? [] : ks.map((k, i) => [i, k[0]]).filter(([i, t]) => i > 0 && t.slice(0, 10) !== ks[i - 1][0].slice(0, 10));
    if (!G.hover) legenda(null);
    agendar();
  };
  G.remove = () => { obs.disconnect(); chart.remove(); };
  return G;
}
