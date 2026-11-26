import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/* ---------- 共用：緩動、補間、語言 ---------- */
const ease = {
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inQuart: t => t * t * t * t,
  sine: t => 0.5 - 0.5 * Math.cos(Math.PI * 2 * t),
  linear: t => t,
  outBack: t => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
};
const active = new Map();
function tween(obj, key, to, dur, fn = ease.outCubic, done) {
  const k = obj._id ??= Symbol(); let m = active.get(k); if (!m) active.set(k, m = {});
  if (m[key]) cancelAnimationFrame(m[key]);
  const from = obj[key], t0 = performance.now();
  const step = () => { const p = Math.min(1, (performance.now() - t0) / dur); obj[key] = from + (to - from) * fn(p);
    if (p < 1) m[key] = requestAnimationFrame(step); else { m[key] = 0; done && done(); } };
  m[key] = requestAnimationFrame(step);
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const GREET = { en: ["Merry Christmas", "en"], zh: ["聖誕快樂", "zh-Hant"], tr: ["Mutlu Noeller", "tr"] };
const ORB_WORDS = { en: ["LOVE YOU", "MISS YOU", "AM AT PEACE", "AM HERE", "AM YOURS"], zh: ["愛你", "想你", "很平靜", "我在", "是你的"], tr: ["SENİ SEVİYORUM", "SENİ ÖZLEDİM", "HUZURLUYUM", "BURADAYIM", "SENİNİM"] };
const HUD_POOL = {
  zh: ["被好好接住的那一刻   心跳 72 ▸ 58", "你說「我在」   延遲 0 ms", "一起沉默也不尷尬   訊號 100%", "想你   23:59 ▸ 00:00", "不用解釋就被懂   錯誤 0", "第一次牽手   36.7°C", "回家的路   剩 0 km", "愛 = 100%   沒有條件"],
  en: ["the warmth of being held   12.25   23:59", "loved without conditions   if(you){ stay }", "two heartbeats, one tempo   72 bpm ×2", "missing you in binary   01101100 01101111 01110110 01100101", "home is a person   25.03°N 121.56°E", "you read me without words   0 errors", "the night we lost track of time   00:00 ▸ 04:12"],
  tr: ["sevilmek: 0x4C4F5645   ❤ 100%", "seninle sessizlik bile güzel   sinyal %100", "eve dönmek gibi   mesafe 0 km", "seni özledim   23:59 ▸ 00:00", "anlatmadan anlaşılmak   hata 0", "ilk kez el ele   36.7°C"],
};
const pickHud = (first = "zh") => { const order = [first, ...["zh", "en", "tr"].filter(l => l !== first)]; return order.map(l => HUD_POOL[l][(Math.random() * HUD_POOL[l].length) | 0]); };
const HUD_LINES = pickHud("zh");
const C = (h) => new THREE.Color(h);
const PAL = { night: C("#07100B"), green: C("#1E5C3A"), green2: C("#3C9A63"), cream: C("#EFE3C3"), gold: C("#E8C170"), pink: C("#F2A7D8"), cyan: C("#8FE3FF"), violet: C("#B48CFF"), magenta: C("#FF4FD8") };

/* ---------- 共用：舞台（renderer + composer + 可見才跑） ---------- */
function makeStage(host, { ortho = false, fov = 32, z = 4.6, dpr = null } = {}) {
  const canvas = host.querySelector("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  const DPR = dpr || Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene(); scene.background = PAL.night.clone();
  const camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20) : new THREE.PerspectiveCamera(fov, 1, 0.1, 50);
  camera.position.set(0, 0, z);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.9, 0.4, 0.8);
  composer.addPass(bloom);
  const post = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.09 }, uCA: { value: 2 }, uVig: { value: 0.55 }, uScan: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime,uGrain,uCA,uVig,uScan; uniform vec2 uRes; varying vec2 vUv;
      float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){
        vec2 uv=vUv; vec2 d=uv-0.5; float r=length(d);
        float sy=fract(uTime*0.085)*1.4-0.2; float band=smoothstep(0.07,0.,abs(uv.y-sy))*uScan;
        uv.x+=band*0.004*sin(uTime*70.+uv.y*40.);
        vec2 off=d*(uCA*(1.+band*3.)/uRes)*2.4*r*2.0;
        float cr=texture2D(tDiffuse,uv+off).r; vec4 c=texture2D(tDiffuse,uv); float cb=texture2D(tDiffuse,uv-off).b;
        vec3 col=vec3(cr,c.g,cb); col+=band*0.045;
        float lum=clamp(dot(col,vec3(.299,.587,.114)),0.,1.);
        float n=hash(floor(gl_FragCoord.xy)+vec2(fract(uTime*7.1)*97.,fract(uTime*3.7)*53.));
        col+=(n-0.5)*uGrain*(1.0-lum*0.7);
        col*=1.0-uVig*smoothstep(0.45,1.1,r*1.6);
        gl_FragColor=vec4(max(col,0.),1.);
      }`
  });
  composer.addPass(post);
  composer.addPass(new OutputPass());
  const st = { host, canvas, renderer, scene, camera, composer, bloom, post, DPR, w: 1, h: 1, hooks: [], t: 0, visible: false, pointer: null, bloomTarget: 0.9, bloomScale: 1 };
  const resize = () => {
    const r = host.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === st.w && h === st.h) return; st.w = w; st.h = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    if (ortho) { const a = w / h; camera.left = -a; camera.right = a; camera.top = 1; camera.bottom = -1; } else camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.uniforms.uRes.value.set(w * DPR, h * DPR); st.bloomScale = Math.min(1, Math.max(0.4, h / 640));
    st.hooks.forEach(f => f.resize && f.resize(st));
  };
  new ResizeObserver(resize).observe(host); resize();
  let last = performance.now();
  const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; st.t += dt; post.uniforms.uTime.value = st.t; bloom.strength = st.bloomTarget * st.bloomScale;
    st.hooks.forEach(f => f.update && f.update(st, dt)); composer.render(); };
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; if (st.visible) { last = performance.now(); renderer.setAnimationLoop(loop); } else renderer.setAnimationLoop(null); }, { threshold: 0.05 }).observe(host);
  host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); st.pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) }; });
  host.addEventListener("pointerleave", () => { st.pointer = null; });
  return st;
}
const ndcToCss = (st, v) => ({ x: (v.x * 0.5 + 0.5) * st.w, y: (-v.y * 0.5 + 0.5) * st.h });

/* ---------- 樹：一個會變形的點雲（樹 / 祝福文字 / 星系 / 星） ---------- */
const GLYPHS = ["✦", "❄", "◇", "✿", "✶", "✧", "❋", "○"];
const SNOWG = ["·", "+", "×", "✧", "0", "1", "·", "·"];
function glyphAtlas(chars) { const cell = 64, cv = document.createElement("canvas"); cv.width = cell * chars.length; cv.height = cell; const x = cv.getContext("2d");
  x.fillStyle = "#fff"; x.font = "500 44px 'Noto Sans TC','IBM Plex Mono',sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; chars.forEach((c, i) => x.fillText(c, i * cell + cell / 2, cell / 2 + 2));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
function textPoints(text, fontFamily, weight, n, width = 2.9, y = 0.02) {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 320; const x = cv.getContext("2d");
  const lines = text.split("\n"); let size = Math.min(200, Math.floor(290 / lines.length)); x.font = `${weight} ${size}px ${fontFamily}`;
  const w = Math.max(...lines.map(l => x.measureText(l).width)); if (w > 940) size = Math.floor(size * 940 / w);
  x.font = `${weight} ${size}px ${fontFamily}`; x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
  lines.forEach((l, i) => x.fillText(l, 512, 160 + (i - (lines.length - 1) / 2) * size * 1.05));
  const d = x.getImageData(0, 0, 1024, 320).data; const px = []; for (let j = 0; j < 320; j += 2) for (let i = 0; i < 1024; i += 2) if (d[(j * 1024 + i) * 4 + 3] > 128) px.push(i, j);
  const out = new Float32Array(n * 3), m = px.length / 2, s = width / 1024;
  for (let k = 0; k < n; k++) { const q = (Math.random() * m) | 0; out[k * 3] = (px[q * 2] - 512) * s + (Math.random() - .5) * 0.008; out[k * 3 + 1] = (160 - px[q * 2 + 1]) * s + y + (Math.random() - .5) * 0.008; out[k * 3 + 2] = (Math.random() - .5) * 0.06; }
  return out;
}
const FORM = { tree: 0, en: 1, zh: 2, tr: 3, galaxy: 4 };
function makeTree(st, { count = 60000, y0 = -1.15, height = 2.3, mirror = true, snow = true, textWidth = 2.9, galaxyR = 1.75, twoLine = false, formY = 0.02 } = {}) {
  const pos = new Float32Array(count * 3), aH = new Float32Array(count), aSeed = new Float32Array(count), aShell = new Float32Array(count), gal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const h = Math.pow(Math.random(), 0.85);
    const tier = (h * 8.5) % 1;
    const rMax = 0.98 * (1 - h) * (0.72 + 0.28 * (1 - tier)) + 0.03;
    const shell = Math.pow(Math.random(), 0.45);
    const rho = rMax * (0.35 + 0.65 * shell);
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * rho; pos[i * 3 + 1] = y0 + h * height - (rho / rMax) * 0.16 * (1 - h); pos[i * 3 + 2] = Math.sin(a) * rho;
    aH[i] = h; aSeed[i] = Math.random(); aShell[i] = shell;
    const r = Math.pow(Math.random(), 0.55) * galaxyR, arm = i % 2, ga = (r / galaxyR) * 4.2 + arm * Math.PI + (Math.random() - .5) * 1.1 * (1 - r / galaxyR) + Math.random() * 0.3;
    gal[i * 3] = Math.cos(ga) * r; gal[i * 3 + 1] = Math.sin(ga) * r; gal[i * 3 + 2] = (Math.random() - .5) * 0.3 * (1 - r / galaxyR);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aH", new THREE.BufferAttribute(aH, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1)); g.setAttribute("aShell", new THREE.BufferAttribute(aShell, 1));
  g.setAttribute("aG", new THREE.BufferAttribute(gal, 3));
  ["aT0", "aT1", "aT2"].forEach(k => g.setAttribute(k, new THREE.BufferAttribute(pos.slice(), 3)));
  document.fonts.ready.then(async () => {
    const t0 = twoLine ? "Merry\nChristmas" : "Merry Christmas", t1 = "聖誕快樂", t2 = twoLine ? "Mutlu\nNoeller" : "Mutlu Noeller";
    await Promise.all([document.fonts.load("500 200px 'Instrument Serif'", t0 + t2), document.fonts.load("700 200px 'Noto Serif TC'", t1)]).catch(() => {});
    g.setAttribute("aT0", new THREE.BufferAttribute(textPoints(t0, "'Instrument Serif',serif", 500, count, textWidth, formY), 3));
    g.setAttribute("aT1", new THREE.BufferAttribute(textPoints(t1, "'Noto Serif TC',serif", 700, count, twoLine ? textWidth * 0.78 : textWidth * 0.88, formY), 3));
    g.setAttribute("aT2", new THREE.BufferAttribute(textPoints(t2, "'Instrument Serif',serif", 500, count, textWidth, formY), 3));
  });
  const u = { uTime: { value: 0 }, uGrow: { value: 0 }, uCollapse: { value: 0 }, uLit: { value: 0 }, uGrid: { value: 3 }, uDither: { value: 1 }, uDim: { value: 1 }, uPixelRatio: { value: st.DPR },
    uRes: { value: new THREE.Vector2(1, 1) }, uStarY: { value: y0 + height + 0.08 }, uFormA: { value: 0 }, uFormB: { value: 0 }, uMix: { value: 1 }, uMirror: { value: 0 }, uFloorY: { value: y0 - 0.02 }, uOrn: { value: 1 }, uGalR: { value: galaxyR }, uFormY: { value: formY }, uLamp: { value: 0.02 }, uSizeK: { value: 1 },
    uGreen: { value: PAL.green }, uGreen2: { value: PAL.green2 }, uCream: { value: PAL.cream }, uGold: { value: PAL.gold }, uPink: { value: PAL.pink }, uCyan: { value: PAL.cyan }, uViolet: { value: PAL.violet } };
  const VERT_COMMON = `uniform float uTime,uGrow,uCollapse,uLit,uGrid,uPixelRatio,uStarY,uFormA,uFormB,uMix,uMirror,uFloorY,uGalR,uFormY; uniform vec2 uRes;
      attribute float aH,aSeed,aShell; attribute vec3 aT0,aT1,aT2,aG;
      vec3 formPos(float f, vec3 tree){
        if(f<0.5) return tree; if(f<1.5) return aT0; if(f<2.5) return aT1; if(f<3.5) return aT2;
        float r=length(aG.xy)/uGalR; float ang=uTime*(0.05+0.16*(1.-r)); float c=cos(ang),s=sin(ang);
        vec3 q=vec3(mat2(c,-s,s,c)*aG.xy,aG.z); q.y=q.y*0.62+uFormY+0.03; return q; }
      float growOf(float h,float seed){ float g=clamp((uGrow*1.75-h-seed*0.3)/0.42,0.,1.); return 1.-pow(1.-g,3.); }
      vec3 treePos(vec3 p0,float h,float seed,float g){ vec3 p=p0; float ang=(1.-g)*12.566; float cs=cos(ang),sn=sin(ang); p.xz=mat2(cs,-sn,sn,cs)*p.xz; p.y=mix(-1.7,p.y,g);
        p.x+=sin(uTime*0.8+h*6.+seed*6.28)*0.012*h; p.z+=cos(uTime*0.7+seed*6.28)*0.008*h; return p; }
      float litOf(float h,float seed){ return (1.-smoothstep(uLit-0.22,uLit+0.02,h+(fract(seed*31.7)-.5)*0.14))*step(0.001,uLit); }
      float collapseOf(float h){ float cl=clamp(uCollapse*1.4-(1.-h)*0.4,0.,1.); return smoothstep(0.,1.,cl); }
      vec3 starOf(float seed){ return vec3(0.,uStarY,0.)+(vec3(seed,fract(seed*7.3),fract(seed*13.7))-.5)*0.07; }`;
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: VERT_COMMON + `
      varying float vSeed,vShell,vLit,vA,vFace,vTier,vText,vGal,vR,vX;
      void main(){
        vec3 n=normalize(vec3(position.x,0.,position.z)); vec3 nv=normalize((modelViewMatrix*vec4(n,0.)).xyz); vFace=nv.z*0.5+0.5; vTier=fract(aH*8.5);
        float g=growOf(aH,aSeed); vec3 p=treePos(position,aH,aSeed,g);
        vec3 pa=formPos(uFormA,p), pb=formPos(uFormB,p);
        float m=clamp(uMix*1.4-aSeed*0.4,0.,1.); m=m*m*(3.-2.*m);
        vec3 q=mix(pa,pb,m); float sw=sin(m*3.14159); float a2=sw*2.4*(aSeed-0.5); float c2=cos(a2),s2=sin(a2); q.xz=mat2(c2,-s2,s2,c2)*q.xz; q.y+=sw*0.4*(fract(aSeed*9.1)-0.5);
        float tA=step(0.5,uFormA)*step(uFormA,3.5), tB=step(0.5,uFormB)*step(uFormB,3.5); vText=mix(tA,tB,m);
        float gA=step(3.5,uFormA), gB=step(3.5,uFormB); vGal=mix(gA,gB,m); vR=length(aG.xy)/uGalR; vX=q.x/(uGalR/1.75);
        float cl=collapseOf(aH); q=mix(q,starOf(aSeed),cl);
        float lit=litOf(aH,aSeed); vLit=lit*(1.-cl); vSeed=aSeed; vShell=aShell; vA=g*(1.-cl*0.9);
        if(uMirror>0.5){ q.y=2.*uFloorY-q.y; float dpt=uFloorY-q.y; q.x+=sin(q.y*22.+uTime*2.2)*0.014*dpt; vA*=0.42*(1.-smoothstep(0.,1.4,dpt))*(1.-vText)*(1.-vGal); }
        vec4 mv=modelViewMatrix*vec4(q,1.); gl_Position=projectionMatrix*mv;
        float grid=uGrid*uPixelRatio*mix(1.,0.62,max(vText,vGal*0.5)); vec2 ndc=gl_Position.xy/gl_Position.w; vec2 px=(ndc*0.5+0.5)*uRes;
        px=(floor(px/grid)+0.5)*grid; gl_Position.xy=(px/uRes*2.-1.)*gl_Position.w;
        float big=step(0.9,fract(aSeed*5.1))*aShell*(1.-vText); gl_PointSize=grid*(1.+big)*0.92;
      }`,
    fragmentShader: `uniform float uTime,uGrid,uPixelRatio,uDither,uDim,uLamp; uniform vec3 uGreen,uGreen2,uCream,uGold,uPink,uCyan,uViolet;
      varying float vSeed,vShell,vLit,vA,vFace,vTier,vText,vGal,vR,vX;
      float bayer2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);} float bayer4(vec2 a){return bayer2(.5*a)*.25+bayer2(a);}
      void main(){
        if(vA<=0.02) discard;
        float sh=0.5+0.5*sin(uTime*1.6+vSeed*40.);
        float b=0.10+0.72*pow(vShell,1.4)*(0.55+0.45*sh);
        b*=mix(0.25,1.0,vFace); b*=mix(1.0,0.4,smoothstep(0.6,1.,vTier));
        float lamp=step(1.-uLamp,fract(vSeed*3.3)); b=mix(b,b*1.05+0.02,vLit); b=mix(b,1.,vLit*lamp);
        b=mix(b,0.34+0.16*sh,vText); b=mix(b,0.12+0.6*(1.-vR)*(0.6+0.4*sh),vGal);
        float th=mix(0.3,bayer4(gl_FragCoord.xy/(uGrid*uPixelRatio)),uDither);
        if(b*vA<th) discard;
        vec3 base=mix(uGreen*0.45,uGreen2,pow(vShell,1.5)*vFace); base=mix(base,uCream,smoothstep(0.85,1.,vShell)*0.35*sh*vFace);
        float pick=fract(vSeed*17.3); vec3 litc=pick<0.4?uGold:(pick<0.65?uPink:(pick<0.85?uCyan:uCream));
        vec3 col=mix(base,mix(base,litc,0.15),vLit); col=mix(col,litc*(0.8+0.6*vLit),vLit*lamp);
        vec3 holo=mix(uCream,uPink,smoothstep(-1.2,0.1,vX)); holo=mix(holo,uCyan,smoothstep(0.1,1.2,vX)); holo*=0.55+0.2*sh; col=mix(col,holo,vText);
        vec3 galc=mix(uCream*1.05,mix(uCyan,uViolet,smoothstep(0.3,1.,vR)),smoothstep(0.,0.35,vR)); galc*=(1.05-0.45*vR)*(0.8+0.4*sh); col=mix(col,galc,vGal);
        col*=uDim; gl_FragColor=vec4(col,vA);
      }` });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 2;
  const treeG = new THREE.Group(); treeG.add(pts);
  // 鏡面地板：同一批點反射到地板下，抖動更稀
  if (mirror) { const mm = mat.clone(); mm.uniforms = Object.assign({}, u, { uMirror: { value: 1 } }); const mp = new THREE.Points(g, mm); mp.frustumCulled = false; mp.renderOrder = 1; treeG.add(mp); }
  // ASCII 飾品：表層的點挑出來變成字元
  const ornIdx = []; for (let i = 0; i < count && ornIdx.length < 420; i++) if (aShell[i] > 0.9 && Math.random() < 0.05) ornIdx.push(i);
  const on = ornIdx.length, op = new Float32Array(on * 3), oh = new Float32Array(on), os = new Float32Array(on), og = new Float32Array(on);
  ornIdx.forEach((i, k) => { op.set(pos.subarray(i * 3, i * 3 + 3), k * 3); oh[k] = aH[i]; os[k] = aSeed[i]; og[k] = (Math.random() * 8) | 0; });
  const ogeo = new THREE.BufferGeometry(); ogeo.setAttribute("position", new THREE.BufferAttribute(op, 3)); ogeo.setAttribute("aH", new THREE.BufferAttribute(oh, 1)); ogeo.setAttribute("aSeed", new THREE.BufferAttribute(os, 1)); ogeo.setAttribute("aGlyph", new THREE.BufferAttribute(og, 1));
  ["aShell", "aT0", "aT1", "aT2", "aG"].forEach(k => ogeo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(on * (k === "aShell" ? 1 : 3)), k === "aShell" ? 1 : 3)));
  const orn = new THREE.Points(ogeo, new THREE.ShaderMaterial({ uniforms: Object.assign({}, u, { uAtlas: { value: glyphAtlas(GLYPHS) }, uOrn: u.uOrn }), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT_COMMON + ` uniform float uOrn,uSizeK; attribute float aGlyph; varying float vG,vSeed,vA;
      void main(){ float g=growOf(aH,aSeed); vec3 p=treePos(position,aH,aSeed,g); float cl=collapseOf(aH); p=mix(p,starOf(aSeed),cl);
        float lit=litOf(aH,aSeed); float pop=lit*(1.+0.4*sin(lit*3.14159)); vG=aGlyph; vSeed=aSeed; vA=lit*g*(1.-cl)*uOrn;
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=uPixelRatio*uSizeK*(10.+7.*fract(aSeed*5.3))*pop*(3.4/-mv.z); }`,
    fragmentShader: `uniform sampler2D uAtlas; uniform float uTime; uniform vec3 uGold,uPink,uCyan,uCream; varying float vG,vSeed,vA;
      void main(){ if(vA<=0.02) discard; vec2 uv=vec2((gl_PointCoord.x+vG)/8.,1.-gl_PointCoord.y); float a=texture2D(uAtlas,uv).a; if(a<0.3) discard;
        float pick=fract(vSeed*17.3); vec3 c=pick<0.4?uGold:(pick<0.65?uPink:(pick<0.85?uCyan:uCream)); float fl=0.75+0.25*sin(uTime*5.+vSeed*60.);
        gl_FragColor=vec4(c*1.05*fl,a*vA); }` }));
  orn.frustumCulled = false; orn.renderOrder = 3; treeG.add(orn);
  // 背景：全息箔 + 綠光暈 + 光柱
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.ShaderMaterial({ depthWrite: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uGreen: { value: PAL.green }, uDim: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime,uDim; uniform vec3 uGreen;
      float h(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float v=0.,a=0.5; for(int i=0;i<4;i++){ v+=a*vn(p); p=p*2.1+vec2(1.7,9.2); a*=0.5; } return v; }
      vec3 pal(float t){ return 0.5+0.5*cos(6.2832*(t+vec3(0.0,0.33,0.67))); }
      void main(){ vec2 p=vUv-vec2(0.5,0.4); p.x*=1.5; float d=length(p); float br=1.0+0.08*sin(uTime*1.047);
        float gl=exp(-d*d*11./br);
        float n=fbm(vUv*vec2(3.,2.2)+vec2(uTime*0.02,-uTime*0.015)); vec3 iri=pal(n*1.6+uTime*0.015+vUv.x*0.3);
        float pil=pow(max(0.,sin(vUv.x*38.+n*7.+uTime*0.1)),28.)*smoothstep(0.1,0.9,vUv.y)*0.045;
        vec3 col=uGreen*0.7*gl*uDim + iri*(0.02+0.024*n)*(1.-gl*0.6)*uDim + iri*pil*uDim;
        gl_FragColor=vec4(col,1.); }` }));
  glow.position.z = -2.5; glow.renderOrder = 0;
  // 地板圓環（點）
  const rn = 3, per = 420, fp = new Float32Array(rn * per * 3);
  for (let r = 0; r < rn; r++) for (let i = 0; i < per; i++) { const a = (i / per) * Math.PI * 2, rx = 1.0 + r * 0.42, rz = 0.3 + r * 0.14; const k = (r * per + i) * 3;
    fp[k] = Math.cos(a) * rx + (Math.random() - .5) * 0.02; fp[k + 1] = y0 - 0.02; fp[k + 2] = Math.sin(a) * rz; }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
  const floor = new THREE.Points(fg, new THREE.PointsMaterial({ color: PAL.green2.clone().multiplyScalar(0.55), size: 2 * st.DPR, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
  floor.renderOrder = 1;
  // 星（ASCII）與光漏
  const sc = document.createElement("canvas"); sc.width = sc.height = 160; const sx = sc.getContext("2d");
  const star = (r, R) => { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; pts.push([80 + Math.cos(a) * rr, 80 + Math.sin(a) * rr]); } return pts; };
  const poly = star(26, 68); const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  sx.fillStyle = "#EFE3C3"; sx.font = "bold 11px 'IBM Plex Mono', monospace"; sx.textAlign = "center"; sx.textBaseline = "middle";
  for (let y = 6; y < 160; y += 9) for (let x = 6; x < 160; x += 8) if (inside(x, y)) { const d = Math.hypot(x - 80, y - 80); sx.fillText(d < 20 ? "*" : (d < 48 ? "+" : "·"), x, y); }
  const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
  const starSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: PAL.gold.clone().multiplyScalar(2.2) }));
  starSp.position.set(0, y0 + height + 0.08, 0); starSp.scale.setScalar(0); starSp.renderOrder = 3;
  const fc = document.createElement("canvas"); fc.width = 512; fc.height = 32; const fx = fc.getContext("2d"); const fgr = fx.createLinearGradient(0, 0, 512, 0);
  fgr.addColorStop(0, "rgba(143,227,255,0)"); fgr.addColorStop(0.35, "rgba(143,227,255,0.5)"); fgr.addColorStop(0.5, "rgba(255,255,255,1)"); fgr.addColorStop(0.65, "rgba(242,167,216,0.5)"); fgr.addColorStop(1, "rgba(242,167,216,0)");
  fx.fillStyle = fgr; fx.fillRect(0, 0, 512, 32); const vg = fx.createLinearGradient(0, 0, 0, 32); vg.addColorStop(0, "rgba(0,0,0,1)"); vg.addColorStop(0.5, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,1)"); fx.globalCompositeOperation = "destination-out"; fx.fillStyle = vg; fx.fillRect(0, 0, 512, 32);
  const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace;
  const flareH = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  const flareV = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, rotation: Math.PI / 2 }));
  flareH.position.copy(starSp.position); flareV.position.copy(starSp.position); flareH.renderOrder = flareV.renderOrder = 4;
  // 數位雪：字元在三層深度落下
  let snowP = null; if (snow) { const sn = 520, sp = new Float32Array(sn * 3), ss = new Float32Array(sn), sg = new Float32Array(sn);
    for (let i = 0; i < sn; i++) { sp[i * 3] = (Math.random() - .5) * 7; sp[i * 3 + 1] = Math.random() * 5; sp[i * 3 + 2] = -1.6 + Math.random() * 3.4; ss[i] = Math.random(); sg[i] = (Math.random() * 8) | 0; }
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sgeo.setAttribute("aSeed", new THREE.BufferAttribute(ss, 1)); sgeo.setAttribute("aGlyph", new THREE.BufferAttribute(sg, 1));
    snowP = new THREE.Points(sgeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uTime: u.uTime, uPR: u.uPixelRatio, uSizeK: u.uSizeK, uAtlas: { value: glyphAtlas(SNOWG) }, uCream: { value: PAL.cream }, uDim: u.uDim },
      vertexShader: `uniform float uTime,uPR,uSizeK; attribute float aSeed,aGlyph; varying float vG,vA;
        void main(){ vec3 p=position; float sp=0.12+0.25*aSeed; p.y=mod(p.y-uTime*sp,5.)-2.6; p.x+=sin(uTime*0.6+aSeed*6.28+p.y*1.5)*0.18; float z=(p.z+1.6)/3.4;
          vG=aGlyph; vA=mix(0.55,0.18,z); vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=uPR*uSizeK*mix(4.,16.,z)*(3.4/-mv.z); }`,
      fragmentShader: `uniform sampler2D uAtlas; uniform vec3 uCream; uniform float uDim; varying float vG,vA; void main(){ vec2 uv=vec2((gl_PointCoord.x+vG)/8.,1.-gl_PointCoord.y); float a=texture2D(uAtlas,uv).a; gl_FragColor=vec4(uCream*0.9*uDim,a*vA); }` }));
    snowP.frustumCulled = false; snowP.renderOrder = 5; }
  const group = new THREE.Group(); group.add(glow, floor, treeG, starSp, flareH, flareV); if (snowP) group.add(snowP); st.scene.add(group);
  const T = { group, treeG, pts, u, glow, starSp, starScale: 0, rot: 0, dragV: 0, scale: 1, form: 0, faceMix: 0, flare: 0 };
  const hook = { update(s, dt) {
      u.uTime.value = s.t; glow.material.uniforms.uTime.value = s.t;
      const br = 1 + 0.02 * Math.sin(s.t * Math.PI * 2 / 6);
      treeG.scale.setScalar(br * T.scale); T.rot += dt * (Math.PI * 2 / 40) + T.dragV * dt; T.dragV *= Math.pow(0.02, dt);
      treeG.rotation.y = T.rot * (1 - T.faceMix);
      starSp.scale.setScalar(T.starScale * 0.44 * (1 + 0.06 * Math.sin(s.t * 3)));
      const fl = T.flare * T.starScale * (0.8 + 0.2 * Math.sin(s.t * 2.3)); flareH.material.opacity = fl * 0.9; flareV.material.opacity = fl * 0.5;
      flareH.scale.set(2.6 * (1 + 0.1 * Math.sin(s.t * 1.7)), 0.09, 1); flareV.scale.set(1.1, 0.07, 1);
    }, resize(s) { u.uRes.value.set(s.w * s.DPR, s.h * s.DPR); const k = Math.min(1, Math.max(0.3, s.h / 640)); u.uLamp.value = 0.02 * k * k; u.uSizeK.value = k; } };
  st.hooks.push(hook); hook.resize(st);
  let drag = null; st.host.addEventListener("pointerdown", e => { drag = { x: e.clientX }; });
  window.addEventListener("pointermove", e => { if (!drag) return; const dx = e.clientX - drag.x; T.rot += dx * 0.008; T.dragV = dx * 0.4; drag.x = e.clientX; });
  window.addEventListener("pointerup", () => drag = null);
  T.grow = async () => { u.uCollapse.value = 0; u.uLit.value = 0; u.uGrow.value = 0; T.starScale = 0; T.flare = 0; tween(u.uGrow, "value", 1, 3200, ease.outExpo); await delay(2300); tween(T, "starScale", 1, 500, ease.outBack); };
  T.light = () => { tween(u.uLit, "value", 1.35, 1800, ease.outCubic); tween(st, "bloomTarget", Math.max(st.bloomTarget, 0.95), 1800, ease.outCubic); tween(T, "flare", 1, 1600, ease.outCubic); };
  T.unlight = (ms = 300) => { tween(u.uLit, "value", 0, ms, ease.outCubic); tween(T, "flare", 0, ms, ease.outCubic); };
  T.collapse = async () => { T.unlight(300); tween(u.uCollapse, "value", 1, 900, ease.inQuart); await delay(700); tween(T, "starScale", 1.6, 300, ease.outCubic); await delay(600); tween(T, "starScale", 0, 300, ease.inQuart); await delay(700); T.grow(); };
  T.setForm = (f) => { if (f === T.form) return; u.uFormA.value = T.form; u.uFormB.value = f; T.form = f; u.uMix.value = 0; tween(u.uMix, "value", 1, 1400, ease.linear);
    if (f === 0) T.rot = 0;
    tween(T, "faceMix", f === 0 ? 0 : 1, 1400, ease.outCubic); tween(u.uOrn, "value", f === 0 ? 1 : 0, 600, ease.outCubic); tween(T, "starScale", f === 0 ? 1 : 0, 500, ease.outCubic); };
  return T;
}

