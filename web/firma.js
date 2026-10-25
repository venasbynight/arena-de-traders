// Firma 3D: o escritório da arena no estilo The Sims — uma sala por mercado, o hall do gerente
// e a Diretoria. Tudo procedural (caixas e cilindros) e texturas desenhadas em canvas.
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
    WDO:       { nome: "Mini-dólar",  x: -4, z: -7, w: 8, d: 6, porta: [-2, -4], cor: "#5b8bd9" },
    WIN:       { nome: "Mini-índice", x: 4,  z: -7, w: 8, d: 6, porta: [2, -4],  cor: "#4fae7b" },
    EURUSD:    { nome: "Forex",       x: -4, z: 7,  w: 8, d: 6, porta: [-2, 4],  cor: "#8f6fd6" },
    BTCUSDT:   { nome: "Bitcoin",     x: 4,  z: 7,  w: 8, d: 6, porta: [2, 4],   cor: "#e39a3b" },
    DIRETORIA: { nome: "Diretoria",   x: 10, z: 0,  w: 8, d: 6, porta: [6, 0],   cor: "#a24d5e" },
  },
};
const MERCADOS = ["WDO", "WIN", "EURUSD", "BTCUSDT"];

// paredes pela linha de centro; ext = normal da face externa (null = parede interna).
// aberturas: j = janela, p = porta aberta, e = porta de entrada (fechada); número = centro ao longo da parede
const j = em => ({ tipo: "janela", em }), p = em => ({ tipo: "porta", em }), e = em => ({ tipo: "entrada", em });
const PAREDES = [
  { de: [-8, -10], ate: [8, -10], ext: [0, -1], ab: [j(-6), j(-2), j(2), j(6)] },
  { de: [-8, 10], ate: [8, 10], ext: [0, 1], ab: [j(-6), j(-2), j(2), j(6)] },
  { de: [-8, -10], ate: [-8, -4], ext: [-1, 0], ab: [j(-7)] },
  { de: [8, -10], ate: [8, -4], ext: [1, 0], ab: [j(-7)] },
  { de: [-8, 4], ate: [-8, 10], ext: [-1, 0], ab: [j(7)] },
  { de: [8, 4], ate: [8, 10], ext: [1, 0], ab: [j(7)] },
  { de: [0, -10], ate: [0, -4] },
  { de: [0, 4], ate: [0, 10] },
  { de: [-8, -4], ate: [-6, -4], ext: [0, 1] },
  { de: [-6, -4], ate: [6, -4], ab: [p(-2), p(2)] },
  { de: [6, -4], ate: [8, -4], ext: [0, 1] },
  { de: [-8, 4], ate: [-6, 4], ext: [0, -1] },
  { de: [-6, 4], ate: [6, 4], ab: [p(-2), p(2)] },
  { de: [6, 4], ate: [8, 4], ext: [0, -1] },
  { de: [-6, -4], ate: [-6, 4], ext: [-1, 0], ab: [j(-2.5), e(0), j(2.5)] },
  { de: [6, -4], ate: [6, -3], ext: [1, 0] },
  { de: [6, -3], ate: [6, 3], ab: [p(0)] },
  { de: [6, 3], ate: [6, 4], ext: [1, 0] },
  { de: [6, -3], ate: [14, -3], ext: [0, -1], ab: [j(8.4)] },
  { de: [6, 3], ate: [14, 3], ext: [0, 1], ab: [j(10)] },
  { de: [14, -3], ate: [14, 3], ext: [1, 0], ab: [j(0)] },
];

// AABB das paredes para a colisão da primeira pessoa (Task 6): {min:[x,y,z], max:[x,y,z]}
export const COLISORES = [];

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
sol.position.set(-14, 26, 16);
sol.target.position.set(3, 0, 0);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
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
for (const a of ambientes) {
  caixa(predio, a.w + 0.3, 0.16, a.d + 0.3, mat("#d9d3c6"), a.x, -0.08, a.z).castShadow = false;
  const material = a === PLANTA.hall
    ? new THREE.MeshStandardMaterial({ map: texMadeira, roughness: 0.45 })
    : new THREE.MeshStandardMaterial({ map: texCarpete(a.cor), roughness: 0.95 });
  piso(predio, a.w, a.d, material, a === PLANTA.hall ? 2.4 : 2, a.x, 0.003, a.z);
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
      pecaParede(par, s - 0.06, s, 0.9, 2.2, M.moldura, { grossura: t + 0.04 });
      pecaParede(par, f, f + 0.06, 0.9, 2.2, M.moldura, { grossura: t + 0.04 });
      pecaParede(par, ab.em - 0.025, ab.em + 0.025, 0.9, 2.2, M.moldura, { grossura: 0.06 });
    } else {
      pecaParede(par, s, f, 2.1, H, M.parede);
      pecaParede(par, s - 0.07, s, 0, 2.17, M.batente, { grossura: t + 0.05 });
      pecaParede(par, f, f + 0.07, 0, 2.17, M.batente, { grossura: t + 0.05 });
      pecaParede(par, s - 0.07, f + 0.07, 2.1, 2.17, M.batente, { grossura: t + 0.05 });
      if (ab.tipo === "entrada") {
        pecaParede(par, s, f, 0, 2.1, mat("#6e4a2f", { roughness: 0.5 }), { grossura: 0.06, colide: true });
        pecaParede(par, s + 0.2, f - 0.2, 1.0, 1.9, M.vidro, { grossura: 0.08 });
      }
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
  pecas.push({ m: g, y0: y - h / 2, y1: y + h / 2, ext, centro: [x, z], inteira: true });
  return g;
}

