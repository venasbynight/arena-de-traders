// Firma 3D: o escritório da arena no estilo The Sims — uma sala por operacional (dois bonecos cada: Brasil e
// Global), a Sala da Demo, o Laboratório, o hall do gerente e a Diretoria. Tudo procedural (caixas e cilindros)
// e texturas desenhadas em canvas.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = s => document.querySelector(s);
const GRAU = Math.PI / 180;

// ---------------------------------------------------------------- planta
// metros; y para cima, norte = -z. w = largura em x, d = profundidade em z.
export const PLANTA = {
  altura: 2.8, espessura: 0.2, porta: 1.2, janela: 1.4,
  corte: 1.0,  // altura das "paredes baixas" na câmera de cima
  hall: { nome: "Hall", x: 0, z: 0, w: 12, d: 8 },
  salas: {
    SOFIA:     { nome: "Sala da Sofia", x: -4, z: -7, w: 8, d: 6, porta: [-2, -4], cor: "#5b8bd9" },
    DIDI:      { nome: "Sala do Didi",  x: 4,  z: -7, w: 8, d: 6, porta: [2, -4],  cor: "#4fae7b" },
    CAIO:      { nome: "Sala do Caio",  x: -4, z: 7,  w: 8, d: 6, porta: [-2, 4],  cor: "#8f6fd6" },
    DEMO:      { nome: "Sala da Demo",  x: 4,  z: 7,  w: 8, d: 6, porta: [2, 4],   cor: "#e39a3b" },
    DIRETORIA: { nome: "Diretoria",   x: 10, z: 0,  w: 8, d: 6, porta: [6, 0],   cor: "#a24d5e" },
    // ala oeste: descanso (noroeste), corredor (liga a entrada ao hall) e o Laboratório (sudoeste)
    DESCANSO:  { nome: "Descanso e jogos", x: -12, z: -7, w: 8, d: 6, porta: [-12, -4], cor: "#2fa3a0", piso: "taco" },
    CORREDOR:  { nome: "Corredor",    x: -11, z: 0,  w: 10, d: 8, porta: [-6, 0], cor: "#9aa5b1", piso: "porcelanato" },
    LAB:       { nome: "Laboratório", x: -12, z: 7, w: 8, d: 6, porta: [-12, 4], cor: "#cf6a87" },
  },
};
// Os operacionais e os dois bonecos de cada um: "Sofia · Brasil" (B3: WDO, WIN, ações) e "Sofia · Global" (forex,
// cripto). Mesmo rosto e cabelo; a roupa em dois tons. O trader do estado ("Sofia SMC") acha o seu pelo primeiro nome.
const OPERACIONAIS = {
  SOFIA: { nome: "Sofia", pele: "#f1c7a5", cabelo: "#3b2a20", corte: "longo", roupa: { Brasil: ["#c2456b", "#2d3440"], Global: ["#f08fb0", "#3d4a5c"] } },
  DIDI:  { nome: "Didi",  pele: "#c98e63", cabelo: "#1d1712", corte: "curto", roupa: { Brasil: ["#3f6fd1", "#4a3b2c"], Global: ["#8fb4f5", "#3a4a40"] } },
  CAIO:  { nome: "Caio",  pele: "#8d5a3b", cabelo: "#121010", corte: "curto", roupa: { Brasil: ["#d9822b", "#2e2a3a"], Global: ["#f2c46d", "#3a3550"] } },
};
const OPS = Object.keys(OPERACIONAIS), GRUPOS_FIRMA = ["Brasil", "Global"];
const opDoTrader = nome => OPS.find(k => OPERACIONAIS[k].nome.toLowerCase() === String(nome ?? "").split(" ")[0].toLowerCase());
// espelho de traders.GRUPOS (Python) para quando /api/firma ainda não traz `grupos`; fora do Brasil é Global
const GRUPOS_PADRAO = { Brasil: ["WDO", "WIN", "PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3", "RENT3", "EQTL3"] };
const grupoDo = ativo => ((Array.isArray(firma.estado?.grupos?.Brasil) ? firma.estado.grupos.Brasil : GRUPOS_PADRAO.Brasil).includes(ativo) ? "Brasil" : "Global");
// as duas telas de cada mesa: Brasil = futuros | ações, Global = forex | cripto
const TELAS_GRUPO = { Brasil: ["B3 · futuros", "B3 · ações"], Global: ["Forex", "Cripto"] };
const telaDoAtivo = ativo => grupoDo(ativo) === "Brasil" ? (["WDO", "WIN"].includes(ativo) ? 0 : 1) : (/USDT?$/.test(ativo) && !/^[A-Z]{6}$/.test(ativo) ? 1 : 0);
const SALAS_OP = [...OPS, "DEMO", "LAB"];   // salas com mesas e quadro de status

// paredes pela linha de centro; ext = normal da face externa (null = parede interna).
// aberturas: j = janela, p = porta aberta, e = porta de entrada (fechada); número = centro ao longo da parede
const j = em => ({ tipo: "janela", em }), p = em => ({ tipo: "porta", em }), e = em => ({ tipo: "entrada", em });
const PAREDES = [
  { de: [-16, -10], ate: [8, -10], ext: [0, -1], ab: [j(-14), j(-10), j(-6), j(-2), j(2), j(6)] },
  { de: [-16, 10], ate: [8, 10], ext: [0, 1], ab: [j(-14), j(-10), j(-6), j(-2), j(2), j(6)] },
  { de: [-16, -10], ate: [-16, 10], ext: [-1, 0], ab: [j(-7), j(-2.5), e(0), j(2.5), j(7)] },   // fachada oeste com a entrada
  { de: [-8, -10], ate: [-8, -4] },
  { de: [8, -10], ate: [8, -4], ext: [1, 0], ab: [j(-7)] },
  { de: [-8, 4], ate: [-8, 10] },
  { de: [8, 4], ate: [8, 10], ext: [1, 0], ab: [j(7)] },
  { de: [0, -10], ate: [0, -4] },
  { de: [0, 4], ate: [0, 10] },
  { de: [-16, -4], ate: [-6, -4], ab: [p(-12)] },
  { de: [-6, -4], ate: [6, -4], ab: [p(-2), p(2)] },
  { de: [6, -4], ate: [8, -4], ext: [0, 1] },
  { de: [-16, 4], ate: [-6, 4], ab: [p(-12)] },
  { de: [-6, 4], ate: [6, 4], ab: [p(-2), p(2)] },
  { de: [6, 4], ate: [8, 4], ext: [0, -1] },
  { de: [-6, -4], ate: [-6, 4], ab: [j(-2.5), p(0), j(2.5)] },   // hall ↔ corredor (vidros internos)
  { de: [6, -4], ate: [6, -3], ext: [1, 0] },
  { de: [6, -3], ate: [6, 3], ab: [p(0)] },
  { de: [6, 3], ate: [6, 4], ext: [1, 0] },
  { de: [6, -3], ate: [14, -3], ext: [0, -1], ab: [j(8.4)] },
  { de: [6, 3], ate: [14, 3], ext: [0, 1], ab: [j(10)] },
  { de: [14, -3], ate: [14, 3], ext: [1, 0], ab: [j(0)] },
];

// AABB das paredes para a colisão da primeira pessoa (Task 6): {min:[x,y,z], max:[x,y,z]}
export const COLISORES = [];
// a parede que passa por (x, z) é fachada (tem face externa)?
const fachadaEm = (x, z) => PAREDES.some(p => p.ext &&
  Math.min(p.de[0], p.ate[0]) <= x && x <= Math.max(p.de[0], p.ate[0]) && Math.min(p.de[1], p.ate[1]) <= z && z <= Math.max(p.de[1], p.ate[1]));

// Vagas nomeadas para os bonecos (Task 3), no mundo: pos = [x, z], rot = giro em y (0 = olhando +z).
// VAGAS_DESCANSO: {tipo: "sofa"|"cafe"|"refri"|"pebolim"|"pufe", pos, rot, pose: "sentado"|"em_pe"}
// VAGAS_CONVERSA: pares [a, b] frente a frente no corredor, cada um {pos, rot}
export const VAGAS_DESCANSO = [], VAGAS_CONVERSA = [];

// ---------------------------------------------------------------- renderer, cena e luz
const recipiente = $("#cena");
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
recipiente.appendChild(renderer.domElement);
const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

export const cena = new THREE.Scene();
cena.fog = new THREE.Fog("#cfe3ee", 70, 160);

export const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);

cena.add(new THREE.HemisphereLight("#fff3e0", "#7a6a55", 1.5));
const sol = new THREE.DirectionalLight("#ffe6c4", 2.6);
sol.position.set(-18, 26, 16);
sol.target.position.set(-1, 0, 0);
sol.castShadow = true;
sol.shadow.mapSize.set(4096, 4096);
Object.assign(sol.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 });   // prédio, café e praça
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.02;
cena.add(sol, sol.target);

// ---------------------------------------------------------------- texturas em canvas
let semente = 7;
const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);  // determinístico: capturas estáveis

function canvasTex(w, h, desenhar, repetir = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  desenhar(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function ruido(g, w, h, forca) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * forca;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

const texMadeira = canvasTex(512, 512, (g, w, h) => {
  const linhas = 8, alt = h / linhas;
  for (let i = 0; i < linhas; i++) {
    let x = -rnd() * 220;
    while (x < w) {
      const len = 170 + rnd() * 200;
      g.fillStyle = `hsl(${27 + rnd() * 6}, ${42 + rnd() * 10}%, ${46 + rnd() * 10}%)`;
      g.fillRect(x, i * alt, len, alt);
      g.strokeStyle = "rgba(90,50,25,.16)";
      for (let k = 0; k < 6; k++) {
        const y = i * alt + 4 + rnd() * (alt - 8);
        g.beginPath(); g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + rnd() * 8 - 4, x + len * 0.7, y + rnd() * 8 - 4, x + len, y);
        g.stroke();
      }
      g.fillStyle = "rgba(70,40,20,.5)"; g.fillRect(x, i * alt, 2, alt);
      x += len;
    }
    g.fillStyle = "rgba(70,40,20,.45)"; g.fillRect(0, i * alt, w, 2);
  }
  ruido(g, w, h, 10);
}, true);

// carpete em placas de 50 cm com o pelo alternando de direção (padrão de escritório)
function texCarpete(cor) {
  return canvasTex(256, 256, (g, w, h) => {
    const n = 4, t = w / n;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      g.fillStyle = cor; g.fillRect(a * t, b * t, t, t);
      g.fillStyle = (a + b) % 2 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)";
      g.fillRect(a * t, b * t, t, t);
      g.strokeStyle = "rgba(0,0,0,.06)";
      for (let k = 2; k < t; k += 4) {
        g.beginPath();
        if ((a + b) % 2) { g.moveTo(a * t + k, b * t); g.lineTo(a * t + k, b * t + t); }
        else { g.moveTo(a * t, b * t + k); g.lineTo(a * t + t, b * t + k); }
        g.stroke();
      }
    }
    g.strokeStyle = "rgba(0,0,0,.12)";
    for (let k = 0; k <= n; k++) { g.strokeRect(0, k * t, w, 0.5); g.strokeRect(k * t, 0, 0.5, h); }
    ruido(g, w, h, 22);
  }, true);
}

const texParede = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#f1ebe1"; g.fillRect(0, 0, w, h);
  ruido(g, w, h, 9);
}, true);