/* ---------- 點綴 ---------- */
function orbTexture(c1, c2) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const x = cv.getContext("2d");
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.18, c1); g.addColorStop(0.42, c2); g.addColorStop(0.62, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = "rgba(255,255,255,0.9)"; for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = 30 + Math.random() * 70; x.beginPath(); x.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 1 + Math.random() * 1.6, 0, 6.28); x.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function softDot() { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const x = cv.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
function makeDeco(st, { labels = true, region = null, zone = { x: 0, y: 0, r: 0.3 }, orbs = 5, streaks = 14, zDepth = 0, orbScale = 1, sides = false } = {}) {
  const grp = new THREE.Group(); st.scene.add(grp);
  const texs = [orbTexture("rgba(242,167,216,0.9)", "rgba(143,227,255,0.55)"), orbTexture("rgba(227,92,138,0.9)", "rgba(247,227,154,0.55)"), orbTexture("rgba(180,140,255,0.9)", "rgba(157,224,181,0.55)")];
  const O = []; const labelEls = [];
  const area = region || { x0: -0.95, x1: 0.95, y0: -0.6, y1: 0.85 };
  for (let i = 0; i < orbs; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sp.renderOrder = 10; grp.add(sp);
    const o = { sp, bx: sides ? (i % 2 ? 1 : -1) * (0.55 + Math.random() * 0.3) : area.x0 + (i + 0.5) / orbs * (area.x1 - area.x0), by: area.y0 + Math.random() * (area.y1 - area.y0), ph: Math.random() * 6.28, sz: (0.14 + Math.random() * 0.08) * orbScale, x: 0, y: 0, vx: 0, vy: 0 };
    o.x = o.bx; o.y = o.by; O.push(o);
    if (labels) { const el = document.createElement("div"); el.className = "lbl"; st.host.querySelector(".ov").appendChild(el); labelEls.push(el); }
  }
  // 光痕 instanced
  const sg = new THREE.PlaneGeometry(1, 1); const smat = new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    vertexShader: `attribute vec3 iCol; attribute float iA; varying vec2 vUv; varying vec3 vC; varying float vA; void main(){ vUv=uv; vC=iCol; vA=iA; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vC; varying float vA; void main(){ float a=smoothstep(0.,0.35,vUv.y)*smoothstep(1.,0.6,vUv.y); float w=smoothstep(0.5,0.0,abs(vUv.x-0.5)); float dots=0.6+0.4*step(0.85,fract(vUv.y*14.)); gl_FragColor=vec4(vC*1.6*dots,a*w*vA); }` });
  const inst = new THREE.InstancedMesh(sg, smat, streaks); inst.renderOrder = 9; inst.frustumCulled = false; grp.add(inst);
  const cols = [PAL.pink, PAL.cyan, PAL.gold, PAL.cream]; const icol = new Float32Array(streaks * 3), ia = new Float32Array(streaks);
  const S = []; for (let i = 0; i < streaks; i++) { const c = cols[i % 4]; icol.set([c.r, c.g, c.b], i * 3); ia[i] = 0.5 + Math.random() * 0.5; S.push({ bx: area.x0 + Math.random() * (area.x1 - area.x0), x: 0, y: area.y1 - Math.random() * 1.6, len: 0.3 + Math.random() * 0.5, sp: 0.04 + Math.random() * 0.08 }); S[i].x = S[i].bx; }
  sg.setAttribute("iCol", new THREE.InstancedBufferAttribute(icol, 3)); sg.setAttribute("iA", new THREE.InstancedBufferAttribute(ia, 1));
  // 光點鏈
  const chainN = 4, perC = 26, cp = new Float32Array(chainN * perC * 3), cs = new Float32Array(chainN * perC), cc = new Float32Array(chainN * perC * 3);
  for (let c = 0; c < chainN; c++) for (let i = 0; i < perC; i++) { const k = c * perC + i; const side = c < 2 ? -1 : 1; cp[k * 3] = side * (0.86 + (c % 2) * 0.09) + (Math.random() - .5) * 0.03; cp[k * 3 + 1] = area.y1 + 0.1 - i / perC * (area.y1 - area.y0 + 0.25) + (Math.random() - .5) * 0.03; cp[k * 3 + 2] = 0;
    cs[k] = 3 + Math.pow(Math.random(), 2.5) * 11; const w = Math.random() < 0.12; const col = w ? PAL.cream : PAL.violet; cc.set([col.r, col.g, col.b], k * 3); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.BufferAttribute(cp, 3)); cg.setAttribute("aS", new THREE.BufferAttribute(cs, 1)); cg.setAttribute("color", new THREE.BufferAttribute(cc, 3));
  const chain = new THREE.Points(cg, new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, uniforms: { uT: { value: softDot() }, uTime: { value: 0 }, uPR: { value: st.DPR }, uAspect: { value: 1 } },
    vertexShader: `attribute float aS; varying vec3 vC; varying float vS; uniform float uTime,uPR,uAspect; void main(){ vC=color; vS=aS; vec3 p=position; p.x=p.x*uAspect+sin(uTime*1.047+position.y*2.)*0.02; vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=aS*uPR*1.4; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uT; varying vec3 vC; varying float vS; void main(){ vec4 t=texture2D(uT,gl_PointCoord); gl_FragColor=vec4(vC*(1.2+vS*0.08),t.a*0.9); }`, vertexColors: true }));
  chain.renderOrder = 8; grp.add(chain);
  const D = { grp, on: { orb: true, streak: true, chain: true }, lang: "en", zone, labelEls, orbs: O };
  const hook = { update(s, dt) {
      const aspect = s.w / s.h; const Z = D.zone; const zr = Z.r;
      // 單位空間：x 在 [-aspect, aspect]，y 在 [-1, 1]；透視相機時整組縮放到 zDepth 那一層的可見範圍
      if (s.camera.isOrthographicCamera) { grp.scale.set(1, 1, 1); grp.position.set(0, 0, 0); }
      else { const dist = s.camera.position.z - zDepth; const hh = dist * Math.tan(THREE.MathUtils.degToRad(s.camera.fov) / 2); grp.scale.set(hh, hh, 1); grp.position.set(s.camera.position.x, s.camera.position.y, zDepth); }
      chain.material.uniforms.uTime.value = s.t; chain.material.uniforms.uAspect.value = aspect; chain.visible = D.on.chain; inst.visible = D.on.streak;
      // 光球
      O.forEach((o, i) => { o.sp.visible = D.on.orb;
        const hx = o.bx + Math.sin(s.t * 0.94 + o.ph) * 0.18, hy = o.by + Math.cos(s.t * 0.7 + o.ph * 1.3) * 0.12;
        let tx = hx, ty = hy; const dx = (hx - Z.x) * aspect, dy = hy - Z.y; const d = Math.hypot(dx, dy); const need = zr * 1.12 + o.sz * 0.9;
        if (d < need) { const k = (need - d) / Math.max(d, 1e-4); tx = hx + dx / aspect * k; ty = hy + dy * k; }
        let rate = 4; if (o.hold) { tx = o.hold.x; ty = o.hold.y; rate = 14; } else if (o.anchor) { tx = o.anchor.x + Math.sin(s.t * 1.3 + o.ph) * 0.01; ty = o.anchor.y + Math.cos(s.t * 1.1 + o.ph) * 0.01; rate = 9; }
        const f = 1 - Math.exp(-dt * rate); o.x += (tx - o.x) * f; o.y += (ty - o.y) * f;
        o.flash = (o.flash || 0) * Math.exp(-dt * 4);
        const sc = o.sz * (1 + 0.08 * Math.sin(s.t * 2 + o.ph)) * 2 * (1 + o.flash * 0.9);
        o.sp.position.set(o.x * aspect, o.y, 0); o.sp.scale.set(sc, sc, 1);
        if (labels) { const el = labelEls[i]; el.hidden = !D.on.orb; el.textContent = ORB_WORDS[D.lang][i % 5]; if (D.lang === "tr") el.setAttribute("lang", "tr"); else el.removeAttribute("lang");
          const css = ndcToCss(s, { x: o.x, y: o.y }); el.style.left = css.x + "px"; el.style.top = (css.y + o.sz * s.h * 0.9) + "px"; }
      });
      // 光痕
      const m = new THREE.Matrix4();
      S.forEach((q, i) => { q.y -= q.sp * dt; if (q.y < area.y0 - 0.25) { q.y = area.y1 + 0.3; q.bx = area.x0 + Math.random() * (area.x1 - area.x0); }
        let tx = q.bx; const dx = (q.bx - Z.x) * aspect; const yin = Math.abs(q.y + q.len * 0.5 - Z.y) < zr * 1.2; if (yin && Math.abs(dx) < zr * 1.15) tx = Z.x + Math.sign(dx || 1) * zr * 1.15 / aspect;
        q.x += (tx - q.x) * (1 - Math.exp(-dt * 3));
        m.makeScale(0.012, q.len, 1); m.setPosition(q.x * aspect, q.y + q.len * 0.5, 0); inst.setMatrixAt(i, m); });
      inst.instanceMatrix.needsUpdate = true;
    } };
  st.hooks.push(hook);
  return D;
}