// ---------------------------------------------------------------- área externa: gramado, calçada, rua, arbustos, árvores
const fora = new THREE.Group();
cena.add(fora);
piso(fora, 220, 220, new THREE.MeshStandardMaterial({ map: texGrama, roughness: 1 }), 3, 4, -0.16, 0);
const matCalcada = new THREE.MeshStandardMaterial({ map: texCalcada, roughness: 0.95 });
piso(fora, 8.2, 1.8, matCalcada, 1.2, -10.1, -0.155, 0);         // caminho até a entrada
piso(fora, 2.4, 220, matCalcada, 1.2, -15.2, -0.155, 0);          // calçada
piso(fora, 8, 220, mat("#4a4d52", { roughness: 0.95 }), 8, -20.4, -0.157, 0);  // rua
for (let z = -100; z < 100; z += 4) caixa(fora, 0.15, 0.01, 2, mat("#f2f0e6"), -20.4, -0.15, z).castShadow = false;
caixa(fora, 0.5, 0.08, 1.8, mat("#d9d3c6"), -6.35, -0.12, 0);    // degrau da entrada

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
canteiro(-8.2, -11.2, 8.2, -10.25);
canteiro(-8.2, 10.25, 8.2, 11.2);
canteiro(14.25, -3, 15.2, 3);
canteiro(-9.2, -10, -8.25, -4.3);
canteiro(-9.2, 4.3, -8.25, 10);
canteiro(-7.1, -4, -6.25, -1.3);
canteiro(-7.1, 1.3, -6.25, 4);
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
[[-12, -8], [-11.5, 7.5], [12, -8.5], [18, 5.5], [18.5, -5], [-3, -14.5], [6, 14.5], [13, 11]].forEach(([x, z]) => arvore(x, z, 1.2 + rnd() * 0.5));

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
  tela.position.set(x, 1.075, z + 0.03 - 0.019);
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
}

function cadeiraVisita(g, x, z, rot) {
  const c = grupo(g, x, z, rot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(c, 0.035, 0.45, 0.035, M.cromo, sx * 0.2, 0.225, sz * 0.2);
  caixa(c, 0.48, 0.07, 0.46, mat("#7a2f3b", { roughness: 0.9 }), 0, 0.48, 0);
  caixa(c, 0.46, 0.42, 0.06, mat("#7a2f3b", { roughness: 0.9 }), 0, 0.74, -0.21);
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
}

function mesaCentro(pai, x, z) {
  const g = grupo(pai, x, z);
  caixa(g, 1.1, 0.05, 0.6, M.madeira, 0, 0.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caixa(g, 0.04, 0.38, 0.04, M.madeiraEscura, sx * 0.5, 0.19, sz * 0.25);
  caixa(g, 0.26, 0.04, 0.2, mat("#3a6ea5"), -0.25, 0.445, 0.05);
  caixa(g, 0.24, 0.04, 0.18, mat("#c0392b"), -0.24, 0.485, 0.04).rotation.y = 0.2;
  caneca(g, 0.25, -0.05, "#ffffff", 0.475);
}

function tapete(pai, x, z, w, d, rot = 0) {
  const m = piso(pai, w, d, new THREE.MeshStandardMaterial({ map: texTapete, roughness: 1 }), null, x, 0.012, z);
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

// quadro branco com rodinhas: o plano do dia rabiscado
const texQuadroBranco = canvasTex(384, 256, (g, w, h) => {
  g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#2a4d8f"; g.font = "700 30px Segoe UI, sans-serif"; g.fillText("PLANO DO DIA", 22, 44);
  g.lineWidth = 3;
  let y = 170;
  for (let k = 0; k < 14; k++) {
    const sobe = rnd() > 0.45, corpo = 8 + rnd() * 22;
    g.strokeStyle = g.fillStyle = sobe ? "#26a69a" : "#ef5350";
    g.beginPath(); g.moveTo(30 + k * 24, y - corpo - 10); g.lineTo(30 + k * 24, y + 10); g.stroke();
    g.fillRect(24 + k * 24, sobe ? y - corpo : y, 12, corpo);
    y += sobe ? -corpo * 0.5 : corpo * 0.4;
  }
  g.strokeStyle = "#e0a020"; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(20, 120); g.lineTo(w - 20, 120); g.stroke();
});
function quadroBranco(pai, x, z, rot) {
  const g = grupo(pai, x, z, rot);
  caixa(g, 1.3, 0.9, 0.04, M.branco, 0, 1.35, 0);
  const tela = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.84), new THREE.MeshStandardMaterial({ map: texQuadroBranco, roughness: 0.35 }));
  tela.position.set(0, 1.35, 0.021);
  g.add(tela);
  for (const s of [-1, 1]) {
    caixa(g, 0.04, 1.8, 0.04, M.cromo, s * 0.62, 0.92, 0);
    caixa(g, 0.06, 0.04, 0.5, M.cromo, s * 0.62, 0.05, 0);
    for (const t of [-1, 1]) cilindro(g, 0.03, 0.03, 0.03, M.preto, s * 0.62, 0.03, t * 0.22, 8).rotation.z = Math.PI / 2;
  }
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

// tela de parede com o nome do mercado (fica nas fachadas do fundo)
function texPlacaSala(ativo, s) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = "#0b0f14"; g.fillRect(0, 0, w, h);
    g.fillStyle = s.cor; g.fillRect(0, 0, w, 10);
    g.fillStyle = "#e6edf3"; g.font = "700 76px Segoe UI, sans-serif"; g.fillText(ativo, 28, 110);
    g.fillStyle = s.cor; g.font = "500 42px Segoe UI, sans-serif"; g.fillText(s.nome, 30, 175);
    g.strokeStyle = s.cor; g.lineWidth = 4; g.beginPath();
    for (let k = 0; k < 12; k++) g.lineTo(300 + k * 18, 200 - Math.sin(k * 1.3) * 18 - k * 4);
    g.stroke();
  });
}