const texGrama = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = "#5e9b43"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w, y = rnd() * h;
    g.strokeStyle = `hsl(${88 + rnd() * 25}, ${40 + rnd() * 20}%, ${28 + rnd() * 22}%)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 3 - 1.5, y - 3 - rnd() * 5); g.stroke();
  }
}, true);

const texCalcada = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#b9b2a6"; g.fillRect(0, 0, w, h);
  const t = 64;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    g.fillStyle = `hsl(36, 10%, ${68 + rnd() * 8}%)`;
    g.fillRect(a * t + 2 + (b % 2) * 0, b * t + 2, t - 4, t - 4);
  }
  ruido(g, w, h, 14);
}, true);

const texTapete = canvasTex(512, 340, (g, w, h) => {
  g.fillStyle = "#8a3b3b"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#e9d8b4"; g.lineWidth = 10; g.strokeRect(22, 22, w - 44, h - 44);
  g.lineWidth = 3; g.strokeRect(42, 42, w - 84, h - 84);
  g.fillStyle = "#c78a4a";
  for (let k = 0; k < 5; k++) {
    g.beginPath(); g.ellipse(w / 2, h / 2, 150 - k * 28, 90 - k * 17, 0, 0, 7); g.globalAlpha = 0.25 + k * 0.12; g.fill();
  }
  g.globalAlpha = 1;
  ruido(g, w, h, 18);
});

// taco de madeira (blocos de 4 réguas alternando a direção): piso da sala de descanso
const texTaco = canvasTex(512, 512, (g, w, h) => {
  const B = 128, n = 4, t = B / n;
  for (let a = 0; a < w / B; a++) for (let b = 0; b < h / B; b++) for (let k = 0; k < n; k++) {
    const deitado = (a + b) % 2 === 0;
    const [x, y, bw, bh] = deitado ? [a * B, b * B + k * t, B, t] : [a * B + k * t, b * B, t, B];
    g.fillStyle = `hsl(${28 + rnd() * 8}, ${40 + rnd() * 12}%, ${44 + rnd() * 12}%)`;
    g.fillRect(x, y, bw, bh);
    g.strokeStyle = "rgba(90,50,25,.14)";
    for (let v = 0; v < 3; v++) {
      const o = 5 + rnd() * (t - 10);
      g.beginPath();
      if (deitado) { g.moveTo(x, y + o); g.bezierCurveTo(x + 40, y + o + rnd() * 6 - 3, x + 90, y + o + rnd() * 6 - 3, x + B, y + o); }
      else { g.moveTo(x + o, y); g.bezierCurveTo(x + o + rnd() * 6 - 3, y + 40, x + o + rnd() * 6 - 3, y + 90, x + o, y + B); }
      g.stroke();
    }
    g.strokeStyle = "rgba(60,35,18,.45)"; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, bw - 1.5, bh - 1.5); g.lineWidth = 1;
  }
  ruido(g, w, h, 10);
}, true);

// porcelanato claro de 60 cm com rejunte (corredor)
const texPorcelanato = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#bdb5a8"; g.fillRect(0, 0, w, h);
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    g.fillStyle = `hsl(38, 16%, ${84 + rnd() * 4}%)`; g.fillRect(a * 128 + 1.5, b * 128 + 1.5, 125, 125);
    g.strokeStyle = "rgba(150,140,125,.18)"; g.lineWidth = 2;
    for (let k = 0; k < 2; k++) {   // veios de mármore bem leves
      g.beginPath(); g.moveTo(a * 128 + rnd() * 128, b * 128);
      g.bezierCurveTo(a * 128 + rnd() * 128, b * 128 + 40, a * 128 + rnd() * 128, b * 128 + 90, a * 128 + rnd() * 128, b * 128 + 128);
      g.stroke();
    }
  }
  ruido(g, w, h, 7);
}, true);

// tapete da sala de jogos: creme com borda verde-água e losangos coral/mostarda
const texTapeteJogos = canvasTex(512, 352, (g, w, h) => {
  g.fillStyle = "#efe4cf"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#2f8f8a"; g.lineWidth = 18; g.strokeRect(14, 14, w - 28, h - 28);
  g.lineWidth = 4; g.strokeRect(38, 38, w - 76, h - 76);
  const cores = ["#e26d5a", "#e0a930", "#2f8f8a"];
  for (let a = 0; a < 7; a++) for (let b = 0; b < 4; b++) {
    const cx = 80 + a * 58, cy = 92 + b * 56;
    g.fillStyle = cores[(a + b) % 3];
    g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx + 16, cy); g.lineTo(cx, cy + 20); g.lineTo(cx - 16, cy); g.fill();
  }
  ruido(g, w, h, 16);
});

// passadeira do corredor: azul-marinho com frisos creme
const texPassadeira = canvasTex(1024, 160, (g, w, h) => {
  g.fillStyle = "#34466b"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#e9d8b4"; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
  g.lineWidth = 2; g.strokeRect(26, 26, w - 52, h - 52);
  g.fillStyle = "#c78a4a";
  for (let x = 70; x < w - 50; x += 64) { g.beginPath(); g.moveTo(x, h / 2 - 18); g.lineTo(x + 14, h / 2); g.lineTo(x, h / 2 + 18); g.lineTo(x - 14, h / 2); g.fill(); }
  ruido(g, w, h, 16);
});

// tela da TV: corrida de kart em tela dividida (dois jogadores)
const texVideogame = canvasTex(512, 288, (g, w, h) => {
  const metade = (y0, corKart, pos) => {
    const ceu = g.createLinearGradient(0, y0, 0, y0 + 70);
    ceu.addColorStop(0, "#4aa8ff"); ceu.addColorStop(1, "#bfe6ff");
    g.fillStyle = ceu; g.fillRect(0, y0, w, h / 2);
    g.fillStyle = "#5cbf5a";
    g.beginPath(); g.moveTo(0, y0 + 70);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y0 + 56 + Math.sin(x / 40 + y0) * 10);
    g.lineTo(w, y0 + h / 2); g.lineTo(0, y0 + h / 2); g.fill();
    g.fillStyle = "#7a7f88";
    g.beginPath(); g.moveTo(w / 2 - 30, y0 + 66); g.lineTo(w / 2 + 30, y0 + 66); g.lineTo(w / 2 + 210, y0 + h / 2); g.lineTo(w / 2 - 210, y0 + h / 2); g.fill();
    g.fillStyle = "#f2f0e6";
    for (let k = 0; k < 4; k++) g.fillRect(w / 2 - 2 - k, y0 + 76 + k * 18, 4 + 2 * k, 8 + k * 2);
    g.fillStyle = corKart; g.fillRect(w / 2 - 40, y0 + 108, 80, 22);
    g.fillStyle = "#1d1d22"; for (const s of [-1, 1]) g.fillRect(w / 2 + s * 44 - 9, y0 + 116, 18, 22);
    g.fillStyle = "#f3d2b8"; g.fillRect(w / 2 - 10, y0 + 92, 20, 18);
    g.fillStyle = "#ffffff"; g.font = "800 30px Segoe UI, sans-serif"; g.fillText(pos, 14, y0 + 36);
    g.font = "600 18px Segoe UI, sans-serif"; g.textAlign = "right"; g.fillText("volta 2/3", w - 14, y0 + 28); g.textAlign = "left";
  };
  metade(0, "#e53935", "1º");
  metade(h / 2, "#1e88e5", "2º");
  g.fillStyle = "#111"; g.fillRect(0, h / 2 - 2, w, 4);
});

// frente iluminada da máquina de refrigerante: letreiro e prateleiras de latas
const texRefri = canvasTex(256, 668, (g, w, h) => {
  g.fillStyle = "#b71c1c"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffffff"; g.font = "italic 900 64px Segoe UI, sans-serif"; g.textAlign = "center"; g.fillText("REFRI", w / 2, 78);
  g.font = "600 22px Segoe UI, sans-serif"; g.fillText("bem gelado", w / 2, 108); g.textAlign = "left";
  const vidro = g.createLinearGradient(0, 130, w, h);
  vidro.addColorStop(0, "#1b2836"); vidro.addColorStop(1, "#0d141c");
  g.fillStyle = vidro; g.fillRect(14, 128, w - 28, h - 150);
  const latas = ["#e53935", "#fbc02d", "#43a047", "#1e88e5", "#f57c00", "#8e24aa"];
  for (let r = 0; r < 5; r++) {
    const y = 150 + r * 96;
    for (let c = 0; c < 5; c++) {
      g.fillStyle = latas[(r * 2 + c) % latas.length];
      g.beginPath(); g.roundRect(26 + c * 44, y, 32, 62, 6); g.fill();
      g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(31 + c * 44, y + 6, 5, 50);
    }
    g.fillStyle = "#c9ced6"; g.fillRect(18, y + 66, w - 36, 6);
    g.fillStyle = "#ffeb3b"; g.font = "600 13px Segoe UI, sans-serif";
    for (let c = 0; c < 5; c++) g.fillText("R$4", 28 + c * 44, y + 86);
  }
  g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.moveTo(14, 128); g.lineTo(120, 128); g.lineTo(14, 400); g.fill();
});

// campo do pebolim
const texPebolim = canvasTex(320, 180, (g, w, h) => {
  g.fillStyle = "#2e8b3e"; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.05)"; g.fillRect(k * w / 8, 0, w / 8, h); }
  g.strokeStyle = "#f2f0e6"; g.lineWidth = 3;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, 26, 0, 7); g.stroke();
  for (const x of [6, w - 46]) g.strokeRect(x, h / 2 - 40, 40, 80);
});

const texCeu = canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#8cc4ec"); gr.addColorStop(0.6, "#cfe3ee"); gr.addColorStop(1, "#e8efe6");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
cena.background = texCeu;

// quadros abstratos para as paredes
const ARTES = ["#e07a5f,#3d405b,#81b29a,#f2cc8f", "#264653,#2a9d8f,#e9c46a,#f4a261", "#5b8bd9,#f0b429,#ef5350,#f1ebe1"].map(cores =>
  canvasTex(256, 192, (g, w, h) => {
    const c = cores.split(",");
    g.fillStyle = "#f6f1e7"; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = c[k % c.length]; g.globalAlpha = 0.85;
      if (k % 2) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 45, 0, 7); g.fill(); }
      else g.fillRect(rnd() * w * 0.7, rnd() * h * 0.7, 40 + rnd() * 90, 20 + rnd() * 60);
    }
    g.globalAlpha = 1;
  }));

// ---------------------------------------------------------------- geometrias e materiais compartilhados
const geos = new Map(), mats = new Map();
function geoCaixa(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d));
  return geos.get(k);
}
function geoCilindro(rt, rb, h, seg = 16) {
  const k = `c${rt},${rb},${h},${seg}`;
  if (!geos.has(k)) geos.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geos.get(k);
}
function mat(cor, extra = {}) {
  const k = cor + JSON.stringify(extra);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: cor, roughness: 0.75, ...extra }));
  return mats.get(k);
}
const M = {
  parede: new THREE.MeshStandardMaterial({ map: texParede, roughness: 0.9 }),
  topo: mat("#40506b", { roughness: 0.6 }),
  rodape: mat("#fbf8f2"),
  moldura: mat("#fbf8f2", { roughness: 0.5 }),
  batente: mat("#8a5a36", { roughness: 0.55 }),
  vidro: new THREE.MeshStandardMaterial({ color: "#cfe9ff", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }),
  madeira: mat("#a0703f", { roughness: 0.55 }),
  madeiraEscura: mat("#5e3b24", { roughness: 0.5 }),
  metal: mat("#3a3f47", { roughness: 0.35, metalness: 0.6 }),
  cromo: mat("#c9ced6", { roughness: 0.25, metalness: 0.9 }),
  preto: mat("#16181d", { roughness: 0.4 }),
  branco: mat("#eeeae4", { roughness: 0.6 }),
  tecido: mat("#2c3442", { roughness: 0.95 }),
  terracota: mat("#b5643c", { roughness: 0.85 }),
  terra: mat("#4a3426", { roughness: 1 }),
  ouro: mat("#d9ab3c", { roughness: 0.28, metalness: 0.85 }),
  telaApagada: mat("#0d1014", { roughness: 0.2, metalness: 0.3 }),
  folhas: ["#3f7d3a", "#4f9444", "#2f6a34"].map(c => mat(c, { flatShading: true, roughness: 0.85 })),
  luz: new THREE.MeshStandardMaterial({ color: "#fff6dd", emissive: "#ffe7b0", emissiveIntensity: 2.2 }),
  contorno: new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.BackSide, toneMapped: false }),
};

function caixa(pai, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(geoCaixa(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  pai.add(m);
  return m;
}
function cilindro(pai, rt, rb, h, material, x, y, z, seg) {
  const m = new THREE.Mesh(geoCilindro(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  pai.add(m);
  return m;
}
function grupo(pai, x, z, rot = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  pai.add(g);
  return g;
}
// plano deitado no chão com a textura repetida a cada `ladrilho` metros (null = textura inteira)
function piso(pai, w, d, material, ladrilho, x, y, z) {
  const geo = new THREE.PlaneGeometry(w, d);
  const uv = geo.attributes.uv;
  if (ladrilho) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / ladrilho, uv.getY(i) * d / ladrilho);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  pai.add(m);
  return m;
}

// ---------------------------------------------------------------- prédio: pisos, fundação, paredes
const predio = new THREE.Group();
cena.add(predio);

const ambientes = [PLANTA.hall, ...Object.values(PLANTA.salas)];
// piso por ambiente: [textura, metros por repetição, aspereza]; sem `piso`, carpete na cor da sala
const PISOS = { taco: [texTaco, 1.6, 0.5], porcelanato: [texPorcelanato, 1.2, 0.3] };
for (const a of ambientes) {
  caixa(predio, a.w + 0.3, 0.16, a.d + 0.3, mat("#d9d3c6"), a.x, -0.08, a.z).castShadow = false;
  const [map, ladrilho, roughness] = a === PLANTA.hall ? [texMadeira, 2.4, 0.45] : PISOS[a.piso] || [texCarpete(a.cor), 2, 0.95];
  piso(predio, a.w, a.d, new THREE.MeshStandardMaterial({ map, roughness }), ladrilho, a.x, 0.003, a.z);
}
// forro: só aparece na primeira pessoa (de cima a casa fica aberta, como no Sims); não faz sombra
const forro = new THREE.Group();
forro.visible = false;
cena.add(forro);
// (virado para baixo só recebe a cor de chão da luz hemisférica: um pouco de emissivo o deixa claro)
const matForro = mat("#f4efe6", { roughness: 0.95, emissive: "#6e665b" });
for (const a of ambientes) piso(forro, a.w, a.d, matForro, null, a.x, PLANTA.altura - 0.005, a.z).rotation.x = Math.PI;

// Cada peça de parede é uma caixa unitária escalada que lembra sua faixa de altura; o recorte (cutaway)
// só muda escala e posição em y. As peças viram instâncias (um InstancedMesh por material).
const pecas = [];
function pecaParede(par, u0, u1, y0, y1, material, opc = {}) {
  const { grossura = PLANTA.espessura, colide = false } = opc;
  const emX = par.de[1] === par.ate[1];
  const c = emX ? par.de[1] : par.de[0];
  const comp = u1 - u0, meio = (u0 + u1) / 2;
  const x = emX ? meio : c, z = emX ? c : meio, sx = emX ? comp : grossura, sz = emX ? grossura : comp;
  const base = { y0, y1, ext: par.ext, centro: par.centro };
  pecas.push({ ...base, material, x, z, sx, sz });
  if (colide) COLISORES.push({ min: [x - sx / 2, y0, z - sz / 2], max: [x + sx / 2, y1, z + sz / 2] });
  if (material === M.parede) {
    // tampo escuro da parede recortada (como no Sims) e rodapés dos dois lados
    pecas.push({ ...base, material: M.topo, x, z, sx: sx + (emX ? 0 : 0.01), sz: sz + (emX ? 0.01 : 0), topo: true });
    if (y0 === 0) caixa(predio, sx + (emX ? 0 : 0.03), 0.1, sz + (emX ? 0.03 : 0), M.rodape, x, 0.05, z).castShadow = false;
  }
}

function construirParede(par) {
  const H = PLANTA.altura, t = PLANTA.espessura;
  par.centro = [(par.de[0] + par.ate[0]) / 2, (par.de[1] + par.ate[1]) / 2];
  const emX = par.de[1] === par.ate[1];
  let u = (emX ? par.de[0] : par.de[1]) - t / 2;
  const fim = (emX ? par.ate[0] : par.ate[1]) + t / 2;
  for (const ab of (par.ab || []).sort((a, b) => a.em - b.em)) {
    const meia = (ab.tipo === "janela" ? PLANTA.janela : PLANTA.porta) / 2;
    const s = ab.em - meia, f = ab.em + meia;
    pecaParede(par, u, s, 0, H, M.parede, { colide: true });
    if (ab.tipo === "janela") {
      pecaParede(par, s, f, 0, 0.9, M.parede, { colide: true });
      pecaParede(par, s, f, 2.2, H, M.parede);
      pecaParede(par, s, f, 0.9, 2.2, M.vidro, { grossura: 0.03, colide: true });
      pecaParede(par, s - 0.06, f + 0.06, 0.86, 0.92, M.moldura, { grossura: t + 0.1 });  // peitoril
      pecaParede(par, s - 0.06, f + 0.06, 2.18, 2.26, M.moldura, { grossura: t + 0.04 });
      // moldura e batente avançam 1 cm para dentro do vão: face no mesmo plano da ponta da parede pisca (z-fighting)
      pecaParede(par, s - 0.06, s + 0.01, 0.9, 2.2, M.moldura, { grossura: t + 0.04 });
      pecaParede(par, f - 0.01, f + 0.06, 0.9, 2.2, M.moldura, { grossura: t + 0.04 });
      pecaParede(par, ab.em - 0.025, ab.em + 0.025, 0.9, 2.2, M.moldura, { grossura: 0.06 });
    } else {
      pecaParede(par, s, f, 2.1, H, M.parede);
      pecaParede(par, s - 0.07, s + 0.01, 0, 2.17, M.batente, { grossura: t + 0.05 });
      pecaParede(par, f - 0.01, f + 0.07, 0, 2.17, M.batente, { grossura: t + 0.05 });
      pecaParede(par, s - 0.07, f + 0.07, 2.09, 2.17, M.batente, { grossura: t + 0.05 });
    }
    u = f;
  }
  pecaParede(par, u, fim, 0, H, M.parede, { colide: true });
}
PAREDES.forEach(construirParede);

for (const material of new Set(pecas.map(pc => pc.material))) {
  const doMaterial = pecas.filter(pc => pc.material === material);
  const im = new THREE.InstancedMesh(geoCaixa(1, 1, 1), material, doMaterial.length);
  im.castShadow = material !== M.vidro;
  im.receiveShadow = true;
  im.frustumCulled = false;  // as escalas mudam com o recorte; a esfera envolvente ficaria velha
  doMaterial.forEach((pc, i) => Object.assign(pc, { im, i }));
  cena.add(im);
}

// Recorte: na câmera de cima as paredes descem para 1 m, menos as fachadas do fundo — face interna
// virada para a câmera e atrás do ponto focado —, que ficam inteiras como no Sims.
let alturaFixa = null;  // a primeira pessoa (Task 6) usa alturaParedes(PLANTA.altura)
export function alturaParedes(h) { alturaFixa = h; }
const dirCamera = new THREE.Vector3(), matriz = new THREE.Matrix4(), semGiro = new THREE.Quaternion();
const posPeca = new THREE.Vector3(), escPeca = new THREE.Vector3();
function atualizarParedes() {
  camera.getWorldDirection(dirCamera);
  const alvo = controles.target;
  const hor = Math.hypot(dirCamera.x, dirCamera.z) || 1;
  for (const pc of pecas) {
    let h = alturaFixa ?? PLANTA.corte;
    if (alturaFixa === null && pc.ext && (pc.ext[0] * dirCamera.x + pc.ext[1] * dirCamera.z) / hor > 0.3 &&
        (pc.centro[0] - alvo.x) * dirCamera.x + (pc.centro[1] - alvo.z) * dirCamera.z > -0.5 * hor) h = PLANTA.altura;
    if (pc.porta) { pc.m.scale.y = Math.min(h, pc.y1) / pc.y1; continue; }
    if (pc.inteira) { pc.m.visible = pc.y1 <= h; continue; }
    const y1 = Math.min(pc.y1, h), visivel = y1 - pc.y0 > 0.005;
    if (pc.topo) { posPeca.set(pc.x, y1 + 0.015, pc.z); escPeca.set(pc.sx, 0.03, pc.sz); }
    else { posPeca.set(pc.x, (pc.y0 + y1) / 2, pc.z); escPeca.set(pc.sx, y1 - pc.y0, pc.sz); }
    if (!visivel) escPeca.setScalar(0);
    pc.im.setMatrixAt(pc.i, matriz.compose(posPeca, semGiro, escPeca));
  }
  for (const pc of pecas) if (pc.im) pc.im.instanceMatrix.needsUpdate = true;
}

// quadro pendurado na face interna de uma fachada; só aparece quando a parede está inteira
function quadroParede(x, y, z, ext, w, h, textura) {
  const g = new THREE.Group();
  g.position.set(x - ext[0] * (PLANTA.espessura / 2 + 0.025), y, z - ext[1] * (PLANTA.espessura / 2 + 0.025));
  g.rotation.y = Math.atan2(-ext[0], -ext[1]);
  caixa(g, w + 0.08, h + 0.08, 0.04, M.madeiraEscura, 0, 0, 0);
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: textura, roughness: 0.6 }));
  tela.position.z = 0.021;
  g.add(tela);
  predio.add(g);
  // em parede interna (ext null) o quadro só aparece com a parede inteira, isto é, na primeira pessoa
  pecas.push({ m: g, y0: y - h / 2, y1: y + h / 2, ext: fachadaEm(x, z) ? ext : null, centro: [x, z], inteira: true });
  return g;
}

// ---------------------------------------------------------------- área externa: gramado, calçada, rua, arbustos, árvores
const fora = new THREE.Group();
cena.add(fora);
piso(fora, 220, 220, new THREE.MeshStandardMaterial({ map: texGrama, roughness: 1 }), 3, 4, -0.16, 0);
const matCalcada = new THREE.MeshStandardMaterial({ map: texCalcada, roughness: 0.95 });
piso(fora, 6.2, 1.8, matCalcada, 1.2, -19.1, -0.155, 0);         // caminho até a entrada (fachada oeste)
piso(fora, 2.4, 220, matCalcada, 1.2, -23.2, -0.155, 0);          // calçada
piso(fora, 8, 220, mat("#4a4d52", { roughness: 0.95 }), 8, -28.4, -0.157, 0);  // rua
for (let z = -100; z < 100; z += 4) caixa(fora, 0.15, 0.01, 2, mat("#f2f0e6"), -28.4, -0.15, z).castShadow = false;
caixa(fora, 0.5, 0.08, 1.8, mat("#d9d3c6"), -16.35, -0.12, 0);   // degrau da entrada

const geoArbusto = new THREE.IcosahedronGeometry(1, 1), geoFlor = new THREE.IcosahedronGeometry(1, 0);
const CORES_FLOR = ["#f4f1f8", "#c86bd6", "#ef8fb0", "#f6d55c"].map(c => mat(c, { flatShading: true }));
function arbusto(x, z, r = 0.45) {
  const m = new THREE.Mesh(geoArbusto, M.folhas[Math.floor(rnd() * 3)]);
  m.position.set(x, -0.16 + r * 0.7, z);
  m.scale.set(r * (1 + rnd() * 0.3), r * 0.85, r * (1 + rnd() * 0.3));
  m.castShadow = m.receiveShadow = true;
  fora.add(m);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(geoFlor, CORES_FLOR[Math.floor(rnd() * 4)]);
    const a = rnd() * 6.28;
    f.position.set(x + Math.cos(a) * r * 0.7, -0.16 + r * 1.2, z + Math.sin(a) * r * 0.7);
    f.scale.setScalar(0.06);
    fora.add(f);
  }
}
function canteiro(x0, z0, x1, z1) {
  piso(fora, x1 - x0, z1 - z0, M.terra, 1, (x0 + x1) / 2, -0.152, (z0 + z1) / 2);
  const emX = x1 - x0 > z1 - z0, comp = emX ? x1 - x0 : z1 - z0;
  for (let s = 0.5; s < comp; s += 0.9) arbusto(emX ? x0 + s : (x0 + x1) / 2, emX ? (z0 + z1) / 2 : z0 + s, 0.35 + rnd() * 0.2);
}
canteiro(-16.2, -11.2, 8.2, -10.25);
canteiro(-16.2, 10.25, 8.2, 11.2);
canteiro(14.25, -3, 15.2, 3);
canteiro(-17.2, -10, -16.25, -1.3);
canteiro(-17.2, 1.3, -16.25, 10);
function arvore(x, z, r = 1.4) {
  cilindro(fora, 0.14, 0.2, 2.2, mat("#6b4a2f"), x, 0.94, z, 8);
  for (const [dx, dy, dz, k] of [[0, 2.7, 0, 1], [0.6, 2.3, 0.3, 0.75], [-0.5, 2.4, -0.4, 0.8], [0.1, 3.3, -0.1, 0.7]]) {
    const m = new THREE.Mesh(geoArbusto, M.folhas[Math.floor(rnd() * 3)]);
    m.position.set(x + dx * r / 1.4, dy, z + dz * r / 1.4);
    m.scale.setScalar(r * k);
    m.castShadow = true;
    fora.add(m);
  }
}
[[-19.6, -8.5], [-19.4, 7.5], [-13, -14.5], [12, -8.5], [18, 5.5], [18.5, -5], [-3, -14.5], [6, 14.5], [13, 11]].forEach(([x, z]) => arvore(x, z, 1.2 + rnd() * 0.5));

// ---------------------------------------------------------------- mobília
function mesa(g, w, d, tampo = M.madeira) {
  caixa(g, w, 0.04, d, tampo, 0, 0.73, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.05, 0.71, 0.05, M.metal, sx * (w / 2 - 0.06), 0.355, sz * (d / 2 - 0.06));
  caixa(g, w - 0.14, 0.34, 0.02, tampo, 0, 0.53, d / 2 - 0.06);           // painel do fundo
  caixa(g, 0.4, 0.58, 0.5, M.branco, w / 2 - 0.3, 0.3, 0.03);                // gaveteiro
  for (const y of [0.15, 0.33, 0.5]) caixa(g, 0.18, 0.02, 0.02, M.cromo, w / 2 - 0.3, y, -0.23);
}

function monitor(g, x, z) {
  caixa(g, 0.24, 0.015, 0.16, M.metal, x, 0.758, z + 0.03);
  caixa(g, 0.04, 0.2, 0.03, M.metal, x, 0.86, z + 0.06);
  caixa(g, 0.64, 0.4, 0.035, M.preto, x, 1.07, z + 0.03);
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.35), M.telaApagada);
  tela.position.set(x, 1.075, z + 0.03 - 0.023);   // 5 mm à frente da carcaça (sem z-fighting)
  tela.rotation.y = Math.PI;
  g.add(tela);
  return tela;
}

function teclado(g, x, z) {
  caixa(g, 0.44, 0.02, 0.15, M.preto, x, 0.76, z);
  caixa(g, 0.41, 0.006, 0.12, mat("#3b404a"), x, 0.772, z);
  caixa(g, 0.06, 0.022, 0.1, M.preto, x + 0.32, 0.76, z);
}

function caneca(g, x, z, cor, y = 0.8) {
  cilindro(g, 0.04, 0.036, 0.1, mat(cor), x, y, z, 12);
  caixa(g, 0.015, 0.05, 0.03, mat(cor), x + 0.048, y, z);
}

function cadeira(g, x, z, rot = 0, executiva = false) {
  const c = grupo(g, x, z, rot);
  for (let k = 0; k < 5; k++) {
    const a = k * 2 * Math.PI / 5;
    caixa(c, 0.04, 0.035, 0.3, M.metal, Math.sin(a) * 0.15, 0.065, Math.cos(a) * 0.15).rotation.y = a;
    cilindro(c, 0.028, 0.028, 0.03, M.preto, Math.sin(a) * 0.29, 0.028, Math.cos(a) * 0.29, 10).rotation.set(0, a, Math.PI / 2);
  }
  cilindro(c, 0.03, 0.03, 0.34, M.cromo, 0, 0.24, 0, 10);
  const tec = executiva ? mat("#3a2a22", { roughness: 0.5 }) : M.tecido;
  caixa(c, 0.5, 0.08, 0.48, tec, 0, 0.44, 0);
  caixa(c, 0.46, executiva ? 0.82 : 0.56, 0.07, tec, 0, executiva ? 0.93 : 0.8, -0.25).rotation.x = -0.08;
  for (const s of [-1, 1]) {
    caixa(c, 0.035, 0.2, 0.035, M.metal, s * 0.25, 0.57, -0.06);
    caixa(c, 0.06, 0.03, 0.26, M.preto, s * 0.25, 0.68, -0.02);
  }
  return c;
}

function cadeiraVisita(g, x, z, rot) {
  const c = grupo(g, x, z, rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(c, 0.035, 0.45, 0.035, M.cromo, sx * 0.2, 0.225, sz * 0.2);
  caixa(c, 0.48, 0.07, 0.46, mat("#7a2f3b", { roughness: 0.9 }), 0, 0.48, 0);
  caixa(c, 0.46, 0.42, 0.06, mat("#7a2f3b", { roughness: 0.9 }), 0, 0.74, -0.21);
  return c;
}

function planta(pai, x, z, alta = true) {
  cilindro(pai, 0.2, 0.15, 0.4, M.terracota, x, 0.2, z, 14);
  cilindro(pai, 0.18, 0.18, 0.02, M.terra, x, 0.39, z, 14);
  if (alta) {
    cilindro(pai, 0.025, 0.035, 0.9, M.madeiraEscura, x, 0.8, z, 6);
    for (const [dx, dy, dz, r] of [[0, 1.35, 0, 0.32], [0.18, 1.1, 0.1, 0.24], [-0.15, 1.15, -0.12, 0.25], [0.05, 1.6, 0.05, 0.2]]) {
      const m = new THREE.Mesh(geoArbusto, M.folhas[Math.floor(rnd() * 3)]);
      m.position.set(x + dx, dy, z + dz);
      m.scale.setScalar(r);
      m.castShadow = true;
      pai.add(m);
    }
  } else {
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9, m = new THREE.Mesh(geoCilindro(0.0, 0.05, 0.55, 5), M.folhas[k % 3]);
      m.position.set(x + Math.cos(a) * 0.07, 0.62, z + Math.sin(a) * 0.07);
      m.rotation.set(Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
      m.castShadow = true;
      pai.add(m);
    }
  }
}

function lixeira(g, x, z) {
  cilindro(g, 0.13, 0.11, 0.32, mat("#6d737c", { roughness: 0.5, metalness: 0.4 }), x, 0.16, z, 14);
  cilindro(g, 0.115, 0.115, 0.005, M.preto, x, 0.32, z, 14);
}

function armarioBaixo(pai, x, z, rot, w = 1.6) {
  const g = grupo(pai, x, z, rot);
  caixa(g, w, 0.72, 0.45, M.branco, 0, 0.36, 0);
  caixa(g, w + 0.04, 0.03, 0.48, M.madeira, 0, 0.735, 0);
  for (let k = 1; k < w / 0.4; k++) caixa(g, 0.01, 0.6, 0.005, mat("#cfcac2"), -w / 2 + k * 0.4, 0.37, 0.226);
  caixa(g, 0.42, 0.22, 0.34, mat("#d6d9de"), -w / 2 + 0.35, 0.86, 0);     // impressora
  caixa(g, 0.3, 0.02, 0.2, M.branco, -w / 2 + 0.35, 0.98, 0.02);
  for (let k = 0; k < 5; k++) caixa(g, 0.05, 0.28, 0.22, mat(["#3a6ea5", "#c0392b", "#f0b429", "#2e8b57", "#6c5ce7"][k]), w / 2 - 0.25 - k * 0.06, 0.89, 0);
  return g;
}

function sofa(pai, x, z, rot, cor) {
  const g = grupo(pai, x, z, rot), m = mat(cor, { roughness: 0.95 });
  caixa(g, 2.0, 0.24, 0.86, m, 0, 0.2, 0);
  for (const s of [-1, 1]) caixa(g, 0.92, 0.14, 0.64, m, s * 0.47, 0.39, 0.08);
  caixa(g, 2.0, 0.52, 0.22, m, 0, 0.56, -0.32);
  for (const s of [-1, 1]) caixa(g, 0.2, 0.58, 0.86, m, s * 0.95, 0.33, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.05, 0.08, 0.05, M.madeiraEscura, sx * 0.92, 0.04, sz * 0.36);
  caixa(g, 0.38, 0.32, 0.1, mat("#f0b429", { roughness: 0.95 }), -0.6, 0.6, -0.16).rotation.z = 0.15;
  return g;
}

function mesaCentro(pai, x, z) {
  const g = grupo(pai, x, z);
  caixa(g, 1.1, 0.05, 0.6, M.madeira, 0, 0.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.04, 0.38, 0.04, M.madeiraEscura, sx * 0.5, 0.19, sz * 0.25);
  caixa(g, 0.26, 0.04, 0.2, mat("#3a6ea5"), -0.25, 0.445, 0.05);
  caixa(g, 0.24, 0.04, 0.18, mat("#c0392b"), -0.24, 0.485, 0.04).rotation.y = 0.2;
  caneca(g, 0.25, -0.05, "#ffffff", 0.475);
}

function tapete(pai, x, z, w, d, rot = 0, tex = texTapete) {
  const m = piso(pai, w, d, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }), null, x, 0.012, z);
  m.rotation.y = rot;
  return m;
}

function bebedouro(pai, x, z) {
  caixa(pai, 0.32, 0.95, 0.32, M.branco, x, 0.475, z);
  caixa(pai, 0.2, 0.08, 0.04, M.preto, x, 0.82, z + 0.17);
  cilindro(pai, 0.13, 0.13, 0.42, new THREE.MeshStandardMaterial({ color: "#7cc4f5", transparent: true, opacity: 0.6, roughness: 0.1 }), x, 1.17, z, 16);
  cilindro(pai, 0.05, 0.13, 0.08, mat("#5aa9e6"), x, 1.42, z, 16);
}

function estante(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot);
  for (const s of [-1, 1]) caixa(g, 0.04, 2.0, 0.36, M.madeiraEscura, s * 0.98, 1.0, 0);
  caixa(g, 2.0, 2.0, 0.02, M.madeiraEscura, 0, 1.0, -0.17);
  const cores = ["#3a6ea5", "#c0392b", "#f0b429", "#2e8b57", "#6c5ce7", "#e8e2d4", "#8a5a36"];
  for (let n = 0; n < 5; n++) {
    const y = 0.02 + n * 0.49;
    caixa(g, 1.96, 0.03, 0.34, M.madeiraEscura, 0, y, 0);
    if (n === 4) continue;
    let px = -0.9;
    while (px < 0.85 - (n === 1 ? 0.6 : 0)) {
      const w = 0.04 + rnd() * 0.04, h = 0.24 + rnd() * 0.14;
      caixa(g, w, h, 0.24, mat(cores[Math.floor(rnd() * cores.length)]), px + w / 2, y + 0.015 + h / 2, 0.02);
      px += w + 0.006;
    }
  }
  trofeu(g, 0.6, 0.53, 0.02);
  return g;
}

function trofeu(pai, x, y, z, k = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(k);
  pai.add(g);
  caixa(g, 0.14, 0.06, 0.14, M.madeiraEscura, 0, 0.03, 0);
  cilindro(g, 0.015, 0.025, 0.1, M.ouro, 0, 0.11, 0, 10);
  cilindro(g, 0.08, 0.035, 0.14, M.ouro, 0, 0.23, 0, 16);
  for (const s of [-1, 1]) caixa(g, 0.02, 0.07, 0.015, M.ouro, s * 0.085, 0.24, 0);
  return g;
}

// pendente: cúpula de latão com a lâmpada acesa por baixo (sem teto, flutua como no Sims)
function mesaReuniao(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot);
  cilindro(g, 0.5, 0.5, 0.04, M.madeira, 0, 0.73, 0, 28);
  cilindro(g, 0.04, 0.05, 0.7, M.metal, 0, 0.36, 0, 10);
  cilindro(g, 0.28, 0.3, 0.03, M.metal, 0, 0.015, 0, 20);
  cadeiraVisita(g, 0, -0.75, 0);
  cadeiraVisita(g, 0, 0.75, Math.PI);
  caneca(g, 0.15, -0.1, "#ffffff", 0.8);
  caixa(g, 0.3, 0.01, 0.22, M.branco, -0.12, 0.755, 0.08).rotation.y = 0.3;  // papéis
}

// lousa de status da equipe: quadro branco 1,6 × 1,2 m sobre rodinhas, virado para as mesas. A tela (canvas
// 1024×768) é repintada por aplicarEstado; clique (de cima) ou E (primeira pessoa) abre o mesmo conteúdo no painel.
function quadroStatus(pai, x, z, rot, chave) {
  const g = grupo(pai, x, z, rot), aluminio = mat("#b9bec6", { roughness: 0.35, metalness: 0.7 });
  caixa(g, 1.7, 1.3, 0.05, aluminio, 0, 1.45, 0);
  caixa(g, 1.64, 1.24, 0.052, M.branco, 0, 1.45, 0);
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ color: "#f7f8f6", roughness: 0.4 }));
  tela.position.set(0, 1.45, 0.031);
  g.add(tela);
  caixa(g, 1.1, 0.025, 0.08, aluminio, 0, 0.79, 0.05);                       // calha dos pincéis
  [["#1d3f7a", -0.3], ["#c0392b", -0.18], ["#1f2328", -0.06]].forEach(([c, px]) =>
    (cilindro(g, 0.011, 0.011, 0.13, mat(c), px, 0.815, 0.05, 8).rotation.z = Math.PI / 2));
  caixa(g, 0.13, 0.04, 0.05, mat("#3a3f47"), 0.25, 0.82, 0.05);              // apagador
  caixa(g, 0.12, 0.012, 0.05, mat("#d9d3c6"), 0.25, 0.8, 0.05);
  for (const s of [-1, 1]) {
    caixa(g, 0.045, 2.08, 0.045, aluminio, s * 0.88, 1.06, 0);
    caixa(g, 0.06, 0.04, 0.56, aluminio, s * 0.88, 0.06, 0);
    for (const t of [-1, 1]) cilindro(g, 0.035, 0.035, 0.03, M.preto, s * 0.88, 0.035, t * 0.24, 10).rotation.z = Math.PI / 2;
  }
  for (const [mx, c] of [[-0.7, "#ef5350"], [0.7, "#4c8dff"]]) cilindro(g, 0.025, 0.025, 0.02, mat(c), mx, 2.0, 0.035, 12).rotation.x = Math.PI / 2;  // ímãs
  tela.userData.alvo = { quadro: chave };
  clicaveis.push(tela);
  return tela;
}

// ---------------------------------------------------------------- mobília da sala de descanso e do corredor
// sofá em L virado para +z: trecho principal de `comp` m e o retorno de `ret` m saindo do canto em +x para a frente
function trechoSofa(g, comp, m, almofada, braco) {
  caixa(g, comp, 0.24, 0.86, m, 0, 0.2, 0);
  const n = Math.max(1, Math.round(comp / 0.7)), larg = (comp - (braco ? 0.2 : 0)) / n, x0 = -comp / 2 + (braco < 0 ? 0.2 : 0);
  for (let k = 0; k < n; k++) {
    caixa(g, larg - 0.03, 0.14, 0.64, m, x0 + (k + 0.5) * larg, 0.39, 0.08);
    caixa(g, larg - 0.05, 0.4, 0.13, almofada, x0 + (k + 0.5) * larg, 0.62, -0.17).rotation.x = -0.14;
  }
  caixa(g, comp, 0.54, 0.2, m, 0, 0.57, -0.33);
  if (braco) caixa(g, 0.2, 0.6, 0.86, m, braco * (comp / 2 - 0.1), 0.34, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.05, 0.08, 0.05, M.madeiraEscura, sx * (comp / 2 - 0.08), 0.04, sz * 0.36);
}
function sofaL(pai, x, z, rot, cor, comp = 2.4, ret = 1.9) {
  const g = grupo(pai, x, z, rot), m = mat(cor, { roughness: 0.95 }), almofada = mat("#5fb3ad", { roughness: 0.95 });
  const a = grupo(g, -0.43, 0);
  trechoSofa(a, comp - 0.86, m, almofada, -1);
  const b = grupo(g, comp / 2 - 0.43, -0.43 + ret / 2, -Math.PI / 2);
  trechoSofa(b, ret, m, almofada, 1);
  caixa(g, 0.86, 0.54, 0.2, m, comp / 2 - 0.43, 0.57, -0.33);        // encosto do canto
  caixa(g, 0.38, 0.32, 0.12, mat("#e0a930", { roughness: 0.95 }), -0.85, 0.62, -0.12).rotation.set(-0.2, 0.2, 0.12);
  caixa(g, 0.38, 0.32, 0.12, mat("#e26d5a", { roughness: 0.95 }), comp / 2 - 0.2, 0.62, -0.1).rotation.set(-0.2, -0.7, -0.1);
  caixa(g, 0.6, 0.03, 0.75, mat("#efe4cf", { roughness: 1 }), comp / 2 - 0.4, 0.475, 0.75).rotation.y = 0.25;   // manta
  return g;
}

function controle(pai, x, y, z, rot, cor) {
  const g = new THREE.Group(), corpo = mat(cor, { roughness: 0.5 });
  g.position.set(x, y, z); g.rotation.y = rot;
  pai.add(g);
  caixa(g, 0.15, 0.03, 0.07, corpo, 0, 0.015, 0);
  for (const s of [-1, 1]) caixa(g, 0.05, 0.03, 0.08, corpo, s * 0.065, 0.013, 0.03).rotation.y = -s * 0.35;
  caixa(g, 0.03, 0.008, 0.03, M.preto, -0.035, 0.033, 0);
  for (const [bx, bz, c] of [[0.035, -0.014, "#ef5350"], [0.05, 0, "#4c8dff"], [0.02, 0, "#f0b429"], [0.035, 0.014, "#26a69a"]])
    cilindro(g, 0.007, 0.007, 0.008, mat(c), bx, 0.034, bz, 6);
}

// rack com videogame, caixas de som e a TV ligada numa corrida de kart
function rackTv(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot), porta = mat("#c08a52", { roughness: 0.5 });
  caixa(g, 1.8, 0.04, 0.42, M.madeiraEscura, 0, 0.1, 0);
  caixa(g, 1.84, 0.035, 0.44, M.madeiraEscura, 0, 0.5, 0);
  for (const s of [-1, 1]) {
    caixa(g, 0.6, 0.38, 0.42, M.madeira, s * 0.6, 0.3, 0);
    caixa(g, 0.56, 0.34, 0.012, porta, s * 0.6, 0.3, 0.212);
    caixa(g, 0.16, 0.02, 0.02, M.cromo, s * 0.6, 0.42, 0.225);
    for (const t of [-1, 1]) caixa(g, 0.04, 0.08, 0.04, M.metal, s * 0.84, 0.04, t * 0.16);
    // caixas de som de chão
    caixa(g, 0.24, 0.84, 0.26, M.madeiraEscura, s * 1.14, 0.42, 0);
    for (const [y, r] of [[0.68, 0.05], [0.4, 0.085]]) cilindro(g, r, r, 0.012, M.preto, s * 1.14, y, 0.132, 16).rotation.x = Math.PI / 2;
  }
  caixa(g, 0.6, 0.38, 0.02, M.preto, 0, 0.3, -0.19);              // fundo do nicho
  caixa(g, 0.6, 0.02, 0.4, M.madeiraEscura, 0, 0.31, 0);          // prateleira do nicho
  caixa(g, 0.36, 0.07, 0.26, M.branco, 0, 0.155, 0.04);           // console
  caixa(g, 0.22, 0.008, 0.004, new THREE.MeshBasicMaterial({ color: "#4cc3ff" }), 0, 0.17, 0.172);
  ["#c0392b", "#3a6ea5", "#2e8b57", "#f0b429"].forEach((c, k) => caixa(g, 0.025, 0.17, 0.13, mat(c), -0.2 + k * 0.03, 0.405, 0.05));  // jogos
  caixa(g, 0.42, 0.02, 0.22, M.metal, 0, 0.53, -0.05);            // pé da TV
  caixa(g, 0.07, 0.16, 0.04, M.metal, 0, 0.62, -0.08);
  caixa(g, 1.38, 0.8, 0.05, M.preto, 0, 1.08, -0.08);
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(1.32, 0.74), new THREE.MeshBasicMaterial({ map: texVideogame, toneMapped: false }));
  tela.position.set(0, 1.08, -0.05);
  g.add(tela);
  caixa(g, 0.9, 0.07, 0.09, M.preto, 0, 0.555, 0.15);            // soundbar
  return g;
}

// balcão de café: armário com portas, tampo de pedra, cafeteira expresso, moedor, canecas e potes
function balcaoCafe(pai, x, z, rot, comp = 1.8) {
  const g = grupo(pai, x, z, rot), porta = mat("#5f8f8a", { roughness: 0.55 }), vidro = mat("#e6f2f5", { roughness: 0.1, transparent: true, opacity: 0.55 });
  caixa(g, comp, 0.84, 0.58, mat("#f4efe6", { roughness: 0.6 }), 0, 0.46, -0.01);
  caixa(g, comp - 0.04, 0.05, 0.5, M.preto, 0, 0.025, -0.03);
  const n = Math.round(comp / 0.45);
  for (let k = 0; k < n; k++) {
    const px = -comp / 2 + (k + 0.5) * comp / n;
    caixa(g, comp / n - 0.03, 0.7, 0.012, porta, px, 0.46, 0.28);
    caixa(g, 0.014, 0.14, 0.02, M.cromo, px + (k % 2 ? -1 : 1) * (comp / n / 2 - 0.06), 0.68, 0.295);
  }
  caixa(g, comp + 0.04, 0.04, 0.64, mat("#d8d2c4", { roughness: 0.3 }), 0, 0.9, 0);
  caixa(g, comp + 0.04, 0.32, 0.02, mat("#cfe0dc", { roughness: 0.4 }), 0, 1.08, -0.31);   // azulejo atrás
  // cafeteira expresso
  const cx = -comp / 2 + 0.35;
  caixa(g, 0.42, 0.42, 0.36, M.cromo, cx, 1.13, -0.09);
  caixa(g, 0.44, 0.06, 0.38, mat("#b8323a", { roughness: 0.35 }), cx, 1.37, -0.09);
  caixa(g, 0.36, 0.03, 0.14, M.preto, cx, 0.935, 0.12);
  caixa(g, 0.16, 0.05, 0.005, new THREE.MeshBasicMaterial({ color: "#9fe3ff" }), cx, 1.25, 0.092);
  for (const s of [-1, 1]) {
    cilindro(g, 0.04, 0.04, 0.05, M.preto, cx + s * 0.09, 1.0, 0.1, 12);
    caixa(g, 0.025, 0.025, 0.12, M.preto, cx + s * 0.09, 0.995, 0.18);
    cilindro(g, 0.03, 0.025, 0.05, M.branco, cx + s * 0.1, 0.975, 0.12, 10);      // xícaras de café
    cilindro(g, 0.03, 0.025, 0.05, M.branco, cx + s * 0.09, 1.425, -0.09, 10);
  }
  // moedor
  caixa(g, 0.16, 0.22, 0.18, M.preto, cx + 0.36, 1.03, -0.1);
  cilindro(g, 0.08, 0.04, 0.16, mat("#6b4226", { roughness: 0.2, transparent: true, opacity: 0.85 }), cx + 0.36, 1.22, -0.1, 14);
  // bandeja com canecas
  caixa(g, 0.44, 0.015, 0.3, M.madeiraEscura, 0.18, 0.928, 0.02);
  [["#ffffff", 0.06, -0.05], ["#ef5350", 0.28, -0.05], ["#4c8dff", 0.08, 0.09], ["#f0b429", 0.3, 0.09]].forEach(([c, mx, mz]) => caneca(g, mx, mz, c, 0.985));
  // potes de açúcar e de biscoito, copinhos e garrafa térmica
  cilindro(g, 0.06, 0.06, 0.14, vidro, comp / 2 - 0.42, 0.99, -0.12, 14);
  cilindro(g, 0.062, 0.062, 0.02, M.madeira, comp / 2 - 0.42, 1.07, -0.12, 14);
  cilindro(g, 0.075, 0.075, 0.18, mat("#e0a930"), comp / 2 - 0.2, 1.01, -0.12, 16);
  cilindro(g, 0.078, 0.078, 0.03, M.madeiraEscura, comp / 2 - 0.2, 1.115, -0.12, 16);
  cilindro(g, 0.036, 0.03, 0.18, M.branco, comp / 2 - 0.16, 1.01, 0.12, 10);
  cilindro(g, 0.05, 0.05, 0.3, M.metal, comp / 2 - 0.38, 1.07, 0.1, 12);
  cilindro(g, 0.03, 0.03, 0.04, M.preto, comp / 2 - 0.38, 1.24, 0.1, 10);
  return g;
}

// máquina de refrigerante com a frente iluminada, teclado e saída das latas
function maquinaRefri(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot);
  caixa(g, 0.9, 1.86, 0.75, mat("#c62828", { roughness: 0.4 }), 0, 0.95, 0);
  caixa(g, 0.92, 0.04, 0.77, M.preto, 0, 0.02, 0);
  const frente = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.62),
    new THREE.MeshStandardMaterial({ map: texRefri, emissive: "#ffffff", emissiveMap: texRefri, emissiveIntensity: 0.55, roughness: 0.2 }));
  frente.position.set(-0.1, 1.05, 0.381);
  g.add(frente);
  caixa(g, 0.18, 0.56, 0.02, M.preto, 0.33, 1.2, 0.38);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) caixa(g, 0.035, 0.03, 0.01, M.cromo, 0.28 + c * 0.05, 1.38 - r * 0.06, 0.393);
  caixa(g, 0.12, 0.05, 0.005, new THREE.MeshBasicMaterial({ color: "#7dff8a" }), 0.33, 1.44, 0.392);
  caixa(g, 0.05, 0.1, 0.01, M.cromo, 0.33, 0.98, 0.39);
  caixa(g, 0.56, 0.16, 0.04, M.preto, -0.1, 0.16, 0.37);
  return g;
}

// pebolim: campo de 1,2 × 0,7 m (comprimento em x), 8 varetas, bonecos vermelhos e azuis
const geoBola = new THREE.SphereGeometry(0.018, 10, 8);
function pebolim(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot), madeira = mat("#7a4a2a", { roughness: 0.5 });
  caixa(g, 1.2, 0.16, 0.7, madeira, 0, 0.66, 0);
  piso(g, 1.1, 0.6, new THREE.MeshStandardMaterial({ map: texPebolim, roughness: 0.9 }), null, 0, 0.746, 0);
  for (const s of [-1, 1]) {
    caixa(g, 1.2, 0.16, 0.05, madeira, 0, 0.82, s * 0.325);
    caixa(g, 0.05, 0.16, 0.6, madeira, s * 0.575, 0.82, 0);
    caixa(g, 0.02, 0.07, 0.2, M.preto, s * 0.548, 0.78, 0);
    for (const t of [-1, 1]) caixa(g, 0.08, 0.6, 0.08, madeira, s * 0.52, 0.3, t * 0.27);
    caixa(g, 0.06, 0.05, 0.54, madeira, s * 0.52, 0.12, 0);
  }
  caixa(g, 1.0, 0.05, 0.05, madeira, 0, 0.12, 0);
  const times = [mat("#d63a3a"), mat("#2f6fd6")], pele = mat("#f1c7a5");
  [[1, 0], [2, 0], [3, 1], [5, 0], [5, 1], [3, 0], [2, 1], [1, 1]].forEach(([n, t], k) => {
    const rx = -0.49 + k * 0.14;
    cilindro(g, 0.008, 0.008, 1.0, M.cromo, rx, 0.86, 0, 6).rotation.x = Math.PI / 2;
    cilindro(g, 0.02, 0.02, 0.12, M.preto, rx, 0.86, (t ? 1 : -1) * 0.56, 10).rotation.x = Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const pz = n === 1 ? 0 : -0.22 + i * 0.44 / (n - 1);
      caixa(g, 0.035, 0.09, 0.05, times[t], rx, 0.84, pz);
      caixa(g, 0.03, 0.03, 0.03, pele, rx, 0.9, pz);
      caixa(g, 0.028, 0.05, 0.035, times[t], rx, 0.775, pz);
    }
  });
  const bola = new THREE.Mesh(geoBola, M.branco);
  bola.position.set(0.1, 0.765, 0.08);
  g.add(bola);
  return g;
}

function pufe(pai, x, z, cor, topo) {
  cilindro(pai, 0.27, 0.28, 0.34, mat(cor, { roughness: 0.95 }), x, 0.17, z, 22);
  cilindro(pai, 0.255, 0.27, 0.07, mat(topo, { roughness: 0.95 }), x, 0.37, z, 22);
  cilindro(pai, 0.03, 0.03, 0.012, mat(cor), x, 0.408, z, 10);
}

function luminariaPe(pai, x, z) {
  cilindro(pai, 0.16, 0.18, 0.03, M.metal, x, 0.015, z, 18);
  cilindro(pai, 0.015, 0.015, 1.45, M.metal, x, 0.75, z, 8);
  cilindro(pai, 0.14, 0.22, 0.28, mat("#f4e3c1", { emissive: "#ffd99a", emissiveIntensity: 0.6, side: THREE.DoubleSide }), x, 1.56, z, 20);
}

// mesa alta de bistrô (café em pé / conversa no corredor) com canecas
function mesaAlta(pai, x, z, cores = ["#ffffff", "#4c8dff"]) {
  cilindro(pai, 0.24, 0.26, 0.03, M.metal, x, 0.015, z, 18);
  cilindro(pai, 0.03, 0.03, 1.02, M.cromo, x, 0.53, z, 10);
  cilindro(pai, 0.36, 0.36, 0.035, M.madeira, x, 1.05, z, 24);
  cores.forEach((c, k) => caneca(pai, x + (k ? 0.14 : -0.14), z + (k ? 0.05 : -0.06), c, 1.118));
}

function banco(pai, x, z, rot, comp = 1.4) {
  const g = grupo(pai, x, z, rot);
  caixa(g, comp, 0.05, 0.44, M.madeira, 0, 0.43, 0);
  caixa(g, comp - 0.06, 0.08, 0.4, mat("#5a7fb5", { roughness: 0.95 }), 0, 0.495, 0.01);
  for (const s of [-1, 1]) caixa(g, 0.05, 0.42, 0.4, M.metal, s * (comp / 2 - 0.1), 0.21, 0);
  caixa(g, comp, 0.3, 0.05, M.madeira, 0, 0.78, -0.2).rotation.x = -0.1;
  for (const s of [-1, 1]) caixa(g, 0.04, 0.38, 0.04, M.metal, s * (comp / 2 - 0.1), 0.62, -0.2);
  return g;
}

function poltrona(pai, x, z, rot, cor) {
  const g = grupo(pai, x, z, rot), m = mat(cor, { roughness: 0.95 });
  caixa(g, 0.78, 0.2, 0.74, m, 0, 0.24, 0);
  caixa(g, 0.56, 0.12, 0.56, m, 0, 0.4, 0.06);
  caixa(g, 0.78, 0.5, 0.16, m, 0, 0.6, -0.29).rotation.x = -0.1;
  for (const s of [-1, 1]) caixa(g, 0.12, 0.3, 0.74, m, s * 0.33, 0.47, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cilindro(g, 0.02, 0.015, 0.14, M.madeiraEscura, sx * 0.32, 0.07, sz * 0.3, 6);
  caixa(g, 0.34, 0.3, 0.1, mat("#efe4cf", { roughness: 0.95 }), 0.1, 0.58, -0.16).rotation.set(-0.2, 0.15, 0.1);
  return g;
}

function aparador(pai, x, z, rot, comp = 1.4) {
  const g = grupo(pai, x, z, rot);
  caixa(g, comp, 0.04, 0.4, M.madeiraEscura, 0, 0.8, 0);
  caixa(g, comp - 0.06, 0.03, 0.34, M.madeira, 0, 0.18, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.04, 0.78, 0.04, M.madeiraEscura, sx * (comp / 2 - 0.05), 0.39, sz * 0.15);
  // abajur, vaso com flores, livros e cestos na prateleira de baixo
  cilindro(g, 0.07, 0.09, 0.05, M.ouro, -comp / 2 + 0.25, 0.845, 0, 14);
  cilindro(g, 0.012, 0.012, 0.32, M.ouro, -comp / 2 + 0.25, 1.0, 0, 6);
  cilindro(g, 0.11, 0.16, 0.2, mat("#f4e3c1", { emissive: "#ffd99a", emissiveIntensity: 0.6, side: THREE.DoubleSide }), -comp / 2 + 0.25, 1.2, 0, 18);
  cilindro(g, 0.06, 0.045, 0.24, mat("#2f8f8a", { roughness: 0.3 }), comp / 2 - 0.3, 0.94, 0.02, 14);
  for (let k = 0; k < 5; k++) {
    const f = new THREE.Mesh(geoFlor, CORES_FLOR[k % 4]);
    f.position.set(comp / 2 - 0.3 + Math.cos(k * 1.3) * 0.07, 1.1 + (k % 2) * 0.05, 0.02 + Math.sin(k * 1.3) * 0.07);
    f.scale.setScalar(0.05);
    g.add(f);
  }
  caixa(g, 0.26, 0.05, 0.2, mat("#3a6ea5"), 0.05, 0.845, 0).rotation.y = 0.1;
  caixa(g, 0.24, 0.04, 0.18, mat("#c0392b"), 0.05, 0.89, 0).rotation.y = -0.15;
  for (const s of [-1, 1]) caixa(g, 0.36, 0.2, 0.28, mat("#c9a77a", { roughness: 1 }), s * 0.3, 0.295, 0);
  return g;
}

function cabideiro(pai, x, z) {
  cilindro(pai, 0.2, 0.22, 0.03, M.madeiraEscura, x, 0.015, z, 16);
  cilindro(pai, 0.02, 0.025, 1.78, M.madeiraEscura, x, 0.9, z, 8);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    caixa(pai, 0.025, 0.025, 0.16, M.madeiraEscura, x + Math.sin(a) * 0.07, 1.68, z + Math.cos(a) * 0.07).rotation.set(-0.6, a, 0, "YXZ");
  }
  caixa(pai, 0.36, 0.72, 0.13, mat("#8a5a36", { roughness: 0.9 }), x + 0.09, 1.25, z).rotation.z = 0.08;    // casaco
  cilindro(pai, 0.03, 0.01, 0.8, mat("#2f6fd6"), x - 0.12, 0.42, z + 0.05, 8).rotation.z = 0.12;          // guarda-chuva
}

function luminaria(x, z) {
  cilindro(predio, 0.06, 0.22, 0.16, mat("#b08d57", { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }), x, 2.6, z, 20).castShadow = false;
  cilindro(predio, 0.17, 0.17, 0.01, M.luz, x, 2.52, z, 20).castShadow = false;
  cilindro(predio, 0.005, 0.005, 0.25, M.metal, x, 2.8, z, 4).castShadow = false;
}
function luzSala(x, z, intensidade = 7) {
  const l = new THREE.PointLight("#ffd9a0", intensidade, 9, 1.4);
  l.position.set(x, 2.3, z);
  cena.add(l);
}

// tela de parede com o nome da sala (fica nas fachadas do fundo)
function texPlacaSala(titulo, sub, cor) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#0b0f14"; g.fillRect(0, 0, w, h);
    g.fillStyle = cor; g.fillRect(0, 0, w, 10);
    g.fillStyle = "#e6edf3"; g.font = "700 76px Segoe UI, sans-serif"; g.fillText(titulo, 28, 110, w - 56);
    g.fillStyle = cor; g.font = "500 42px Segoe UI, sans-serif"; g.fillText(sub, 30, 175, w - 60);
    g.strokeStyle = cor; g.lineWidth = 4; g.beginPath();
    for (let k = 0; k < 12; k++) g.lineTo(300 + k * 18, 200 - Math.sin(k * 1.3) * 18 - k * 4);
    g.stroke();
  });
}

// ---------------------------------------------------------------- bonecos

// boneco articulado (≈1,85 m em pé): origem no chão sob o quadril, olhando para +z. Nasce sentado à mesa
// (quadril a 0,575 m, coxas na horizontal); `posar` troca a pose (em pé, andando, sofá, café...).
const COXA = 0.42, CANELA = 0.575;   // quadril→joelho e joelho→sola: em pé o quadril fica a 0,995 m
function boneco(pal, { cabelo = "curto", terno = null, gravata = "#b8323a" } = {}) {
  const g = new THREE.Group();
  const pele = mat(pal.pele), roupa = mat(terno || pal.camisa, { roughness: 0.9 }), calca = mat(pal.calca, { roughness: 0.9 });
  const fio = mat(pal.cabelo, { roughness: 0.8 }), sapato = mat("#1d1d22", { roughness: 0.5 });
  const quadril = new THREE.Group();
  quadril.position.set(0, 0.575, -0.03);
  g.add(quadril);
  caixa(quadril, 0.36, 0.16, 0.3, calca, 0, 0.005, 0.01);
  const pernas = [];
  for (const s of [-1, 1]) {
    const coxa = new THREE.Group(), joelho = new THREE.Group();
    coxa.position.x = s * 0.095;
    coxa.rotation.x = -Math.PI / 2;
    joelho.position.y = -COXA;
    joelho.rotation.x = Math.PI / 2;
    quadril.add(coxa); coxa.add(joelho);
    caixa(coxa, 0.15, 0.45, 0.15, calca, 0, -0.21, 0);
    caixa(joelho, 0.13, 0.5, 0.14, calca, 0, -0.25, 0);
    caixa(joelho, 0.14, 0.07, 0.24, sapato, 0, -0.54, 0.05);
    pernas.push({ coxa, joelho });
  }
  const tronco = new THREE.Group();
  tronco.position.set(0, 0.065, 0);
  quadril.add(tronco);
  caixa(tronco, 0.38, 0.46, 0.22, roupa, 0, 0.23, 0);
  if (terno) {
    caixa(tronco, 0.12, 0.28, 0.01, M.branco, 0, 0.31, 0.111);
    caixa(tronco, 0.045, 0.23, 0.012, mat(gravata), 0, 0.29, 0.118);
  }
  caixa(tronco, 0.1, 0.07, 0.1, pele, 0, 0.49, 0);
  const cabeca = new THREE.Group();
  cabeca.position.set(0, 0.52, 0);
  tronco.add(cabeca);
  caixa(cabeca, 0.25, 0.25, 0.25, pele, 0, 0.125, 0);
  for (const s of [-1, 1]) caixa(cabeca, 0.04, 0.045, 0.01, M.preto, s * 0.058, 0.14, 0.126);
  caixa(cabeca, 0.08, 0.015, 0.01, mat("#9b4f45"), 0, 0.065, 0.126);
  caixa(cabeca, 0.27, 0.07, 0.27, fio, 0, 0.27, -0.005);
  if (cabelo === "longo") {
    caixa(cabeca, 0.28, 0.36, 0.07, fio, 0, 0.1, -0.125);
    for (const s of [-1, 1]) caixa(cabeca, 0.035, 0.26, 0.2, fio, s * 0.137, 0.155, -0.03);
    caixa(cabeca, 0.27, 0.05, 0.04, fio, 0, 0.235, 0.12);
  } else {
    caixa(cabeca, 0.27, 0.17, 0.06, fio, 0, 0.185, -0.11);
    for (const s of [-1, 1]) caixa(cabeca, 0.03, 0.1, 0.2, fio, s * 0.133, 0.21, -0.02);
    if (cabelo === "coque") caixa(cabeca, 0.13, 0.13, 0.13, fio, 0, 0.28, -0.15);
  }
  const ombros = [], cotovelos = [], maos = [];
  for (const s of [-1, 1]) {
    const ombro = new THREE.Group();
    ombro.position.set(s * 0.245, 0.42, 0);
    ombro.rotation.x = -0.55;
    tronco.add(ombro);
    caixa(ombro, 0.11, 0.31, 0.11, roupa, 0, -0.14, 0);
    const cotovelo = new THREE.Group();
    cotovelo.position.y = -0.29;
    cotovelo.rotation.x = -0.98;   // antebraço na horizontal, apoiado no tampo (0,75 m)
    ombro.add(cotovelo);
    caixa(cotovelo, 0.1, 0.3, 0.1, roupa, 0, -0.14, 0);
    maos.push(caixa(cotovelo, 0.09, 0.1, 0.09, pele, 0, -0.33, 0.01));
    ombros.push(ombro); cotovelos.push(cotovelo);
  }
  // contorno de seleção (casco invertido) em cada peça, ligado só no hover
  const contornos = [];
  const pecasBoneco = [];
  g.traverse(o => o.isMesh && pecasBoneco.push(o));
  for (const o of pecasBoneco) {
    const { width: w, height: h, depth: d } = o.geometry.parameters;
    const c = new THREE.Mesh(o.geometry, M.contorno);
    c.scale.set((w + 0.035) / w, (h + 0.035) / h, (d + 0.035) / d);
    c.visible = false;
    o.add(c);
    contornos.push(c);
  }
  g.userData = { quadril, pernas, tronco, ombros, cotovelos, maos, contornos, fase: rnd() * 6.28, topo: 1.465 };
  return g;
}

// plumbob verde sobre o trader selecionado
const plumbob = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0),
  new THREE.MeshStandardMaterial({ color: "#3ddc5a", emissive: "#2bbf47", emissiveIntensity: 0.9, roughness: 0.3, flatShading: true }));
plumbob.scale.y = 1.7;
plumbob.visible = false;

// ---------------------------------------------------------------- rótulos (sprites de canvas)
const rotulos = [];
function rotulo(titulo, sub, corSub, corBorda) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texRotulo(titulo, sub, corSub, corBorda), depthTest: false, depthWrite: false, toneMapped: false }));
  s.renderOrder = 10;
  s.center.set(0.5, 0);
  s.userData.base = 1.5;
  s.scale.set(1.5, 1.5 * 150 / 512, 1);
  rotulos.push(s);
  return s;
}
// troca o texto de um rótulo (só quando muda: cada troca desenha um canvas novo)
function retextar(s, ...args) {
  const k = args.join("|");
  if (s.userData.texto === k) return;
  s.userData.texto = k;
  s.material.map.dispose();
  s.material.map = texRotulo(...args);
}
function texRotulo(titulo, sub, corSub = "#8b98a5", corBorda = "#1f2a36") {
  const W = 512, H = 150;
  let fracao = 1;
  const tex = canvasTex(W, H, g => {
    g.font = "600 46px Segoe UI, sans-serif";
    const lt = g.measureText(titulo).width;
    g.font = "36px Segoe UI, sans-serif";
    const larg = Math.min(W - 24, Math.max(lt, g.measureText(sub).width) + 56);
    const x = (W - larg) / 2;
    fracao = larg / W;
    g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14; g.shadowOffsetY = 5;
    g.fillStyle = "rgba(18,24,33,.94)";
    g.beginPath(); g.roundRect(x, 10, larg, H - 26, 26); g.fill();
    g.shadowColor = "transparent";
    g.strokeStyle = corBorda; g.lineWidth = 4; g.stroke();
    g.textAlign = "center";
    g.fillStyle = "#e6edf3"; g.font = "600 46px Segoe UI, sans-serif"; g.fillText(titulo, W / 2, 62);
    g.fillStyle = corSub; g.font = "36px Segoe UI, sans-serif"; g.fillText(sub, W / 2, 108, W - 48);  // texto longo encolhe, não corta
  });
  tex.anisotropy = 1;
  tex.userData.larg = fracao;   // largura da plaquinha / largura do sprite (para o arranjo dos rótulos)
  return tex;
}
// rótulo compacto de quem está ocioso (câmera de cima): "Sofia SMC · WIN" numa linha; pausado ganha "pausado" em
// vermelho embaixo. O canvas tem a largura do texto. Subido `linhas` acima da cabeça (para não cobrir outro rótulo),
// ganha uma haste até a cabeça do dono.
const PX_MINI = 0.36;   // px de tela por px de canvas: o compacto tem tamanho fixo na tela (texto de ~14 px), perto ou longe
const VAO_MINI = 6;     // px de tela entre duas linhas de rótulos
const medidor = document.createElement("canvas").getContext("2d");
function pilulaMini(titulo, pausado) {   // [largura, altura] da plaquinha em px de canvas
  medidor.font = "600 40px Segoe UI, sans-serif";
  return [Math.ceil(medidor.measureText(titulo).width) + 40, pausado ? 94 : 64];
}
function texMini(titulo, pausado, corBorda, linhas = 0) {
  const [W, H] = pilulaMini(titulo, pausado), haste = Math.round(linhas * (H + VAO_MINI / PX_MINI));
  const tex = canvasTex(W, H + haste, g => {
    if (haste) {
      g.fillStyle = "rgba(18,24,33,.8)"; g.fillRect(W / 2 - 4, H - 4, 8, haste + 4);
      g.fillStyle = corBorda; g.fillRect(W / 2 - 1.5, H - 4, 3, haste + 4);
    }
    g.fillStyle = "rgba(18,24,33,.92)"; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 18); g.fill();
    g.strokeStyle = corBorda; g.lineWidth = 4; g.stroke();
    g.textAlign = "center"; g.fillStyle = "#e6edf3"; g.font = "600 40px Segoe UI, sans-serif"; g.fillText(titulo, W / 2, 46);
    if (pausado) { g.fillStyle = "#ef5350"; g.font = "600 26px Segoe UI, sans-serif"; g.fillText("pausado", W / 2, 80); }
  });
  tex.anisotropy = 1;
  return tex;
}

// ---------------------------------------------------------------- salas
const dinamicos = [];   // objetos refeitos a cada atualização do estado
const clicaveis = [];   // bonecos e rótulos que abrem o painel
const salas = {};       // SOFIA | DIDI | CAIO | DEMO | LAB → {def, estacoes, quadro}

// vaga nomeada num ponto local (x, z, giro) do grupo g, convertida para o mundo
const pontoVaga = new THREE.Object3D(), posVaga = new THREE.Vector3(), quatVaga = new THREE.Quaternion(), giroVaga = new THREE.Euler();
function vaga(tipo, g, x, z, rot, pose) {
  pontoVaga.position.set(x, 0, z);
  pontoVaga.rotation.set(0, rot, 0);
  g.add(pontoVaga);
  pontoVaga.updateWorldMatrix(true, false);
  pontoVaga.matrixWorld.decompose(posVaga, quatVaga, giroVaga);
  pontoVaga.removeFromParent();
  const y = giroVaga.setFromQuaternion(quatVaga, "YXZ").y, r = v => Math.round(v * 100) / 100;
  return { tipo, pos: [r(posVaga.x), r(posVaga.z)], rot: Math.round(y * 1000) / 1000, pose };
}

// bandeirinha do Brasil (mesa Brasil) e globo (mesa Global), enfeites de mesa
const texBandeira = canvasTex(200, 140, (g, w, h) => {
  g.fillStyle = "#009c3b"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffdf00"; g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w - 14, h / 2); g.lineTo(w / 2, h - 14); g.lineTo(14, h / 2); g.fill();
  g.fillStyle = "#002776"; g.beginPath(); g.arc(w / 2, h / 2, 33, 0, 7); g.fill();
  g.strokeStyle = "#ffffff"; g.lineWidth = 6; g.beginPath(); g.arc(w / 2 + 6, h / 2 + 60, 66, -2.2, -0.95); g.stroke();
  g.fillStyle = "#ffffff"; for (const [x, y] of [[88, 84], [104, 92], [116, 80], [96, 98], [110, 100]]) g.fillRect(x, y, 3, 3);
});
const texGlobo = canvasTex(256, 128, (g, w, h) => {
  const mar = g.createLinearGradient(0, 0, 0, h);
  mar.addColorStop(0, "#5aa3e0"); mar.addColorStop(0.5, "#2f78c4"); mar.addColorStop(1, "#5aa3e0");
  g.fillStyle = mar; g.fillRect(0, 0, w, h);
  // continentes aproximados (equirretangular): Américas, Europa/África, Ásia, Austrália
  for (const [x, y, rx, ry, c] of [[52, 34, 20, 14, "#6fae4f"], [64, 50, 10, 10, "#6fae4f"], [78, 82, 11, 22, "#5f9e44"], [132, 34, 13, 9, "#7cb85a"],
    [138, 70, 15, 22, "#c9b27a"], [182, 38, 34, 15, "#6fae4f"], [196, 60, 14, 10, "#c9b27a"], [218, 92, 12, 8, "#c9b27a"], [128, 120, 128, 6, "#eef3f6"]]) {
    g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
  }
  ruido(g, w, h, 10);
});
function bandeirinha(g, x, z) {
  cilindro(g, 0.045, 0.055, 0.02, M.metal, x, 0.76, z, 12);
  cilindro(g, 0.006, 0.006, 0.36, M.cromo, x, 0.93, z, 6);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.154), new THREE.MeshStandardMaterial({ map: texBandeira, roughness: 0.8, side: THREE.DoubleSide }));
  f.position.set(x - 0.11, 1.03, z);
  f.rotation.y = Math.PI - 0.25;   // de frente para a câmera, levemente virada como pano
  f.castShadow = true;
  g.add(f);
}
function globo(g, x, z) {
  cilindro(g, 0.07, 0.085, 0.025, M.madeiraEscura, x, 0.7625, z, 16);
  cilindro(g, 0.009, 0.009, 0.07, M.ouro, x, 0.81, z, 6);
  const esfera = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), new THREE.MeshStandardMaterial({ map: texGlobo, roughness: 0.45 }));
  esfera.position.set(x, 0.94, z);
  esfera.rotation.set(0, 2.2, 0.41);
  esfera.castShadow = true;
  g.add(esfera);
  const anel = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.006, 6, 28, Math.PI * 1.15), M.ouro);
  anel.position.set(x, 0.94, z);
  anel.rotation.set(0, Math.PI / 2, 0.41 - 0.5);
  anel.castShadow = true;
  g.add(anel);
}

// estação de trabalho: mesa, monitores (dx de cada um; dois ficam virados para quem senta), teclado, caneca, cadeira,
// lixeira e o enfeite do grupo; o trader senta em z = -0.78
function estacao(pai, x, z, rot, corCaneca, { telas: dxs = [0], enfeite = null, largura = 1.4 } = {}) {
  const g = grupo(pai, x, z, rot);
  mesa(g, largura, 0.7);
  const telas = dxs.map(dx => dx ? monitor(grupo(g, dx, 0.16, Math.sign(dx) * 0.22), 0, 0) : monitor(g, 0, 0.16));
  teclado(g, -0.05, -0.17);
  caneca(g, enfeite ? -largura / 2 + 0.2 : largura / 2 - 0.2, -0.12, corCaneca);
  if (enfeite === "bandeira") bandeirinha(g, largura / 2 - 0.12, -0.2);
  if (enfeite === "globo") globo(g, largura / 2 - 0.14, -0.18);
  const assento = cadeira(g, 0, -0.52);   // empurrada para baixo da mesa; o trader a puxa (−0,78) ao sentar
  lixeira(g, largura / 2 + 0.18, -0.5);
  return { grupo: g, telas, cadeira: assento, vaga: vaga("mesa", g, 0, -0.78, 0, "sentado"), puxada: -0.78, guardada: -0.52 };
}

// rack de servidores do Laboratório: porta escura com os LEDs piscando (verde, âmbar, azul)
const LEDS = ["#3ddc5a", "#f0b429", "#4cc3ff"].map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
function rack(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot);
  caixa(g, 0.6, 1.9, 0.62, mat("#262b33", { roughness: 0.45, metalness: 0.4 }), 0, 0.95, 0);
  caixa(g, 0.52, 1.76, 0.012, mat("#12161c", { roughness: 0.15 }), 0, 0.97, 0.31);
  for (let k = 0; k < 12; k++) {
    const y = 0.24 + k * 0.135;
    caixa(g, 0.46, 0.1, 0.01, mat("#323944"), 0, y, 0.318);
    for (let n = 0; n < 3; n++) caixa(g, 0.022, 0.014, 0.006, LEDS[(k + n) % 3], -0.19 + n * 0.035, y + 0.02, 0.325).castShadow = false;
  }
  return g;
}

// Salas com mesas e lousa: as três dos operacionais (mesa Brasil à esquerda, Global à direita, duas telas cada), a Demo
// (uma mesa por boneco promovido num mercado; três mesas prontas) e o Laboratório (a mesa onde o gerente acompanha os
// testes e os servidores).
const CORES_CANECA = ["#ffffff", "#ef5350", "#4c8dff", "#f0b429", "#26a69a"];
SALAS_OP.forEach((chave, i) => {
  const s = PLANTA.salas[chave], norte = s.z < 0, op = OPERACIONAIS[chave];
  const fundo = norte ? s.z - s.d / 2 : s.z + s.d / 2;     // fachada do fundo
  const ext = [0, norte ? -1 : 1], zMesa = s.z + (norte ? -1.0 : 0.1);
  const estacoes = op ? GRUPOS_FIRMA.map((gr, k) => estacao(predio, s.x + (k ? 1.5 : -1.5), zMesa, Math.PI, CORES_CANECA[(i + k) % 5],
      { telas: [-0.34, 0.34], enfeite: k ? "globo" : "bandeira", largura: 1.6 }))
    : chave === "DEMO" ? [-2.6, 0, 2.6].map((dx, k) => estacao(predio, s.x + dx, zMesa, Math.PI, CORES_CANECA[(i + k) % 5]))
    : [estacao(predio, s.x - 0.6, s.z + 0.3, Math.PI, "#4c8dff", { telas: [-0.34, 0.34], largura: 1.6 })];
  planta(predio, s.x - s.w / 2 + 0.45, fundo - ext[1] * 0.45);
  planta(predio, s.x + s.w / 2 - 0.45, fundo - ext[1] * 0.45, false);
  const lado = s.x < 0 ? -1 : 1;                           // parede lateral externa
  armarioBaixo(predio, s.x + lado * (s.w / 2 - 0.33), s.z + (norte ? 1.75 : -1.75), -lado * Math.PI / 2);
  planta(predio, s.x - lado * (s.w / 2 - 0.45), s.z - ext[1] * 2.4, false);
  const [titulo, sub] = op ? [op.nome, "Brasil · Global"] : chave === "DEMO" ? ["Demo", "promovidos"] : ["Laboratório", "testes · opções"];
  quadroParede(s.x, 1.65, fundo, ext, 1.3, 0.65, texPlacaSala(titulo, sub, s.cor));
  // mesinha de reunião no canto livre e lousa de status encostada na divisória; no Laboratório, os servidores ao lado da
  // lousa e a estante de livros de mercado junto da porta
  mesaReuniao(predio, s.x + lado * 2.3, s.z + (norte ? 1.6 : 2.0), norte ? 0 : Math.PI / 2);
  if (chave === "LAB") {
    for (const dz of [0.9, 1.55]) rack(predio, s.x + s.w / 2 - 0.42, s.z + dz, -Math.PI / 2);
    estante(predio, s.x - 2.2, s.z - s.d / 2 + 0.3, 0);
  }
  const quadro = quadroStatus(predio, s.x - lado * (s.w / 2 - 0.35), s.z + (norte ? 1.0 : -1.0), lado * Math.PI / 2, chave);
  quadroParede(s.x + lado * s.w / 2, 1.6, s.z + (norte ? 1.75 : -1.75), [lado, 0], 0.7, 0.5, ARTES[i % 3]);
  luminaria(s.x - 2, s.z); luminaria(s.x + 2, s.z);
  luzSala(s.x, s.z);
  salas[chave] = { def: s, estacoes, quadro };
});
const placaLab = rotulo("Laboratório", "nenhum teste agora", "#8b98a5", PLANTA.salas.LAB.cor);
placaLab.position.set(-12, 2.2, 4.5);
predio.add(placaLab);

// hall: mesa do gerente, quadro de ranking, sala de espera, bebedouro e plantas
tapete(predio, 0, 0.5, 4, 2.6);
const mesaGerente = grupo(predio, 0, -1.7, 0);   // o gerente senta ao norte da mesa, de frente para o hall
mesa(mesaGerente, 1.8, 0.8, M.madeiraEscura);
const telaGerente = monitor(mesaGerente, 0.3, 0.18);
teclado(mesaGerente, 0.3, -0.18);
caneca(mesaGerente, -0.6, -0.1, "#4c8dff");
// o gerente (um funcionário que anda, ver "funcionários") só senta aqui durante o ciclo real
const mesaDoGerente = { cadeira: cadeira(mesaGerente, 0, -0.6, 0, true), vaga: vaga("mesa", mesaGerente, 0, -0.85, 0, "sentado"), puxada: -0.85, guardada: -0.6 };

const quadro = grupo(predio, 0, -3.62, 0);
caixa(quadro, 2.7, 1.55, 0.08, M.preto, 0, 1.62, 0);
for (const s of [-1, 1]) caixa(quadro, 0.08, 0.9, 0.08, M.metal, s * 1.2, 0.45, 0);
const telaRanking = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.42), M.telaApagada);
telaRanking.position.set(0, 1.62, 0.046);
quadro.add(telaRanking);
const telaRankingVerso = telaRanking.clone();
telaRankingVerso.rotation.y = Math.PI;
telaRankingVerso.position.z = -0.046;
quadro.add(telaRankingVerso);

const sofaHall = sofa(predio, -4.4, -3.3, 0, "#5f7d95");
mesaCentro(predio, -4.4, -2.2);
tapete(predio, -4.4, -2.5, 2.6, 1.7);
const visitas = [cadeiraVisita(predio, -2.9, -2.3, -Math.PI / 2)];
bebedouro(predio, -5.55, 3.5);
planta(predio, -5.45, -1.0);
planta(predio, -5.45, 1.0, false);
planta(predio, 5.45, -3.45);
planta(predio, 5.45, 3.45);
armarioBaixo(predio, 4.2, 3.6, Math.PI, 1.6);
luminaria(-3, 0); luminaria(3, 0); luminaria(0, -2);
luzSala(-3, 0, 6); luzSala(3, 0, 6);

// Diretoria: mesa grande, cadeira executiva, duas cadeiras de visita, estante com troféu
const dir = PLANTA.salas.DIRETORIA;
tapete(predio, dir.x + 0.6, dir.z, 3.6, 2.6);
const mesaDiretor = grupo(predio, dir.x + 0.8, dir.z, -Math.PI / 2);
mesa(mesaDiretor, 2.0, 0.95, M.madeiraEscura);
const telaDiretor = monitor(mesaDiretor, -0.3, 0.2);
teclado(mesaDiretor, -0.3, -0.2);
trofeu(mesaDiretor, 0.75, 0.75, 0.15, 0.9);
caneca(mesaDiretor, 0.45, -0.15, "#f0b429");
cadeira(mesaDiretor, 0, -0.85, 0, true);
visitas.push(cadeiraVisita(predio, dir.x - 0.55, dir.z - 0.55, Math.PI / 2), cadeiraVisita(predio, dir.x - 0.55, dir.z + 0.55, Math.PI / 2));
// o Diretor (você) anda como os funcionários (ver "funcionários"): `eu` é uma pessoa sem rotina, movida pelo clique e pelo V
const diretor = boneco({ pele: "#e8b896", cabelo: "#2b1d14", camisa: "#e9ecef", calca: "#2f2f35" }, { terno: "#2f2f35", gravata: "#4c8dff" });
const eu = { chave: "diretor", raiz: new THREE.Group(), b: diretor, mini: new THREE.Object3D(), balao: new THREE.Object3D(), props: {},
  rota: [], destino: null, fase: 0 };
eu.raiz.add(diretor);
cena.add(eu.raiz);
diretor.userData.alvo = "gerente";
clicaveis.push(diretor);
telaDiretor.userData.alvo = "relatorios";   // o monitor da Diretoria abre os relatórios do dia
clicaveis.push(telaDiretor);
estante(predio, dir.x + 1.6, dir.z - dir.d / 2 + 0.3, 0);
planta(predio, dir.x + dir.w / 2 - 0.45, dir.z + dir.d / 2 - 0.45);
planta(predio, dir.x - dir.w / 2 + 0.5, dir.z - dir.d / 2 + 0.5, false);
const sofaDiretoria = sofa(predio, dir.x - 1.6, dir.z + dir.d / 2 - 0.55, Math.PI, "#7a2f3b");
mesaCentro(predio, dir.x - 1.6, dir.z + 1.4);
quadroParede(dir.x + dir.w / 2, 1.6, dir.z - 1.7, [1, 0], 0.9, 0.6, ARTES[1]);
quadroParede(dir.x + dir.w / 2, 1.6, dir.z + 1.7, [1, 0], 0.9, 0.6, ARTES[2]);
luminaria(dir.x - 1.5, dir.z); luminaria(dir.x + 1.5, dir.z);
luzSala(dir.x, dir.z, 7);
const rotDiretor = eu.rot = rotulo("Diretor (você)", "Diretoria", "#e6edf3", dir.cor);
Object.assign(rotDiretor.userData, { alvo: "gerente", boneco: diretor });
eu.raiz.add(rotDiretor);
clicaveis.push(rotDiretor);
const rotDiretoria = rotulo("Diretoria", "sala do diretor", "#8b98a5", dir.cor);
rotDiretoria.position.set(dir.porta[0] - 0.5, 2.2, dir.porta[1]);
predio.add(rotDiretoria);

// Descanso e jogos: TV com videogame e sofá em L, café, refri, pebolim, pufes e uma mesa alta
const desc = PLANTA.salas.DESCANSO;
tapete(predio, -12.1, -8.3, 3.4, 2.3, 0, texTapeteJogos);
rackTv(predio, -12.2, -9.66, 0);
const sofaJogos = sofaL(predio, -12.2, -7.3, Math.PI, "#3e8e8b");   // olha para a TV; o retorno fica a oeste
mesaCentro(predio, -11.85, -8.45);
controle(predio, -11.75, 0.425, -8.27, 0.4, "#2b2f36");
controle(predio, -11.45, 0.425, -8.32, -0.3, "#eeeae4");
cilindro(predio, 0.1, 0.065, 0.08, M.branco, -11.97, 0.465, -8.64, 18);   // pipoca
cilindro(predio, 0.092, 0.092, 0.02, mat("#f6e7b0", { roughness: 1 }), -11.97, 0.51, -8.64, 18);
pufe(predio, -10.75, -8.75, "#e0a930", "#f0c25a");
pufe(predio, -10.75, -7.85, "#e26d5a", "#ef8b7a");
luminariaPe(predio, -10.65, -6.85);
maquinaRefri(predio, -8.52, -9.45, -Math.PI / 2);
balcaoCafe(predio, -8.42, -7.7, -Math.PI / 2);
lixeira(predio, -8.45, -6.5);
mesaAlta(predio, -10.0, -5.3, ["#f0b429", "#ffffff"]);
pebolim(predio, -14.4, -5.3, Math.PI / 2);
planta(predio, -15.45, -9.45);
planta(predio, -8.5, -4.5, false);
quadroParede(-16, 1.6, -5.2, [-1, 0], 0.7, 0.5, ARTES[0]);
luminaria(-14.3, -7.9); luminaria(-10.0, -7.9);
luzSala(-12, -7, 7);
const rotDescanso = rotulo("Descanso e jogos", "café · videogame · pebolim", "#8b98a5", desc.cor);
rotDescanso.position.set(desc.porta[0] - 0.7, 2.2, desc.porta[1] - 0.5);
predio.add(rotDescanso);
VAGAS_DESCANSO.push(
  // sofá: dois lugares no trecho principal e dois no retorno (coordenadas locais do sofá, que olha para +z)
  vaga("sofa", sofaJogos, -0.7, 0.02, 0, "sentado"), vaga("sofa", sofaJogos, -0.05, 0.02, 0, "sentado"),
  vaga("sofa", sofaJogos, 0.75, 0.47, -Math.PI / 2, "sentado"), vaga("sofa", sofaJogos, 0.75, 1.02, -Math.PI / 2, "sentado"),
  vaga("pufe", predio, -10.75, -8.75, -2.1, "sentado"), vaga("pufe", predio, -10.75, -7.85, -2.45, "sentado"),
  vaga("cafe", predio, -9.3, -8.15, Math.PI / 2, "em_pe"), vaga("cafe", predio, -9.3, -7.25, Math.PI / 2, "em_pe"),
  vaga("cafe", predio, -10.62, -5.3, Math.PI / 2, "em_pe"), vaga("cafe", predio, -9.38, -5.3, -Math.PI / 2, "em_pe"),
  vaga("refri", predio, -9.45, -9.3, Math.PI / 2, "em_pe"),
  vaga("pebolim", predio, -15.2, -5.3, Math.PI / 2, "em_pe"), vaga("pebolim", predio, -13.6, -5.3, -Math.PI / 2, "em_pe"),
);

// Corredor: entrada do prédio a oeste, passadeira até o hall, bancos, cabideiro e mesas altas para conversar
tapete(predio, -11, 0, 9.2, 1.5, 0, texPassadeira);
piso(predio, 0.7, 1.3, mat("#4a3f35", { roughness: 1 }), null, -15.5, 0.016, 0);   // capacho
cabideiro(predio, -15.5, -1.25);
const bancos = [banco(predio, -14.2, -3.62, 0), banco(predio, -14.2, 3.62, Math.PI)];
planta(predio, -15.45, -3.5); planta(predio, -15.45, 3.5);
const poltronas = [poltrona(predio, -8.05, -3.25, 0.5, "#e0a930"), poltrona(predio, -6.75, -3.25, -0.5, "#e0a930")];
cilindro(predio, 0.22, 0.22, 0.03, M.madeira, -7.4, 0.55, -3.6, 20);   // mesinha entre as poltronas
cilindro(predio, 0.03, 0.03, 0.54, M.metal, -7.4, 0.27, -3.6, 8);
cilindro(predio, 0.14, 0.15, 0.02, M.metal, -7.4, 0.01, -3.6, 14);
cilindro(predio, 0.07, 0.055, 0.12, M.terracota, -7.47, 0.625, -3.62, 12);   // vasinho e caneca na mesinha
const vasinho = new THREE.Mesh(geoArbusto, M.folhas[1]);
vasinho.position.set(-7.47, 0.75, -3.62); vasinho.scale.setScalar(0.11); vasinho.castShadow = true;
predio.add(vasinho);
caneca(predio, -7.3, -3.5, "#ffffff", 0.615);
tapete(predio, -7.4, -3.1, 2.4, 1.4, 0, texTapeteJogos);
aparador(predio, -7.4, 3.72, Math.PI);
mesaAlta(predio, -14.0, -1.9);
mesaAlta(predio, -9.6, 2.0, ["#ef5350", "#26a69a"]);
quadroParede(-9.6, 1.6, -4, [0, -1], 0.9, 0.6, ARTES[2]);
quadroParede(-9.6, 1.6, 4, [0, 1], 0.9, 0.6, ARTES[1]);
luminaria(-13.5, 0); luminaria(-8.5, 0);
luzSala(-11, 0, 6);
// pares frente a frente (a olha para b e vice-versa); na mesa alta cada um fica a 0,62 m do centro, sem mesa a 0,45
const par = (x, z, meio = 0.45) => [{ pos: [+(x - meio).toFixed(2), z], rot: 1.571 }, { pos: [+(x + meio).toFixed(2), z], rot: -1.571 }];
VAGAS_CONVERSA.push(par(-14.0, -1.9, 0.62), par(-9.6, 2.0, 0.62), par(-9.6, -2.2));

// ---------------------------------------------------------------- lado de fora: porta de entrada, cafeteria e praça
// Porta da fachada oeste: abre para fora na dobradiça norte. Só o E da primeira pessoa (mirando nela) abre e fecha; de
// cima ela não é clicável. Fechada, segura a primeira pessoa (`bate`) e a grade dos bonecos (`livre`).
const portaEntrada = { aberta: false, angulo: 0, g: grupo(cena, -16, -PLANTA.porta / 2) };
caixa(portaEntrada.g, 0.06, 2.1, PLANTA.porta, mat("#6e4a2f", { roughness: 0.5 }), 0, 1.05, PLANTA.porta / 2);
caixa(portaEntrada.g, 0.08, 0.9, PLANTA.porta - 0.4, M.vidro, 0, 1.45, PLANTA.porta / 2);
for (const s of [-1, 1]) caixa(portaEntrada.g, 0.05, 0.03, 0.14, M.cromo, s * 0.05, 1.0, PLANTA.porta - 0.15);   // maçanetas
portaEntrada.g.userData.alvo = "porta";
clicaveis.push(portaEntrada.g);
pecas.push({ m: portaEntrada.g, porta: true, y0: 0, y1: 2.1, ext: [-1, 0], centro: [-16, 0] });   // desce com o recorte

// tudo que fica na grama: o chão de fora está 15,5 cm abaixo do piso do prédio (os bonecos acompanham, ver `chao`)
const CHAO_FORA = -0.155;
const chao = (x, z) => ambientes.some(a => Math.abs(x - a.x) <= a.w / 2 + 0.1 && Math.abs(z - a.z) <= a.d / 2 + 0.1) ? 0 : CHAO_FORA;
const ext = new THREE.Group();
ext.position.y = CHAO_FORA;
fora.add(ext);
// caminhos de pedra: do caminho da entrada, um vai para o sul até a cafeteria e outro para o norte até a praça
piso(ext, 1.4, 22.7, matCalcada, 1.2, -20.6, 0.004, 12.25);
piso(ext, 1.4, 21.1, matCalcada, 1.2, -20.6, 0.004, -11.45);
piso(ext, 8.7, 1.4, matCalcada, 1.2, -16.95, 0.004, -22);

// Café do Pregão, ao sul: quiosque com o balcão virado para a rua (oeste), toldo listrado, vitrine, máquina de espresso e
// cardápio; no deck, entre o quiosque e a rua, mesinhas com cadeiras e guarda-sóis. O telhado só aparece na primeira pessoa (de cima, aberto como no Sims).
piso(ext, 12.7, 7, new THREE.MeshStandardMaterial({ map: texTaco, roughness: 0.6 }), 1.6, -13.55, 0.008, 23.6);
const quiosque = grupo(ext, -8.5, 23.6, -Math.PI / 2);   // frente (+z local) para o oeste
{
  const parede = mat("#f3e6d3", { roughness: 0.9 }), verde = mat("#2f6b4f", { roughness: 0.7 });
  caixa(quiosque, 5, 2.7, 0.2, parede, 0, 1.35, -1.1);
  for (const s of [-1, 1]) caixa(quiosque, 0.2, 2.7, 2.4, parede, s * 2.4, 1.35, 0);
  caixa(quiosque, 4.6, 1.0, 0.45, verde, 0, 0.5, 0.95);              // balcão
  caixa(quiosque, 4.7, 0.05, 0.55, M.madeira, 0, 1.025, 0.95);
  caixa(quiosque, 1.4, 0.34, 0.42, M.vidro, -1.2, 1.22, 0.95);       // vitrine de doces
  ["#e8a87c", "#c0392b", "#f6d55c", "#8a5a36", "#f4f1f8"].forEach((c, k) =>
    caixa(quiosque, 0.18, 0.08, 0.18, mat(c), -1.75 + k * 0.27, 1.1, 0.95));
  caixa(quiosque, 4.6, 0.9, 0.5, M.madeira, 0, 0.45, -0.75);         // bancada do fundo
  caixa(quiosque, 0.62, 0.45, 0.42, M.cromo, -0.6, 1.13, -0.75);     // espresso
  caixa(quiosque, 0.64, 0.08, 0.44, mat("#c0392b", { roughness: 0.4 }), -0.6, 1.39, -0.75);
  cilindro(quiosque, 0.09, 0.07, 0.35, M.preto, 0.4, 1.08, -0.75, 12);   // moedor
  for (let k = 0; k < 4; k++) caneca(quiosque, 1.0 + k * 0.18, -0.7, ["#ffffff", "#2f6b4f", "#f0b429", "#ffffff"][k], 0.95);
  const cardapio = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshStandardMaterial({ roughness: 0.8,
    map: canvasTex(512, 210, (g, w, h) => {
      g.fillStyle = "#1f2a24"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#c9a96e"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = "#f4ead5"; g.textAlign = "center"; g.font = "700 40px Segoe UI, sans-serif"; g.fillText("Café do Pregão", w / 2, 56);
      g.font = "26px Segoe UI, sans-serif"; g.textAlign = "left";
      [["Espresso", "6"], ["Cappuccino", "9"], ["Pão de queijo", "5"], ["Bolo do dia", "8"]].forEach(([n, v], k) => {
        const x = k % 2 ? 270 : 40, y = 112 + Math.floor(k / 2) * 52;
        g.fillText(n, x, y); g.fillText(`R$ ${v}`, x + 175, y);
      });
    }) }));
  cardapio.position.set(0, 2.0, -0.99);
  quiosque.add(cardapio);
  const toldo = new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(256, 64, (g, w, h) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? "#f4f1ea" : "#2f6b4f"; g.fillRect(k * w / 8, 0, w / 8, h); }
  }) });
  caixa(quiosque, 5.2, 0.04, 1.3, toldo, 0, 2.5, 1.65).rotation.x = 0.35;
  caixa(forro, 2.7, 0.15, 5.3, parede, -8.5, 2.78 + CHAO_FORA, 23.6).castShadow = false;   // telhado (só na primeira pessoa)
}
const rotCafe = rotulo("Café do Pregão", "espresso · pão de queijo", "#c9a96e", "#2f6b4f");
rotCafe.position.set(-8.5, 3.4, 23.6);
fora.add(rotCafe);
const cadeirasCafe = [];
for (const [x, z, guardaSol] of [[-17.5, 22.0, true], [-14.6, 25.3, false], [-12.3, 22.1, true]]) {
  cilindro(ext, 0.24, 0.26, 0.03, M.metal, x, 0.015, z, 18);
  cilindro(ext, 0.03, 0.03, 0.72, M.cromo, x, 0.37, z, 10);
  cilindro(ext, 0.4, 0.4, 0.035, mat("#f4f1ea", { roughness: 0.5 }), x, 0.74, z, 24);
  caneca(ext, x + 0.1, z - 0.08, "#ffffff", 0.81);
  cadeirasCafe.push(cadeiraVisita(ext, x - 0.68, z, Math.PI / 2), cadeiraVisita(ext, x + 0.68, z, -Math.PI / 2));
  if (!guardaSol) continue;
  cilindro(ext, 0.025, 0.025, 2.3, M.cromo, x, 1.55, z, 8);
  cilindro(ext, 0.03, 1.25, 0.35, mat("#e26d5a", { roughness: 0.9 }), x, 2.6, z, 8);
}
for (const [x, z] of [[-19.4, 20.5], [-19.4, 26.7], [-7.7, 26.7], [-7.7, 20.5]]) planta(ext, x, z, z > 23);

// Praça ao norte: chafariz no meio, quatro bancos virados para ele, postes e canteiros
const PRACA = [-8, -22];
{
  const [x, z] = PRACA, pedra = mat("#cfc6b8", { roughness: 0.85 });
  const agua = mat("#5fb7e8", { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
  const disco = new THREE.CircleGeometry(4.3, 48).rotateX(-Math.PI / 2), uv = disco.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8.6 / 1.2, uv.getY(i) * 8.6 / 1.2);
  const chaoPraca = new THREE.Mesh(disco, matCalcada);
  chaoPraca.position.set(x, 0.006, z);
  chaoPraca.receiveShadow = true;
  ext.add(chaoPraca);
  cilindro(ext, 1.4, 1.5, 0.4, pedra, x, 0.2, z, 32);
  cilindro(ext, 1.28, 1.28, 0.02, agua, x, 0.41, z, 32);   // espelho d'água por cima da pedra, com a borda à mostra
  cilindro(ext, 0.16, 0.22, 1.0, pedra, x, 0.9, z, 12);
  cilindro(ext, 0.55, 0.25, 0.18, pedra, x, 1.45, z, 20);
  cilindro(ext, 0.48, 0.48, 0.02, agua, x, 1.55, z, 20);
  cilindro(ext, 0.05, 0.03, 0.35, agua, x, 1.72, z, 8);
  for (const [dx, dz] of [[-3.9, -1.2], [3.9, -1.2], [-3.9, 1.6], [3.9, 1.6]]) {
    cilindro(ext, 0.06, 0.08, 3.2, mat("#2b2f36", { roughness: 0.5, metalness: 0.5 }), x + dx, 1.6, z + dz, 10);
    cilindro(ext, 0.17, 0.17, 0.3, M.luz, x + dx, 3.3, z + dz, 14);
  }
  for (let k = 0; k < 10; k++) { const a = k * 0.63 + 0.3; arbusto(x + Math.sin(a) * 4.7, z + Math.cos(a) * 4.7, 0.32); }
}
const bancosPraca = [45, 135, 225, 315].map(g => {
  const a = g * GRAU;
  return banco(ext, PRACA[0] + 3.0 * Math.sin(a), PRACA[1] + 3.0 * Math.cos(a), a + Math.PI);
});
const rotPraca = rotulo("Praça", "chafariz · bancos", "#8b98a5", "#4fae7b");
rotPraca.position.set(PRACA[0], 3.6, PRACA[1]);
fora.add(rotPraca);

// lugares de fora: assentos (o Diretor também senta) e pontos em pé dos NPCs; a chave "f<n>" ocupa para todos
const LUGARES_FORA = [
  ...cadeirasCafe.map(g => ({ ...vaga("fora", g, 0, 0, 0, "sentado"), assento: 0.6, texto: "no café" })),
  ...bancosPraca.flatMap(g => [-0.35, 0.35].map(x => ({ ...vaga("fora", g, x, 0, 0, "sentado"), assento: 0.62, texto: "na praça" }))),
].map((l, i) => ({ chave: `f${i}`, ...l }));
const PONTOS_NPC = [
  ...LUGARES_FORA,
  ...[23.0, 24.3].map((z, i) => ({ chave: `fb${i}`, pos: [-10.1, z], rot: Math.PI / 2, pose: "caneca" })),   // no balcão
  { chave: "fc0", pos: [PRACA[0] - 1.9, PRACA[1]], rot: Math.PI / 2, pose: "em_pe" },                 // na beira do chafariz
  { chave: "fc1", pos: [PRACA[0] + 1.9, PRACA[1] + 0.4], rot: -Math.PI / 2, pose: "em_pe" },
  { chave: "fr0", pos: [-23.2, -5], rot: 0, pose: "em_pe" }, { chave: "fr1", pos: [-23.2, 9], rot: Math.PI, pose: "em_pe" },   // calçada
];
const VAGA_BARISTA = { ...vaga("fora", quiosque, 0.3, 0.15, 0, "em_pe"), chave: "barista", pose: "em_pe" };

// onde o Diretor senta com um clique (as cadeiras das mesas de trabalho ficam para os traders); assento = altura do
// quadril. Os lugares do descanso guardam a chave da vaga ("d3"): quem está lá (ou indo para lá) ocupa para os dois lados.
const lugar = (g, x, z, assento, texto) => ({ ...vaga("lugar", g, x, z, 0, "sentado"), assento, texto });
const LUGARES = [
  { ...lugar(mesaDiretor, 0, -0.85, 0.575, "Diretoria"), pose: "digitando" },
  ...[sofaHall, sofaDiretoria].flatMap(g => [-0.47, 0.47].map(x => lugar(g, x, 0.02, 0.535, "no sofá"))),
  ...visitas.map(g => lugar(g, 0, 0, 0.6, "na cadeira")),
  ...bancos.flatMap(g => [-0.35, 0.35].map(x => lugar(g, x, 0, 0.62, "no banco"))),
  ...poltronas.map(g => lugar(g, 0, 0.02, 0.535, "na poltrona")),
].map((l, i) => ({ chave: `a${i}`, ...l })).concat(VAGAS_DESCANSO.flatMap((v, i) => v.pose !== "sentado" ? [] :
  [{ ...v, chave: `d${i}`, assento: v.tipo === "sofa" ? 0.535 : 0.48, texto: v.tipo === "sofa" ? "no sofá" : "no pufe" }]),
  LUGARES_FORA);

// ---------------------------------------------------------------- texturas que dependem do estado
const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const STATUS = { promovido: ["promovido", "#26a69a"], experiencia: ["em experiência", "#f0b429"], pausado: ["pausado", "#ef5350"],
  sem_tarefa: ["sem tarefa", "#8b98a5"] };

function texCurva(t) {
  return canvasTex(320, 190, (g, w, h) => {
    g.fillStyle = "#0b0f14"; g.fillRect(0, 0, w, h);
    const v = (t.equity || []).map(p => p[1]);
    const final = v.at(-1) ?? 5000, cor = final >= 5000 ? "#26a69a" : "#ef5350";
    g.fillStyle = "#e6edf3"; g.font = "600 22px Segoe UI, sans-serif"; g.fillText(t.nome, 12, 28, w - 120);
    g.fillStyle = cor; g.font = "600 20px Segoe UI, sans-serif"; g.textAlign = "right";
    g.fillText(brl(final - 5000), w - 12, 28); g.textAlign = "left";
    if (v.length < 2) return;
    const lo = Math.min(...v, 5000), hi = Math.max(...v, 5000), y = x => 170 - (x - lo) / (hi - lo || 1) * 120;
    g.strokeStyle = "#1f2a36"; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(10, y(5000)); g.lineTo(w - 10, y(5000)); g.stroke(); g.setLineDash([]);
    g.beginPath();
    v.forEach((x, i) => g.lineTo(10 + i * (w - 20) / (v.length - 1), y(x)));
    g.strokeStyle = cor; g.lineWidth = 3; g.stroke();
    g.lineTo(w - 10, 178); g.lineTo(10, 178); g.closePath();
    g.fillStyle = cor + "33"; g.fill();
  });
}

// ---- bonecos e lousas (a lousa 3D e o painel lateral usam os mesmos dados)
const PENDENCIAS_OPCOES = ["como escolher a opção (call/put, strike, vencimento)", "quais ações acompanhar",
  "quais operacionais usar no 60 min", "fonte de dados das opções (MT5 Genial?)", "regra de saída e tamanho da posição"];
const objeto = x => !!x && typeof x === "object" && !Array.isArray(x);
// traders que se leem: objeto com nome; status fora de STATUS vira "—" (nada de "undefined" no quadro)
const tradersValidos = d => (Array.isArray(d?.traders) ? d.traders : []).filter(t => objeto(t) && t.nome)
  .map(t => ({ ...t, status: STATUS[t.status] ? t.status : null }));
const ORDEM = { promovido: 3, experiencia: 2, pausado: 1 };   // o status do boneco é o melhor entre os mercados dele
const reqs = t => Array.isArray(t.requisitos) ? t.requisitos.filter(objeto) : [];
const nReq = t => { const r = reqs(t); return r.length ? `${r.filter(x => x.ok).length} de ${r.length} requisitos` : "requisitos no próximo ciclo"; };
const corTexto = c => c === "#f0b429" ? "#b7791f" : c;   // o amarelo do status não se lê no quadro branco
// Boneco = (operacional, grupo): os mercados do grupo em que o trader dele foi avaliado (estado.salas[ATIVO]), os
// mercados do grupo ainda sem dados e o melhor status. Chave "SOFIA:Brasil".
function montarBonecos(estado) {
  const out = {};
  for (const op of OPS) for (const gr of GRUPOS_FIRMA) out[`${op}:${gr}`] = { boneco: true, op, grupo: gr, sala: op,
    nome: `${OPERACIONAIS[op].nome} · ${gr}`, mercados: [], aguardando: [], status: null };
  for (const [ativo, d] of Object.entries(objeto(estado?.salas) ? estado.salas : {})) {
    if (ativo === "OPCOES" || !objeto(d)) continue;   // OPCOES é a lousa de pendências do Laboratório
    const gr = grupoDo(ativo);
    if (d.status !== "ok") { for (const op of OPS) out[`${op}:${gr}`].aguardando.push({ ativo, motivo: d.motivo || "" }); continue; }
    for (const t of tradersValidos(d)) {
      const op = opDoTrader(t.nome);
      if (op) out[`${op}:${gr}`].mercados.push({ ...t, ativo, op, grupo: gr, mercado: true });
    }
  }
  for (const b of Object.values(out)) b.status = b.mercados.reduce((m, t) => (ORDEM[t.status] || 0) > (ORDEM[m] || 0) ? t.status : m, null);
  return out;
}
let bonecos = montarBonecos(null), laboratorio = {};
const promovidos = () => Object.values(bonecos).flatMap(b => b.mercados.filter(t => t.status === "promovido").map(t => ({ ...t, dono: b.nome })));
const pendenciasOpcoes = estado => { const p = estado?.salas?.OPCOES?.pendencias; return Array.isArray(p) && p.length ? p : PENDENCIAS_OPCOES; };
const linhasLab = () => (Array.isArray(laboratorio?.linhas) ? laboratorio.linhas : []).filter(objeto);
const quemLab = l => `${OPERACIONAIS[opDoTrader(l.trader)]?.nome ?? l.trader ?? "—"} · ${l.grupo || grupoDo(l.ativo)}`;
const numero = (v, casas = 2) => typeof v === "number" ? v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) : "—";

function quebrar(g, texto, larg) {   // linhas que cabem em `larg` px com a fonte atual
  const linhas = [];
  let atual = "";
  for (const p of String(texto).split(" ")) {
    const t = atual ? `${atual} ${p}` : p;
    if (atual && g.measureText(t).width > larg) { linhas.push(atual); atual = p; } else atual = t;
  }
  return atual ? [...linhas, atual] : linhas;
}

const FONTE = "Segoe UI, sans-serif", EMOJI = "Segoe UI Emoji, Segoe UI Symbol, sans-serif";
const TOM = { up: "#1b8a5a", dn: "#c0392b", warn: "#b7791f", mut: "#6a737d" };
const quando = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""; };
const rodapeGerente = estado => estado?.gerado_em ? `atualizado pelo gerente: ${quando(estado.gerado_em)}` : "sem ciclo do gerente";

// moldura das lousas: quadro branco com marcas de apagador, faixa da cor da sala, título, resumo, risco e rodapé
function lousa(chave, titulo, resumo, tom, rodape, desenhar) {
  return canvasTex(1024, 768, (g, w, h) => {
    const fundo = g.createLinearGradient(0, 0, w, h);
    fundo.addColorStop(0, "#ffffff"); fundo.addColorStop(1, "#e9edf0");
    g.fillStyle = fundo; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(120,130,140,.05)";
    [[180, 600, 160], [760, 120, 120], [520, 700, 200], [880, 520, 110]].forEach(([x, y, r]) => { g.beginPath(); g.ellipse(x, y, r, r * 0.22, -0.2, 0, 7); g.fill(); });
    g.fillStyle = PLANTA.salas[chave].cor; g.fillRect(38, 28, 12, 60);
    g.fillStyle = "#1d3f7a"; g.font = `700 50px ${FONTE}`; g.fillText(titulo, 66, 74, w - 110);
    g.fillStyle = TOM[tom]; g.font = `700 32px ${FONTE}`; g.fillText(resumo, 66, 118, w - 110);
    g.strokeStyle = "#1d3f7a"; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 138); g.quadraticCurveTo(w / 2, 144, w - 40, 136); g.stroke();
    g.fillStyle = "#7a838c"; g.font = `20px ${FONTE}`; g.textAlign = "right"; g.fillText(rodape, w - 40, h - 18); g.textAlign = "left";
    desenhar(g, w, h);
  });
}
// bandeira do Brasil ou globo (as mesmas texturas das mesas) no canvas; devolve a largura usada
function iconeGrupo(g, gr, x, y, alto) {
  if (gr === "Brasil") {
    g.drawImage(texBandeira.image, x, y, alto * 1.43, alto);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1; g.strokeRect(x, y, alto * 1.43, alto);
    return alto * 1.43;
  }
  g.save(); g.beginPath(); g.arc(x + alto / 2, y + alto / 2, alto / 2, 0, 7); g.clip();
  g.drawImage(texGlobo.image, x - alto * 0.4, y, alto * 2, alto); g.restore();
  return alto;
}
const tracejado = (g, x, y0, y1) => { g.strokeStyle = "rgba(29,63,122,.35)"; g.lineWidth = 2; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke(); g.setLineDash([]); };

// sala do operacional: dois blocos (Brasil e Global), uma linha por mercado com status e "N de M requisitos"
function texQuadroOp(op, estado) {
  const bs = GRUPOS_FIRMA.map(gr => bonecos[`${op}:${gr}`]);
  return lousa(op, `${PLANTA.salas[op].nome} · status`, ...resumoOp(op), rodapeGerente(estado), (g, w, h) => {
    bs.forEach((b, i) => {
      const col = (w - 80) / 2, x = 40 + i * col + 14, larg = col - 28;
      if (i) tracejado(g, 40 + col, 160, h - 50);
      const li = iconeGrupo(g, b.grupo, x, 160, 32);
      g.fillStyle = "#1f2328"; g.font = `700 34px ${FONTE}`; g.fillText(b.nome, x + li + 14, 188, larg - li - 14);
      const linhas = [...b.mercados, ...b.aguardando.map(a => ({ ...a, aguardando: true }))];
      if (!linhas.length) {
        g.fillStyle = "#6a737d"; g.font = `italic 26px ${FONTE}`;
        quebrar(g, "nenhum mercado avaliado ainda", larg).forEach((l, k) => g.fillText(l, x, 258 + k * 34));
        return;
      }
      const passo = Math.min(76, (h - 310) / linhas.length), duas = passo >= 58;
      linhas.forEach((t, k) => {
        const y = 256 + k * passo;
        const [nomeSt, corSt] = t.aguardando ? ["aguardando dados", "#8b98a5"] : STATUS[t.status] || ["—", "#8b98a5"];
        g.fillStyle = corSt; g.beginPath(); g.arc(x + 9, y - 10, 9, 0, 7); g.fill();
        g.fillStyle = "#1f2328"; g.font = `700 30px ${FONTE}`; g.fillText(t.ativo, x + 28, y);
        g.fillStyle = corTexto(corSt); g.font = `700 25px ${FONTE}`; g.textAlign = "right"; g.fillText(nomeSt, x + larg, y); g.textAlign = "left";
        if (!duas) return;
        const detalhe = t.aguardando ? (t.motivo || "sem dados do mercado") : `${nReq(t)}${typeof t.prova?.resultado === "number" ? ` · prova ${brl(t.prova.resultado)}` : ""}`;
        g.fillStyle = "#4f5861"; g.font = `23px ${FONTE}`; g.fillText(detalhe, x + 28, y + 30, larg - 28);
      });
    });
  });
}

// Sala da Demo: quem foi promovido em qual mercado
function texQuadroDemo(estado) {
  const lista = promovidos();
  return lousa("DEMO", "Sala da Demo · promovidos", lista.length ? `${lista.length} na demo` : "ninguém promovido ainda",
    lista.length ? "up" : "mut", rodapeGerente(estado), (g, w) => {
      if (!lista.length) {
        g.fillStyle = "#4f5861"; g.font = `30px ${FONTE}`;
        g.fillText("uma mesa para cada boneco promovido num mercado;", 52, 230, w - 100);
        g.fillText("pausado volta para a sala do operacional", 52, 272, w - 100);
        return;
      }
      lista.slice(0, 8).forEach((t, k) => {
        const y = 222 + k * 62;
        const li = iconeGrupo(g, t.grupo, 52, y - 28, 30);
        g.fillStyle = "#1f2328"; g.font = `700 32px ${FONTE}`; g.fillText(t.dono, 66 + li, y, 420);
        g.fillStyle = "#1d3f7a"; g.font = `700 30px ${FONTE}`; g.fillText(t.ativo, 520, y);
        const r = t.prova?.resultado;
        if (typeof r === "number") { g.fillStyle = r >= 0 ? "#1b8a5a" : "#c0392b"; g.textAlign = "right"; g.fillText(`prova ${brl(r)}`, w - 52, y); g.textAlign = "left"; }
      });
    });
}

// Laboratório: a última rodada de testes (/api/laboratorio) e as pendências das opções
function texQuadroLab(estado) {
  const linhas = linhasLab(), passaram = linhas.filter(l => l.passou === true).length;
  const resumo = linhas.length ? [laboratorio.titulo || "última rodada", quando(laboratorio.quando)].filter(Boolean).join(" · ") : "nenhuma rodada ainda";
  const rodape = linhas.length ? `${linhas.length} variante${linhas.length > 1 ? "s" : ""} · ${passaram} passa${passaram === 1 ? "ou" : "ram"}` : "os testes pedidos ao Claude aparecem aqui";
  return lousa("LAB", "Laboratório · última rodada", resumo, linhas.length ? (passaram ? "up" : "dn") : "mut", rodape, (g, w, h) => {
    if (linhas.length) {
      const cols = [[52, "Quem", "left"], [262, "Mercado", "left"], [425, "Variante", "left"], [712, "Trades", "right"], [858, "Resultado", "right"], [935, "PF", "right"]];
      g.fillStyle = "#6a737d"; g.font = `700 22px ${FONTE}`;
      for (const [x, t, a] of cols) { g.textAlign = a; g.fillText(t, x, 186); }
      linhas.slice(0, 7).forEach((l, k) => {
        const y = 230 + k * 42, celulas = [quemLab(l), `${l.ativo ?? "—"}${l.tf ? ` ${l.tf}m` : ""}`, String(l.variante ?? "—"), l.trades ?? "—",
          typeof l.resultado === "number" ? brl(l.resultado) : "—", numero(l.pf)];
        if (k % 2) { g.fillStyle = "rgba(29,63,122,.05)"; g.fillRect(44, y - 30, w - 88, 42); }
        celulas.forEach((c, n) => {
          const [x, , a] = cols[n];
          g.textAlign = a; g.font = `${n < 2 ? 700 : 500} 24px ${FONTE}`;
          g.fillStyle = n === 4 && typeof l.resultado === "number" ? (l.resultado >= 0 ? "#1b8a5a" : "#c0392b") : "#1f2328";
          g.fillText(String(c), x, y, [200, 150, 265][n] ?? 130);
        });
        g.textAlign = "left"; g.font = `22px ${EMOJI}`; g.fillText(l.passou ? "✅" : "❌", 948, y);
      });
      if (linhas.length > 7) { g.fillStyle = "#6a737d"; g.font = `italic 22px ${FONTE}`; g.fillText(`+ ${linhas.length - 7} variantes no painel`, 52, 556); }
      g.textAlign = "left";
    } else {
      g.fillStyle = "#4f5861"; g.font = `30px ${FONTE}`;
      g.fillText("nenhuma rodada ainda: peça um teste ao Claude", 52, 230, w - 100);
    }
    // pendências das opções logo abaixo da tabela (ou do aviso), em duas colunas
    const topo = linhas.length ? Math.max(440, 230 + Math.min(linhas.length, 7) * 42 + (linhas.length > 7 ? 50 : 20)) : 300;
    g.strokeStyle = "rgba(29,63,122,.35)"; g.lineWidth = 2; g.beginPath(); g.moveTo(44, topo); g.lineTo(w - 44, topo); g.stroke();
    g.fillStyle = "#1f2328"; g.font = `700 30px ${FONTE}`; g.fillText("Opções · pendências (decisão do Diretor)", 52, topo + 44);
    pendenciasOpcoes(estado).slice(0, 6).forEach((p, k) => {
      const x = k % 2 ? 530 : 52, y = topo + 92 + Math.floor(k / 2) * 44;
      g.fillStyle = "#1d3f7a"; g.font = `26px ${EMOJI}`; g.fillText("☐", x, y + 2);
      g.fillStyle = "#2b2f36"; g.font = `25px ${FONTE}`; g.fillText(p, x + 34, y, 420);
    });
  });
}

const texQuadroStatus = (chave, estado) => chave === "LAB" ? texQuadroLab(estado) : chave === "DEMO" ? texQuadroDemo(estado) : texQuadroOp(chave, estado);
function pintarQuadro(chave, estado) {
  const tela = salas[chave].quadro, map = texQuadroStatus(chave, estado);
  tela.material.map?.dispose(); tela.material.dispose();
  // um pouco de emissivo: o texto continua legível com a sala na penumbra
  tela.material = new THREE.MeshStandardMaterial({ map, roughness: 0.45, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.3 });
}

// telas das mesas: ociosa (o grupo de mercado daquela tela), teste em andamento e a rodada do Laboratório
function texTelaOciosa(titulo, sub, cor) {
  return canvasTex(320, 190, (g, w, h) => {
    g.fillStyle = "#0b0f14"; g.fillRect(0, 0, w, h);
    g.fillStyle = cor; g.fillRect(0, 0, w, 6);
    g.textAlign = "center";
    g.fillStyle = "#8b98a5"; g.font = `600 30px ${FONTE}`; g.fillText(titulo, w / 2, 96, w - 24);
    g.fillStyle = "#4a5663"; g.font = `20px ${FONTE}`; g.fillText(sub, w / 2, 130, w - 24);
  });
}
const progresso = pq => { const n = Number(pq.n) || 0, t = Number(pq.total) || 0; return t > 1 ? `${n}/${t}` : ""; };
function texTeste(pq, cor) {
  return canvasTex(320, 190, (g, w, h) => {
    g.fillStyle = "#0d1712"; g.fillRect(0, 0, w, h);
    g.fillStyle = cor; g.fillRect(0, 0, w, 6);
    g.fillStyle = "#7ee2b0"; g.font = `600 20px ${FONTE}`; g.fillText("● testando", 14, 34);
    g.fillStyle = "#e6edf3"; g.font = `700 50px ${FONTE}`; g.fillText(pq.ativo ?? "—", 14, 92, w - 28);
    g.fillStyle = "#8b98a5"; g.font = `18px ${FONTE}`; g.fillText(pq.rotulo || quemLab(pq), 14, 120, w - 28);
    const n = Number(pq.n) || 0, t = Number(pq.total) || 0, f = t > 0 ? Math.min(1, n / t) : 1;
    g.fillStyle = "#1f2a36"; g.fillRect(14, 140, w - 28, 18);
    g.fillStyle = "#26a69a"; g.fillRect(14, 140, (w - 28) * f, 18);
    g.fillStyle = "#e6edf3"; g.font = `600 18px ${FONTE}`; g.textAlign = "right"; g.fillText(progresso(pq) || "1 variante", w - 14, 182); g.textAlign = "left";
  });
}

function texRanking(estado) {
  return canvasTex(1024, 568, (g, w, h) => {
    g.fillStyle = "#0f1620"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#4c8dff"; g.fillRect(0, 0, w, 12);
    g.fillStyle = "#e6edf3"; g.font = "700 52px Segoe UI, sans-serif"; g.fillText("Ranking da firma", 40, 86);
    g.fillStyle = "#8b98a5"; g.font = "30px Segoe UI, sans-serif"; g.fillText("resultado na prova (últimos 21 pregões)", 40, 128);
    const r = (estado?.ranking || []).slice(0, 6);
    if (!r.length) { g.fillText("sem ranking: o gerente ainda não rodou", 40, 220); return; }
    r.forEach((x, i) => {
      const y = 196 + i * 60;
      g.fillStyle = i % 2 ? "#121a25" : "#16202d"; g.fillRect(28, y - 42, w - 56, 56);
      g.fillStyle = i === 0 ? "#f0b429" : "#8b98a5"; g.font = "700 34px Segoe UI, sans-serif"; g.fillText(`${i + 1}º`, 44, y);
      g.fillStyle = "#e6edf3"; g.font = "600 34px Segoe UI, sans-serif"; g.fillText(x.nome, 118, y);
      g.fillStyle = PLANTA.salas[opDoTrader(x.nome)]?.cor || "#8b98a5"; g.font = "30px Segoe UI, sans-serif"; g.fillText(x.sala, 560, y);
      g.fillStyle = x.prova_resultado >= 0 ? "#26a69a" : "#ef5350"; g.font = "700 34px Segoe UI, sans-serif";
      g.textAlign = "right"; g.fillText(brl(x.prova_resultado), w - 48, y); g.textAlign = "left";
    });
  });
}

function texCavalete(linhas, sub) {   // placa amarela de aviso: duas linhas grandes e uma menor
  return canvasTex(256, 340, (g, w, h) => {
    g.fillStyle = "#f0b429"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#16181d";
    for (let x = -40; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 0); g.lineTo(x + 40, 26); g.lineTo(x + 20, 26); g.fill(); }
    g.textAlign = "center"; g.font = "800 40px Segoe UI, sans-serif";
    linhas.forEach((l, k) => g.fillText(l, w / 2, 130 + k * 48, w - 20));
    g.font = "600 34px Segoe UI, sans-serif"; g.fillText(sub, w / 2, 250, w - 20);
  });
}

function cavalete(x, z, linhas, sub) {
  const g = new THREE.Group(), tex = texCavalete(linhas, sub);
  g.position.set(x, 0, z);
  for (const s of [-1, 1]) {
    const lado = new THREE.Group();
    lado.position.z = s * 0.14;
    lado.rotation.x = -s * 0.2;   // os dois lados se encostam no alto (cavalete em A)
    g.add(lado);
    caixa(lado, 0.64, 0.86, 0.025, M.madeira, 0, 0.46, 0);
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.78), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    placa.position.set(0, 0.46, s * 0.014);
    if (s < 0) placa.rotation.y = Math.PI;
    lado.add(placa);
  }
  return g;
}

// ---------------------------------------------------------------- fusão dos estáticos
// Funde mobília, pisos e área externa por material: ~1.500 malhas viram poucas dezenas de chamadas
// de desenho. Ficam de fora o que muda: telas, bonecos e quadros (somem com o recorte).
// `destino` recebe as malhas fundidas (no espaço local dele): a cena, ou uma cadeira móvel fundida em si mesma.
function fundirEstaticos(raizes, manter, destino = cena) {
  const porMaterial = new Map(), fundidas = [];
  destino.updateMatrixWorld(true);
  const paraDestino = destino.matrixWorld.clone().invert(), m4 = new THREE.Matrix4();
  const visitar = o => {
    if (manter.has(o)) return;
    if (o.isMesh) {
      const k = o.material.uuid + o.castShadow;
      if (!porMaterial.has(k)) porMaterial.set(k, { material: o.material, sombra: o.castShadow, geos: [], malhas: [] });
      const grupoMat = porMaterial.get(k);
      grupoMat.geos.push((o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(m4.multiplyMatrices(paraDestino, o.matrixWorld)));
      grupoMat.malhas.push(o);
    }
    o.children.forEach(visitar);
  };
  raizes.forEach(r => { r.updateMatrixWorld(true); visitar(r); });
  for (const { material, sombra, geos, malhas } of porMaterial.values()) {
    malhas.forEach(m => m.removeFromParent());
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    m.castShadow = sombra;
    m.receiveShadow = true;
    destino.add(m);
    fundidas.push(m);
    geos.forEach(g => g.dispose());
  }
  return fundidas;
}
// as cadeiras das mesas andam (puxadas ao sentar): cada uma vira uma malha por material (4 em vez de 17)
const cadeirasMoveis = [...SALAS_OP.flatMap(a => salas[a].estacoes.map(e => e.cadeira)), mesaDoGerente.cadeira];
for (const c of cadeirasMoveis) fundirEstaticos([c], new Set(), c);
const malhasFixas = fundirEstaticos([predio, fora], new Set([
  ...SALAS_OP.flatMap(a => [...salas[a].estacoes.flatMap(e => e.telas), salas[a].quadro]), ...cadeirasMoveis,
  telaGerente, telaDiretor, telaRanking, telaRankingVerso, diretor,
  ...pecas.filter(pc => pc.inteira).map(pc => pc.m),
]));

// ---------------------------------------------------------------- funcionários: rotina pela atividade real
// Cada trader (e o gerente) é uma pessoa que sobrevive aos polls (chave "sala:nome"). Só trabalha na mesa quando
// o gerente está processando a sala dele (/api/atividade); senão vai para o descanso ou conversa no corredor.
// Anda a 1,3 m/s por uma grade de 10 cm (paredes e móveis bloqueados, portas abertas) com A*.
const GR = { x0: -34, z0: -29, passo: 0.1, nx: 541, nz: 581 };   // o prédio e o terreno em volta (cafeteria, praça, rua)
const bloqueio = new Uint8Array(GR.nx * GR.nz);
function bloquear(x0, z0, x1, z1, folga) {   // marca as células com centro dentro do retângulo alargado pela folga
  const i0 = Math.max(0, Math.ceil((x0 - folga - GR.x0) / GR.passo)), i1 = Math.min(GR.nx - 1, Math.floor((x1 + folga - GR.x0) / GR.passo));
  const k0 = Math.max(0, Math.ceil((z0 - folga - GR.z0) / GR.passo)), k1 = Math.min(GR.nz - 1, Math.floor((z1 + folga - GR.z0) / GR.passo));
  for (let k = k0; k <= k1 && i0 <= i1; k++) bloqueio.fill(1, k * GR.nx + i0, k * GR.nx + i1 + 1);
}
for (const c of COLISORES) bloquear(c.min[0], c.min[2], c.max[0], c.max[2], 0.25);   // paredes: folga do ombro
// móveis: cada triângulo da mobília fundida entre 8 cm e 1,5 m de altura (pisos e tapetes ficam de fora)
for (const m of malhasFixas) {
  const p = m.geometry.attributes.position.array, idx = m.geometry.index?.array, n = idx ? idx.length : p.length / 3;
  for (let t = 0; t < n; t += 3) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const j = 3 * (idx ? idx[t + v] : t + v), x = p[j], y = p[j + 1], z = p[j + 2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    if (y1 < 0.08 || y0 > 1.5 || x1 < GR.x0 || x0 > GR.x0 + GR.nx * GR.passo || z1 < GR.z0 || z0 > GR.z0 + GR.nz * GR.passo) continue;
    bloquear(x0, z0, x1, z1, 0.1);
  }
}
const celula = (x, z) => [Math.round((x - GR.x0) / GR.passo), Math.round((z - GR.z0) / GR.passo)];
// a porta de entrada fechada bloqueia o vão (com a folga das paredes); aberta, dá para sair
const naPorta = (i, k) => Math.abs(GR.x0 + i * GR.passo + 16) < 0.3 && Math.abs(GR.z0 + k * GR.passo) < PLANTA.porta / 2 + 0.25;
const livre = (i, k) => i >= 0 && k >= 0 && i < GR.nx && k < GR.nz && !bloqueio[k * GR.nx + i] && (portaEntrada.aberta || !naPorta(i, k));
const pontoDe = c => [GR.x0 + (c % GR.nx) * GR.passo, GR.z0 + Math.floor(c / GR.nx) * GR.passo];
function celulaLivre(x, z) {   // a célula livre mais perto de (x, z): quem está no sofá começa e termina fora dele
  const [ci, ck] = celula(x, z);
  for (let r = 0; r < 30; r++) {
    let melhor = -1, dm = Infinity;
    for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dk)) !== r || !livre(ci + di, ck + dk)) continue;
      const d = di * di + dk * dk;
      if (d < dm) { dm = d; melhor = (ck + dk) * GR.nx + ci + di; }
    }
    if (melhor >= 0) return melhor;
  }
  return -1;
}
const enxerga = (a, b) => {   // segmento todo em células livres (para encurtar a rota em linhas retas)
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
  for (let s = 1; s < n; s++) if (!livre(...celula(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n))) return false;
  return true;
};
const custoG = new Float32Array(GR.nx * GR.nz), veio = new Int32Array(GR.nx * GR.nz), geracao = new Uint32Array(GR.nx * GR.nz);
let geracaoAtual = 0;
const VIZ = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
// rota de `de` até `ate` ([x, z]): pontos de passagem pelas portas, terminando exatamente em `ate`;
// null se não há caminho (quem chama fica onde está: nunca atravessa parede em linha reta)
function caminho(de, ate) {
  const a = celulaLivre(...de), b = celulaLivre(...ate);
  if (a < 0 || b < 0) return null;
  const g = ++geracaoAtual, bx = b % GR.nx, bk = Math.floor(b / GR.nx);
  const h = c => 1.5 * Math.hypot(c % GR.nx - bx, Math.floor(c / GR.nx) - bk);   // A* com peso: bem menos células, rota quase ótima
  const heap = [[h(a), a]];   // heap binário de [f, célula]
  const sobe = () => { let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const tira = () => {
    const topo = heap[0], ult = heap.pop();
    if (heap.length) {
      heap[0] = ult;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return topo;
  };
  geracao[a] = g; custoG[a] = 0; veio[a] = -1;
  let melhor = a, hm = h(a);
  while (heap.length) {
    const [f, c] = tira();
    if (c === b) { melhor = b; break; }
    if (f - h(c) > custoG[c] + 1e-3) continue;   // entrada velha do heap
    const ci = c % GR.nx, ck = Math.floor(c / GR.nx);
    for (const [di, dk, w] of VIZ) {
      const ni = ci + di, nk = ck + dk;
      if (!livre(ni, nk) || (di && dk && (!livre(ci + di, ck) || !livre(ci, ck + dk)))) continue;   // sem cortar quina
      const n = nk * GR.nx + ni, ng = custoG[c] + w;
      if (geracao[n] === g && ng >= custoG[n]) continue;
      geracao[n] = g; custoG[n] = ng; veio[n] = c;
      const hn = h(n);
      if (hn < hm) { hm = hn; melhor = n; }
      heap.push([ng + hn, n]); sobe();
    }
  }
  if (melhor !== b) return null;
  const celulas = [];
  for (let c = melhor; c >= 0; c = veio[c]) celulas.push(pontoDe(c));
  celulas.reverse();
  const rota = [celulas[0]];   // encurta: de cada ponto, vai em linha reta até o último que ainda enxerga
  for (let i = 0; i < celulas.length - 1;) {
    let j = i + 1;
    while (j + 1 < celulas.length && enxerga(celulas[i], celulas[j + 1])) j++;
    rota.push(celulas[j]); i = j;
  }
  rota.push(ate);
  return rota;
}

// poses: altura do quadril (q: "assento" = da vaga; sem q = em pé), inclinação do tronco e os braços
// [ombro.x, cotovelo.x, ombro para dentro] do direito (x−) e do esquerdo
const BRACO_SOLTO = [0.02, -0.12, -0.06];
const POSES = {
  digitando: { q: true, bracos: [[-0.55, -0.98, 0], [-0.55, -0.98, 0]] },
  sentado: { q: true, incl: -0.1, bracos: [[-0.25, -0.95, 0.05], [-0.25, -0.95, 0.05]] },
  videogame: { q: true, incl: -0.05, bracos: [[-0.6, -0.9, 0.32], [-0.6, -0.9, 0.32]], prop: "controle" },
  em_pe: { bracos: [BRACO_SOLTO, BRACO_SOLTO] },
  caneca: { bracos: [[-0.35, -1.25, 0.15], BRACO_SOLTO], prop: "caneca" },
  lata: { bracos: [[-0.35, -1.25, 0.15], BRACO_SOLTO], prop: "lata" },
  pebolim: { incl: 0.2, bracos: [[-0.5, -0.1, 0], [-0.5, -0.1, 0]] },
  conversa: { bracos: [BRACO_SOLTO, BRACO_SOLTO] },
  andando: { bracos: [[0, -0.25, -0.06], [0, -0.25, -0.06]] },
};
const ASSENTO = { mesa: 0.575, sofa: 0.535, pufe: 0.48 };
// o que cada vaga do descanso vira: os dois lugares do sofá de frente para a TV jogam videogame
const ATIVIDADES = VAGAS_DESCANSO.map(v => v.tipo === "sofa"
  ? (Math.abs(Math.abs(v.rot) - Math.PI) < 0.1 ? { pose: "videogame", texto: "jogando videogame" } : { pose: "sentado", texto: "no sofá" })
  : { pufe: { pose: "sentado", texto: "no pufe" }, cafe: { pose: "caneca", texto: "no café" }, refri: { pose: "lata", texto: "tomando um refri" },
      pebolim: { pose: "pebolim", texto: "pebolim" } }[v.tipo]);
const IDX_CAFE = VAGAS_DESCANSO.flatMap((v, i) => v.tipo === "cafe" ? [i] : []), IDX_TODAS = VAGAS_DESCANSO.map((v, i) => i);

const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
function posar(p, nome, assento = 0.575) {
  const P = POSES[nome], u = p.b.userData;
  const q = P.q ? assento : COXA + CANELA, coxa = P.q ? -Math.acos(THREE.MathUtils.clamp((q - CANELA) / COXA, -1, 1)) : 0;
  u.quadril.position.y = q;
  u.pernas.forEach(pr => { pr.coxa.rotation.x = coxa; pr.joelho.rotation.x = -coxa; });   // canela sempre na vertical
  u.tronco.rotation.set(P.incl || 0, 0, 0);
  P.bracos.forEach(([ox, cx, dentro], i) => { u.ombros[i].rotation.set(ox, 0, (i ? -1 : 1) * dentro); u.ombros[i].position.y = 0.42; u.cotovelos[i].rotation.x = cx; });
  u.topo = q + 0.89;
  p.rot.position.y = u.topo + 0.5;
  p.mini.position.y = u.topo + 0.25;
  p.balao.position.y = u.topo - 0.3;   // ao lado do rosto, abaixo do rótulo
  p.pose = nome;
  // a caneca, a lata ou o controle vão para a mão direita (e acompanham o gole / o jogo)
  for (const [k, o] of Object.entries(p.props)) {
    o.visible = k === P.prop;
    if (!o.visible) continue;
    p.raiz.add(o);
    p.raiz.updateMatrixWorld(true);
    p.raiz.worldToLocal(u.maos[0].getWorldPosition(v3));
    if (k === "controle") v3.add(p.raiz.worldToLocal(u.maos[1].getWorldPosition(v3b))).multiplyScalar(0.5);
    o.position.copy(v3).add(v3b.set(k === "controle" ? 0 : 0.02, k === "controle" ? 0.02 : 0.03, 0.02));
    o.rotation.set(k === "controle" ? -0.5 : 0, 0, 0);
    p.raiz.updateMatrixWorld(true);
    u.cotovelos[0].attach(o);
  }
}

// balão "…" de quem está falando: três quadros (•, ••, •••)
const texBalao = [1, 2, 3].map(n => canvasTex(128, 96, g => {
  g.fillStyle = "#ffffff"; g.strokeStyle = "#1f2a36"; g.lineWidth = 5;
  g.beginPath(); g.roundRect(6, 6, 116, 62, 24); g.moveTo(40, 66); g.lineTo(30, 90); g.lineTo(62, 66); g.fill(); g.stroke();
  g.fillStyle = "#ffffff"; g.fillRect(38, 60, 26, 9);
  g.fillStyle = "#1f2a36";
  for (let k = 0; k < n; k++) { g.beginPath(); g.arc(36 + k * 28, 37, 8, 0, 7); g.fill(); }
}));

const pessoas = new Map();   // chave → pessoa
const pedido = new URLSearchParams(location.search), INSTANTANEO = pedido.get("instantaneo") === "1";
// ?atividade=sala:WIN[:trader] (ou ocioso) simula o ciclo do gerente; &teste=WDO:Didi Agulhada[:12/40] simula um teste do
// Laboratório (o campo `pesquisa`); &hora=10 fixa a hora do expediente — úteis para capturas. firma.simularAtividade(json)
// aceita o mesmo formato de /api/atividade: {gerente, pesquisa}
const ativ = { real: null, simulada: null };
{
  const [tipo, sala, trader] = (pedido.get("atividade") || "").split(":");
  if (tipo === "sala" && sala) ativ.simulada = { gerente: { estado: "trabalhando", sala, trader: trader || null } };
  else if (tipo === "ocioso") ativ.simulada = { gerente: { estado: "ocioso", sala: null, trader: null } };
}
{
  const [ativo, trader, prog] = (pedido.get("teste") || "").split(":");
  if (ativo) {
    const [n, total] = (prog || "1/1").split("/").map(Number);
    (ativ.simulada ??= { gerente: { estado: "ocioso", sala: null, trader: null } }).pesquisa = { trader: trader || "Sofia SMC", ativo, n, total, rotulo: "" };
  }
}
const atividadeAgora = () => (ativ.simulada ?? ativ.real)?.gerente || { estado: "ocioso" };
const pesquisaAgora = () => { const p = (ativ.simulada ?? ativ.real)?.pesquisa; return objeto(p) && p.ativo ? p : null; };
const grupoPesquisa = pq => GRUPOS_FIRMA.includes(pq.grupo) ? pq.grupo : grupoDo(pq.ativo);
// expediente na firma: Global também à noite; Brasil só no horário da B3 (9h às 18h, hora deste computador)
const HORA = pedido.has("hora") ? Number(pedido.get("hora")) : null;
const expediente = gr => gr === "Global" || (h => h >= 9 && h < 18)(HORA ?? new Date().getHours());

function criarPessoa(chave, pal, opc) {
  const raiz = new THREE.Group(), b = boneco(pal, opc);
  raiz.add(b);
  cena.add(raiz);
  const rot = rotulo("", "");
  rot.userData.boneco = b;
  raiz.add(rot);
  const mini = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, toneMapped: false, opacity: 0, sizeAttenuation: false }));
  mini.renderOrder = 10; mini.center.set(0.5, 0); mini.visible = false;
  mini.userData = { mini: true, boneco: b };
  raiz.add(mini);
  clicaveis.push(b, rot, mini);
  // balão ao lado da cabeça (o centro deslocado põe o sprite à direita na tela, de qualquer ângulo); escala como os rótulos
  const balao = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBalao[2], depthTest: false, depthWrite: false, toneMapped: false }));
  balao.center.set(-0.25, 0.1); balao.renderOrder = 9; balao.visible = false;   // por baixo dos rótulos
  Object.assign(balao.userData, { base: 0.42, aspecto: 0.75, balao: true });
  raiz.add(balao);
  rotulos.push(balao);
  const props = { caneca: new THREE.Group(), lata: new THREE.Group(), controle: new THREE.Group() };
  caneca(props.caneca, 0, 0, "#ffffff", 0);
  cilindro(props.lata, 0.033, 0.033, 0.12, mat("#e53935", { roughness: 0.3, metalness: 0.5 }), 0, 0, 0, 12);
  controle(props.controle, 0, 0, 0, 0, "#2b2f36");
  const p = { chave, raiz, b, rot, mini, balao, props, novo: true, rota: [], destino: null, fase: rnd() * 6.28, giroAlvo: 0,
    miniTexto: ["", false, "#1f2a36"], texMinis: [], linha: 0 };
  mini.material.map = mapaMini(p, 0);
  pessoas.set(chave, p);
  posar(p, "em_pe");
  return p;
}
function definirAlvo(p, alvo, titulo, corBorda) {
  p.alvo = p.b.userData.alvo = p.rot.userData.alvo = p.mini.userData.alvo = alvo;
  p.titulo = titulo; p.corBorda = corBorda;
}
function removerPessoa(p) {
  if (selecionado === p.b) selecionar(null);
  if (sobre === p.b) marcarSobre(null);
  p.raiz.removeFromParent();
  for (const [lista, o] of [[clicaveis, p.b], [clicaveis, p.rot], [clicaveis, p.mini], [rotulos, p.rot], [rotulos, p.balao]]) {
    const k = lista.indexOf(o); if (k >= 0) lista.splice(k, 1);
  }
  p.rot.material.map.dispose(); p.rot.material.dispose();
  p.texMinis.forEach(t => t?.dispose()); p.mini.material.dispose(); p.balao.material.dispose();
  pessoas.delete(p.chave);
}
function legenda(p) {   // o rótulo mostra a atividade real; andando para o descanso, "aguardando tarefa"
  if (p.npc) return;
  if (p === eu) return retextar(p.rot, "Diretor (você)", p.rota.length ? "andando" : p.destino?.texto || "em pé", "#e6edf3", dir.cor);
  const d = p.destino || { chave: "", texto: "aguardando tarefa" }, andando = p.rota.length > 0;
  const pausado = p.alvo?.status === "pausado" && d.chave !== "mesa";
  const texto = andando && d.chave !== "mesa" ? "aguardando tarefa" : d.texto;
  retextar(p.rot, p.titulo, pausado ? `pausado · ${texto}` : texto, d.chave === "mesa" ? "#26a69a" : pausado ? "#ef5350" : "#c9d1d9", p.corBorda);
  const titulo = p.chave === "gerente" ? "Gerente" : p.titulo;
  if (p.miniTexto.join("|") === [titulo, pausado, p.corBorda].join("|")) return;
  p.miniTexto = [titulo, pausado, p.corBorda];
  p.texMinis.forEach(t => t?.dispose());
  p.texMinis = [];
  p.mini.material.map = mapaMini(p, p.linha);
}
// textura do compacto na linha k (0 = logo acima da cabeça), desenhada uma vez por texto
const mapaMini = (p, k) => (p.texMinis[k] ??= texMini(...p.miniTexto, k));

// Rótulos na câmera de cima. Cheio (nome + atividade): quem trabalha, quem está sob o mouse e o selecionado. Os
// ociosos mostram o compacto, que some com a câmera longe (entre ROTULO_PERTO e ROTULO_LONGE m do foco) e também
// quando cobriria outro rótulo na tela (antes sobe até 2 linhas): placas e rótulos cheios primeiro, depois quem já
// aparecia (não pisca) e então do mais perto da câmera para o mais longe. Em primeira pessoa: rótulo cheio para todos.
const ROTULO_PERTO = 20, ROTULO_LONGE = 26;
const vRot = new THREE.Vector3(), vRotCima = new THREE.Vector3();
function retangulo(s, larg = 1) {   // [x0, y0, x1, y1] em px; null se atrás da câmera
  s.getWorldPosition(vRot);
  vRotCima.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(s.scale.y).add(vRot);
  vRot.project(camera); vRotCima.project(camera);
  if (Math.abs(vRot.z) > 1) return null;
  const { clientWidth: W, clientHeight: H } = renderer.domElement;
  const x = (vRot.x + 1) / 2 * W, y = (1 - vRot.y) / 2 * H;
  const alto = (vRotCima.y - vRot.y) / 2 * H;
  const meio = alto * s.scale.x / s.scale.y * larg / 2 + 3;   // 3 px de folga de cada lado
  return [x - meio, y - alto - 3, x + meio, y + 3];
}
const cruza = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const naCena = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function arrumarRotulos(dt, fp, distancia) {
  const forca = fp ? 0 : 1 - THREE.MathUtils.clamp((distancia - ROTULO_PERTO) / (ROTULO_LONGE - ROTULO_PERTO), 0, 1);
  const minis = [];
  for (const p of pessoas.values()) {
    const cheio = fp || p.destino?.chave === "mesa" || p.b === sobre || p.b === selecionado;
    p.rot.visible = cheio;
    if (!cheio) { minis.push(p); continue; }
    // sob o mouse, o compacto fica invisível mas ainda "acertável": o rótulo cheio (mais alto) não pisca ao mexer o mouse
    p.mini.visible &&= !fp && p.b === sobre && p.b !== selecionado && p.destino?.chave !== "mesa";
    p.mini.material.opacity = 0; p.mostrado = false;
  }
  if (!minis.length) return;
  const ocupados = [];
  for (const s of rotulos) {
    if (s.userData.mini || s.userData.balao || !naCena(s)) continue;
    const r = retangulo(s, s.material.map.userData.larg ?? 1);
    if (r) ocupados.push(r);
  }
  const { clientWidth: W, clientHeight: H } = renderer.domElement, porPx = 2 * Math.tan(camera.fov * GRAU / 2) / H;
  for (const p of minis) {   // ponto da tela logo acima da cabeça (null: câmera longe ou atrás)
    p.mini.getWorldPosition(vRot).project(camera);
    p.ancora = forca > 0 && Math.abs(vRot.z) <= 1 ? [(vRot.x + 1) / 2 * W, (1 - vRot.y) / 2 * H] : null;
  }
  minis.sort((a, b) => (b.mostrado - a.mostrado) || (b.ancora?.[1] ?? -1) - (a.ancora?.[1] ?? -1));
  for (const p of minis) {   // na linha da cabeça ou até 2 linhas acima (sempre centrado no dono, com haste); senão some
    p.mostrado = false;
    const [w, h] = pilulaMini(p.miniTexto[0], p.miniTexto[1]).map(v => v * PX_MINI);
    if (p.ancora) for (const k of new Set([p.linha, 0, 1, 2])) {
      const [x, y] = p.ancora, dy = k * (h + VAO_MINI), r = [x - w / 2 - 3, y - h - dy - 3, x + w / 2 + 3, y - dy + 3];
      if (ocupados.some(o => cruza(o, r))) continue;
      ocupados.push(r);
      p.mostrado = true;
      if (k !== p.linha) { p.linha = k; p.mini.material.map = mapaMini(p, k); }
      p.mini.renderOrder = k ? 9.5 : 10;   // a haste passa por baixo dos rótulos da linha de baixo
      break;
    }
    const img = p.mini.material.map.image;
    p.mini.scale.set(img.width * PX_MINI * porPx, img.height * PX_MINI * porPx, 1);
    const m = p.mini.material, alvo = p.mostrado ? forca : 0;
    m.opacity += Math.sign(alvo - m.opacity) * Math.min(Math.abs(alvo - m.opacity), dt * 5);
    p.mini.visible = m.opacity > 0.02;
  }
}

// a gente da firma no estado novo: cria quem chegou, atualiza a ficha de quem ficou e tira quem saiu
eu.destino = LUGARES[0];
eu.raiz.position.set(eu.destino.pos[0], 0, eu.destino.pos[1]);
eu.raiz.rotation.y = eu.destino.rot;
posar(eu, eu.destino.pose, eu.destino.assento);

// Gente de fora (NPCs): a barista do café e quatro pessoas que trocam de lugar (café, balcão, praça, calçada) a cada
// 40–100 s. Sem rótulo nem ficha; ocupam os lugares de fora para o Diretor e entre si.
const GENTE_FORA = [
  [{ pele: "#f1c7a5", cabelo: "#2a1a10", camisa: "#2f6b4f", calca: "#3a3a40" }, { cabelo: "coque" }],
  [{ pele: "#c98e63", cabelo: "#d9b36c", camisa: "#e26d5a", calca: "#2e3a5a" }, { cabelo: "longo" }],
  [{ pele: "#8d5a3b", cabelo: "#121010", camisa: "#f6d55c", calca: "#4a3b2c" }, {}],
  [{ pele: "#f3d2b8", cabelo: "#6b3b22", camisa: "#5fb3ad", calca: "#33363f" }, { cabelo: "longo" }],
  [{ pele: "#e0ac85", cabelo: "#2b2b2b", camisa: "#8a6bd8", calca: "#22303f" }, {}],
];
const npcs = GENTE_FORA.map(([pal, opc], i) => {
  const raiz = new THREE.Group(), b = boneco(pal, opc), props = { caneca: new THREE.Group() };
  raiz.add(b);
  cena.add(raiz);
  caneca(props.caneca, 0, 0, "#ffffff", 0);
  return { chave: `npc${i}`, npc: true, novo: true, raiz, b, props, rota: [], destino: null, fase: 0, ate: 0,
    rot: new THREE.Object3D(), mini: new THREE.Object3D(), balao: new THREE.Object3D() };
});
irPara(npcs[0], VAGA_BARISTA);
npcs[0].ate = Infinity;   // a barista não sai do balcão
function passearNpcs() {
  const agora = Date.now() / 1000, ocupadas = new Set([eu, ...npcs].map(p => p.destino?.chave));
  for (const n of npcs) {
    if (n.rota.length || agora < n.ate) continue;
    const livres = PONTOS_NPC.filter(l => !ocupadas.has(l.chave));
    const l = livres[Math.floor(Math.random() * livres.length)];
    if (!l) continue;
    ocupadas.delete(n.destino?.chave);
    ocupadas.add(l.chave);
    n.ate = agora + 40 + Math.random() * 60;
    irPara(n, l);
  }
}
passearNpcs();
setInterval(passearNpcs, 5000);
const gerente = criarPessoa("gerente", { pele: "#d9a37c", cabelo: "#4a4a4a", camisa: "#e9ecef", calca: "#25324a" }, { terno: "#25324a" });
definirAlvo(gerente, "gerente", "Gerente", "#4c8dff");
gerente.mesa = mesaDoGerente;
gerente.lab = salas.LAB.estacoes[0];   // durante um teste do Laboratório o gerente acompanha dali
// os seis bonecos (operacional × grupo) existem sempre, cada um na sua mesa; o estado novo só troca a ficha
function sincronizarPessoas(estado) {
  bonecos = montarBonecos(estado);
  OPS.forEach(op => GRUPOS_FIRMA.forEach((gr, k) => {
    const chave = `${op}:${gr}`, b = bonecos[chave], o = OPERACIONAIS[op], [camisa, calca] = o.roupa[gr];
    const p = pessoas.get(chave) || criarPessoa(chave, { pele: o.pele, cabelo: o.cabelo, camisa, calca }, { cabelo: o.corte });
    definirAlvo(p, b, b.nome, (STATUS[b.status] || [])[1] || "#8b98a5");
    Object.assign(p, { sala: op, grupo: gr, mesa: salas[op].estacoes[k] });
  }));
  equipeConhecida = true;
  distribuir();
}
let equipeConhecida = false;   // até o primeiro estado ninguém se mexe (o gerente não vai ao café e volta)

const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// Quem vai para onde. Trabalha só quem tem tarefa: no ciclo do gerente, os bonecos do grupo do mercado em processamento
// que têm esse mercado (e não estão pausados nele) e o gerente na mesa dele; num teste do Laboratório (`pesquisa`), o
// boneco (trader, grupo) do teste e o gerente na mesa do Laboratório. Global trabalha a qualquer hora; Brasil só das 9h
// às 18h (fora disso fica no descanso mesmo com tarefa). Cada ocioso tem a sua "vez" (troca a cada 2–5 min, período e fase tirados do nome):
// enquanto a vez não muda ele fica onde está; na troca sorteia (nome + vez) entre conversar em par no corredor e
// uma vaga livre do descanso. Pausados não conversam; o gerente prefere o café.
// Pausado nunca vai à mesa (o gerente tirou a tarefa dele). Quem sentou para trabalhar fica pelo menos GRACA s depois
// que a tarefa da sala acabou (um ciclo curto ainda mostra a equipe na mesa); quem ainda ia a caminho volta.
const GRACA = 30;
const inalcancaveis = new Set();   // vagas sem rota (nunca acontece na planta de hoje): ninguém tenta de novo
function distribuir() {
  const g = atividadeAgora(), salaAtiva = g.estado === "trabalhando" ? g.sala : null, agora = Date.now() / 1000;
  const grupoAtivo = salaAtiva && (GRUPOS_FIRMA.includes(g.grupo) ? g.grupo : grupoDo(salaAtiva));
  const pq = pesquisaAgora(), opTeste = pq && opDoTrader(pq.trader), grupoTeste = pq && grupoPesquisa(pq);
  const destinos = new Map(), ociosos = [];
  for (const p of pessoas.values()) {
    if (!p.alvo) continue;
    let texto = null, est = p.mesa;
    if (p.chave === "gerente") {
      if (salaAtiva) texto = `trabalhando: backtest ${salaAtiva}${g.trader ? ` · ${g.trader}` : ""}`;
      else if (pq) { texto = `no laboratório: teste de ${pq.ativo}`; est = p.lab; }
    } else if (expediente(p.grupo)) {
      const mercado = salaAtiva && grupoAtivo === p.grupo && p.alvo.mercados.find(t => t.ativo === salaAtiva);
      if (pq && opTeste === p.sala && grupoTeste === p.grupo) texto = `testando: ${pq.ativo}${progresso(pq) ? ` · ${progresso(pq)}` : ""}`;
      else if (mercado && mercado.status !== "pausado") texto = `trabalhando: backtest ${salaAtiva}`;
    }
    if (texto) {
      p.fimTarefa = null;
      destinos.set(p, { chave: "mesa", estacao: est, pos: est.vaga.pos, rot: est.vaga.rot, pose: "digitando", assento: ASSENTO.mesa, texto });
    } else if (p.sentou && p.destino?.chave === "mesa" && agora - (p.fimTarefa ??= agora) < GRACA) destinos.set(p, p.destino);
    else { p.fimTarefa = null; ociosos.push(p); }
  }
  const vez = p => { const h = hash(p.chave), periodo = 120 + h % 181; return Math.floor((agora + h % periodo) / periodo); };
  const sorteio = p => hash(`${p.chave}:${vez(p)}`);
  for (const p of ociosos) {   // quem não trocou de vez fica (a troca de um não empurra os outros)
    const d = p.destino;
    if (d && d.vez === vez(p) && !(d.par !== undefined && p.alvo.status === "pausado")) destinos.set(p, d);
  }
  const pares = new Map();   // par do corredor → quantos ficaram nele; quem ficou sozinho escolhe de novo
  for (const d of destinos.values()) if (d.par !== undefined) pares.set(d.par >> 1, (pares.get(d.par >> 1) || 0) + 1);
  for (const [p, d] of destinos) if (d.par !== undefined && pares.get(d.par >> 1) === 1) { destinos.delete(p); pares.delete(d.par >> 1); }
  const ocupada = new Set([...destinos.values(), eu.destino].map(d => d?.chave));
  const novos = ociosos.filter(p => !destinos.has(p)).sort((a, b) => (b.chave === "gerente") - (a.chave === "gerente") || (a.chave < b.chave ? -1 : 1));
  const papo = novos.filter(p => p.alvo.status !== "pausado" && sorteio(p) % 3 === 0);
  const paresLivres = VAGAS_CONVERSA.map((_, i) => i).filter(i => !pares.has(i) && !inalcancaveis.has(`c${2 * i}`) && !inalcancaveis.has(`c${2 * i + 1}`));
  for (let k = 0; k + 1 < papo.length && paresLivres.length; k += 2) {
    const i = paresLivres.shift();
    [papo[k], papo[k + 1]].forEach((p, lado) => {
      const v = VAGAS_CONVERSA[i][lado];
      destinos.set(p, { chave: `c${2 * i + lado}`, pos: v.pos, rot: v.rot, pose: "conversa", texto: "conversando", par: 2 * i + lado, vez: vez(p) });
    });
  }
  for (const p of novos) {
    if (destinos.has(p)) continue;
    const s = sorteio(p), livreEm = cand => cand.map((_, k) => cand[(s + k) % cand.length]).find(i => !ocupada.has(`d${i}`) && !inalcancaveis.has(`d${i}`));
    const i = (p.chave === "gerente" ? livreEm(IDX_CAFE) : undefined) ?? livreEm(IDX_TODAS);
    let d;
    if (i === undefined) {   // descanso lotado: espera em pé no corredor, à beira da passadeira
      let n = 0;
      while (ocupada.has(`s${n}`) || inalcancaveis.has(`s${n}`)) n++;
      const lado = n % 2 ? 1 : -1;
      d = { chave: `s${n}`, pos: [-14.6 + (n >> 1) * 0.9, lado * 1.15], rot: lado > 0 ? Math.PI : 0, pose: "em_pe", texto: "aguardando tarefa" };
    } else {
      const v = VAGAS_DESCANSO[i];
      d = { chave: `d${i}`, pos: v.pos, rot: v.rot, assento: ASSENTO[v.tipo], ...ATIVIDADES[i] };
    }
    d.vez = vez(p);
    ocupada.add(d.chave);
    destinos.set(p, d);
  }
  for (const [p, d] of destinos) irPara(p, d);
  pintarTelas();
}

function irPara(p, d) {
  const mesmo = p.destino === d || (p.destino?.chave === d.chave && p.destino.pos[0] === d.pos[0] && p.destino.pos[1] === d.pos[1]);
  if (mesmo) { p.destino = d; return legenda(p); }
  p.balao.visible = false;
  p.chegando = false;
  if (p.novo || (INSTANTANEO && p !== eu)) {   // quem acabou de aparecer (ou ?instantaneo=1) já está no lugar; o Diretor sempre anda
    p.novo = false;
    p.destino = d;
    p.raiz.position.set(d.pos[0], 0, d.pos[1]);
    p.raiz.rotation.y = d.rot;
    p.rota = [];
    posar(p, d.pose, d.assento);
    p.sentou = d.chave === "mesa";
  } else {
    const rota = caminho([p.raiz.position.x, p.raiz.position.z], d.pos);
    p.sentou = false;
    if (!rota) {   // sem rota: fica onde está, em pé; a vaga sai da lista e o próximo poll escolhe outra
      if (d.chave !== "mesa") inalcancaveis.add(d.chave);
      p.destino = null; p.rota = [];
      posar(p, "em_pe");
    } else {
      p.destino = d; p.rota = rota;
      posar(p, "andando");
    }
  }
  legenda(p);
}

const VELOCIDADE = 1.3, VELOCIDADE_DIRETOR = 2.2, GIRO = 7;   // m/s (o Diretor, andando pelo clique, vai mais rápido) e rad/s
const angulo = a => Math.atan2(Math.sin(a), Math.cos(a));
function girar(p, alvo, dt) {
  const dif = angulo(alvo - p.raiz.rotation.y);
  p.raiz.rotation.y += Math.sign(dif) * Math.min(Math.abs(dif), GIRO * dt);
  return dif;
}
function atualizarPessoas(dt, t) {
  for (const p of [eu, ...npcs, ...pessoas.values()]) {
    p.raiz.position.y = chao(p.raiz.position.x, p.raiz.position.z);
    const u = p.b.userData, d = p.destino;
    u.tronco.scale.y = 1 + 0.012 * Math.sin(t * 2 * Math.PI / 3.5 + u.fase);   // respiração
    for (const est of [p.mesa, p.lab]) if (est) {   // cadeira puxada só onde ele vai sentar; quem não trabalha deixa a mesa arrumada
      const c = est.cadeira, alvo = d?.chave === "mesa" && (d.estacao ?? p.mesa) === est ? est.puxada : est.guardada;
      c.position.z += Math.sign(alvo - c.position.z) * Math.min(Math.abs(alvo - c.position.z), 0.8 * dt);
    }
    if (!d) continue;
    if (p.rota.length) {
      const [x, z] = p.rota[0], pos = p.raiz.position, dx = x - pos.x, dz = z - pos.z, dist = Math.hypot(dx, dz);
      const dif = dist > 0.02 ? girar(p, Math.atan2(dx, dz), dt) : 0;
      const passo = (p === eu ? VELOCIDADE_DIRETOR : VELOCIDADE) * dt * Math.max(0.15, Math.cos(dif));   // curva fechada: quase para e gira
      if (dist <= passo) { pos.x = x; pos.z = z; p.rota.shift(); } else { pos.x += dx / dist * passo; pos.z += dz / dist * passo; }
      // passada: 1 ciclo por 1,3 m; a perna de trás dobra o joelho; o quadril desce para o pé da frente tocar o chão
      p.fase += passo / 1.3 * 2 * Math.PI;
      const a = 0.42 * Math.sin(p.fase);
      u.pernas.forEach((pr, i) => {
        const ang = i ? -a : a;
        pr.coxa.rotation.x = ang; pr.joelho.rotation.x = Math.max(0, ang) * 1.3;
        u.ombros[i].rotation.x = -ang * 1.1;
      });
      u.quadril.position.y = (COXA + CANELA) * Math.cos(a);
      if (!p.rota.length) { posar(p, "em_pe"); p.chegando = true; legenda(p); }
      continue;
    }
    const giroFalta = girar(p, d.rot, dt);
    if (p.chegando) {   // chegou: primeiro vira para o lado da vaga, em pé; só então senta (as pernas não varrem o móvel)
      if (Math.abs(giroFalta) > 0.2) continue;
      p.chegando = false;
      posar(p, d.pose, d.assento);
      p.sentou = d.chave === "mesa";
    }
    const fase = t + u.fase;
    if (p.pose === "digitando") u.ombros.forEach((o, i) => (o.position.y = 0.42 + 0.01 * Math.sin(fase * 2 * Math.PI + i * Math.PI)));
    else if (p.pose === "videogame") u.cotovelos.forEach((c, i) => (c.rotation.x = -0.9 + 0.06 * Math.sin(fase * 11 + i)));
    else if (p.pose === "pebolim") {
      u.ombros.forEach((o, i) => (o.rotation.x = -0.5 + 0.14 * Math.sin(fase * 6 + i * Math.PI)));
      u.tronco.rotation.y = 0.1 * Math.sin(fase * 3);
    } else if (p.pose === "caneca" || p.pose === "lata") {   // um gole a cada ~8 s
      const k = Math.max(0, Math.sin(Math.min(1, (fase % 8) / 1.6) * Math.PI));
      u.ombros[0].rotation.x = -0.35 - 0.55 * k; u.cotovelos[0].rotation.x = -1.25 - 0.75 * k;
    } else if (p.pose === "conversa") {   // os dois do par revezam a fala a cada 3,5 s; quem fala gesticula
      const fala = (Math.floor((t + (d.par >> 1) * 1.7) / 3.5) % 2) === (d.par & 1);
      p.balao.visible = fala;
      if (fala) p.balao.material.map = texBalao[Math.floor(t * 2.5) % 3];
      u.ombros[0].rotation.x = fala ? -0.35 + 0.25 * Math.sin(fase * 2.6) : BRACO_SOLTO[0];
      u.cotovelos[0].rotation.x = fala ? -0.9 : BRACO_SOLTO[1];
    }
  }
}
// estado da rotina para testes: firma.pessoas() → [{chave, texto, pos, andando, pose}]; firma.diretor() → o mesmo do Diretor
const resumo = p => ({ chave: p.chave, texto: p.rot.userData.texto, destino: p.destino?.chave,
  pos: [+p.raiz.position.x.toFixed(2), +p.raiz.position.z.toFixed(2)], andando: p.rota.length > 0, pose: p.pose });
const resumoPessoas = () => [...pessoas.values()].map(resumo);

// ---------------------------------------------------------------- estado → cena
let modoAtual = "cima";   // "cima" | "fp"; firma.modo = ... aplica a troca inteira
const firma = window.firma = {
  estado: null, abrirPainel, salas, vagas: { descanso: VAGAS_DESCANSO, conversa: VAGAS_CONVERSA },
  pessoas: resumoPessoas, diretor: () => resumo(eu), npcs: () => npcs.map(resumo),
  porta: () => portaEntrada.aberta, alternarPorta,
  rotas: { caminho, mesaGerente: mesaDoGerente.vaga },   // teste de rotas (todas as vagas alcançáveis, nenhuma parede cruzada)
  simularAtividade(json) { ativ.simulada = json ?? null; if (equipeConhecida) distribuir(); return atividadeAgora(); },   // null volta ao real
  get modo() { return modoAtual; },
  set modo(m) { trocarModo(m); },
};
let selecionado = null, painelAlvo = null;

function limparDinamicos() {
  for (const o of dinamicos) {
    o.removeFromParent();
    o.traverse(x => {
      if (x.material?.map && x.material !== M.telaApagada) { x.material.map.dispose(); x.material.dispose(); }
    });
    const k = clicaveis.indexOf(o); if (k >= 0) clicaveis.splice(k, 1);
    const r = rotulos.indexOf(o); if (r >= 0) rotulos.splice(r, 1);
  }
  dinamicos.length = 0;
}
const dinamico = (o, pai, clicavel = false) => { pai.add(o); dinamicos.push(o); if (clicavel) clicaveis.push(o); return o; };

function trocarTela(tela, textura) {
  if (tela.material !== M.telaApagada) { tela.material.map?.dispose(); tela.material.dispose(); }
  tela.material = textura ? new THREE.MeshBasicMaterial({ map: textura, toneMapped: false }) : M.telaApagada;
}

function aplicarEstado(estado) {
  limparDinamicos();
  firma.estado = estado;
  sincronizarPessoas(estado);   // as pessoas não são refeitas: quem anda continua andando (e selecionado)

  for (const op of OPS) {
    const s = PLANTA.salas[op], n = GRUPOS_FIRMA.reduce((a, gr) => a + bonecos[`${op}:${gr}`].mercados.length, 0);
    placaSala(s, n ? `${n} ${n === 1 ? "mercado" : "mercados"} · Brasil e Global` : "aguardando dados", n ? "#8b98a5" : "#f0b429");
    if (!n) dinamico(cavalete(s.x + 1.3, s.z + (s.z < 0 ? 1.5 : -1.5), ["AGUARDANDO", "DADOS"], OPERACIONAIS[op].nome), predio);
  }
  const np = promovidos().length, demo = PLANTA.salas.DEMO;
  placaSala(demo, np ? `${np} promovido${np > 1 ? "s" : ""}` : "ninguém promovido ainda", np ? "#26a69a" : "#8b98a5");
  if (!np) dinamico(cavalete(demo.x + 1.3, demo.z - 1.5, ["NINGUÉM", "PROMOVIDO"], "ainda"), predio);

  SALAS_OP.forEach(k => pintarQuadro(k, estado));
  trocarTela(telaRanking, texRanking(estado));
  trocarTela(telaRankingVerso, texRanking(estado));
  trocarTela(telaGerente, texRanking(estado));
  trocarTela(telaDiretor, texRanking(estado));
  $("#ciclo").textContent = estado ? `Ciclo do gerente: ${quando(estado.gerado_em) || "—"}` : "sem estado do gerente";
  $("#exemplo").hidden = !estado?.exemplo;
  reabrirPainel();
}
// a ficha aberta acompanha o estado novo (a de um mercado continua no mesmo mercado)
function reabrirPainel() {
  if (!$("#painel").classList.contains("aberto") || !painelAlvo) return;
  abrirPainel(painelAlvo.mercado ? fichaMercado(painelAlvo.op, painelAlvo.ativo) ?? painelAlvo : selecionado?.userData.alvo ?? painelAlvo);
}
const fichaMercado = (op, ativo) => Object.values(bonecos).find(b => b.op === op && b.grupo === grupoDo(ativo))?.mercados.find(t => t.ativo === ativo);
function placaSala(s, sub, corSub) {   // rótulo sobre a porta
  const placa = rotulo(s.nome, sub, corSub, s.cor);
  placa.position.set(s.porta[0], 2.2, s.porta[1] + (s.z < 0 ? -0.5 : 0.5));
  dinamico(placa, predio);
}

// Telas das mesas: cada tela mostra o melhor mercado do seu grupo (Brasil: futuros | ações; Global: forex | cripto); o
// teste em andamento acende a tela do mercado testado. A Demo mostra os promovidos; o Laboratório, o teste e a última
// rodada. Só repinta a tela cujo conteúdo mudou (roda a cada poll da atividade).
function pintarTela(tela, chave, fazer) {
  if (tela.userData.chave === chave) return;
  tela.userData.chave = chave;
  trocarTela(tela, fazer ? fazer() : null);
}
function pintarTelas() {
  const pq = pesquisaAgora(), ciclo = firma.estado?.gerado_em, chaveTeste = pq && `t|${pq.ativo}|${pq.n}|${pq.total}|${pq.rotulo}|${pq.trader}`;
  for (const op of OPS) GRUPOS_FIRMA.forEach((gr, k) => {
    const b = bonecos[`${op}:${gr}`], cor = PLANTA.salas[op].cor;
    const testando = pq && expediente(gr) && opDoTrader(pq.trader) === op && grupoPesquisa(pq) === gr;
    salas[op].estacoes[k].telas.forEach((tela, n) => {
      if (testando && telaDoAtivo(pq.ativo) === n) return pintarTela(tela, chaveTeste, () => texTeste(pq, cor));
      const t = b.mercados.filter(m => telaDoAtivo(m.ativo) === n).sort((x, y) => (ORDEM[y.status] || 0) - (ORDEM[x.status] || 0))[0];
      if (t) return pintarTela(tela, `c|${ciclo}|${t.ativo}`, () => texCurva({ ...t, nome: t.ativo }));
      pintarTela(tela, `o|${gr}${n}`, () => texTelaOciosa(TELAS_GRUPO[gr][n], "sem mercado avaliado", cor));
    });
  });
  const lista = promovidos();
  salas.DEMO.estacoes.forEach((est, k) => {   // ponytail: três mesas na Demo; do 4º promovido em diante, só a lousa e o painel
    const t = lista[k];
    pintarTela(est.telas[0], t ? `c|${ciclo}|${t.op}|${t.ativo}` : "apagada", t && (() => texCurva({ ...t, nome: `${t.ativo} · ${t.dono}` })));
  });
  const [telaTeste, telaRodada] = salas.LAB.estacoes[0].telas, cor = PLANTA.salas.LAB.cor, linhas = linhasLab();
  const ok = linhas.filter(l => l.passou === true).length;
  pintarTela(telaTeste, pq ? chaveTeste : "lab", () => pq ? texTeste(pq, cor) : texTelaOciosa("Laboratório", "nenhum teste agora", cor));
  pintarTela(telaRodada, `r|${laboratorio.quando}|${linhas.length}|${ok}`, () => texTelaOciosa(linhas.length ? `${ok} de ${linhas.length} passaram` : "nenhuma rodada", "última rodada", cor));
  retextar(placaLab, "Laboratório", pq ? `testando: ${pq.ativo}${progresso(pq) ? ` · ${progresso(pq)}` : ""} · ${quemLab(pq)}`
    : linhas.length ? `última rodada: ${ok} de ${linhas.length} passaram` : "nenhuma rodada ainda", pq ? "#26a69a" : "#8b98a5", cor);
}

// ---------------------------------------------------------------- painel lateral
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = v => v == null ? "—" : Math.round(v * 100) + "%";
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Relatório do dia (contrato da Task 4: /relatorios/<dia>/<ativo em minúsculas>-<slug>.html). Com a lista
// estado.relatorios.arquivos, só vale o arquivo listado (fora dela: null, sem chutar o nome); sem lista (ou
// lista que não é array), o nome do contrato; sem relatorios.dia, null.
function urlRelatorio(nome) {
  const rel = firma.estado?.relatorios;
  if (!rel?.dia) return null;
  const arquivo = Array.isArray(rel.arquivos) ? rel.arquivos.find(a => String(a).toLowerCase() === nome.toLowerCase()) : nome;
  return arquivo ? `/relatorios/${encodeURIComponent(rel.dia)}/${encodeURIComponent(arquivo)}` : null;
}
function linkRelatorio(nome, texto) {
  const url = urlRelatorio(nome);
  if (url) return `<a href="${url}" target="_blank">${texto} ↗</a>`;
  const motivo = firma.estado?.relatorios?.dia ? "não gerado neste ciclo" : "disponível após o primeiro ciclo do gerente";
  return `<span class="off">${texto} · ${motivo}</span>`;
}

function abrirPainel(alvo) {
  const corpo = $("#painel-corpo");
  linksPainel = [];
  corpo.innerHTML = alvo === "gerente" ? htmlGerente(firma.estado) : alvo === "relatorios" ? htmlRelatorios(firma.estado)
    : alvo.quadro ? htmlQuadro(alvo.quadro) : alvo.boneco ? htmlBoneco(alvo) : htmlTrader(alvo);
  // o V (câmera) e o ESC (fechar) continuam valendo com o foco dentro do relatório embutido (mesma origem)
  corpo.querySelector("iframe")?.addEventListener("load", e => {
    try { for (const f of [teclaModo, teclaEsc]) e.target.contentWindow.addEventListener("keydown", f); } catch {}
  });
  painelAlvo = alvo;
  $("#painel").classList.add("aberto");
}
function fecharPainel() {
  document.activeElement?.blur?.();   // o foco sai do relatório embutido: senão o WASD continua indo para ele
  $("#painel").classList.remove("aberto");
  painelAlvo = null;
  selecionar(null);
}
// linhas clicáveis do painel: um mercado abre a ficha daquele mercado; o "←" volta para o boneco
let linksPainel = [];
const linkFicha = (alvo, html, cls = "linha") => `<button class="${cls}" data-ficha="${linksPainel.push(alvo) - 1}">${html}</button>`;
$("#painel-corpo").addEventListener("click", e => {
  const b = e.target.closest("[data-ficha]");
  if (b) abrirPainel(linksPainel[b.dataset.ficha]);
});

const chipStatus = (status, vazio = "—") => { const [n, c] = STATUS[status] || [status || vazio, "#8b98a5"]; return `<span class="chip" style="border-color:${c};color:${c}">${esc(n)}</span>`; };
const linhaMercado = t => linkFicha(t, `<b>${esc(t.ativo)}</b>${chipStatus(t.status)}<span class="mut">${esc(nReq(t))}</span><span class="vai">›</span>`);
const DESCR_GRUPO = { Brasil: "B3: WDO, WIN e ações · 9h às 18h", Global: "forex e cripto · quase 24 h" };
function blocoBoneco(b) {
  const linhas = b.mercados.map(linhaMercado).join("") + b.aguardando.map(a =>
    `<div class="linha off"><b>${esc(a.ativo)}</b><span class="mut">aguardando dados${a.motivo ? ` · ${esc(a.motivo)}` : ""}</span></div>`).join("");
  return `<h3>${esc(b.nome)} · ${esc(DESCR_GRUPO[b.grupo])}</h3>${linhas || '<div class="mut">nenhum mercado avaliado ainda</div>'}`;
}
// ficha do boneco: o melhor status e uma linha por mercado do grupo
function htmlBoneco(b) {
  const s = PLANTA.salas[b.op];
  return `
    <div class="ficha"><span class="av" style="background:${s.cor}">${esc(b.nome[0])}</span>
      <div><div class="n">${esc(b.nome)}</div><div class="s">${esc(s.nome)} · mesa ${b.grupo === "Brasil" ? "com a bandeira do Brasil" : "com o globo"}</div></div></div>
    <div class="chips">${chipStatus(b.status, "sem mercado avaliado")}<span class="chip">${b.mercados.length} ${b.mercados.length === 1 ? "mercado" : "mercados"}</span></div>
    ${blocoBoneco(b)}
    <p class="mut nota">O status do boneco é o melhor entre os mercados dele. Clique num mercado para abrir a ficha.</p>`;
}

// ficha de um mercado de um boneco (o trader do estado naquele ativo)
function htmlTrader(t) {
  const [nomeSt, corSt] = STATUS[t.status] || [t.status || "—", "#8b98a5"];
  const cls = { promovido: "up", pausado: "dn", experiencia: "warn" }[t.status] || "";
  const linha = (rot, f) => `<tr><td>${rot}</td><td>${f(t.treino || {})}</td><td>${f(t.prova || {})}</td></tr>`;
  const din = v => v == null ? "—" : `<span class="${v >= 0 ? "up" : "dn"}">${brl(v)}</span>`;
  const params = Object.entries(t.parametros || {}).map(([k, v]) => `${esc(k)} = ${esc(v)}`).join(" · ") || "padrão";
  const s = PLANTA.salas[t.op] || { cor: "#8b98a5", nome: "" }, b = bonecos[`${t.op}:${t.grupo}`], r = reqs(t);
  return `
    ${b ? linkFicha(b, `← ${esc(b.nome)}`, "voltar") : ""}
    <div class="ficha"><span class="av" style="background:${s.cor}">${esc((b?.nome ?? t.nome)[0])}</span>
      <div><div class="n">${esc(b?.nome ?? t.nome)} · ${esc(t.ativo)}</div><div class="s">${esc(t.nome)} · ${esc(t.estilo)}</div></div></div>
    <div class="chips"><span class="chip ${cls}" style="border-color:${corSt}">${esc(nomeSt)}</span>
      ${t.overfit ? '<span class="chip dn">overfit</span>' : ""}
      <span class="chip">confiança ${esc(t.prova?.confianca ?? "—")}</span></div>
    <h3>Decisão do gerente</h3><div class="decisao">${esc(t.decisao || "—")}</div>
    ${r.length ? `<h3>Requisitos · ${esc(nReq(t))}</h3><table class="req">${r.map(x => `<tr><td>${x.ok ? "✅" : "❌"} ${esc(x.item)}</td><td class="${x.ok ? "up" : "dn"}">${esc(x.valor)}</td></tr>`).join("")}</table>` : ""}
    <h3>Placar</h3>
    <table><tr><th></th><th>Treino</th><th>Prova</th></tr>
      ${linha("Resultado", x => din(x.resultado))}
      ${linha("Trades", x => x.trades ?? "—")}
      ${linha("Acerto", x => pct(x.acerto))}
      ${linha("Fator de lucro", x => x.fator_lucro?.toLocaleString("pt-BR") ?? "—")}
      ${linha("Drawdown", x => din(x.drawdown))}
      ${linha("Pior dia", x => din(x.pior_dia))}
    </table>
    <h3>Parâmetros</h3><div class="mut">${params}</div>
    <h3>Diário do último pregão</h3><div class="diario">${(t.diario || []).map(l => `<div>${esc(l)}</div>`).join("") || '<div class="mut">sem anotações</div>'}</div>
    <div class="links">
      ${linkRelatorio(`${String(t.ativo).toLowerCase()}-${slug(t.nome)}.html`, "Relatório do dia")}
      <a href="/?ativo=${encodeURIComponent(t.ativo)}">Abrir na sala de operações (${esc(t.ativo)}) →</a>
    </div>`;
}

// lousa de cada sala no painel: os mesmos dados da lousa 3D, com as linhas clicáveis
function resumoOp(op) {
  const bs = GRUPOS_FIRMA.map(gr => bonecos[`${op}:${gr}`]);
  const avaliados = bs.reduce((a, b) => a + b.mercados.length, 0), n = bs.reduce((a, b) => a + b.mercados.filter(t => t.status === "promovido").length, 0);
  return !avaliados ? ["aguardando dados", "warn"] : n ? [`${n} mercado${n > 1 ? "s" : ""} promovido${n > 1 ? "s" : ""} para a demo`, "up"] : ["ninguém promovido ainda", "dn"];
}
function htmlQuadro(chave) {
  const s = PLANTA.salas[chave], cabeca = (resumo, tom) => `
    <div class="ficha"><span class="av" style="background:${s.cor}">${esc(s.nome.split(" ").at(-1)[0])}</span>
      <div><div class="n">${esc(s.nome)}</div><div class="s">lousa de status</div></div></div>
    <div class="decisao ${tom}">${esc(resumo)}</div>`;
  if (OPERACIONAIS[chave]) return cabeca(...resumoOp(chave)) + GRUPOS_FIRMA.map(gr => blocoBoneco(bonecos[`${chave}:${gr}`])).join("");
  if (chave === "DEMO") {
    const lista = promovidos();
    return cabeca(lista.length ? `${lista.length} na demo` : "ninguém promovido ainda", lista.length ? "up" : "mut") + `
      <h3>Promovidos</h3>${lista.map(t => linkFicha(t, `<b>${esc(t.dono)}</b><span>${esc(t.ativo)}</span><span class="mut">${typeof t.prova?.resultado === "number" ? `prova ${brl(t.prova.resultado)}` : ""}</span><span class="vai">›</span>`)).join("")
        || '<div class="mut">Uma mesa para cada boneco promovido num mercado; pausado volta para a sala do operacional.</div>'}`;
  }
  const linhas = linhasLab(), pq = pesquisaAgora();
  return cabeca(linhas.length ? [laboratorio.titulo || "última rodada", quando(laboratorio.quando)].filter(Boolean).join(" · ") : "nenhuma rodada ainda",
      linhas.length ? "" : "mut") + `
    ${pq ? `<div class="chips"><span class="chip up">testando agora: ${esc(pq.ativo)}${progresso(pq) ? ` · ${progresso(pq)}` : ""} · ${esc(quemLab(pq))}</span></div>` : ""}
    <h3>Última rodada</h3>
    ${linhas.length ? `<table class="lab"><tr><th>Quem</th><th>Mercado</th><th>Variante</th><th>Trades</th><th>Resultado</th><th>PF</th><th></th></tr>
      ${linhas.map(l => `<tr title="${esc(l.obs)}"><td>${esc(quemLab(l))}</td><td>${esc(l.ativo)}${l.tf ? ` ${esc(l.tf)}m` : ""}</td><td>${esc(l.variante)}</td>
        <td>${esc(l.trades ?? "—")}</td><td class="${l.resultado >= 0 ? "up" : "dn"}">${typeof l.resultado === "number" ? brl(l.resultado) : "—"}</td>
        <td>${numero(l.pf)}</td><td>${l.passou ? "✅" : "❌"}</td></tr>`).join("")}</table>`
      : '<div class="mut">Os testes que o Diretor pede ao Claude aparecem aqui: o que foi testado, as variantes, quem passou e os números.</div>'}
    <h3>Opções · pendências (decisão do Diretor)</h3><ul class="lista pend">${pendenciasOpcoes(firma.estado).map(p => `<li>☐ ${esc(p)}</li>`).join("")}</ul>`;
}

function htmlGerente(estado) {
  if (!estado) return `<div class="ficha"><div class="n">Gerente</div></div><p class="warn">O gerente ainda não rodou: execute <b>python gerente.py</b>.</p>`;
  const pq = pesquisaAgora();
  const salasHtml = Object.entries(objeto(estado.salas) ? estado.salas : {}).filter(([a, s]) => a !== "OPCOES" && objeto(s)).map(([a, s]) =>
    `<tr><td>${esc(a)} · ${grupoDo(a)}</td><td class="${s.status === "ok" ? "up" : "warn"}">${s.status === "ok" ? "ok" : "aguardando dados"}</td></tr>`).join("");
  return `
    <div class="ficha"><span class="av" style="background:#4c8dff">G</span>
      <div><div class="n">Gerente da firma</div><div class="s">último ciclo: ${esc(new Date(estado.gerado_em).toLocaleString("pt-BR"))}</div></div></div>
    ${estado.exemplo ? '<div class="chips"><span class="chip warn">dados de exemplo</span></div>' : ""}
    <h3>Ranking (prova)</h3>
    <table><tr><th>Trader</th><th>Mercado</th><th>Resultado</th></tr>
      ${(estado.ranking || []).map(r => `<tr><td>${esc(r.nome)}</td><td>${esc(r.sala)}</td><td class="${r.prova_resultado >= 0 ? "up" : "dn"}">${brl(r.prova_resultado)}</td></tr>`).join("")}
    </table>
    <h3>Mercados</h3><table>${salasHtml}<tr><td>Laboratório</td><td class="${pq ? "up" : "mut"}">${pq ? `testando ${esc(pq.ativo)}` : "sem teste agora"}</td></tr></table>
    <h3>Pendências</h3><ul class="lista">${(estado.pendencias || []).map(p => `<li>${esc(p)}</li>`).join("") || "<li class='mut'>nenhuma</li>"}</ul>
    <div class="links">${linkRelatorio("gerente.html", "Relatório do gerente")}</div>`;
}

// monitor da Diretoria: o resumo do gerente, a lista de relatórios do dia e o gerente.html embutido
function htmlRelatorios(estado) {
  const rel = estado?.relatorios;
  if (!estado) return htmlGerente(estado);
  if (!rel?.dia) return htmlGerente(estado) +
    `<h3>Relatórios do dia</h3><p class="warn">O gerente ainda não rodou: os relatórios aparecem aqui depois do primeiro ciclo (<b>python gerente.py</b>).</p>`;
  const arquivos = Array.isArray(rel.arquivos) ? rel.arquivos : [];
  const urlGerente = urlRelatorio("gerente.html");
  // gerente.html não tem script (os dos traders têm, para o gráfico, e abrem em aba própria, fora do sandbox): sem allow-scripts (o V repassado é ouvinte desta página)
  return htmlGerente(estado) + `
    <h3>Relatórios de ${esc(rel.dia)}</h3>
    <ul class="lista">${arquivos.map(a => `<li>${linkRelatorio(String(a), esc(a))}</li>`).join("") || "<li class='mut'>nenhum arquivo listado</li>"}</ul>
    ${urlGerente ? `<iframe class="relatorio" src="${urlGerente}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Relatório do gerente"></iframe>` : ""}`;
}

$("#fechar").onclick = fecharPainel;
// em primeira pessoa o ESC só solta o mouse (o painel continua aberto e usável); lá ele fecha no ×
function teclaEsc(e) { if (e.key === "Escape" && firma.modo !== "fp") fecharPainel(); }
addEventListener("keydown", teclaEsc);

// ---------------------------------------------------------------- câmera de cima
export const controles = new OrbitControls(camera, renderer.domElement);
Object.assign(controles, {
  enableDamping: true, dampingFactor: 0.08,
  minPolarAngle: 20 * GRAU, maxPolarAngle: 60 * GRAU,
  minDistance: 3, maxDistance: 48,
  screenSpacePanning: false,
});
// botão esquerdo arrasta a cena (um clique sem arrastar continua selecionando: ver o limiar de 6 px no pointerup)
controles.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

function focar(x, z, distancia, azimute = -35 * GRAU, polar = 45 * GRAU) {
  controles.target.set(x, 0, z);
  camera.position.set(
    x + distancia * Math.sin(polar) * Math.sin(azimute),
    distancia * Math.cos(polar),
    z + distancia * Math.sin(polar) * Math.cos(azimute));
  controles.update();
}

// ?cam=geral (padrão: o prédio inteiro, a praça e a rua) | sala&sala=DIDI (SOFIA, CAIO, DEMO, LAB, DESCANSO…) | quadro&sala=DIDI
// (de frente para a lousa) | diretoria | fp[&pos=x,z,yaw°,pitch°] (primeira pessoa; o mouse só trava no primeiro clique);
// | foco&foco=x,z,distância[,azimute°,polar°]; &trader=<nome> abre a ficha; &atividade=sala:WIN simula o ciclo
// do gerente e &instantaneo=1 põe todo mundo direto no lugar — úteis para capturas
const salaPedida = PLANTA.salas[pedido.get("sala")], quadroPedido = salas[pedido.get("sala")]?.quadro;
if (pedido.get("cam") === "diretoria") focar(dir.x - 1, dir.z, 11);
else if (pedido.get("cam") === "sala" && salaPedida) focar(salaPedida.x, salaPedida.z, 9);
else if (pedido.get("cam") === "quadro" && quadroPedido) {
  const p = quadroPedido.getWorldPosition(new THREE.Vector3());
  const frente = new THREE.Vector3(0, 0, 1).applyQuaternion(quadroPedido.getWorldQuaternion(new THREE.Quaternion()));
  controles.target.copy(p);
  camera.position.copy(p).addScaledVector(frente, 2.6).setY(p.y + 1.5);
  controles.update();
}
else if (pedido.get("cam") === "foco") {
  const [x, z, d, az, po] = (pedido.get("foco") || "").split(",").map(Number);
  focar(x || 0, z || 0, d || 12, (az ?? -35) * GRAU, (po ?? 45) * GRAU);
}
else focar(-1, 1, 41, -30 * GRAU, 42 * GRAU);

const teclas = new Set();
addEventListener("keydown", e => { if (!e.target.closest?.("input,textarea")) teclas.add(e.key.toLowerCase()); });
addEventListener("keyup", e => teclas.delete(e.key.toLowerCase()));
addEventListener("blur", () => teclas.clear());

const desloc = new THREE.Vector3(), frente = new THREE.Vector3(), direita = new THREE.Vector3();
function atualizarCima(dt) {
  const giro = (teclas.has("e") ? 1 : 0) - (teclas.has("q") ? 1 : 0);
  if (giro) {
    desloc.subVectors(camera.position, controles.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, giro * 1.6 * dt);
    camera.position.copy(controles.target).add(desloc);
  }
  const fw = (teclas.has("w") ? 1 : 0) - (teclas.has("s") ? 1 : 0), lt = (teclas.has("d") ? 1 : 0) - (teclas.has("a") ? 1 : 0);
  if (fw || lt) {
    camera.getWorldDirection(frente).setY(0).normalize();
    direita.crossVectors(frente, THREE.Object3D.DEFAULT_UP);
    const v = camera.position.distanceTo(controles.target) * 0.9 * dt;
    desloc.copy(frente).multiplyScalar(fw * v).addScaledVector(direita, lt * v);
    camera.position.add(desloc);
    controles.target.add(desloc);
  }
  // não deixa o foco sair do terreno da firma
  const t = controles.target, antes = t.clone();
  t.x = THREE.MathUtils.clamp(t.x, -32, 18);
  t.z = THREE.MathUtils.clamp(t.z, -27, 27);
  camera.position.add(desloc.subVectors(t, antes));
  controles.update();
}

// cada modo de câmera registra aqui sua função por quadro (a Task 6 acrescenta "fp")
export const modos = { cima: atualizarCima };

// ---------------------------------------------------------------- hover, clique e seleção
const raio = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
let ponteiroMudou = false, sobre = null, inicioClique = null;

function alvoSob(evento) {
  const r = renderer.domElement.getBoundingClientRect();
  ponteiro.set((evento.clientX - r.left) / r.width * 2 - 1, -(evento.clientY - r.top) / r.height * 2 + 1);
  raio.setFromCamera(ponteiro, camera);
  const o = primeiroAlvo(raio.intersectObjects(clicaveis, true));
  return o?.userData.alvo === "porta" ? null : o;   // de cima a porta não abre: clicar nela é andar até lá
}
// primeiro acerto que pertence a um alvo visível (o diretor some na primeira pessoa; contornos apagados não contam)
function primeiroAlvo(hits) {
  for (const hit of hits) {
    let o = hit.object, visivel = true;
    while (o && !o.userData.alvo) { visivel &&= o.visible; o = o.parent; }
    if (o && visivel && o.visible) return o;
  }
  return null;
}
const bonecoDe = o => o?.userData.boneco ?? o;

function marcarSobre(o) {
  const b = bonecoDe(o);
  if (b === sobre) return;
  sobre?.userData.contornos?.forEach(c => (c.visible = false));
  sobre = b;
  sobre?.userData.contornos?.forEach(c => (c.visible = true));
  recipiente.classList.toggle("mao", !!sobre);
}

function selecionar(b) {
  selecionado = b;
  plumbob.removeFromParent();
  plumbob.visible = !!b;
  if (b) { b.add(plumbob); plumbob.position.set(0, 1.72, -0.03); }
}

let ultimoEvento = null;
renderer.domElement.addEventListener("pointermove", e => {
  ultimoEvento = e; ponteiroMudou = true;
  // mãozinha fechada enquanto o botão esquerdo arrasta a cena na câmera de cima
  if (firma.modo !== "fp" && inicioClique && (e.buttons & 1)
      && Math.hypot(e.clientX - inicioClique[0], e.clientY - inicioClique[1]) > 6)
    recipiente.classList.add("arrastando");
});
for (const tipo of ["pointerup", "pointercancel", "pointerleave"])
  renderer.domElement.addEventListener(tipo, () => recipiente.classList.remove("arrastando"));
renderer.domElement.addEventListener("pointerdown", e => { if (e.button === 0) inicioClique = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", e => {
  if (e.button !== 0 || !inicioClique || Math.hypot(e.clientX - inicioClique[0], e.clientY - inicioClique[1]) > 6) return;
  inicioClique = null;
  if (firma.modo === "fp") { if (!olhar.isLocked) travar(); return; }   // em primeira pessoa o clique só trava o mouse
  const o = alvoSob(e);
  if (o) interagir(o); else irAte();
});

// Clique no chão (câmera de cima): o Diretor anda até lá pela mesma grade dos funcionários; numa cadeira ou num
// sofá livre (LUGARES), vai e senta. Usa o raio que alvoSob acabou de lançar; paredes de pé seguram o clique.
const alvosChao = [...malhasFixas, ...cadeirasMoveis, ...new Set(pecas.map(pc => pc.im).filter(Boolean))];
function irAte() {
  const hit = raio.intersectObjects(alvosChao, true)[0];
  if (!hit) return;
  const { x, y, z } = hit.point, perto = l => Math.hypot(l.pos[0] - x, l.pos[1] - z);
  const ocupados = new Set([...pessoas.values(), ...npcs].map(p => p.destino?.chave));   // lugar do descanso com trader: o vizinho livre serve
  const l = y > 0.15 && LUGARES.filter(l => perto(l) < 0.55 && !ocupados.has(l.chave)).sort((a, b) => perto(a) - perto(b))[0];
  if (l) return irPara(eu, l);
  const c = celulaLivre(x, z);   // chão (ou móvel, parede, lugar ocupado): a célula livre mais perto do ponto
  if (c < 0) return;
  const pos = pontoDe(c);
  irPara(eu, { chave: `livre:${pos}`, pos, rot: eu.raiz.rotation.y, pose: "em_pe", texto: "em pé" });
}

// trader → ficha; gerente/diretor → resumo; monitor da Diretoria → relatórios. O plumbob só vai em boneco.
function interagir(o) {
  if (o.userData.alvo === "porta") return alternarPorta();
  const b = bonecoDe(o);
  selecionar(b.userData.contornos ? b : null);
  abrirPainel(b.userData.alvo);
}

function alternarPorta() {
  portaEntrada.aberta = !portaEntrada.aberta;
  alvoFp = null;   // a dica "E abrir/fechar a porta" se refaz no próximo quadro
}

// ---------------------------------------------------------------- primeira pessoa
// V alterna com a câmera de cima. O mouse olha (PointerLockControls); WASD anda a 3 m/s (Shift 5 m/s) com
// colisão com paredes e móveis (ver `bate`), eixo por eixo para deslizar rente a eles; E interage com o que está na mira.
const OLHO = 1.7, RAIO = 0.3, ANDAR = 3, CORRER = 5, ALCANCE = 2.5;
const olhar = new PointerLockControls(camera, renderer.domElement), giro = new THREE.Euler(0, 0, 0, "YXZ");
olhar.minPolarAngle = 10 * GRAU;
olhar.maxPolarAngle = 170 * GRAU;
const voltar = $("#voltar");
const travar = () => renderer.domElement.requestPointerLock?.()?.catch?.(() => {});  // recusa → "pointerlockerror"
let recusas = 0;   // recusas seguidas da trava, zeradas quando ela pega
olhar.addEventListener("lock", () => {
  recusas = 0;
  if (firma.modo !== "fp") olhar.unlock();   // V duplo: a trava chegou depois de voltar para cima
  else voltar.hidden = true;
});
olhar.addEventListener("unlock", () => (voltar.hidden = firma.modo !== "fp"));
voltar.onclick = travar;
// Trava recusada, sem o console.error do PointerLockControls (three 0.160). A 1ª recusa costuma ser o intervalo
// de ~1 s do Chrome/Opera logo após o ESC: o aviso fica e tenta de novo em 1,1 s. Recusou de novo = o navegador
// não dá pointer lock (como o painel embutido do app): some o aviso e fica o "arrastar para olhar".
document.removeEventListener("pointerlockerror", olhar._onPointerlockError);
document.addEventListener("pointerlockerror", () => {
  if (firma.modo !== "fp") return;
  voltar.hidden = ++recusas > 1;
  if (recusas === 1) setTimeout(() => firma.modo === "fp" && !olhar.isLocked && travar(), 1100);
});
// O Chrome no Windows às vezes manda num único evento um movementX/Y de centenas de px que o mouse não fez (mais ainda
// logo depois de travar): a câmera girava sozinha 90–180° num quadro. Pico = salto grande vindo do nada; um giro rápido
// de verdade cresce aos poucos e passa (depois de um pico descartado, o mesmo tamanho já não conta como pico).
let ultimoMov = 0;
function picoDoMouse(e) {
  const m = Math.hypot(e.movementX, e.movementY), pico = m > 200 && m > 4 * ultimoMov + 40;
  ultimoMov = pico ? m / 4 : m;
  return pico;
}
document.removeEventListener("mousemove", olhar._onMouseMove);
document.addEventListener("mousemove", e => picoDoMouse(e) || olhar._onMouseMove(e));
renderer.domElement.addEventListener("pointermove", e => {
  if (firma.modo !== "fp" || olhar.isLocked || !(e.buttons & 1) || picoDoMouse(e)) return;
  giro.setFromQuaternion(camera.quaternion);
  giro.y -= e.movementX * 0.004;
  giro.x = THREE.MathUtils.clamp(giro.x - e.movementY * 0.004, -80 * GRAU, 80 * GRAU);
  camera.quaternion.setFromEuler(giro);
});

const camCima = { pos: new THREE.Vector3(), alvo: new THREE.Vector3() };
let pitchFp = -8;   // graus; a primeira pessoa volta com o mesmo olhar para cima/baixo
function trocarModo(m) {
  if (m === modoAtual || !modos[m]) return;
  const fp = (modoAtual = m) === "fp";
  document.body.classList.toggle("fp", fp);   // troca a dica de teclas e mostra a mira
  controles.enabled = !fp;
  alturaParedes(fp ? PLANTA.altura : null);
  forro.visible = fp;
  diretor.visible = rotDiretor.visible = !fp;   // em primeira pessoa você é o diretor
  camera.fov = fp ? 60 : 40;
  camera.updateProjectionMatrix();
  if (fp) {
    document.activeElement?.blur?.();   // tira o foco do relatório embutido, senão o WASD vai para ele
    camCima.pos.copy(camera.position);
    camCima.alvo.copy(controles.target);
    // você entra no boneco: onde ele está, olhando para onde ele olha (sentado, levanta para a célula livre mais perto)
    const { x, z } = eu.raiz.position, sentado = POSES[eu.pose]?.q, c = sentado ? celulaLivre(x, z) : -1;
    const [px, pz] = c >= 0 ? pontoDe(c) : [x, z];
    teleportar(px, pz, (eu.raiz.rotation.y + Math.PI) / GRAU, pitchFp);
    pararDiretor(px, pz, eu.raiz.rotation.y);
  } else {
    // o boneco fica onde você parou, em pé, de frente para onde você olhava; a câmera de cima vai até ele
    giro.setFromQuaternion(camera.quaternion);
    pitchFp = giro.x / GRAU;
    pararDiretor(camera.position.x, camera.position.z, giro.y + Math.PI);
    if (olhar.isLocked) olhar.unlock();
    controles.target.set(camera.position.x, 0, camera.position.z);
    camera.position.copy(controles.target).add(desloc.subVectors(camCima.pos, camCima.alvo));
    controles.update();
  }
  voltar.hidden = true;
  mirar(null);
  marcarSobre(null);
  mostrarDica();   // os controles mudam com a câmera: mostra os novos
}

// Tutorial de controles (canto de baixo): aberto ao entrar e a cada troca de câmera, encolhe para o botão "Controles"
// depois de 4 s (com o mouse em cima, espera ele sair); clicar no botão abre e fecha.
const dica = $("#dica");
let tempoDica;
function mostrarDica(aberta = true) {
  clearTimeout(tempoDica);
  dica.classList.toggle("aberta", aberta);
  $("#dica-botao").setAttribute("aria-expanded", aberta);
  if (aberta) tempoDica = setTimeout(function encolher() {
    if (dica.matches(":hover")) tempoDica = setTimeout(encolher, 800);
    else mostrarDica(false);
  }, 4000);
}
$("#dica-botao").onclick = () => mostrarDica(!dica.classList.contains("aberta"));
mostrarDica();

function pararDiretor(x, z, rot) {   // em pé em (x, z), sem rota
  eu.rota = []; eu.chegando = false;
  eu.raiz.position.set(x, 0, z);
  eu.raiz.rotation.y = rot;
  eu.destino = { chave: "livre", pos: [x, z], rot, pose: "em_pe", texto: "em pé" };
  posar(eu, "em_pe");
  legenda(eu);
}

function teleportar(x, z, yaw = 0, pitch = 0) {   // graus; yaw 0 = norte (−z), 90 = oeste (−x)
  camera.position.set(x, OLHO, z);
  camera.rotation.set(pitch * GRAU, yaw * GRAU, 0, "YXZ");
}

// paredes (COLISORES: todos começam no chão ou no peitoril, as vergas não entram), móveis (as células bloqueadas da
// grade dos funcionários, já com folga) e as cadeiras das mesas, que andam (um círculo em volta de cada uma)
const posCadeira = new THREE.Vector3();
const bate = (x, z) => COLISORES.some(c => x + RAIO > c.min[0] && x - RAIO < c.max[0] && z + RAIO > c.min[2] && z - RAIO < c.max[2]) ||
  !livre(...celula(x, z)) ||
  cadeirasMoveis.some(c => (c.getWorldPosition(posCadeira), Math.hypot(posCadeira.x - x, posCadeira.z - z) < 0.5));
function andar(dx, dz) {
  // passos de até 5 cm: nunca atravessa (a peça mais fina, o vidro, vira 0,63 m com o raio) e para a < 5 cm da parede
  const n = Math.ceil(Math.hypot(dx, dz) / 0.05), p = camera.position;
  for (let k = 0; k < n; k++) {
    const preso = bate(p.x, p.z);   // começou dentro de um móvel (?cam=fp&pos=...): anda livre até sair
    if (preso || !bate(p.x + dx / n, p.z)) p.x += dx / n;
    if (preso || !bate(p.x, p.z + dz / n)) p.z += dz / n;
  }
}

// mira: raio do centro da tela até 2,5 m, cortado pela primeira parede (as caixas de COLISORES)
const centroTela = new THREE.Vector2(), pontoParede = new THREE.Vector3();
const caixasParede = COLISORES.map(c => new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)));
function alvoNaMira() {
  raio.setFromCamera(centroTela, camera);
  raio.far = ALCANCE;
  for (const b of caixasParede) if (raio.ray.intersectBox(b, pontoParede)) raio.far = Math.min(raio.far, pontoParede.distanceTo(raio.ray.origin));
  const o = primeiroAlvo(raio.intersectObjects(clicaveis, true));
  raio.far = Infinity;
  return o;
}

let alvoFp = null;
const acaoDe = a => a === "porta" ? (portaEntrada.aberta ? "fechar a porta" : "abrir a porta")
  : a === "gerente" ? "painel do gerente" : a === "relatorios" ? "relatórios do dia"
  : a.quadro ? `lousa da ${PLANTA.salas[a.quadro].nome}` : `ficha de ${a.nome}${a.mercado ? ` · ${a.ativo}` : ""}`;
function mirar(o) {
  if (o === alvoFp) return;
  alvoFp = o;
  marcarSobre(o);
  $("#mira").classList.toggle("alvo", !!o);
  $("#acao").hidden = !o;
  if (o) $("#acao").innerHTML = `<b>E</b>${esc(acaoDe(o.userData.alvo))}`;
}

modos.fp = dt => {
  const fw = (teclas.has("w") ? 1 : 0) - (teclas.has("s") ? 1 : 0), lt = (teclas.has("d") ? 1 : 0) - (teclas.has("a") ? 1 : 0);
  if (fw || lt) {
    const yaw = giro.setFromQuaternion(camera.quaternion).y, v = (teclas.has("shift") ? CORRER : ANDAR) * dt / Math.hypot(fw, lt);
    andar((-Math.sin(yaw) * fw + Math.cos(yaw) * lt) * v, (-Math.cos(yaw) * fw - Math.sin(yaw) * lt) * v);
  }
  camera.position.y = OLHO + chao(camera.position.x, camera.position.z);   // lá fora o chão é mais baixo
  mirar(alvoNaMira());
};

function teclaModo(e) {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input,textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "v") {
    firma.modo = firma.modo === "fp" ? "cima" : "fp";
    if (firma.modo === "fp") travar();
  } else if (k === "e" && firma.modo === "fp" && alvoFp) interagir(alvoFp);
}
addEventListener("keydown", teclaModo);

// ganchos para testar sem pointer lock: firma.modo = "fp"; firma.fp.teleportar(x, z, yaw°); firma.fp.andar(dx, dz) → [x, z]
firma.fp = { teleportar, andar: (dx, dz) => (andar(dx, dz), [camera.position.x, camera.position.z]), alvo: () => alvoFp?.userData.alvo ?? null };
if (pedido.get("cam") === "fp") {
  firma.modo = "fp";
  const [x, z, yaw, pitch] = (pedido.get("pos") || "").split(",").map(Number);
  if (Number.isFinite(x) && Number.isFinite(z)) teleportar(x, z, yaw || 0, pitch || 0);
}

// ---------------------------------------------------------------- dados (poll de 30 s)
let ultimoTexto = "", cenaVazia = false;
const aviso = msg => { $("#aviso").hidden = !msg; $("#aviso").textContent = msg || ""; };
async function carregar() {
  let r, texto, corpo;
  try {
    r = await fetch("/api/firma", { cache: "no-store" });
    texto = await r.text();
  } catch (err) {
    return aviso(`Não consegui falar com o servidor da arena (${err.message}).`);
  }
  try { corpo = JSON.parse(texto); } catch {
    return aviso(`O servidor respondeu ${r.status} com algo que não é JSON em /api/firma.`);
  }
  if (!r.ok) {
    // 404 = o gerente ainda não rodou; 500 = estado ilegível (ex.: gravado pela metade). A cena anterior fica.
    aviso(corpo.erro || "O gerente ainda não rodou: execute python gerente.py");
    if (!firma.estado && !cenaVazia) { cenaVazia = true; aplicarEstado(null); }
    return;
  }
  if (texto === ultimoTexto) return aviso(null);
  const primeira = !ultimoTexto;
  try {
    aplicarEstado(corpo);
  } catch (err) {
    ultimoTexto = "";   // a cena ficou limpa pela metade: o próximo estado, mesmo igual ao anterior, repinta
    return aviso(`O estado da firma veio num formato inesperado (${err.message}).`);
  }
  ultimoTexto = texto;  // só depois de aplicado: um estado que falhou é tentado de novo no próximo poll
  aviso(null);
  const b = primeira && clicaveis.find(o => !o.isSprite && o.userData.alvo?.nome === pedido.get("trader") &&
    (!salaPedida || o.userData.alvo.sala === pedido.get("sala")));
  if (b) { selecionar(b); abrirPainel(b.userData.alvo); }
}
// Laboratório: a última rodada de testes (/api/laboratorio; vazio = "nenhuma rodada ainda"). ?laboratorio=exemplo usa a
// rodada de exemplo de firma.exemplo.json (capturas).
let textoLab = "";
async function carregarLab() {
  const exemplo = pedido.get("laboratorio") === "exemplo";
  let lab = laboratorio;  // falha na consulta: fica a última rodada boa, como carregar() faz com o estado
  try {
    const r = await fetch(exemplo ? "/web/firma.exemplo.json" : "/api/laboratorio", { cache: "no-store" });
    if (r.ok) lab = exemplo ? (await r.json()).laboratorio : await r.json();
  } catch {}   // servidor fora: segue com o que já tinha
  laboratorio = objeto(lab) ? lab : {};
  const texto = JSON.stringify(laboratorio);
  if (texto === textoLab) return;
  textoLab = texto;
  pintarQuadro("LAB", firma.estado);
  if (equipeConhecida) pintarTelas();
  if (painelAlvo?.quadro === "LAB") reabrirPainel();
}
// atividade do gerente e da pesquisa a cada 5 s (decide quem trabalha; também é quando os ociosos trocam de atividade)
let textoAtividade = "";
async function carregarAtividade() {
  try {
    const r = await fetch("/api/atividade", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const texto = await r.text();
    if (texto !== textoAtividade) {
      const testava = ativ.real?.pesquisa;
      ativ.real = JSON.parse(texto); textoAtividade = texto;
      if (testava && !ativ.real?.pesquisa) carregarLab();   // o teste acabou: a rodada nova já está no quadro
    }
  } catch {   // servidor fora (ou resposta ruim): ninguém fica "trabalhando" para sempre, todo mundo fica ocioso
    ativ.real = null; textoAtividade = "";
  }
  if (equipeConhecida) distribuir();
}
carregarAtividade().finally(carregar);   // a primeira cena já nasce com cada um no lugar certo
carregarLab();
setInterval(carregar, 30000);
setInterval(carregarLab, 30000);
setInterval(carregarAtividade, 5000);

// ---------------------------------------------------------------- laço de render
new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = recipiente;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}).observe(recipiente);

const relogio = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const bruto = relogio.getDelta(), dt = Math.min(bruto, 0.1), t = relogio.elapsedTime;
  modos[firma.modo]?.(dt);
  atualizarParedes();
  atualizarPessoas(Math.min(bruto, 1), t);   // com a tela travando, quem anda não fica para trás
  const abrir = (portaEntrada.aberta ? Math.PI / 2 : 0) - portaEntrada.angulo;   // ~0,6 s para abrir ou fechar
  portaEntrada.angulo += Math.sign(abrir) * Math.min(Math.abs(abrir), 2.6 * dt);
  portaEntrada.g.rotation.y = -portaEntrada.angulo;
  if (plumbob.visible) { plumbob.rotation.y = t * 1.5; plumbob.position.y = (selecionado?.userData.topo ?? 1.465) + 0.255 + 0.04 * Math.sin(t * 2.5); }
  // rótulos crescem um pouco com a distância para continuarem legíveis na visão geral; em primeira pessoa
  // ficam menores e respeitam as paredes (de cima atravessam tudo)
  const fp = firma.modo === "fp", distancia = camera.position.distanceTo(controles.target);
  const f = fp ? 0.75 : THREE.MathUtils.clamp(distancia / 11, 1, 2.4);
  for (const s of rotulos) { s.scale.set(s.userData.base * f, s.userData.base * f * (s.userData.aspecto ?? 150 / 512), 1); s.material.depthTest = fp; }
  arrumarRotulos(dt, fp, distancia);
  if (!fp && ponteiroMudou && ultimoEvento) { ponteiroMudou = false; marcarSobre(alvoSob(ultimoEvento)); }
  renderer.render(cena, camera);
  if (!window.firmaPronta) {
    window.firmaPronta = true;   // o aviso de "não consegui carregar o 3D" da firma.html não aparece mais
    // aba aberta em segundo plano: o aviso disparou antes do 1º quadro; desfaz recarregando o estado
    if (document.getElementById("ciclo")?.textContent === "3D indisponível") { ultimoTexto = ""; carregar(); }
  }
});
