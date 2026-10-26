// Tela de resultado do backtest: ranking, destaques, curva de capital e operações de cada trader.
(() => {
  const CORES = ["#4c8dff", "#c084fc", "#26a69a", "#f0b429", "#ef5350", "#5ad1e6"];
  const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", {maximumFractionDigits: 2});
  const pct = v => Math.round(v * 100) + "%";
  const data = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  const seg = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
  const el = document.querySelector("#resultado");

  function mostrar() {
    const d = window.arena.dados; if (!d) return;
    const dias = window.arena.dias;
    const ts = Object.entries(d.traders).map(([nome, t], k) => ({nome, ...t, cor: CORES[k % CORES.length]}))
      .sort((a, b) => b.placar.resultado - a.placar.resultado);
    const total = ts.reduce((s, t) => s + t.placar.trades, 0);
    const ganhouNoDia = (t, dia) => t.operacoes.filter(o => o.entrada_t.startsWith(dia)).reduce((s, o) => s + o.resultado_rs, 0) > 0;
    const todosGanharam = dias.filter(dia => ts.every(t => ganhouNoDia(t, dia))).length;
    const melhor = ts[0], pior = ts[ts.length - 1];

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap">
        <h1 style="font-size:22px">Resultado do backtest</h1>
        <span class="mut">${d.ativo} · ${data(dias[0])} a ${data(dias[dias.length - 1])} · ${dias.length} pregões · ${ts.length} trader(s) · R$ 5.000 cada</span>
        <div style="margin-left:auto;display:flex;gap:10px;align-items:center">
          <select id="dia-replay" class="btn">${dias.map(x => `<option value="${x}">${data(x)}</option>`).join("")}</select>
          <button class="btn" id="ver-dia">Ver replay do dia</button>
          <button class="btn prim" id="outro">Rodar outro período</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0">
        ${[["Melhor trader", `${melhor.nome} · ${brl(melhor.placar.resultado)}`, melhor.placar.resultado >= 0 ? "up" : "dn"],
           ["Pior trader", `${pior.nome} · ${brl(pior.placar.resultado)}`, pior.placar.resultado >= 0 ? "up" : "dn"],
           ["Total de operações", total, ""], ["Dias em que todos ganharam", `${todosGanharam} de ${dias.length}`, ""]]
          .map(([r, v, c]) => `<div class="card"><small class="mut">${r}</small><b class="${c}" style="font-size:20px;margin-top:4px">${v}</b></div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px">
        <section class="card">
          <h3><span>Ranking final</span></h3>
          <table><tr><th>#</th><th>Trader</th><th>Resultado</th><th>Trades</th><th>Acerto</th><th>Fator lucro</th><th>Drawdown</th><th>Pior dia</th><th>Confiança</th></tr>
          ${ts.map((t, k) => { const p = t.placar; return `<tr class="linha-trader" data-nome="${t.nome}" style="cursor:pointer">
            <td>${k + 1}</td><td style="text-align:left"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.cor};margin-right:8px"></span>${t.nome}</td>
            <td class="${p.resultado >= 0 ? "up" : "dn"}">${brl(p.resultado)}</td><td>${p.trades}</td><td>${pct(p.acerto)}</td>
            <td>${p.fator_lucro == null ? "–" : p.fator_lucro.toLocaleString("pt-BR")}</td><td class="dn">${brl(p.drawdown)}</td>
            <td class="${p.pior_dia < 0 ? "dn" : ""}">${brl(p.pior_dia)}</td><td class="${p.confianca === "baixa" ? "warn" : ""}">${p.confianca}</td></tr>`; }).join("")}
          </table>
          <p class="mut" style="font-size:12px;margin-top:12px;line-height:1.6">Resultados já descontam custos e 1 tick de derrapagem nos stops.<br>
          "Confiança" sobe com o número de operações: com menos de 50 trades, o resultado pode ser sorte.<br>
          Clique num trader para ver as operações dele.</p>
          <div id="ops"></div>
        </section>
        <section class="card" style="min-height:420px;display:flex;flex-direction:column">
          <h3><span>Curva de capital de cada trader (R$)</span></h3>
          <div id="curva" style="flex:1;min-height:380px"></div>
        </section>
      </div>`;
    el.style.display = "block";

    const ch = LightweightCharts.createChart(el.querySelector("#curva"), {autoSize: true,
      layout: {background: {color: "transparent"}, textColor: "#8b98a5"},
      grid: {vertLines: {color: "#18212c"}, horzLines: {color: "#18212c"}}, timeScale: {borderColor: "#1f2a36"}});
    for (const t of ts) {
      const s = ch.addLineSeries({color: t.cor, lineWidth: 2, title: t.nome});
      s.setData(t.equity.map(([iso, saldo]) => ({time: seg(iso), value: saldo})));
    }
    ch.timeScale().fitContent();

    el.querySelectorAll(".linha-trader").forEach(tr => tr.onclick = () => operacoes(ts.find(t => t.nome === tr.dataset.nome)));
    el.querySelector("#outro").onclick = () => { el.style.display = "none"; };
    el.querySelector("#ver-dia").onclick = () => {
      const dia = el.querySelector("#dia-replay").value;
      el.style.display = "none";
      window.arena.irPara(window.arena.inicioDoDia(dia));
    };
  }

  function operacoes(t) {
    const hh = iso => iso.slice(11, 16);
    el.querySelector("#ops").innerHTML = `<h3 style="margin-top:14px"><span>Operações · ${t.nome}</span><span>${t.operacoes.length}</span></h3>
      <div style="max-height:260px;overflow:auto"><table><tr><th>Dia</th><th>Lado</th><th>Contratos</th><th>Entrada</th><th>Saída</th><th>Motivo</th><th>Resultado</th></tr>
      ${t.operacoes.map(o => `<tr><td>${data(o.entrada_t)} ${hh(o.entrada_t)}</td><td>${o.lado}</td><td>${o.contratos}</td>
        <td>${o.entrada.toLocaleString("pt-BR")}</td><td>${o.saida.toLocaleString("pt-BR")} <span class="mut">${hh(o.saida_t)}</span></td>
        <td>${o.motivo_saida}</td><td class="${o.resultado_rs >= 0 ? "up" : "dn"}">${brl(o.resultado_rs)}</td></tr>`).join("")}</table></div>`;
  }

  window.arena.mostrarResultado = mostrar;
})();