// ---------------------------------------------------------------- bonecos
const PALETAS = [
  { pele: "#f1c7a5", cabelo: "#3b2a20", camisa: "#3f7fd9", calca: "#2d3440" },
  { pele: "#c98e63", cabelo: "#1d1712", camisa: "#e9ecef", calca: "#4a3b2c" },
  { pele: "#8d5a3b", cabelo: "#121010", camisa: "#d65a7a", calca: "#2e2a3a" },
  { pele: "#f3d2b8", cabelo: "#c9893a", camisa: "#3fa37a", calca: "#39404d" },
  { pele: "#e0ac85", cabelo: "#6b3b22", camisa: "#f0b429", calca: "#33363f" },
  { pele: "#a86f4c", cabelo: "#2a2a2a", camisa: "#8a6bd8", calca: "#22303f" },
];
const CABELO = { "Sofia SMC": "longo", "Vera VWAP": "coque", "Rafa Rompimento": "curto" };
const animados = [];  // bonecos com respiração e digitação

// boneco sentado (≈1,75 m em pé): origem no chão sob o assento, olhando para +z (a mesa)
function boneco(pal, { cabelo = "curto", terno = null, gravata = "#b8323a" } = {}) {
  const g = new THREE.Group();
  const pele = mat(pal.pele), roupa = mat(terno || pal.camisa, { roughness: 0.9 }), calca = mat(pal.calca, { roughness: 0.9 });
  const fio = mat(pal.cabelo, { roughness: 0.8 }), sapato = mat("#1d1d22", { roughness: 0.5 });
  for (const s of [-1, 1]) {
    caixa(g, 0.15, 0.15, 0.46, calca, s * 0.095, 0.575, 0.17);
    caixa(g, 0.13, 0.47, 0.14, calca, s * 0.095, 0.27, 0.38);
    caixa(g, 0.14, 0.07, 0.24, sapato, s * 0.095, 0.035, 0.43);
  }
  caixa(g, 0.36, 0.16, 0.3, calca, 0, 0.58, -0.02);
  const tronco = new THREE.Group();
  tronco.position.set(0, 0.64, -0.03);
  g.add(tronco);
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
  const ombros = [];
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
    caixa(cotovelo, 0.09, 0.1, 0.09, pele, 0, -0.33, 0.01);
    ombros.push(ombro);
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
  g.userData = { tronco, ombros, contornos, fase: rnd() * 6.28 };
  animados.push(g);
  return g;
}

function animarBonecos(t) {
  for (const b of animados) {
    const { tronco, ombros, fase } = b.userData;
    tronco.scale.y = 1 + 0.012 * Math.sin(t * 2 * Math.PI / 3.5 + fase);     // respiração
    ombros.forEach((o, i) => (o.position.y = 0.42 + 0.01 * Math.sin(t * 2 * Math.PI + fase + i * Math.PI)));  // digitando: ±1 cm, 1 s
  }
}

