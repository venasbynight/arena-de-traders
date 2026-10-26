// Desenhos nos gráficos, como no TradingView: os mesmos no ao vivo e no backtest, guardados por ativo neste navegador
// (tq.desenhos). Cada gráfico entra com Desenho.registrar(Q), Q = {ativo, tf (min), T (hora de cada candle, em segundos,
// na ordem dos dados da série), g: {chart, serie}, box, el}, e sai com Desenho.soltar(Q) antes de ser jogado fora.
// A barra da esquerda de cada tela usa Desenho.botoes(). Carrega antes da sala.js (usa o fmtPreco dela só ao pintar).
window.Desenho = (() => {
  const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let ferramenta = "cursor", sel = null, historico = [];  // sel: {Q, d} o selecionado; historico: cópias para o Ctrl+Z
  const qs = new Set();  // os gráficos com desenho na tela
  let ultimo = null;     // o último gráfico clicado (a lixeira apaga os desenhos do ativo dele)

  const DESENHOS = ler("tq.desenhos", {});  // ativo -> [{tipo, v?, t?, p?: [{t, v}, {t, v}]}]; t em segundos do gráfico
  const guardarDesenhos = () => gravar("tq.desenhos", DESENHOS);

  // ---- barra de ferramentas
  const ICONE = {
    cursor: `<path d="M5 3l11 6.2-5 1.4L8.6 16z"/>`,
    tendencia: `<path d="M4.5 15.5l11-11"/><circle cx="4.5" cy="15.5" r="1.8"/><circle cx="15.5" cy="4.5" r="1.8"/>`,
    horizontal: `<path d="M2 10h16"/><circle cx="10" cy="10" r="1.8"/>`,
    vertical: `<path d="M10 2v16"/><circle cx="10" cy="10" r="1.8"/>`,
    raio: `<path d="M4.5 15.5L18 2"/><circle cx="4.5" cy="15.5" r="1.8"/><circle cx="10.5" cy="9.5" r="1.8"/>`,
    estendida: `<path d="M2 18L18 2"/><circle cx="7" cy="13" r="1.8"/><circle cx="13" cy="7" r="1.8"/>`,
    seta: `<path d="M4 16L16 4M9.5 4H16v6.5"/>`,
    raioh: `<path d="M5 10h13"/><circle cx="5" cy="10" r="1.8"/>`,
    retangulo: `<rect x="3.5" y="5" width="13" height="10" rx="1"/>`,
    fibonacci: `<path d="M3 4h14M3 8h14M3 12h14M3 16h14M5 16L15 4"/>`,
    medir: `<path d="M3 14.5L14.5 3 17 5.5 5.5 17z"/><path d="M6.5 11l1.6 1.6M9 8.5l1.2 1.2M11.5 6l1.6 1.6"/>`,
    texto: `<path d="M4.5 5.5v-2h11v2M10 3.5V16.5M7.5 16.5h5"/>`,
    nota: `<path d="M3.5 4h13v9h-7l-4 3.5V13h-2z"/><path d="M6.5 7.5h7M6.5 10h4.5"/>`,
    sequencial: `<path d="M3 15.5l4.5-7 4 4.5 5.5-9"/><circle cx="3" cy="15.5" r="1.6"/><circle cx="7.5" cy="8.5" r="1.6"/><circle cx="11.5" cy="13" r="1.6"/><circle cx="17" cy="4" r="1.6"/>`,
    pincel: `<path d="M3 16c2.5 0 2.5-3.5 5-3.5s1.5 3 4 3 2-6 5-11.5"/>`,
    compra: `<rect x="3.5" y="3" width="13" height="14" rx="1"/><path d="M3.5 11h13M10 15V6.5M7 9.5l3-3 3 3"/>`,
    venda: `<rect x="3.5" y="3" width="13" height="14" rx="1"/><path d="M3.5 9h13M10 5v8.5M7 10.5l3 3 3-3"/>`,
    cima: `<path d="M10 17V4M5 9l5-5 5 5"/>`,
    baixo: `<path d="M10 3v13M5 11l5 5 5-5"/>`,
    traco: `<path d="M2 10h3.5M8.25 10h3.5M14.5 10H18"/>`,
    borracha: `<path d="M8 16h9M3.6 12.4l7-7a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1L11 15H6.2z"/>`,
    limpar: `<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>`,
    l1: `<rect x="3" y="3" width="14" height="14" rx="1.5"/>`,
    l2: `<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M10 3v14"/>`,
    l4: `<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M10 3v14M3 10h14"/>`,
  };
  const NOME_F = {cursor: "Cursor (Esc)", tendencia: "Linha de tendência", raio: "Raio", estendida: "Linha estendida",
    seta: "Seta", horizontal: "Linha horizontal", raioh: "Raio horizontal", vertical: "Linha vertical", retangulo: "Retângulo",
    fibonacci: "Retração de Fibonacci", medir: "Medir preço e tempo", texto: "Texto", nota: "Nota (observação)",
    sequencial: "Sequencial: clique em cada ponto; duplo clique, Enter ou Esc termina", pincel: "Pincel",
    compra: "Posição comprada (entrada, alvo e stop)", venda: "Posição vendida (entrada, alvo e stop)",
    cima: "Seta para cima", baixo: "Seta para baixo"};
  const LINHAS = ["tendencia", "raio", "estendida", "seta", "horizontal", "raioh", "vertical"];  // o grupo que abre ao lado
  let linhaAtual = LINHAS.includes(ler("tq.linha")) ? ler("tq.linha") : "tendencia";
  const botao = (attr, ic, titulo) => `<button ${attr} title="${titulo}" aria-label="${titulo}"><svg viewBox="0 0 20 20">${ICONE[ic]}</svg></button>`;
  const botoes = () => `${botao('data-f="cursor" class="sel"', "cursor", NOME_F.cursor)}
      <div class="grupo">${botao(`data-f="${linhaAtual}" data-g="linhas"`, linhaAtual, NOME_F[linhaAtual])}<button class="abre"
        aria-haspopup="menu" aria-expanded="false" title="Mais linhas" aria-label="Mais ferramentas de linha"><svg viewBox="0 0 6 6"><path d="M1 1l4 4H1z"/></svg></button></div>
      ${["retangulo", "sequencial", "pincel", "fibonacci", "medir", "texto", "nota", "compra", "venda", "cima", "baixo"]
        .map(f => botao(`data-f="${f}"`, f, NOME_F[f])).join("")}
      ${botao('data-f="borracha"', "borracha", "Borracha: clique num desenho para apagar")}
      ${botao('data-acao="limpar"', "limpar", "Apagar todos os desenhos do ativo do último gráfico clicado")}`;
  // ---- desenhos, como no TradingView: cada gráfico tem um canvas por cima. Com uma ferramenta escolhida ele pega todo o
  // mouse; no cursor, só quando o mouse está em cima de um desenho (clique seleciona, arrastar move, as pontas e os cantos
  // mudam a forma); fora deles o mouse segue para o gráfico. Delete apaga o selecionado e Ctrl+Z desfaz.
  // "tema": a cor do texto do tema (branco nos escuros); as setas para cima e para baixo nascem na cor do candle
  const CORES_D = ["tema", "#4c8dff", "#26a69a", "#ef5350", "#f0b429", "#c084fc", "#787b86"];
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const corDe = d => d.cor && d.cor !== "tema" ? d.cor : css(d.tipo === "cima" ? "--up" : d.tipo === "baixo" ? "--dn" : "--txt");
  const TRACOS = [false, true, "ponto"], NOME_TRACO = {false: "Linha sólida", true: "Linha tracejada", ponto: "Linha pontilhada"};
  const tracejado = d => d.traco === "ponto" ? [1.5, 4] : d.traco ? [6, 4] : [];
  const FIB = [0, .236, .382, .5, .618, .786, 1], UM_CLIQUE = ["horizontal", "raioh", "vertical", "cima", "baixo"];
  let copia = null;  // Ctrl+C: {ativo, d}
  const FONTE = "600 13px Segoe UI", medidor = document.createElement("canvas").getContext("2d");

  function usar(f) {
    ferramenta = f; fecharMenu();
    document.body.classList.toggle("desenhando", f !== "cursor");
    document.body.classList.toggle("apagando", f === "borracha");
    document.querySelectorAll(".ferr [data-f]").forEach(b => b.classList.toggle("sel", b.dataset.f === f));
    if (f !== "cursor") selecionarDesenho(null);
    qs.forEach(Q => { Q.rascunho = null; Q.alvo = null; if (Q.cv) Q.cv.style.cssText = ""; redesenhar(Q); });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".ferr button"); if (!b) return;
    if (b.classList.contains("abre")) return abrirMenu(b);
    if (b.dataset.f) usar(b.dataset.f);
    if (b.dataset.acao === "limpar") {
      const a = (ultimo?.box.offsetParent ? ultimo : [...qs].find(Q => Q.box.offsetParent))?.ativo; if (!a) return;
      if (DESENHOS[a]?.length && confirm(`Apagar os ${DESENHOS[a].length} desenhos de ${a}?`)) {
        selecionarDesenho(null); mudar(() => delete DESENHOS[a]);
      }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest?.("input, textarea, select")) return;
    const seq = [...qs].find(Q => Q.rascunho?.tipo === "sequencial");
    if (seq && (e.key === "Enter" || e.key === "Escape")) return terminarSequencial(seq);
    if (e.key === "Escape") { fecharMenu(); if (ferramenta !== "cursor") usar("cursor"); else selecionarDesenho(null); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && sel) copia = {ativo: sel.Q.ativo, d: JSON.stringify(sel.d)};
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && copia) { e.preventDefault(); colar(); }
    if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); apagar(sel.Q, sel.d); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
  });

  // o grupo das linhas abre um menu ao lado; a escolhida fica no botão (lembrada neste navegador)
  const menu = document.createElement("div"); menu.className = "ferr-menu"; menu.hidden = true; menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  function abrirMenu(b) {
    if (!menu.hidden) return fecharMenu();
    const r = b.closest(".grupo").getBoundingClientRect();
    menu.innerHTML = LINHAS.map(f => `<button role="menuitem" data-f="${f}" class="${f === linhaAtual ? "sel" : ""}">
      <svg viewBox="0 0 20 20">${ICONE[f]}</svg>${NOME_F[f]}</button>`).join("");
    menu.style.left = r.right + 6 + "px"; menu.style.top = r.top + "px";
    menu.hidden = false; b.setAttribute("aria-expanded", "true");
  }
  function fecharMenu() { menu.hidden = true; document.querySelectorAll(".ferr .abre").forEach(b => b.setAttribute("aria-expanded", "false")); }
  menu.addEventListener("click", e => {
    const f = e.target.closest("[data-f]")?.dataset.f; if (!f) return;
    linhaAtual = f;
    document.querySelectorAll('.ferr [data-g="linhas"]').forEach(b => {
      b.dataset.f = f; b.title = NOME_F[f]; b.setAttribute("aria-label", NOME_F[f]);
      b.innerHTML = `<svg viewBox="0 0 20 20">${ICONE[f]}</svg>`;
    });
    gravar("tq.linha", f); usar(f);
  });
  document.addEventListener("pointerdown", e => { if (!menu.hidden && !e.target.closest(".ferr-menu, .abre")) fecharMenu(); });

  // toda mudança passa por aqui: guarda uma cópia para o Ctrl+Z, grava e repinta todos os gráficos do ativo
  const lembrar = () => { historico.push(JSON.stringify(DESENHOS)); if (historico.length > 50) historico.shift(); };
  function mudar(fn) { lembrar(); fn(); guardarDesenhos(); qs.forEach(redesenhar); }
  function desfazer() {
    if (!historico.length) return;
    const velho = JSON.parse(historico.pop());
    for (const a of Object.keys(DESENHOS)) delete DESENHOS[a];
    Object.assign(DESENHOS, velho); selecionarDesenho(null); guardarDesenhos(); qs.forEach(redesenhar);
  }
  // a cópia entra no mesmo ativo, uns candles à direita, e fica selecionada
  function colar() {
    const Q = [...qs].find(Q => Q.ativo === copia.ativo && Q.box.offsetParent && Q.T.length); if (!Q) return;
    const o = JSON.parse(copia.d), d = JSON.parse(copia.d);
    mover(d, o, eixo(Q), 40, 0);
    mudar(() => DESENHOS[Q.ativo].push(d));
    selecionarDesenho(Q, d);
  }
  function criar(Q, d) {
    Object.assign(d, {esp: d.esp ?? 2});
    mudar(() => (DESENHOS[Q.ativo] ??= []).push(d));
    usar("cursor"); selecionarDesenho(Q, d);
  }
  function apagar(Q, d) {
    if (sel?.d === d) selecionarDesenho(null);
    mudar(() => { const l = DESENHOS[Q.ativo] || [], k = l.indexOf(d); if (k >= 0) l.splice(k, 1); });
  }

  // a barra que aparece em cima do gráfico com o desenho selecionado: cor, espessura, tracejado, texto e apagar
  function selecionarDesenho(Q, d) {
    document.querySelector(".d-barra")?.remove();
    const antes = sel; sel = Q && d ? {Q, d} : null;
    if (sel) {
      const el = document.createElement("div"); el.className = "d-barra";
      const posicao = d.tipo === "compra" || d.tipo === "venda", marca = d.tipo === "cima" || d.tipo === "baixo";
      el.innerHTML = (posicao ? "" : CORES_D.map(c => `<button data-cor="${c}" class="${(d.cor || "tema") === c ? "sel" : ""}"
          style="--c:${c === "tema" ? "var(--txt)" : c}" title="${c === "tema" ? "Cor do tema" : "Cor"}" aria-label="Cor ${c}"></button>`).join("") + `<i></i>`)
        + (d.tipo === "texto" || d.tipo === "nota" ? `<button data-editar title="Editar o texto">Editar</button>` : posicao || marca ? "" : `
        <button data-esp title="Espessura da linha">${String(d.esp ?? 1.5).replace(".", ",")} px</button>
        <button data-traco class="${d.traco ? "sel" : ""}" title="${NOME_TRACO[d.traco || false]}: clique para trocar"
          aria-label="${NOME_TRACO[d.traco || false]}"><svg viewBox="0 0 20 20">${d.traco === "ponto"
          ? `<path d="M2.5 10h.5M6.5 10h.5M10.5 10h.5M14.5 10h.5M18 10h.5"/>` : ICONE.traco}</svg></button>`)
        + `<i></i><button data-apagar title="Apagar (Delete)" aria-label="Apagar o desenho"><svg viewBox="0 0 20 20">${ICONE.limpar}</svg></button>`;
      el.addEventListener("pointerdown", e => e.stopPropagation());
      el.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b || !sel) return;
        const {Q, d} = sel;
        if ("apagar" in b.dataset) return apagar(Q, d);
        if ("editar" in b.dataset) return editarTexto(Q, d);
        if (b.dataset.cor) mudar(() => d.cor = b.dataset.cor);
        if ("esp" in b.dataset) mudar(() => d.esp = d.esp >= 4 ? 1 : Math.floor(d.esp ?? 1) + 1);
        if ("traco" in b.dataset) mudar(() => d.traco = TRACOS[(TRACOS.indexOf(d.traco ?? false) + 1) % TRACOS.length]);
        selecionarDesenho(Q, d);  // refaz a barra com o que mudou
      });
      Q.box.appendChild(el);
    }
    if (antes || sel) qs.forEach(redesenhar);
  }

  // texto: uma caixa no lugar do clique; Enter confirma, Esc desiste, apagar todo o texto apaga o desenho
  // a nota é um balão com o texto ligado a um ponto do gráfico; nasce um pouco acima e à direita do clique
  function editarTexto(Q, d, c, p, tipo = "texto") {
    if (!p) { const G = eixo(Q), k = d.tipo === "nota" ? 1 : 0; p = {x: G.x(d.p[k].t), y: G.y(d.p[k].v) + (k ? 20 : 0)}; }
    const inp = document.createElement("input");
    inp.className = "d-texto"; inp.value = d?.texto || ""; inp.placeholder = "Escreva e tecle Enter";
    inp.style.left = p.x + "px"; inp.style.top = p.y - 22 + "px";
    Q.box.appendChild(inp); setTimeout(() => inp.focus());
    let feito = false;
    const fim = ok => {
      if (feito) return; feito = true;
      const txt = inp.value.trim(); inp.remove();
      if (!ok) return usar("cursor");
      if (d) { if (!txt) apagar(Q, d); else if (txt !== d.texto) { mudar(() => d.texto = txt); selecionarDesenho(Q, d); } }
      else if (txt && tipo === "nota") { const G = eixo(Q); criar(Q, {tipo, p: [c, {t: G.t(p.x + 24), v: G.v(p.y - 64)}], texto: txt}); }
      else if (txt) criar(Q, {tipo, p: [c], texto: txt});
      else usar("cursor");
    };
    inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") fim(true); if (e.key === "Escape") fim(false); });
    inp.addEventListener("pointerdown", e => e.stopPropagation());
    inp.addEventListener("blur", () => fim(true));
  }

  // tempo ↔ posição: o índice lógico do Lightweight Charts, com fração entre dois candles e além do último.
  // W e H: a área dos candles (sem as escalas de preço e de tempo)
  function eixo(Q) {
    const ts = Q.g.chart.timeScale(), T = Q.T, n = T.length, passo = Q.tf * 60;
    const logico = t => {
      if (t <= T[0]) return (t - T[0]) / passo;
      if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / passo;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      return lo + (t - T[lo]) / (T[hi] - T[lo]);
    };
    const tempo = l => {
      if (l <= 0) return T[0] + l * passo;
      if (l >= n - 1) return T[n - 1] + (l - n + 1) * passo;
      const i = Math.floor(l); return T[i] + (l - i) * (T[i + 1] - T[i]);
    };
    return {x: t => ts.logicalToCoordinate(logico(t)), y: v => Q.g.serie.priceToCoordinate(v),
            t: x => tempo(ts.coordinateToLogical(x)), v: y => Q.g.serie.coordinateToPrice(y), l: x => ts.coordinateToLogical(x),
            W: Q.box.clientWidth - Q.g.chart.priceScale("right").width(), H: Q.box.clientHeight - ts.height()};
  }

  // um desenho em pixels: segmentos e área (para achar o desenho com o mouse) e alças (o que arrastar muda a forma)
  function geo(d, G) {
    const P = (d.p || []).map(c => ({x: G.x(c.t), y: G.y(c.v)}));
    if (P.some(c => c.x == null || c.y == null)) return null;
    const canto = (i, j) => ({x: P[i].x, y: P[j].y, mover: c => { d.p[i].t = c.t; d.p[j].v = c.v; }});
    const longe = (a, b) => { const k = 1e4 / (Math.hypot(b.x - a.x, b.y - a.y) || 1); return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k]; };
    const [a, b] = P;
    switch (d.tipo) {
      case "horizontal": { const y = G.y(d.v); return y == null ? null : {segs: [[0, y, G.W, y]], alcas: [{x: G.W / 2, y, mover: c => d.v = c.v}]}; }
      case "vertical": { const x = G.x(d.t); return x == null ? null : {segs: [[x, 0, x, G.H]], alcas: [{x, y: G.H / 2, mover: c => d.t = c.t}]}; }
      case "raioh": return {segs: [[a.x, a.y, G.W, a.y]], alcas: [canto(0, 0)]};
      case "raio": return {segs: [[a.x, a.y, ...longe(a, b)]], alcas: [canto(0, 0), canto(1, 1)]};
      case "estendida": return {segs: [[...longe(b, a), ...longe(a, b)]], alcas: [canto(0, 0), canto(1, 1)]};
      case "tendencia": case "seta": return {segs: [[a.x, a.y, b.x, b.y]], alcas: [canto(0, 0), canto(1, 1)]};
      case "texto": {
        medidor.font = FONTE;
        return {segs: [], area: [a.x - 3, a.y - 15, a.x + medidor.measureText(d.texto).width + 3, a.y + 5], alcas: []};
      }
      case "nota": {  // balão em b; a ponta (a) é o ponto marcado
        medidor.font = FONTE;
        const area = [b.x, b.y, b.x + medidor.measureText(d.texto).width + 20, b.y + 28];
        return {segs: [[a.x, a.y, Math.max(area[0], Math.min(a.x, area[2])), a.y < b.y ? area[1] : area[3]]], area,
                alcas: [canto(0, 0), {x: area[0], y: area[1], mover: c => { d.p[1].t = c.t; d.p[1].v = c.v; }}]};
      }
      case "sequencial": case "pincel":
        return {segs: P.slice(1).map((c, i) => [P[i].x, P[i].y, c.x, c.y]), alcas: d.tipo === "pincel" ? [] : P.map((_, i) => canto(i, i))};
      case "cima": return {segs: [], area: [a.x - 9, a.y, a.x + 9, a.y + 24], alcas: []};
      case "baixo": return {segs: [], area: [a.x - 9, a.y - 24, a.x + 9, a.y], alcas: []};
      case "compra": case "venda": {  // p[0]: entrada; p[1]: fim (tempo) e alvo (preço); stop à parte
        const yS = G.y(d.stop); if (yS == null) return null;
        return {segs: [], area: [Math.min(a.x, b.x), Math.min(b.y, yS), Math.max(a.x, b.x), Math.max(b.y, yS)], yS,
                alcas: [{x: a.x, y: a.y, mover: c => { d.p[0].t = c.t; d.p[0].v = c.v; }},
                        {x: a.x, y: b.y, mover: c => d.p[1].v = c.v}, {x: a.x, y: yS, mover: c => d.stop = c.v},
                        {x: b.x, y: a.y, mover: c => d.p[1].t = c.t}]};
      }
    }
    const area = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    return {segs: [], area, alcas: d.tipo === "fibonacci" ? [canto(0, 0), canto(1, 1)] : [canto(0, 0), canto(1, 1), canto(0, 1), canto(1, 0)]};
  }

  const distSeg = (x, y, [x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1, u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - x1 - u * dx, y - y1 - u * dy);
  };
  // o desenho (e a alça dele) a até 6 px do ponto; o de cima vence
  function alvoEm(Q, G, {x, y}) {
    const lista = DESENHOS[Q.ativo] || [];
    for (let k = lista.length - 1; k >= 0; k--) {
      const d = lista[k], g = geo(d, G); if (!g) continue;
      const alca = g.alcas.find(a => Math.hypot(a.x - x, a.y - y) < 7); if (alca) return {d, alca};
      if (g.area && x >= g.area[0] - 6 && x <= g.area[2] + 6 && y >= g.area[1] - 6 && y <= g.area[3] + 6) return {d};
      if (g.segs.some(s => distSeg(x, y, s) < 6)) return {d};
    }
    return null;
  }
  // arrastar o desenho inteiro: cada ponto anda os mesmos pixels (o tempo pula fins de semana como os candles)
  function mover(d, o, G, dx, dy) {
    const t = t0 => G.t(G.x(t0) + dx), v = v0 => G.v(G.y(v0) + dy);
    if ("v" in o) d.v = v(o.v);
    if ("t" in o) d.t = t(o.t);
    if ("stop" in o) d.stop = v(o.stop);
    if (o.p) d.p = o.p.map(c => ({t: t(c.t), v: v(c.v)}));
  }

  // no cursor, o canvas só pega o mouse em cima de um desenho; o resto (arrastar, zoom, mira) fica com o gráfico
  function pairar(Q, e) {
    if (ferramenta !== "cursor" || Q.arraste || !Q.cv || !Q.T.length) return;
    const r = Q.box.getBoundingClientRect(), h = alvoEm(Q, eixo(Q), {x: e.clientX - r.left, y: e.clientY - r.top});
    Q.cv.style.pointerEvents = h ? "auto" : "";
    Q.cv.style.cursor = h ? (h.alca ? "pointer" : "move") : "";
  }

  // seleciona o desenho sob o mouse e começa a arrastar (o canvas fica com o mouse até soltar)
  function pegar(Q, e) {
    if (!Q.cv || !Q.T.length || e.button !== 0) return false;
    const r = Q.cv.getBoundingClientRect(), p = {x: e.clientX - r.left, y: e.clientY - r.top}, h = alvoEm(Q, eixo(Q), p);
    if (!h) return false;
    e.preventDefault(); selecionarDesenho(Q, h.d);
    Q.arraste = {h, p, orig: JSON.parse(JSON.stringify(h.d)), mudou: false};
    Q.cv.style.pointerEvents = "auto"; Q.cv.style.cursor = h.alca ? "pointer" : "grabbing";
    Q.cv.setPointerCapture(e.pointerId);
    return true;
  }

  // ouvintes da caixa (uma vez: no ao vivo a caixa fica quando o gráfico é remontado)
  function ligarCaixa(Q) {
    if (Q.box.dataset.desenho) return;
    Q.box.dataset.desenho = "1";
    new ResizeObserver(() => redesenhar(Q)).observe(Q.box);
    for (const ev of ["pointermove", "wheel"]) Q.box.addEventListener(ev, e => { if (ev === "pointermove") pairar(Q, e); redesenhar(Q); },
                                                                     {passive: true, capture: true});
    // no cursor, apertar em cima de um desenho o pega (mesmo sem ter passado o mouse antes); fora dele, tira a seleção
    Q.box.addEventListener("pointerdown", e => {
      ultimo = Q;
      if (e.button === 1 && Q.cv && Q.T.length) {  // botão do meio (a roda) em cima de um desenho: apaga
        const r = Q.box.getBoundingClientRect(), h = alvoEm(Q, eixo(Q), {x: e.clientX - r.left, y: e.clientY - r.top});
        if (h) { e.preventDefault(); e.stopPropagation(); apagar(Q, h.d); }
        return;
      }
      if (e.target === Q.cv || e.target.closest(".d-barra, .d-texto")) return;
      if (ferramenta === "cursor" && pegar(Q, e)) return e.stopPropagation();
      if (sel) selecionarDesenho(null);
    }, true);
  }

  function prepararDesenho(Q) {
    const cv = document.createElement("canvas"); cv.className = "desenho"; Q.box.appendChild(cv); Q.cv = cv;
    const agendar = () => redesenhar(Q);
    Q.g.chart.timeScale().subscribeVisibleLogicalRangeChange(agendar);
    Q.g.chart.subscribeCrosshairMove(agendar);
    const ponto = e => { const r = cv.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
    const noGrafico = (G, {x, y}) => ({t: G.t(x), v: G.v(y)});
    let baixou = null;
    cv.addEventListener("pointerdown", e => {
      if (!Q.T.length || e.button !== 0 || Q.box.querySelector(".d-texto")) return;  // texto aberto: o clique fora confirma
      const G = eixo(Q), p = ponto(e), c = noGrafico(G, p);
      if (ferramenta === "cursor") return pegar(Q, e);
      if (ferramenta === "borracha") { const h = alvoEm(Q, G, p); if (h) { Q.alvo = null; apagar(Q, h.d); } return; }
      if (ferramenta === "texto" || ferramenta === "nota") { e.preventDefault(); return editarTexto(Q, null, c, p, ferramenta); }  // o clique não tira o foco da caixa
      if (UM_CLIQUE.includes(ferramenta))
        return criar(Q, ferramenta === "horizontal" ? {tipo: "horizontal", v: c.v} : ferramenta === "vertical" ? {tipo: "vertical", t: c.t}
                                                    : {tipo: ferramenta, p: [c]});
      if (ferramenta === "compra" || ferramenta === "venda") {  // stop a 40 px da entrada, alvo a 3 vezes o risco
        const lado = ferramenta === "compra" ? 1 : -1, stop = G.v(p.y + 40 * lado);
        return criar(Q, {tipo: ferramenta, p: [c, {t: G.t(p.x + 160), v: c.v + 3 * (c.v - stop)}], stop});
      }
      if (ferramenta === "pincel") { Q.rascunho = {tipo: "pincel", p: [c]}; Q.ultimo = p; return cv.setPointerCapture(e.pointerId); }
      if (Q.rascunho?.tipo === "sequencial") {  // cada clique fixa um ponto; clicar no último de novo termina
        const P = Q.rascunho.p, ant = P.at(-2);
        if (ant && Math.hypot(G.x(ant.t) - p.x, G.y(ant.v) - p.y) < 6) return terminarSequencial(Q);
        P[P.length - 1] = c; P.push({...c}); return redesenhar(Q);
      }
      if (ferramenta === "sequencial") { Q.rascunho = {tipo: "sequencial", p: [c, {...c}]}; return redesenhar(Q); }
      if (!Q.rascunho) { Q.rascunho = {tipo: ferramenta, p: [c, {...c}], esp: 2}; baixou = p; cv.setPointerCapture(e.pointerId); }
      else concluir(Q, c);
    });
    cv.addEventListener("pointermove", e => {
      if (!Q.T.length) return;
      const G = eixo(Q), p = ponto(e), A = Q.arraste;
      if (A) {
        if (!A.mudou && Math.hypot(p.x - A.p.x, p.y - A.p.y) < 3) return;
        if (!A.mudou) { lembrar(); A.mudou = true; }
        if (A.h.alca) A.h.alca.mover(noGrafico(G, p));
        else mover(A.h.d, A.orig, G, p.x - A.p.x, p.y - A.p.y);
        return qs.forEach(redesenhar);
      }
      if (Q.rascunho?.tipo === "pincel") {
        if (Math.hypot(p.x - Q.ultimo.x, p.y - Q.ultimo.y) > 2) { Q.rascunho.p.push(noGrafico(G, p)); Q.ultimo = p; }
      } else if (Q.rascunho) Q.rascunho.p[Q.rascunho.p.length - 1] = noGrafico(G, p);
      if (ferramenta === "borracha") Q.alvo = alvoEm(Q, G, p)?.d;
      redesenhar(Q);
    });
    cv.addEventListener("pointerup", e => {  // arrastou: termina ao soltar; só clicou: espera o segundo clique
      if (Q.arraste) { if (Q.arraste.mudou) guardarDesenhos(); Q.arraste = null; return pairar(Q, e); }
      const p = ponto(e);
      if (Q.rascunho?.tipo === "pincel") { const d = Q.rascunho; Q.rascunho = null; if (d.p.length > 1) criar(Q, d); else usar("cursor"); return; }
      if (Q.rascunho && baixou && Math.hypot(p.x - baixou.x, p.y - baixou.y) > 6) concluir(Q, noGrafico(eixo(Q), p));
      baixou = null;
    });
    cv.addEventListener("dblclick", e => {
      if (Q.rascunho?.tipo === "sequencial") return terminarSequencial(Q);
      const h = ferramenta === "cursor" && Q.T.length && alvoEm(Q, eixo(Q), ponto(e));
      if (h?.d.tipo === "texto" || h?.d.tipo === "nota") editarTexto(Q, h.d);
    });
  }
  function concluir(Q, c) {
    const d = Q.rascunho; d.p[1] = c; Q.rascunho = null; criar(Q, d);
  }
  // tira o ponto que segue o mouse e os repetidos (o duplo clique marca o mesmo ponto duas vezes)
  function terminarSequencial(Q) {
    const d = Q.rascunho, G = eixo(Q); Q.rascunho = null;
    const P = d.p.slice(0, -1).filter((c, i, l) => !i || Math.hypot(G.x(c.t) - G.x(l[i - 1].t), G.y(c.v) - G.y(l[i - 1].v)) > 3);
    if (P.length > 1) criar(Q, {...d, p: P}); else { usar("cursor"); redesenhar(Q); }
  }

  function redesenhar(Q) {
    if (Q.quadro || !Q.cv) return;
    Q.quadro = requestAnimationFrame(() => { Q.quadro = 0; pintar(Q); });
  }
  const duracao = s => {
    const m = Math.round(Math.abs(s) / 60), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
    return [d && d + "d", h && h + "h", (mi || !(d || h)) && mi + "min"].filter(Boolean).join(" ");
  };
  function pintar(Q) {
    const cv = Q.cv, w = Q.box.clientWidth, h = Q.box.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    if (!Q.T.length || !Q.g) return;
    const G = eixo(Q), up = css("--up"), dn = css("--dn"), fundo = css("--panel");
    const etiqueta = (txt, x, y, fundo) => {  // texto branco numa caixinha da cor do desenho
      const tw = g.measureText(txt).width + 10;
      g.fillStyle = fundo; g.fillRect(x, y - 9, tw, 18); g.fillStyle = "#fff"; g.fillText(txt, x + 5, y + 4);
    };
    g.save(); g.beginPath(); g.rect(0, 0, G.W, G.H); g.clip();
    g.font = "600 11px Segoe UI"; g.lineCap = g.lineJoin = "round";
    for (const d of [...(DESENHOS[Q.ativo] || []), Q.rascunho]) {
      const s = d && geo(d, G); if (!s) continue;
      const cor = d === Q.alvo ? "#ef5350" : corDe(d), [a, b] = (d.p || []).map(c => ({x: G.x(c.t), y: G.y(c.v)}));
      g.strokeStyle = g.fillStyle = cor; g.lineWidth = d.esp ?? 1.5; g.setLineDash(tracejado(d));
      for (const [x1, y1, x2, y2] of s.segs) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      if (d.tipo === "horizontal") etiqueta(fmtPreco(d.v, Q.ativo), G.W - g.measureText(fmtPreco(d.v, Q.ativo)).width - 10, s.segs[0][1], cor);
      if (d.tipo === "raioh") etiqueta(fmtPreco(d.p[0].v, Q.ativo), G.W - g.measureText(fmtPreco(d.p[0].v, Q.ativo)).width - 10, a.y, cor);
      if (d.tipo === "seta") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10 + g.lineWidth * 2;
        g.setLineDash([]); g.beginPath(); g.moveTo(b.x, b.y);
        for (const da of [-.45, .45]) g.lineTo(b.x - L * Math.cos(ang + da), b.y - L * Math.sin(ang + da));
        g.closePath(); g.fill();
      }
      if (d.tipo === "retangulo") {
        g.globalAlpha = .14; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); g.globalAlpha = 1;
        g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      }
      if (d.tipo === "fibonacci") {  // 0 no segundo ponto, 1 no primeiro, como no TradingView
        const [x1, , x2] = s.area;
        g.save(); g.setLineDash([4, 4]); g.globalAlpha = .6; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.restore();
        FIB.forEach((n, i) => {
          const v = d.p[1].v + (d.p[0].v - d.p[1].v) * n, y = G.y(v);
          if (i) { const y0 = G.y(d.p[1].v + (d.p[0].v - d.p[1].v) * FIB[i - 1]); g.globalAlpha = .06; g.fillRect(x1, y0, x2 - x1, y - y0); g.globalAlpha = 1; }
          g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke();
          const txt = `${n} (${fmtPreco(v, Q.ativo)})`;
          g.textAlign = "right"; g.fillText(txt, x1 - 4, y + 4); g.textAlign = "left";
        });
      }
      if (d.tipo === "medir") {  // verde subindo, vermelho caindo; variação, %, candles e tempo embaixo
        const dv = d.p[1].v - d.p[0].v, c2 = dv >= 0 ? up : dn, [x1, y1, x2, y2] = s.area;
        g.fillStyle = c2; g.strokeStyle = c2; g.globalAlpha = .16; g.fillRect(x1, y1, x2 - x1, y2 - y1); g.globalAlpha = 1;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        const l1 = `${dv >= 0 ? "+" : "−"}${fmtPreco(Math.abs(dv), Q.ativo)} (${(dv / d.p[0].v * 100).toLocaleString("pt-BR", {maximumFractionDigits: 2})}%)`;
        const l2 = `${Math.round(Math.abs(G.l(b.x) - G.l(a.x)))} candles · ${duracao(d.p[1].t - d.p[0].t)}`;
        const tw = Math.max(g.measureText(l1).width, g.measureText(l2).width) + 12, cx = (x1 + x2) / 2 - tw / 2, cy = y2 + 6;
        g.fillRect(cx, cy, tw, 34); g.fillStyle = "#fff"; g.fillText(l1, cx + 6, cy + 14); g.fillText(l2, cx + 6, cy + 28);
      }
      if (d.tipo === "texto") { g.font = FONTE; g.fillText(d.texto, a.x, a.y); g.font = "600 11px Segoe UI"; }
      if (d.tipo === "nota") {  // balão com fundo do painel, borda e texto na cor; ponto marcado na ponta da linha
        const [x1, y1, x2, y2] = s.area;
        g.setLineDash([]); g.beginPath(); g.arc(a.x, a.y, 3, 0, 2 * Math.PI); g.fill();
        g.fillStyle = fundo; g.globalAlpha = .92; g.beginPath(); g.roundRect(x1, y1, x2 - x1, y2 - y1, 6); g.fill(); g.globalAlpha = 1;
        g.lineWidth = 1.2; g.stroke(); g.fillStyle = cor; g.font = FONTE; g.fillText(d.texto, x1 + 10, y1 + 18); g.font = "600 11px Segoe UI";
      }
      if (d.tipo === "cima" || d.tipo === "baixo") {  // seta cheia com a ponta no ponto clicado
        const k = d.tipo === "cima" ? 1 : -1;
        g.setLineDash([]); g.beginPath(); g.moveTo(a.x, a.y);
        for (const [dx, dy] of [[8, 10], [3, 10], [3, 24], [-3, 24], [-3, 10], [-8, 10]]) g.lineTo(a.x + dx, a.y + dy * k);
        g.closePath(); g.fill();
      }
      if (d.tipo === "compra" || d.tipo === "venda") {  // verde até o alvo, vermelho até o stop; preços, pontos, % e risco:retorno
        const [x1, , x2] = s.area, e0 = d.p[0].v, alvo = d.p[1].v, ganho = Math.abs(alvo - e0), risco = Math.abs(e0 - d.stop);
        g.setLineDash([]);
        for (const [y, c2] of [[b.y, up], [s.yS, dn]]) { g.fillStyle = c2; g.globalAlpha = .18; g.fillRect(x1, a.y, x2 - x1, y - a.y); g.globalAlpha = 1; }
        g.strokeStyle = css("--txt"); g.lineWidth = 1; g.beginPath(); g.moveTo(x1, a.y); g.lineTo(x2, a.y); g.stroke();
        const n = x => `${fmtPreco(x, Q.ativo)}`, pc = x => (x / e0 * 100).toLocaleString("pt-BR", {maximumFractionDigits: 2});
        const meio = (x1 + x2) / 2, rotulo = (txt, y, c2) => { const w = g.measureText(txt).width + 10; etiqueta(txt, meio - w / 2, y, c2); };
        const fora = (y, lado) => y + 13 * lado;  // a etiqueta fica do lado de fora da zona
        const kA = Math.sign(b.y - a.y) || -1, kS = Math.sign(s.yS - a.y) || 1;
        rotulo(`Alvo ${n(alvo)} · ${n(ganho)} (${pc(ganho)}%)`, fora(b.y, kA), up);
        rotulo(`Stop ${n(d.stop)} · ${n(risco)} (${pc(risco)}%)`, fora(s.yS, kS), dn);
        rotulo(`${d.tipo === "compra" ? "Compra" : "Venda"} ${n(e0)} · R:R ${risco ? (ganho / risco).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "—"}`,
               a.y, css("--line2") || "#2a3542");
      }
      if (sel?.Q === Q && sel.d === d || d === Q.rascunho) {  // alças: bolinhas vazadas nas pontas e nos cantos
        g.setLineDash([]); g.lineWidth = 1.5; g.strokeStyle = cor; g.fillStyle = fundo;
        for (const p of s.alcas) { g.beginPath(); g.arc(p.x, p.y, 4.5, 0, 2 * Math.PI); g.fill(); g.stroke(); }
        if (d.tipo === "texto" || d.tipo === "cima" || d.tipo === "baixo") { g.strokeRect(...s.area.slice(0, 2), s.area[2] - s.area[0], s.area[3] - s.area[1]); }
      }
    }
    g.restore();
  }


  // O Lightweight Charts só avisa mudança de tempo: arrastar ou esticar o eixo de preço, a escala automática com um
  // candle novo... deixavam desenhos e zonas parados até a próxima mexida do mouse. A cada quadro, quem teve a escala
  // de preço ou de tempo mudada é repintado (vigiar devolve a função que para).
  const vigias = new Map();  // função de repintar -> {chart, serie, chave}
  function vigiar(chart, serie, fn) { vigias.set(fn, {chart, serie, chave: ""}); return () => vigias.delete(fn); }
  (function quadro() {
    for (const [fn, v] of vigias) {
      try {
        const r = v.chart.timeScale().getVisibleLogicalRange();
        const k = `${v.serie.priceToCoordinate(0)}|${v.serie.priceToCoordinate(1000)}|${r?.from}|${r?.to}|${v.chart.priceScale("right").width()}`;
        if (k !== v.chave) { v.chave = k; fn(); }
      } catch { vigias.delete(fn); }  // gráfico já removido
    }
    requestAnimationFrame(quadro);
  })();

  function registrar(Q) {
    Object.assign(Q, {rascunho: null, arraste: null, alvo: null});
    qs.add(Q); ligarCaixa(Q); prepararDesenho(Q); redesenhar(Q);
    Q.pararVigia = vigiar(Q.g.chart, Q.g.serie, () => redesenhar(Q));
  }
  function soltar(Q) {
    Q.pararVigia?.();
    if (sel?.Q === Q) selecionarDesenho(null);
    qs.delete(Q); Q.rascunho = Q.arraste = null;
    if (ultimo === Q) ultimo = null;
  }

  return {registrar, soltar, redesenhar, vigiar, botoes, botao, ICONE};
})();
