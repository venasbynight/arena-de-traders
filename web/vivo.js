// Ao vivo: os quatro ativos em gráfico puro de 5 min direto da fonte (MT5 ou Binance), via /api/aovivo. Só acompanha:
// sem ordens e sem estudos. Cada ativo pede de novo depois que a resposta anterior chega (bitcoin a cada 5 s, os do
// MT5 a cada 15 s) e só enquanto a tela ao vivo está aberta e visível. A lateral mostra os ativos e o placar da firma.
// Usa $, seg, esc, pct, brl, fmtPreco, ATIVOS, STATUS, CORES e graficoPuro da sala.js.
(() => {
  const ORDEM = ["WIN", "WDO", "EURUSD", "BTCUSDT"];
  const ESPERA = {BTCUSDT: 5000}, ESPERA_MT5 = 15000;
  const q = {};  // ativo -> {el, g, ks, hora, erro, ocupado, timer}
  let painel = null;
  const visivel = () => document.body.classList.contains("vivo") && !document.hidden;

  $("#vivo").innerHTML = ORDEM.map(a => `<section class="card quad" data-ativo="${a}">
    <div class="q-top"><b class="tk">${a}</b><span class="nm">${ATIVOS[a]}</span><span class="tf">5 min</span>
      <span class="px"></span><span class="var"></span><span class="estado mut">conectando…</span></div>
    <div class="grafico"></div></section>`).join("");
  for (const a of ORDEM) {
    const el = $(`#vivo .quad[data-ativo="${a}"]`), box = el.querySelector(".grafico");
    q[a] = {el, g: null};
    try { q[a].g = graficoPuro(box, a); }
    catch { box.innerHTML = `<div class="espera">a biblioteca de gráficos não carregou: confira a internet e recarregue a página</div>`; }
  }

  // preço, variação contra o fechamento do dia anterior e se o mercado está andando agora
  function resumo(a) {
    const ks = q[a].ks; if (!ks?.length) return null;
    const ult = ks.at(-1), dia = ult[0].slice(0, 10);
    const ref = ks.findLast(k => k[0].slice(0, 10) < dia)?.[4];
    return {preco: ult[4], variacao: ref ? (ult[4] / ref - 1) * 100 : null, ultimo: ult[0],
            aberto: q[a].hora && seg(q[a].hora) - seg(ult[0]) < 15 * 60};  // candle com menos de 15 min: mercado aberto
  }

  function desenhar(a) {
    const Q = q[a], r = resumo(a), top = Q.el.querySelector(".q-top");
    top.querySelector(".px").textContent = r ? fmtPreco(r.preco, a) : "";
    const v = top.querySelector(".var");
    v.className = "var " + (r?.variacao > 0 ? "up" : r?.variacao < 0 ? "dn" : "mut");
    v.textContent = r?.variacao == null ? "" : pct(r.variacao);
    const est = top.querySelector(".estado");
    if (Q.erro) { est.className = "estado warn"; est.textContent = Q.erro; est.title = Q.erro; }
    else if (r) {
      est.className = "estado " + (r.aberto ? "vivo" : "mut"); est.title = "";
      est.innerHTML = r.aberto ? `<i class="ponto"></i>ao vivo · ${Q.hora.slice(11, 19)}` : `mercado fechado · último ${hhmm(r.ultimo)} de ${ddmm(r.ultimo)}`;
    }
    lateral();
  }

  async function puxar(a) {
    const Q = q[a];
    if (Q.ocupado || !visivel()) return;  // escondida: para; o evento "modo" ou a volta da aba recomeça
    Q.ocupado = true; clearTimeout(Q.timer);
    try {
      const r = await fetch(`/api/aovivo?ativo=${a}`), d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || `o servidor respondeu ${r.status}`);
      Q.erro = null; Q.ks = d.candles; Q.hora = d.atualizado;
      Q.g?.dados(d.candles);
    } catch (e) {
      Q.erro = e instanceof TypeError ? "sem conexão com o servidor da arena" : e.message;
    } finally { Q.ocupado = false; }
    desenhar(a);
    Q.timer = setTimeout(() => puxar(a), ESPERA[a] ?? ESPERA_MT5);
  }
  const todos = () => ORDEM.forEach(puxar);
  document.addEventListener("modo", todos);
  document.addEventListener("visibilitychange", todos);

  // ---- lateral: ativos (preço ao vivo, ou o do cache enquanto ele não chega) e placar da firma
  function lateral() {
    $("#vivo-ativos").innerHTML = ORDEM.map(a => {
      const r = resumo(a), m = painel?.mercado.find(x => x.ativo === a);
      const preco = r?.preco ?? (m?.sem_dados ? null : m?.ultimo), v = r ? r.variacao : m?.variacao_pct;
      const t = m?.tendencia60, seta = {alta: "▲", baixa: "▼", indefinida: "◆"}[t] || "";
      return `<div class="va"><b class="tk">${a}</b><span class="nm">${ATIVOS[a]}</span>
        <span class="px">${preco == null ? "—" : fmtPreco(preco, a)}</span>
        <span class="var ${v > 0 ? "up" : v < 0 ? "dn" : "mut"}">${v == null ? "—" : pct(v)}</span>
        ${t ? `<span class="t60 ${esc(t)}" title="Tendência no gráfico de 60 min, pela regra da Sofia">${seta}</span>` : ""}</div>`;
    }).join("");
  }

  function placar() {
    $("#ciclo-vivo").textContent = painel.ciclo ? `· ${painel.ciclo.slice(8, 10)}/${painel.ciclo.slice(5, 7)}` : "· o gerente ainda não rodou";
    $("#vivo-placar").innerHTML = painel.traders.map((t, k) => `<div class="vp">
      <div class="quem"><span class="av" style="background:${CORES[k % CORES.length]}">${esc(t.nome[0])}</span>
        <span style="min-width:0"><b>${esc(t.nome)}</b><small>${esc(t.estilo)}</small></span></div>
      ${ORDEM.map(a => {
        const c = t.por_ativo[a]; if (!c) return "";
        const r = c.prova_resultado;
        return `<div class="vp-l"><span class="tk">${a}</span><span class="chip ${esc(c.status)}">${STATUS[c.status] || esc(c.status)}</span>
          <span class="res ${r > 0 ? "up" : r < 0 ? "dn" : "mut"}">${r == null ? "" : brl(Math.round(r))}</span></div>`;
      }).join("")}</div>`).join("");
  }

  document.addEventListener("painel", e => { painel = e.detail; placar(); lateral(); });
  lateral();
  todos();
})();