// plumbob verde sobre o trader selecionado
const plumbob = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0),
  new THREE.MeshStandardMaterial({ color: "#3ddc5a", emissive: "#2bbf47", emissiveIntensity: 0.9, roughness: 0.3, flatShading: true }));
plumbob.scale.y = 1.7;
plumbob.visible = false;

// ---------------------------------------------------------------- rótulos (sprites de canvas)
const rotulos = [];
function rotulo(titulo, sub, corSub = "#8b98a5", corBorda = "#1f2a36") {
  const W = 512, H = 150;
  const tex = canvasTex(W, H, g => {
    g.font = "600 46px Segoe UI, sans-serif";
    const lt = g.measureText(titulo).width;
    g.font = "36px Segoe UI, sans-serif";
    const larg = Math.min(W - 24, Math.max(lt, g.measureText(sub).width) + 56);
    const x = (W - larg) / 2;
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, toneMapped: false }));
  s.renderOrder = 10;
  s.center.set(0.5, 0);
  s.userData.base = 1.5;
  s.scale.set(1.5, 1.5 * H / W, 1);
  rotulos.push(s);
  return s;
}

// ---------------------------------------------------------------- salas
const dinamicos = [];   // objetos refeitos a cada atualização do estado
const clicaveis = [];   // bonecos e rótulos que abrem o painel
const salas = {};       // ATIVO → {def, estacoes, traders}

// estação de trabalho: mesa, monitor, teclado, caneca, cadeira e lixeira; o trader senta em z = -0.78
function estacao(pai, x, z, rot, corCaneca) {
  const g = grupo(pai, x, z, rot);
  mesa(g, 1.4, 0.7);
  const tela = monitor(g, 0, 0.16);
  teclado(g, -0.05, -0.17);
  caneca(g, 0.52, -0.05, corCaneca);
  cadeira(g, 0, -0.78);
  lixeira(g, 0.88, -0.5);
  return { grupo: g, tela };
}

const CORES_CANECA = ["#ffffff", "#ef5350", "#4c8dff", "#f0b429", "#26a69a"];
MERCADOS.forEach((ativo, i) => {
  const s = PLANTA.salas[ativo], norte = s.z < 0;
  const fundo = norte ? s.z - s.d / 2 : s.z + s.d / 2;     // fachada do fundo
  const ext = [0, norte ? -1 : 1];
  const estacoes = [-2.6, 0, 2.6].map((dx, k) =>
    estacao(predio, s.x + dx, s.z + (norte ? -1.0 : 0.1), Math.PI, CORES_CANECA[(i + k) % 5]));
  planta(predio, s.x - s.w / 2 + 0.45, fundo - ext[1] * 0.45);
  planta(predio, s.x + s.w / 2 - 0.45, fundo - ext[1] * 0.45, false);
  const lado = s.x < 0 ? -1 : 1;                           // parede lateral externa
  armarioBaixo(predio, s.x + lado * (s.w / 2 - 0.33), s.z + (norte ? 1.75 : -1.75), -lado * Math.PI / 2);
  planta(predio, s.x - lado * (s.w / 2 - 0.45), s.z - ext[1] * 2.4, false);
  quadroParede(s.x, 1.65, fundo, ext, 1.3, 0.65, texPlacaSala(ativo, s));
  // mesinha de reunião no canto livre e quadro branco encostado na divisória, virado para as mesas
  mesaReuniao(predio, s.x + lado * 2.3, s.z + (norte ? 1.6 : 2.0), norte ? 0 : Math.PI / 2);
  quadroBranco(predio, s.x - lado * (s.w / 2 - 0.35), s.z + (norte ? 1.3 : -1.3), lado * Math.PI / 2);
  quadroParede(s.x + lado * s.w / 2, 1.6, s.z + (norte ? 1.75 : -1.75), [lado, 0], 0.7, 0.5, ARTES[i % 3]);
  luminaria(s.x - 2, s.z); luminaria(s.x + 2, s.z);
  luzSala(s.x, s.z);
  salas[ativo] = { def: s, estacoes, traders: [] };
});

// hall: mesa do gerente, quadro de ranking, sala de espera, bebedouro e plantas
tapete(predio, 0, 0.5, 4, 2.6);
const mesaGerente = grupo(predio, 0, -1.7, 0);   // o gerente senta ao norte da mesa, de frente para o hall
mesa(mesaGerente, 1.8, 0.8, M.madeiraEscura);
const telaGerente = monitor(mesaGerente, 0.3, 0.18);
teclado(mesaGerente, 0.3, -0.18);
caneca(mesaGerente, -0.6, -0.1, "#4c8dff");
cadeira(mesaGerente, 0, -0.85, 0, true);
const gerente = boneco({ pele: "#d9a37c", cabelo: "#4a4a4a", camisa: "#e9ecef", calca: "#25324a" }, { terno: "#25324a" });
gerente.position.set(0, 0, -0.85);
mesaGerente.add(gerente);
gerente.userData.alvo = "gerente";
clicaveis.push(gerente);

