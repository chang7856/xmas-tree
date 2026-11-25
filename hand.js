/* 手：關鍵點拓樸、One Euro 濾波、手勢判斷、虛擬手。成品接 MediaPipe 時只換資料來源，判斷與濾波不變。 */

export const HAND_CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 }, PIP = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- One Euro ---------- */
export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) { this.mc = minCutoff; this.beta = beta; this.dc = dCutoff; this.x = null; this.dx = 0; this.t = null; }
  static alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dx = (v - this.x) / dt; const ad = OneEuro.alpha(this.dc, dt); this.dx = ad * dx + (1 - ad) * this.dx;
    const cut = this.mc + this.beta * Math.abs(this.dx); const a = OneEuro.alpha(cut, dt);
    this.x = a * v + (1 - a) * this.x; return this.x;
  }
}
export class HandFilter {
  constructor(opts) { this.opts = opts; this.f = [[], []]; this.on = true; }
  apply(hands, t) {
    if (!this.on) return hands;
    return hands.map((h, hi) => h && h.map((p, i) => { const fx = this.f[hi][i] ??= [new OneEuro(this.opts), new OneEuro(this.opts)]; return [fx[0].filter(p[0], t), fx[1].filter(p[1], t)]; }));
  }
  reset() { this.f = [[], []]; }
}

/* ---------- 手勢判斷（單幀） ---------- */
export function fingers(h) {
  const w = h[0], out = {};
  for (const k of ["index", "middle", "ring", "pinky"]) out[k] = d2(h[TIP[k]], w) > d2(h[PIP[k]], w) * 1.25;
  out.thumb = d2(h[4], h[17]) > d2(h[2], h[17]) * 1.15;
  return out;
}
export const palmWidth = (h) => d2(h[5], h[17]);
export function poseOf(h) {
  const f = fingers(h), pw = palmWidth(h);
  if (d2(h[4], h[8]) < pw * 0.35 && !f.middle && !f.ring) return "pinch";
  if (f.index && !f.middle && !f.ring && !f.pinky) return "point";
  if (f.index && f.middle && f.ring && f.pinky) return "open";
  if (!f.index && !f.middle && !f.ring && !f.pinky) return "fist";
  return "none";
}
export function classify(hands, W) {
  const hs = hands.filter(Boolean);
  if (hs.length === 2) {
    const [a, b] = hs, pw = (palmWidth(a) + palmWidth(b)) / 2;
    const tipsClose = d2(a[8], b[8]) < pw * 0.45 && d2(a[4], b[4]) < pw * 0.6;
    const indexAboveThumb = (a[8][1] + b[8][1]) / 2 < (a[4][1] + b[4][1]) / 2;
    if (tipsClose && indexAboveThumb) return "heart";
    const wristClose = d2(a[0], b[0]) < pw * 1.2;
    if (wristClose && poseOf(a) === "open" && poseOf(b) === "open") return "cross";
    if (poseOf(a) === "open" && poseOf(b) === "open") return d2(a[0], b[0]) > W * 0.4 ? "wide" : "two-open";
    return "two";
  }
  if (hs.length === 1) return poseOf(hs[0]);
  return "none";
}