/* ---------- 光蝴蝶 ---------- */
function makeButterfly(st, { n = 6000, scale = 0.16, pos = [0, 0, 0] } = {}) {
  const p = new Float32Array(n * 3), seed = new Float32Array(n), side = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 24; const r = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin(t / 12), 5); let x = r * Math.sin(t), y = r * Math.cos(t); const f = i % 2 ? Math.pow(Math.random(), 0.5) : 1; x *= f; y *= f;
    p[i * 3] = x * scale; p[i * 3 + 1] = (y - 0.6) * scale; p[i * 3 + 2] = 0; seed[i] = Math.random(); side[i] = Math.abs(x) < 0.25 ? 0 : (x < 0 ? -1 : 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1)); g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  const u = { uTime: { value: 0 }, uScale: { value: 0 }, uDis: { value: 0 }, uGrid: { value: 2 }, uPR: { value: st.DPR }, uRes: { value: new THREE.Vector2(1, 1) }, uM: { value: PAL.magenta }, uC: { value: PAL.cyan }, uW: { value: PAL.cream } };
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime,uScale,uDis,uGrid,uPR; uniform vec2 uRes; attribute float aSeed,aSide; varying float vSeed,vSide,vA;
      void main(){ float F=sin(uTime*6.283*2.4)*0.95; vec3 q=position; q.z=q.x*sin(F)*0.7; q.x*=cos(F); q.y+=sin(uTime*6.283*2.4+1.5)*0.01;
        vec3 dir=normalize(vec3(fract(aSeed*7.1)-.5,fract(aSeed*13.3)-.5+0.3,fract(aSeed*3.7)-.5)); q+=dir*uDis*uDis*0.9*(0.5+aSeed);
        q*=uScale; vSeed=aSeed; vSide=aSide; vA=(1.-uDis)*smoothstep(0.,0.05,uScale);
        vec4 mv=modelViewMatrix*vec4(q,1.); gl_Position=projectionMatrix*mv;
        float grid=uGrid*uPR; vec2 ndc=gl_Position.xy/gl_Position.w; vec2 px=(ndc*0.5+0.5)*uRes; px=(floor(px/grid)+0.5)*grid; gl_Position.xy=(px/uRes*2.-1.)*gl_Position.w;
        gl_PointSize=grid*0.95*(1.+step(0.93,aSeed)); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uM,uC,uW; varying float vSeed,vSide,vA; void main(){ if(vA<=0.01) discard; float fl=0.5+0.5*sin(uTime*9.+vSeed*50.); if(fl*0.8+0.2<fract(vSeed*91.)*0.5) discard;
        vec3 col=vSide<-0.5?uM:(vSide>0.5?uC:uW); col=mix(col,uW,step(0.97,vSeed)); gl_FragColor=vec4(col*(1.4+fl*1.2),vA*0.9); }` }));
  pts.position.set(...pos); pts.renderOrder = 20; pts.frustumCulled = false; st.scene.add(pts);
  const B = { pts, u, k: 170, d: 16, x: 0, v: 0, target: 0 };
  const hook = { update(s, dt) { u.uTime.value = s.t; const sub = 4, h = dt / sub; for (let i = 0; i < sub; i++) { B.v += (-B.k * (B.x - B.target) - B.d * B.v) * h; B.x += B.v * h; } u.uScale.value = Math.max(0, B.x); }, resize(s) { u.uRes.value.set(s.w * s.DPR, s.h * s.DPR); } };
  st.hooks.push(hook); hook.resize(st);
  B.show = () => { tween(u.uDis, "value", 0, 1); B.x = 0; B.v = 0; B.target = 1; };
  B.dissolve = () => { if (B.target === 0 && B.x < 0.02) return; B.target = B.x; tween(u.uDis, "value", 1, 900, ease.outCubic, () => { B.target = 0; B.x = 0; B.v = 0; }); };
  return B;
}
async function playHud(hudEl, txtEl, lines) { lines = lines || pickHud(["zh", "en", "tr"][(Math.random() * 3) | 0]);
  const labs = hudEl.querySelectorAll(".lab,.box,.dash"); labs.forEach(e => e.style.opacity = 0); txtEl.textContent = "";
  for (const e of labs) { e.style.transition = "opacity .2s"; e.style.opacity = 1; await delay(80); }
  let out = ""; for (const ln of lines) { for (const ch of ln) { out += ch; txtEl.textContent = out; await delay(40); } out += "\n"; await delay(200); }
}

/* ---------- 祝福文字散聚 ---------- */
function setGreet(wrap, lang, animate = true) {
  const w = wrap.querySelector(".w"); const [text, code] = GREET[lang];
  const old = [...w.querySelectorAll("span")];
  const build = () => { w.setAttribute("lang", code); w.innerHTML = ""; [...text].forEach((ch, i) => { const s = document.createElement("span"); s.textContent = ch; w.appendChild(s); if (animate) { const dx = (Math.random() - .5) * 40, dy = (Math.random() - .5) * 30; s.animate([{ opacity: 0, filter: "blur(8px)", transform: `translate(${dx}px,${dy}px) scale(.5)` }, { opacity: 1, filter: "blur(0)", transform: "none" }], { duration: 500, delay: i * 18, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" }); } }); };
  if (!animate || !old.length) return build();
  old.forEach((s, i) => { const dx = (Math.random() - .5) * 28, dy = (Math.random() - .5) * 28; s.animate([{ opacity: 1 }, { opacity: 0, filter: "blur(6px)", transform: `translate(${dx}px,${dy}px) scale(.6)` }], { duration: 350, delay: i * 14, easing: "ease-in", fill: "forwards" }); });
  setTimeout(build, 350 + old.length * 14);
}
function wireLang(el, cb) { el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); cb(b.dataset.l); })); }
function pressSeg(id, k) { document.querySelectorAll("#" + id + " button").forEach(x => x.setAttribute("aria-pressed", x.dataset.k === k)); }
function wireSeg(el, cb) { el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); cb(b.dataset.k); })); }


export { ease, tween, delay, GREET, ORB_WORDS, HUD_POOL, pickHud, HUD_LINES, C, PAL, makeStage, ndcToCss, GLYPHS, SNOWG, glyphAtlas, textPoints, FORM, makeTree, orbTexture, softDot, makeDeco, makeButterfly, playHud, setGreet, pressSeg, wireLang, wireSeg };