const quadro = grupo(predio, 0, -3.62, 0);
caixa(quadro, 2.7, 1.55, 0.08, M.preto, 0, 1.62, 0);
for (const s of [-1, 1]) caixa(quadro, 0.08, 0.9, 0.08, M.metal, s * 1.2, 0.45, 0);
const telaRanking = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.42), M.telaApagada);
telaRanking.position.set(0, 1.62, 0.042);
quadro.add(telaRanking);
const telaRankingVerso = telaRanking.clone();
telaRankingVerso.rotation.y = Math.PI;
telaRankingVerso.position.z = -0.042;
quadro.add(telaRankingVerso);

sofa(predio, -4.4, -3.3, 0, "#5f7d95");
mesaCentro(predio, -4.4, -2.2);
tapete(predio, -4.4, -2.5, 2.6, 1.7);
cadeiraVisita(predio, -2.9, -2.3, -Math.PI / 2);
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
cadeiraVisita(predio, dir.x - 0.55, dir.z - 0.55, Math.PI / 2);
cadeiraVisita(predio, dir.x - 0.55, dir.z + 0.55, Math.PI / 2);
const diretor = boneco({ pele: "#e8b896", cabelo: "#2b1d14", camisa: "#e9ecef", calca: "#2f2f35" }, { terno: "#2f2f35", gravata: "#4c8dff" });
diretor.position.set(0, 0, -0.85);
mesaDiretor.add(diretor);
diretor.userData.alvo = "gerente";
clicaveis.push(diretor);
telaDiretor.userData.alvo = "relatorios";   // o monitor da Diretoria abre os relatórios do dia
clicaveis.push(telaDiretor);
estante(predio, dir.x + 1.6, dir.z - dir.d / 2 + 0.3, 0);
planta(predio, dir.x + dir.w / 2 - 0.45, dir.z + dir.d / 2 - 0.45);
planta(predio, dir.x - dir.w / 2 + 0.5, dir.z - dir.d / 2 + 0.5, false);
sofa(predio, dir.x - 1.6, dir.z + dir.d / 2 - 0.55, Math.PI, "#7a2f3b");
mesaCentro(predio, dir.x - 1.6, dir.z + 1.4);
quadroParede(dir.x + dir.w / 2, 1.6, dir.z - 1.7, [1, 0], 0.9, 0.6, ARTES[1]);
quadroParede(dir.x + dir.w / 2, 1.6, dir.z + 1.7, [1, 0], 0.9, 0.6, ARTES[2]);
luminaria(dir.x - 1.5, dir.z); luminaria(dir.x + 1.5, dir.z);
luzSala(dir.x, dir.z, 7);
const rotDiretor = rotulo("Diretor (você)", "Diretoria", "#e6edf3", dir.cor);
rotDiretor.position.set(0, 1.98, -0.85);
Object.assign(rotDiretor.userData, { alvo: "gerente", boneco: diretor });
mesaDiretor.add(rotDiretor);
clicaveis.push(rotDiretor);
const rotDiretoria = rotulo("Diretoria", "sala do diretor", "#8b98a5", dir.cor);
rotDiretoria.position.set(dir.porta[0] - 0.5, 2.2, dir.porta[1]);
predio.add(rotDiretoria);

// ---------------------------------------------------------------- texturas que dependem do estado
const brl = v => (v < 0 ? "−" : v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const STATUS = { promovido: ["promovido", "#26a69a"], experiencia: ["em experiência", "#f0b429"], pausado: ["pausado", "#ef5350"] };
const resultadoDia = t => {
  const eq = t.equity || [];
  return eq.length > 1 ? eq.at(-1)[1] - eq.at(-2)[1] : 0;
};

function texCurva(t) {
  return canvasTex(320, 190, (g, w, h) => {
    g.fillStyle = "#0b0f14"; g.fillRect(0, 0, w, h);
    const v = (t.equity || []).map(p => p[1]);
    const final = v.at(-1) ?? 5000, cor = final >= 5000 ? "#26a69a" : "#ef5350";
    g.fillStyle = "#e6edf3"; g.font = "600 22px Segoe UI, sans-serif"; g.fillText(t.nome, 12, 28);
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
      g.fillStyle = PLANTA.salas[x.sala]?.cor || "#8b98a5"; g.font = "30px Segoe UI, sans-serif"; g.fillText(x.sala, 560, y);
      g.fillStyle = x.prova_resultado >= 0 ? "#26a69a" : "#ef5350"; g.font = "700 34px Segoe UI, sans-serif";
      g.textAlign = "right"; g.fillText(brl(x.prova_resultado), w - 48, y); g.textAlign = "left";
    });
  });
}