/* ---------- 手勢狀態機：6 幀成立、10 幀解除、動作手勢看速度 ---------- */
export class GestureEngine {
  constructor({ W = 390, enter = 6, exit = 10 } = {}) { this.W = W; this.enter = enter; this.exit = exit; this.cand = "none"; this.candN = 0; this.active = "none"; this.absentN = 0; this.hist = []; this.cool = {}; this.listeners = []; }
  on(fn) { this.listeners.push(fn); }
  emit(type, detail) { this.listeners.forEach(f => f(type, detail)); }
  update(hands, t) {
    const g = classify(hands, this.W);
    if (g === this.cand) this.candN++; else { this.cand = g; this.candN = 1; }
    if (this.cand !== this.active) {
      if (this.candN >= this.enter && this.cand !== "none" && this.cand !== "two" && this.cand !== "two-open") { this.active = this.cand; this.absentN = 0; this.emit("enter", this.active); }
      else if (this.active !== "none") { this.absentN++; if (this.absentN >= this.exit) { const was = this.active; this.active = "none"; this.emit("exit", was); } }
    } else this.absentN = 0;
    // 動作：揮手（單手 400 ms 橫移 25% 寬）、拉開／合上（雙手 600 ms 距離變化 40% 寬）
    const hs = hands.filter(Boolean);
    const rec = { t, x: hs.length === 1 ? hs[0][0][0] : null, dist: hs.length === 2 ? d2(hs[0][0], hs[1][0]) : null };
    this.hist.push(rec); while (this.hist.length && t - this.hist[0].t > 0.7) this.hist.shift();
    const since = (k) => !this.cool[k] || t - this.cool[k] > 0.9;
    if (rec.x !== null) { const past = this.hist.find(r => r.x !== null && t - r.t <= 0.4 && t - r.t >= 0.15); if (past && Math.abs(rec.x - past.x) > this.W * 0.25 && since("swipe")) { this.cool.swipe = t; this.emit("swipe", rec.x > past.x ? "right" : "left"); } }
    if (rec.dist !== null) { const past = this.hist.find(r => r.dist !== null && t - r.t <= 0.6 && t - r.t >= 0.2); if (past) { if (rec.dist - past.dist > this.W * 0.4 && since("spread")) { this.cool.spread = t; this.emit("spread"); } if (past.dist - rec.dist > this.W * 0.3 && since("close")) { this.cool.close = t; this.emit("close"); } } }
    // 撒鹽：單手，手腕 y 在 0.6 秒內上下反轉 3 次以上，每段振幅超過畫面寬 3%
    rec.y = hs.length === 1 ? hs[0][0][1] : null;
    if (rec.y !== null) { const ys = this.hist.filter(r => r.y !== null && t - r.t <= 0.6).map(r => r.y); let rev = 0, dir = 0, ext = ys[0] ?? rec.y; for (const y of ys) { const d = y - ext; if (Math.abs(d) > this.W * 0.03) { const nd = Math.sign(d); if (dir && nd !== dir) rev++; dir = nd; ext = y; } }
      if (rev >= 3 && (!this.cool.shake || t - this.cool.shake > 0.45)) { this.cool.shake = t; this.emit("shake", { x: hs[0][12][0], y: hs[0][12][1] }); } }
    return { raw: g, cand: this.cand, candN: this.candN, active: this.active };
  }
  reset() { this.cand = "none"; this.candN = 0; this.active = "none"; this.absentN = 0; this.hist = []; }
}

