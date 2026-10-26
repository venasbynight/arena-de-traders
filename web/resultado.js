// Relatório do backtest: resumo geral, ranking, curva de capital e um cartão por trader · ativo dos gráficos visíveis.
// Usa de sala.js: slots, btLayout e esc. Cores só do tema (variáveis CSS do estilo.css).
(() => {
  const CORES = ["--acc", "--brand", "--warn", "--brand2", "--up", "--dn", "--txt", "--mut"];
  const MOTIVOS = {stop: "bateu no stop", alvo: "bateu no alvo", sinal: "sinal do robô", zeragem: "zerou no fim do pregão",
                   tempo: "tempo esgotado", "fim dos dados": "fim do período"};
  const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", {maximumFractionDigits: 2});
  const pct = v => Math.round(v * 100) + "%";
  const num = v => v == null ? "–" : v.toLocaleString("pt-BR", {maximumFractionDigits: 2});
  const cls = v => v > 0 ? "up" : v < 0 ? "dn" : "";
  const data = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  const seg = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
  const soma = a => a.reduce((s, v) => s + v, 0);
  const media = a => a.length ? soma(a) / a.length : null;
  const duracao = m => m == null ? "–" : m < 1 ? "menos de 1 min" : m < 60 ? Math.round(m) + " min"
    : Math.floor(m / 60) + " h " + Math.round(m % 60) + " min";
  const el = document.querySelector("#resultado");
  let grafico = null;

  // números de um trader · ativo a partir das operações dele
  function estat(t, dias) {
    const ops = [...t.operacoes].sort((a, b) => a.saida_t < b.saida_t ? -1 : 1), r = ops.map(o => o.resultado_rs);
    const ganhos = r.filter(v => v > 0), perdas = r.filter(v => v < 0);
    let seq = 0, maxSeq = 0;
    for (const v of r) { seq = v < 0 ? seq + 1 : 0; maxSeq = Math.max(maxSeq, seq); }
    const lado = l => { const x = ops.filter(o => o.lado === l); return {n: x.length, rs: soma(x.map(o => o.resultado_rs))}; };
    const motivos = {};
    for (const o of ops) motivos[o.motivo_saida] = (motivos[o.motivo_saida] || 0) + 1;
    const gm = media(ganhos), pm = media(perdas);
    return {ops, ganhos, perdas, gm, pm, payoff: gm != null && pm != null ? gm / -pm : null,
      maior: ganhos.length ? Math.max(...ganhos) : null, menor: perdas.length ? Math.min(...perdas) : null, maxSeq,
      minutos: media(ops.map(o => (Date.parse(o.saida_t) - Date.parse(o.entrada_t)) / 60000)),
      compra: lado("compra"), venda: lado("venda"), motivos,
      porDia: dias.map(d => soma(ops.filter(o => o.saida_t.startsWith(d)).map(o => o.resultado_rs)))};
  }

  // mini gráfico de barras do resultado de cada dia (verde ganhou, vermelho perdeu)
  function barras(porDia, dias) {
    const max = Math.max(1, ...porDia.map(Math.abs)), w = 100 / dias.length;
    return `<svg viewBox="0 0 100 40" preserveAspectRatio="none"><line x1="0" x2="100" y1="20" y2="20"/>
      ${porDia.map((v, i) => { const h = Math.abs(v) / max * 19;
        return `<rect class="${cls(v)}" x="${i * w + w * .15}" width="${w * .7}" y="${v >= 0 ? 20 - h : 20}" height="${Math.max(h, .4)}">
          <title>${data(dias[i])}: ${brl(v)}</title></rect>`; }).join("")}</svg>
      <div class="rel-eixo mut"><span>${data(dias[0]).slice(0, 5)}</span><span>${data(dias[dias.length - 1]).slice(0, 5)}</span></div>`;
  }

  function cartao(t, k) {
    const p = t.placar, e = t.e;
    const linhas = [
      ["Operações", p.trades], ["Acerto", pct(p.acerto)],
      ["Ganho médio", e.gm == null ? "–" : brl(e.gm), "up"], ["Perda média", e.pm == null ? "–" : brl(e.pm), "dn"],
      ["Payoff", num(e.payoff), "", "quantas perdas médias um ganho médio paga"],
      ["Tempo médio na operação", duracao(e.minutos)],
      ["Maior ganho", e.maior == null ? "–" : brl(e.maior), "up"], ["Maior perda", e.menor == null ? "–" : brl(e.menor), "dn"],
      ["Maior sequência de perdas", e.maxSeq + (e.maxSeq === 1 ? " seguida" : " seguidas")],
      ["Compras", `${e.compra.n} · <span class="${cls(e.compra.rs)}">${brl(e.compra.rs)}</span>`],
      ["Vendas", `${e.venda.n} · <span class="${cls(e.venda.rs)}">${brl(e.venda.rs)}</span>`]];
    const saidas = Object.entries(e.motivos).sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `<span>${esc(MOTIVOS[m] || m)}: <b>${n}</b></span>`).join("") || `<span class="mut">nenhuma operação</span>`;
    return `<article class="card rel-trader" data-k="${k}" tabindex="0" title="Clique para ver as operações">
      <div class="rel-tt"><span class="rel-bola" style="background:var(${t.cor})"></span><b>${esc(t.nome)}</b>
        <b class="rel-rs ${cls(p.resultado)}">${brl(p.resultado)}</b></div>
      <dl class="rel-num">${linhas.map(([r, v, c = "", dica]) => `<dt${dica ? ` title="${dica}"` : ""}>${r}</dt><dd class="${c}">${v}</dd>`).join("")}</dl>
      <div><small class="mut">Como saiu das operações</small><div class="rel-chips">${saidas}</div></div>
      <div class="rel-dias"><small class="mut">Resultado de cada dia</small>${barras(e.porDia, window.arena.dias)}</div>
    </article>`;
  }

  function mostrar() {
    const d = window.arena.dados; if (!d) return;
    const dias = window.arena.dias;
    // só os pares dos gráficos que estão na tela, sem repetir
    const vis = [...new Set(slots.slice(0, btLayout).map(([n, a]) => `${n} · ${a}`))].filter(k => d.traders[k]);
    const ts = vis.map((nome, k) => ({nome, ...d.traders[nome], cor: CORES[k % CORES.length]}))
      .sort((a, b) => b.placar.resultado - a.placar.resultado);
    ts.forEach(t => t.e = estat(t, dias));
    const ativos = [...new Set(vis.map(k => k.split(" · ")[1]))].join(", ") || d.ativo;

    const todas = ts.flatMap(t => t.e.ops.map(o => o.resultado_rs)), ganhos = soma(todas.filter(v => v > 0)), perdas = soma(todas.filter(v => v < 0));
    const total = soma(ts.map(t => t.placar.resultado));
    const dd = ts.reduce((m, t) => !m || t.placar.drawdown < m.placar.drawdown ? t : m, null);
    const positivos = dias.filter((_, i) => soma(ts.map(t => t.e.porDia[i])) > 0).length;
    const resumo = [
      ["Resultado total", brl(total), cls(total), `soma dos ${ts.length} trader(s), já sem custos`],
      ["Operações", todas.length, "", `${(todas.length / Math.max(1, dias.length)).toLocaleString("pt-BR", {maximumFractionDigits: 1})} por dia`],
      ["Acerto", todas.length ? pct(todas.filter(v => v > 0).length / todas.length) : "–", "", "operações que deram lucro"],
      ["Fator de lucro", perdas ? num(ganhos / -perdas) : ganhos ? "sem perdas" : "–", "", "ganhos ÷ perdas; acima de 1 é lucro"],
      ["Maior drawdown", dd ? brl(dd.placar.drawdown) : "–", dd && dd.placar.drawdown < 0 ? "dn" : "", dd ? `maior queda, ${esc(dd.nome)}` : ""],
      ["Dias no positivo", `${positivos} de ${dias.length}`, "", "dias em que a soma fechou no lucro"]];

    el.innerHTML = `
      <div class="rel-topo">
        <div><h1>Relatório do backtest</h1>
          <p class="mut">${data(dias[0])} a ${data(dias[dias.length - 1])} · ${esc(ativos)} · ${dias.length} pregões · ${ts.length} trader(s) · R$ 5.000 cada</p></div>
        <div class="rel-acoes">
          <select id="dia-replay" class="btn">${dias.map(x => `<option value="${x}">${data(x)}</option>`).join("")}</select>
          <button class="btn" id="ver-dia">Ver replay do dia</button>
          <button class="btn" id="imprimir">Imprimir / PDF</button>
          <button class="btn prim" id="outro">Rodar outro período</button>
        </div>
      </div>
      ${ts.length ? `
      <div class="rel-resumo">${resumo.map(([r, v, c, dica]) =>
        `<div class="card"><small class="mut">${r}</small><b class="${c}">${v}</b><small class="mut">${dica}</small></div>`).join("")}</div>
      <p class="mut rel-nota">Resultados já descontam custos e 1 tick de derrapagem nos stops.
        "Confiança" sobe com o número de operações: com menos de 50, o resultado pode ser sorte.</p>
      <div class="rel-meio">
        <section class="card">
          <h3><span>Ranking final</span></h3>
          <table><tr><th>#</th><th>Trader</th><th>Resultado</th><th>Trades</th><th>Acerto</th><th>Fator lucro</th><th>Drawdown</th><th>Pior dia</th><th>Confiança</th></tr>
          ${ts.map((t, k) => { const p = t.placar; return `<tr class="linha-trader" data-k="${k}">
            <td>${k + 1}</td><td style="text-align:left"><span class="rel-bola" style="background:var(${t.cor})"></span>${esc(t.nome)}</td>
            <td class="${cls(p.resultado)}">${brl(p.resultado)}</td><td>${p.trades}</td><td>${pct(p.acerto)}</td>
            <td>${num(p.fator_lucro)}</td><td class="dn">${brl(p.drawdown)}</td>
            <td class="${p.pior_dia < 0 ? "dn" : ""}">${brl(p.pior_dia)}</td><td class="${p.confianca === "baixa" ? "warn" : ""}">${p.confianca}</td></tr>`; }).join("")}
          </table>
        </section>
        <section class="card rel-cc">
          <h3><span>Curva de capital de cada trader (R$)</span></h3>
          <div id="curva"></div>
        </section>
      </div>
      <h2 class="rel-h2">Trader por trader <small class="mut">clique num cartão para ver as operações</small></h2>
      <div class="rel-traders">${ts.map(cartao).join("")}</div>
      <section class="card rel-ops" id="ops" hidden></section>`
      : `<p class="mut">Nenhum gráfico na tela tem resultado neste período.</p>`}`;
    el.classList.add("aberto");

    grafico?.remove(); grafico = null;
    if (ts.length) {
      const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
      grafico = LightweightCharts.createChart(el.querySelector("#curva"), {autoSize: true,
        layout: {background: {color: "transparent"}, textColor: v("--mut")},
        grid: {vertLines: {visible: false}, horzLines: {visible: false}},
        timeScale: {borderColor: v("--line")}, rightPriceScale: {borderColor: v("--line")}});
      for (const t of ts) grafico.addLineSeries({color: v(t.cor), lineWidth: 2, title: t.nome})
        .setData(t.equity.map(([iso, saldo]) => ({time: seg(iso), value: saldo})));
      grafico.timeScale().fitContent();
    }

    el.querySelectorAll(".linha-trader, .rel-trader").forEach(x => {
      x.onclick = () => operacoes(ts[x.dataset.k], +x.dataset.k);
      x.onkeydown = ev => { if (ev.key === "Enter") x.onclick(); };
    });
    el.querySelector("#imprimir").onclick = () => window.print();
    el.querySelector("#outro").onclick = () => el.classList.remove("aberto");
    el.querySelector("#ver-dia").onclick = () => {
      const dia = el.querySelector("#dia-replay").value;
      el.classList.remove("aberto");
      window.arena.irPara(window.arena.inicioDoDia(dia));
    };
  }

  function operacoes(t, k) {
    const hh = iso => iso.slice(11, 16), ops = el.querySelector("#ops");
    el.querySelectorAll(".rel-trader").forEach(c => c.classList.toggle("sel", +c.dataset.k === k));
    ops.hidden = false;
    ops.innerHTML = `<h3><span>Operações · ${esc(t.nome)}</span><span>${t.operacoes.length}</span></h3>
      <div class="rel-tabela"><table><tr><th>Dia</th><th>Lado</th><th>Contratos</th><th>Entrada</th><th>Saída</th><th>Motivo</th><th>Resultado</th></tr>
      ${t.operacoes.map(o => `<tr><td>${data(o.entrada_t)} ${hh(o.entrada_t)}</td><td>${o.lado}</td><td>${o.contratos}</td>
        <td>${o.entrada.toLocaleString("pt-BR")}</td><td>${o.saida.toLocaleString("pt-BR")} <span class="mut">${hh(o.saida_t)}</span></td>
        <td>${esc(MOTIVOS[o.motivo_saida] || o.motivo_saida)}</td><td class="${cls(o.resultado_rs)}">${brl(o.resultado_rs)}</td></tr>`).join("")
        || `<tr><td colspan="7" class="mut">Nenhuma operação no período.</td></tr>`}</table></div>`;
    ops.scrollIntoView({behavior: "smooth", block: "nearest"});
  }

  window.arena.mostrarResultado = mostrar;
})();