function texCavalete(ativo) {
  return canvasTex(256, 340, (g, w, h) => {
    g.fillStyle = "#f0b429"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#16181d";
    for (let x = -40; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 20, 0); g.lineTo(x + 40, 26); g.lineTo(x + 20, 26); g.fill(); }
    g.textAlign = "center"; g.font = "800 40px Segoe UI, sans-serif";
    g.fillText("AGUARDANDO", w / 2, 130); g.fillText("DADOS", w / 2, 178);
    g.font = "600 34px Segoe UI, sans-serif"; g.fillText(ativo, w / 2, 250);
  });
}

function cavalete(x, z, ativo) {
  const g = new THREE.Group(), tex = texCavalete(ativo);
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
// de desenho. Ficam de fora o que muda: telas, bonecos (animados) e quadros (somem com o recorte).
function fundirEstaticos(raizes, manter) {
  const porMaterial = new Map();
  const visitar = o => {
    if (manter.has(o)) return;
    if (o.isMesh) {
      const k = o.material.uuid + o.castShadow;
      if (!porMaterial.has(k)) porMaterial.set(k, { material: o.material, sombra: o.castShadow, geos: [], malhas: [] });
      const grupoMat = porMaterial.get(k);
      grupoMat.geos.push((o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld));
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
    cena.add(m);
    geos.forEach(g => g.dispose());
  }
}
fundirEstaticos([predio, fora], new Set([
  ...MERCADOS.flatMap(a => salas[a].estacoes.map(e => e.tela)),
  telaGerente, telaDiretor, telaRanking, telaRankingVerso, gerente, diretor,
  ...pecas.filter(pc => pc.inteira).map(pc => pc.m),
]));

// ---------------------------------------------------------------- estado → cena
let modoAtual = "cima";   // "cima" | "fp"; firma.modo = ... aplica a troca inteira
const firma = window.firma = {
  estado: null, abrirPainel, salas,
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
    const i = animados.indexOf(o); if (i >= 0) animados.splice(i, 1);
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
  const alvoAntes = selecionado?.userData.alvo;
  selecionado = null;
  plumbob.visible = false;

  MERCADOS.forEach((ativo, i) => {
    const sala = salas[ativo], s = sala.def, dados = estado?.salas?.[ativo];
    const ok = dados?.status === "ok";
    sala.traders = ok ? (dados.traders || []).slice(0, 3).map(t => ({ ...t, sala: ativo })) : [];  // ponytail: 3 mesas por sala; um 4º trader pede mais mesas
    sala.estacoes.forEach((est, k) => {
      const t = sala.traders[k];
      trocarTela(est.tela, t ? texCurva(t) : null);
      if (!t) return;
      const b = dinamico(boneco(PALETAS[(i * 3 + k) % 6], { cabelo: CABELO[t.nome] || "curto" }), est.grupo, true);
      b.position.z = -0.78;
      b.userData.alvo = t;
      const [nomeSt, corSt] = STATUS[t.status] || [t.status, "#8b98a5"];
      const dia = resultadoDia(t);
      const r = dinamico(rotulo(t.nome, `${nomeSt} · último pregão ${brl(dia)}`, dia >= 0 ? "#26a69a" : "#ef5350", corSt), est.grupo, true);
      r.position.set(0, 1.98, -0.78);
      Object.assign(r.userData, { alvo: t, boneco: b });
      if (alvoAntes?.nome === t.nome && alvoAntes?.sala === ativo) selecionar(b);
    });
    const placa = rotulo(`${ativo} · ${s.nome}`, ok ? `${sala.traders.length} traders` : "aguardando dados", ok ? "#8b98a5" : "#f0b429", s.cor);
    placa.position.set(s.porta[0], 2.2, s.porta[1] + (s.z < 0 ? -0.5 : 0.5));
    dinamico(placa, predio);
    if (!ok) dinamico(cavalete(s.x + 1.3, s.z + (s.z < 0 ? 1.5 : -1.5), ativo), predio);
  });

  trocarTela(telaRanking, texRanking(estado));
  trocarTela(telaRankingVerso, texRanking(estado));
  trocarTela(telaGerente, texRanking(estado));
  trocarTela(telaDiretor, texRanking(estado));
  const quando = estado?.gerado_em ? new Date(estado.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const rg = dinamico(rotulo("Gerente", `ciclo ${quando}`, "#8b98a5", "#4c8dff"), predio, true);
  rg.position.set(0, 1.98, -2.55);
  Object.assign(rg.userData, { alvo: "gerente", boneco: gerente });
  if (alvoAntes === "gerente") selecionar(gerente);
  $("#ciclo").textContent = estado ? `Ciclo do gerente: ${quando}` : "sem estado do gerente";
  $("#exemplo").hidden = !estado?.exemplo;
  if ($("#painel").classList.contains("aberto") && painelAlvo) abrirPainel(selecionado?.userData.alvo ?? painelAlvo);
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
  corpo.innerHTML = alvo === "gerente" ? htmlGerente(firma.estado) : alvo === "relatorios" ? htmlRelatorios(firma.estado) : htmlTrader(alvo);
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

function htmlTrader(t) {
  const [nomeSt, corSt] = STATUS[t.status] || [t.status, "#8b98a5"];
  const cls = { promovido: "up", pausado: "dn", experiencia: "warn" }[t.status] || "";
  const linha = (rot, f) => `<tr><td>${rot}</td><td>${f(t.treino || {})}</td><td>${f(t.prova || {})}</td></tr>`;
  const din = v => v == null ? "—" : `<span class="${v >= 0 ? "up" : "dn"}">${brl(v)}</span>`;
  const params = Object.entries(t.parametros || {}).map(([k, v]) => `${esc(k)} = ${esc(v)}`).join(" · ") || "padrão";
  const s = PLANTA.salas[t.sala];
  return `
    <div class="ficha"><span class="av" style="background:${s.cor}">${esc(t.nome[0])}</span>
      <div><div class="n">${esc(t.nome)}</div><div class="s">${esc(t.estilo)} · sala ${esc(t.sala)} (${esc(s.nome)})</div></div></div>
    <div class="chips"><span class="chip ${cls}" style="border-color:${corSt}">${esc(nomeSt)}</span>
      ${t.overfit ? '<span class="chip dn">overfit</span>' : ""}
      <span class="chip">confiança ${esc(t.prova?.confianca ?? "—")}</span></div>
    <h3>Decisão do gerente</h3><div class="decisao">${esc(t.decisao || "—")}</div>
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
      ${linkRelatorio(`${t.sala.toLowerCase()}-${slug(t.nome)}.html`, "Relatório do dia")}
      <a href="/?ativo=${encodeURIComponent(t.sala)}">Abrir na sala de operações (${esc(t.sala)}) →</a>
    </div>`;
}

function htmlGerente(estado) {
  if (!estado) return `<div class="ficha"><div class="n">Gerente</div></div><p class="warn">O gerente ainda não rodou: execute <b>python gerente.py</b>.</p>`;
  const quando = new Date(estado.gerado_em).toLocaleString("pt-BR");
  const salasHtml = MERCADOS.map(a => {
    const s = estado.salas?.[a];
    return `<tr><td>${a} · ${PLANTA.salas[a].nome}</td><td class="${s?.status === "ok" ? "up" : "warn"}">${s?.status === "ok" ? "ok" : "aguardando dados"}</td></tr>`;
  }).join("");
  return `
    <div class="ficha"><span class="av" style="background:#4c8dff">G</span>
      <div><div class="n">Gerente da firma</div><div class="s">último ciclo: ${esc(quando)}</div></div></div>
    ${estado.exemplo ? '<div class="chips"><span class="chip warn">dados de exemplo</span></div>' : ""}
    <h3>Ranking (prova)</h3>
    <table><tr><th>Trader</th><th>Sala</th><th>Resultado</th></tr>
      ${(estado.ranking || []).map(r => `<tr><td>${esc(r.nome)}</td><td>${esc(r.sala)}</td><td class="${r.prova_resultado >= 0 ? "up" : "dn"}">${brl(r.prova_resultado)}</td></tr>`).join("")}
    </table>
    <h3>Salas</h3><table>${salasHtml}</table>
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
  minDistance: 3, maxDistance: 40,
  screenSpacePanning: false,
});
controles.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

function focar(x, z, distancia, azimute = -35 * GRAU, polar = 45 * GRAU) {
  controles.target.set(x, 0, z);
  camera.position.set(
    x + distancia * Math.sin(polar) * Math.sin(azimute),
    distancia * Math.cos(polar),
    z + distancia * Math.sin(polar) * Math.cos(azimute));
  controles.update();
}

// ?cam=geral | sala&sala=EURUSD | diretoria (padrão: Diretoria) | fp[&pos=x,z,yaw°,pitch°] (primeira pessoa;
// o mouse só trava no primeiro clique); &trader=<nome> abre a ficha — útil para capturas
const pedido = new URLSearchParams(location.search);
const salaPedida = PLANTA.salas[pedido.get("sala")];
if (pedido.get("cam") === "geral") focar(3, 2.5, 33, -30 * GRAU, 42 * GRAU);
else if (pedido.get("cam") === "sala" && salaPedida) focar(salaPedida.x, salaPedida.z, 9);
else focar(dir.x - 1, dir.z, 11);

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
  t.x = THREE.MathUtils.clamp(t.x, -12, 18);
  t.z = THREE.MathUtils.clamp(t.z, -13, 13);
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
  return primeiroAlvo(raio.intersectObjects(clicaveis, true));
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
renderer.domElement.addEventListener("pointermove", e => { ultimoEvento = e; ponteiroMudou = true; });
renderer.domElement.addEventListener("pointerdown", e => { if (e.button === 0) inicioClique = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", e => {
  if (e.button !== 0 || !inicioClique || Math.hypot(e.clientX - inicioClique[0], e.clientY - inicioClique[1]) > 6) return;
  inicioClique = null;
  if (firma.modo === "fp") { if (!olhar.isLocked) travar(); return; }   // em primeira pessoa o clique só trava o mouse
  const o = alvoSob(e);
  if (o) interagir(o);
});

// trader → ficha; gerente/diretor → resumo; monitor da Diretoria → relatórios. O plumbob só vai em boneco.
function interagir(o) {
  const b = bonecoDe(o);
  selecionar(b.userData.contornos ? b : null);
  abrirPainel(b.userData.alvo);
}

// ---------------------------------------------------------------- primeira pessoa
// V alterna com a câmera de cima. O mouse olha (PointerLockControls); WASD anda a 3 m/s (Shift 5 m/s) com
// colisão só nas paredes (COLISORES), eixo por eixo para deslizar rente a elas; E interage com o que está na mira.
const OLHO = 1.7, RAIO = 0.3, ANDAR = 3, CORRER = 5, ALCANCE = 2.5;
const INICIO = [dir.x + 2.4, dir.z, 90, -8];   // x, z, yaw°, pitch°: atrás da mesa do diretor, olhando a porta
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
renderer.domElement.addEventListener("pointermove", e => {
  if (firma.modo !== "fp" || olhar.isLocked || !(e.buttons & 1)) return;
  giro.setFromQuaternion(camera.quaternion);
  giro.y -= e.movementX * 0.004;
  giro.x = THREE.MathUtils.clamp(giro.x - e.movementY * 0.004, -80 * GRAU, 80 * GRAU);
  camera.quaternion.setFromEuler(giro);
});

const camCima = { pos: new THREE.Vector3(), alvo: new THREE.Vector3() };
let poseFp = null;   // onde a primeira pessoa parou; null = ainda não entrou (começa na Diretoria)
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
    if (poseFp) { camera.position.copy(poseFp.pos); camera.quaternion.copy(poseFp.quat); }
    else teleportar(...INICIO);
  } else {
    poseFp = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    if (olhar.isLocked) olhar.unlock();
    camera.position.copy(camCima.pos);
    controles.target.copy(camCima.alvo);
    controles.update();
  }
  voltar.hidden = true;
  mirar(null);
  marcarSobre(null);
}

function teleportar(x, z, yaw = 0, pitch = 0) {   // graus; yaw 0 = norte (−z), 90 = oeste (−x)
  camera.position.set(x, OLHO, z);
  camera.rotation.set(pitch * GRAU, yaw * GRAU, 0, "YXZ");
}

const bate = (x, z) => COLISORES.some(c =>   // todos os colisores começam no chão ou no peitoril (as vergas não entram)
  x + RAIO > c.min[0] && x - RAIO < c.max[0] && z + RAIO > c.min[2] && z - RAIO < c.max[2]);
function andar(dx, dz) {
  // passos de até 5 cm: nunca atravessa (a peça mais fina, o vidro, vira 0,63 m com o raio) e para a < 5 cm da parede
  const n = Math.ceil(Math.hypot(dx, dz) / 0.05), p = camera.position;
  for (let k = 0; k < n; k++) {
    if (!bate(p.x + dx / n, p.z)) p.x += dx / n;
    if (!bate(p.x, p.z + dz / n)) p.z += dz / n;
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
const acaoDe = a => a === "gerente" ? "painel do gerente" : a === "relatorios" ? "relatórios do dia" : `ficha de ${a.nome}`;
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
carregar();
setInterval(carregar, 30000);

// ---------------------------------------------------------------- laço de render
new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = recipiente;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}).observe(recipiente);

const relogio = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(relogio.getDelta(), 0.1), t = relogio.elapsedTime;
  modos[firma.modo]?.(dt);
  atualizarParedes();
  animarBonecos(t);
  if (plumbob.visible) { plumbob.rotation.y = t * 1.5; plumbob.position.y = 1.72 + 0.04 * Math.sin(t * 2.5); }
  // rótulos crescem um pouco com a distância para continuarem legíveis na visão geral; em primeira pessoa
  // ficam menores e respeitam as paredes (de cima atravessam tudo)
  const fp = firma.modo === "fp";
  const f = fp ? 0.75 : THREE.MathUtils.clamp(camera.position.distanceTo(controles.target) / 11, 1, 2.4);
  for (const s of rotulos) { s.scale.set(s.userData.base * f, s.userData.base * f * 150 / 512, 1); s.material.depthTest = fp; }
  if (!fp && ponteiroMudou && ultimoEvento) { ponteiroMudou = false; marcarSobre(alvoSob(ultimoEvento)); }
  renderer.render(cena, camera);
  window.firmaPronta = true;   // o aviso de "não consegui carregar o 3D" da firma.html não aparece mais
});