/* ---------- 虛擬手：用姿勢參數產生 21 點 ---------- */
// 右手、掌心朝鏡頭、y 向上的手掌座標；left=true 鏡射
function build({ curl = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }, spread = 1, thumbIn = 0 } = {}) {
  const pts = new Array(21); pts[0] = [0, 0];
  const fing = (base, ang, lens, c, out) => { let p = base, a = ang; out.push(base); for (let i = 0; i < 3; i++) { a -= c * [0.25, 0.75, 0.9][i]; const L = lens[i] * (1 - 0.62 * c); p = [p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L]; out.push(p); } };
  const seq = [];
  fing([0.42, 0.18], 0.95 - thumbIn * 0.9, [0.34, 0.28, 0.24], curl.thumb, seq); // 1-4
  fing([0.34, 0.98], Math.PI / 2 - 0.16 * spread, [0.42, 0.26, 0.2], curl.index, seq); // 5-8
  fing([0.11, 1.04], Math.PI / 2 - 0.03 * spread, [0.46, 0.3, 0.22], curl.middle, seq); // 9-12
  fing([-0.12, 1.0], Math.PI / 2 + 0.1 * spread, [0.42, 0.27, 0.2], curl.ring, seq); // 13-16
  fing([-0.34, 0.88], Math.PI / 2 + 0.24 * spread, [0.33, 0.2, 0.17], curl.pinky, seq); // 17-20
  for (let i = 0; i < 20; i++) pts[i + 1] = seq[i];
  return pts;
}
export const POSES = {
  open: build({ spread: 1 }),
  fist: build({ curl: { thumb: 0.6, index: 1, middle: 1, ring: 1, pinky: 1 }, spread: 0.3, thumbIn: 0.6 }),
  point: build({ curl: { thumb: 0.5, index: 0, middle: 1, ring: 1, pinky: 1 }, spread: 0.3, thumbIn: 0.5 }),
  pinch: (() => { const p = build({ curl: { thumb: 0.1, index: 0.6, middle: 0.9, ring: 0.95, pinky: 1 }, spread: 0.2, thumbIn: 0.3 }); const tip = p[8]; p[4] = [tip[0] + 0.03, tip[1] - 0.04];
    const L = (a, b, t, bx, by) => [a[0] + (b[0] - a[0]) * t + bx, a[1] + (b[1] - a[1]) * t + by]; p[2] = L(p[1], p[4], 0.4, 0.08, -0.04); p[3] = L(p[1], p[4], 0.74, 0.05, -0.02); return p; })(),
  heart: build({ curl: { thumb: 0.5, index: 0.5, middle: 0.95, ring: 1, pinky: 1 }, spread: 0.2, thumbIn: 0 }),
  relax: build({ curl: { thumb: 0.2, index: 0.25, middle: 0.3, ring: 0.35, pinky: 0.4 }, spread: 0.6 }),
};
// 把手掌座標放到畫面：center 是手腕位置（px），size 是掌寬 px，rot 弧度，left 鏡射
export function placeHand(pose, { x, y, size = 90, rot = 0, left = false }) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pose.map(([px, py]) => { const lx = left ? -px : px; const X = lx * size, Y = -py * size; return [x + X * c - Y * s, y + X * s + Y * c]; });
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPts = (A, B, t) => A.map((p, i) => [lerp(p[0], B[i][0], t), lerp(p[1], B[i][1], t)]);
const easeIO = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/* 兩隻手的動畫：每隻手是一串關鍵影格 {pose, x, y, size, rot, left, at(秒)}；之間用 ease-in-out 插值 */
export class HandSim {
  constructor() { this.tracks = [null, null]; this.t0 = 0; this.noise = 1.6; this.visible = [false, false]; }
  play(tracks, now) { this.tracks = tracks.map(tr => tr ? tr.map(k => ({ size: 90, rot: 0, left: false, ...k })) : null); this.t0 = now; }
  clear() { this.tracks = [null, null]; }
  sample(now) {
    const t = now - this.t0;
    return this.tracks.map(tr => {
      if (!tr) return null; if (t < tr[0].at - 0.001) return null; const last = tr[tr.length - 1]; if (t > last.at + (last.hold ?? 0)) return null;
      let a = tr[0], b = tr[0]; for (let i = 0; i < tr.length; i++) { if (tr[i].at <= t) { a = tr[i]; b = tr[Math.min(i + 1, tr.length - 1)]; } }
      const span = Math.max(1e-3, b.at - a.at); const u = b === a ? 1 : easeIO(Math.min(1, (t - a.at) / span));
      const pa = placeHand(POSES[a.pose], a), pb = placeHand(POSES[b.pose], b);
      const pts = lerpPts(pa, pb, u);
      return pts.map(p => [p[0] + (Math.random() - 0.5) * this.noise * 2, p[1] + (Math.random() - 0.5) * this.noise * 2]);
    });
  }
}

/* 畫骨架：米白線、關節點、指尖亮點，像參考影片 */
export function drawHands(ctx, hands, { color = "rgba(239,227,195,.95)", glow = "rgba(143,227,255,.9)", label = null, dpr = 1 } = {}) {
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  hands.forEach(h => { if (!h) return;
    ctx.shadowColor = glow; ctx.shadowBlur = 10 * dpr; ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); HAND_CONN.forEach(([a, b]) => { ctx.moveTo(h[a][0], h[a][1]); ctx.lineTo(h[b][0], h[b][1]); }); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = color; h.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0], p[1], ([4, 8, 12, 16, 20].includes(i) ? 3.4 : 2.2) * dpr, 0, 6.283); ctx.fill(); });
    if (label) { ctx.font = `500 ${10 * dpr}px "IBM Plex Mono", monospace`; ctx.fillStyle = "rgba(143,227,255,.9)"; ctx.fillText(label, h[0][0] + 10 * dpr, h[0][1] + 16 * dpr); }
  });
  ctx.restore();
}
