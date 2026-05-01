/* Overlays */
function openOverlay(id){
  document.getElementById('ov-'+id).classList.add('on');
  document.getElementById('main-site').classList.add('blurred');
}
function closeOverlay(id){
  document.getElementById('ov-'+id).classList.remove('on');
  document.getElementById('main-site').classList.remove('blurred');
}
document.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openOverlay(el.dataset.open)));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeOverlay(el.dataset.close)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ['about','contact'].forEach(closeOverlay); });

/* Scroll reveal */
const rt = document.getElementById('reveal-text');
if (rt) {
  const wk = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
  const ts = []; let n; while ((n = wk.nextNode())) ts.push(n);
  ts.forEach(t => {
    const f = document.createDocumentFragment();
    t.textContent.split(/(\s+)/).forEach(p => {
      if (p.match(/^\s+$/)) f.appendChild(document.createTextNode(p));
      else if (p) { const s = document.createElement('span'); s.className = 'reveal-word'; s.textContent = p; f.appendChild(s); }
    });
    t.replaceWith(f);
  });
  const ws = rt.querySelectorAll('.reveal-word');
  new IntersectionObserver(e => e.forEach(x => { if (x.isIntersecting) ws.forEach((w, i) => setTimeout(() => w.classList.add('on'), i * 70)); }), {threshold: 0.3}).observe(rt);
}
document.querySelectorAll('.slide-in, .rise-in').forEach(el => {
  new IntersectionObserver(e => e.forEach((x, i) => { if (x.isIntersecting) setTimeout(() => x.target.classList.add('on'), i * 90); }), {threshold: 0.12}).observe(el);
});

/* ===========================================================
   CURSOR — instant 1:1 follow
   =========================================================== */
const cursorEl = document.getElementById('cursor');
const cxyEl = document.getElementById('cursor-xy');

let mouseRX = 0, mouseRY = 0;
let cx = 0, cy = 0;

window.addEventListener('mousemove', (e) => {
  mouseRX = e.clientX; mouseRY = e.clientY;
  cx = mouseRX; cy = mouseRY;
  cursorEl.style.transform = `translate(${cx}px, ${cy}px)`;
  cxyEl.textContent = `x ${Math.round(cx)}, y ${Math.round(cy)}`;
});

function bindHover(){
  document.querySelectorAll('.interactive, a, button, [data-open]').forEach(el => {
    if (el.__bound) return; el.__bound = true;
    el.addEventListener('mouseenter', () => cursorEl.classList.add('hot'));
    el.addEventListener('mouseleave', () => cursorEl.classList.remove('hot'));
  });
}
bindHover();
new MutationObserver(bindHover).observe(document.body, {childList:true, subtree:true});

document.addEventListener('mouseleave', () => cursorEl.style.opacity = '0');
document.addEventListener('mouseenter', () => cursorEl.style.opacity = '1');

/* ===========================================================
   MESH BACKGROUND
   - Mesh follows a delayed mouse so it reacts AFTER cursor dot
   - Click: applied force / FEM bloom, decays in time
   =========================================================== */
const meshCanvas = document.getElementById('mesh-canvas');
const mctx = meshCanvas.getContext('2d');
let MW=0, MH=0, DPR=Math.min(2, devicePixelRatio||1);

function resizeMesh(){
  DPR = Math.min(2, devicePixelRatio||1);
  MW=window.innerWidth; MH=window.innerHeight;
  meshCanvas.width=MW*DPR; meshCanvas.height=MH*DPR;
  meshCanvas.style.width=MW+'px'; meshCanvas.style.height=MH+'px';
  mctx.setTransform(DPR,0,0,DPR,0,0);
}
resizeMesh();
window.addEventListener('resize', () => { resizeMesh(); resizePen(); });

let meshMx = -9999, meshMy = -9999;
let mouseInside = false;
window.addEventListener('mousemove', () => { mouseInside = true; });
window.addEventListener('mouseleave', () => { mouseInside = false; });

const MESH_FOLLOW = 0.045;

/* Click impulses — 30% chance of inversion (tension vs compression) */
const impulses = [];
const IMPULSE_LIFE = 1800;
const IMPULSE_RADIUS_MAX = 520;
const INVERT_PROBABILITY = 0.3;
window.addEventListener('mousedown', (e) => {
  impulses.push({
    x: e.clientX, y: e.clientY,
    t0: performance.now(),
    inverted: Math.random() < INVERT_PROBABILITY
  });
  if (impulses.length > 6) impulses.shift();
});

/* Mesh density: fewer nodes on mobile for performance */
const isMobile = window.innerWidth < 768;
const rows = isMobile ? 16 : 32;
const cols = isMobile ? 24 : 48;

const nodes=[];
for (let i=0;i<=rows;i++) for (let j=0;j<=cols;j++){
  nodes.push({
    ox:j/cols, oy:i/rows,
    bx:0, by:0, x:0, y:0, tx:0, ty:0,
    phase: Math.random()*Math.PI*2,
    ampX: 4+Math.random()*5,
    ampY: 4+Math.random()*5,
    freq: .35+Math.random()*.3,
    inited: false,
  });
}
function nidx(r,c){return r*(cols+1)+c;}

function femColor(t, alpha){
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0.00, 220, 50, 30],
    [0.20, 235, 130, 30],
    [0.40, 230, 200, 40],
    [0.60, 90, 180, 80],
    [0.80, 60, 160, 190],
    [1.00, 40, 90, 190],
  ];
  for (let i=1;i<stops.length;i++){
    const a=stops[i-1], b=stops[i];
    if (t<=b[0]){
      const k=(t-a[0])/(b[0]-a[0]);
      const r=a[1]+(b[1]-a[1])*k|0;
      const g=a[2]+(b[2]-a[2])*k|0;
      const bl=a[3]+(b[3]-a[3])*k|0;
      return `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
    }
  }
  return `rgba(40,90,190,${alpha.toFixed(3)})`;
}

let t0 = performance.now();
const HOVER_RADIUS = 180;
const ATTRACT      = 0.14;
const DAMPING      = 0.12;

function meshFrame(now){
  const t = (now - t0)/1000;
  mctx.clearRect(0,0,MW,MH);

  if (mouseInside){
    if (meshMx < -1000){ meshMx = mouseRX; meshMy = mouseRY; }
    meshMx += (mouseRX - meshMx) * MESH_FOLLOW;
    meshMy += (mouseRY - meshMy) * MESH_FOLLOW;
  } else {
    meshMx = -9999; meshMy = -9999;
  }

  for (let i=impulses.length-1;i>=0;i--){
    if (now - impulses[i].t0 > IMPULSE_LIFE) impulses.splice(i,1);
  }
  drawMesh(t, now, false);
  requestAnimationFrame(meshFrame);
}

function drawMesh(t, now, still){
  const useMx = meshMx, useMy = meshMy;

  /* Cache CSS vars once per frame instead of per node/member */
  const style = getComputedStyle(document.documentElement);
  const inkRaw = style.getPropertyValue('--ink').trim() || '#151612';
  const ink2 = style.getPropertyValue('--ink2').trim() || 'rgba(0,0,0,.3)';
  const inkRgb = hexToRgb(inkRaw);

  for (const n of nodes){
    const bx = n.ox*MW, by = n.oy*MH;
    let tx, ty;
    if (still){ tx = bx; ty = by; }
    else {
      const wave  = Math.sin(t*0.9 + n.ox*4 + n.oy*3) * 9;
      const wave2 = Math.cos(t*0.75  + n.oy*3.5 - n.ox*2) * 7;
      tx = bx + Math.sin(t*n.freq + n.phase)*n.ampX + wave*0.45;
      ty = by + Math.cos(t*n.freq*0.85 + n.phase*1.2)*n.ampY + wave2*0.5;
    }
    if (useMx > -1000){
      const dx = useMx - tx, dy = useMy - ty;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < HOVER_RADIUS){
        const f = (1 - dist/HOVER_RADIUS);
        tx += dx * f * ATTRACT;
        ty += dy * f * ATTRACT;
      }
    }
    n.tx = tx; n.ty = ty;
    if (!n.inited){ n.x = tx; n.y = ty; n.inited = true; }
    n.x += (n.tx - n.x) * DAMPING;
    n.y += (n.ty - n.y) * DAMPING;
  }

  for (let i=0;i<=rows;i++){
    for (let j=0;j<cols;j++){
      const a = nodes[nidx(i,j)], b = nodes[nidx(i,j+1)];
      drawMember(a, b, 0.55, now, useMx, useMy, inkRgb);
    }
  }
  for (let i=0;i<rows;i++){
    for (let j=0;j<=cols;j++){
      const a = nodes[nidx(i,j)], b = nodes[nidx(i+1,j)];
      drawMember(a, b, 0.55, now, useMx, useMy, inkRgb);
    }
  }
  for (let i=0;i<rows;i++){
    for (let j=0;j<cols;j++){
      if (((i+j) % 2) !== 0) continue;
      const a = nodes[nidx(i,j)], b = nodes[nidx(i+1,j+1)];
      drawMember(a, b, 0.18, now, useMx, useMy, inkRgb);
    }
  }

  for (const n of nodes){
    let hover = 0;
    if (useMx > -1000){
      const dx = useMx - n.x, dy = useMy - n.y;
      const d = Math.sqrt(dx*dx+dy*dy);
      if (d < HOVER_RADIUS) hover = 1 - d/HOVER_RADIUS;
    }
    const imp = impulseAt(n.x, n.y, now);

    if (imp.intensity > 0.04){
      const alpha = (0.45 + imp.intensity*0.45);
      const tRatio = imp.inverted ? (1 - imp.tRatio) : imp.tRatio;
      mctx.fillStyle = femColor(tRatio, alpha);
      mctx.beginPath(); mctx.arc(n.x, n.y, 0.9 + imp.intensity*2 + hover*0.6, 0, Math.PI*2); mctx.fill();
    } else if (hover > 0.05){
      mctx.fillStyle = `rgba(${inkRgb[0]},${inkRgb[1]},${inkRgb[2]},${(0.32 + hover*0.4).toFixed(3)})`;
      mctx.beginPath(); mctx.arc(n.x, n.y, 0.8 + hover*1.4, 0, Math.PI*2); mctx.fill();
    } else {
      mctx.fillStyle = ink2;
      mctx.beginPath(); mctx.arc(n.x, n.y, 0.7, 0, Math.PI*2); mctx.fill();
    }
  }
}

function impulseAt(x, y, now){
  let bestIntensity = 0;
  let bestTRatio = 1;
  let bestInverted = false;
  for (const imp of impulses){
    const age = (now - imp.t0) / IMPULSE_LIFE;
    if (age >= 1) continue;
    const radius = IMPULSE_RADIUS_MAX * (0.55 + 0.45 * Math.min(1, age*2.2));
    const dx = x - imp.x, dy = y - imp.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d > radius) continue;
    const tRatio = d / radius;
    let env;
    if (age < 0.12) env = age / 0.12;
    else env = Math.pow(1 - (age - 0.12)/0.88, 1.6);
    const spatial = 1 - tRatio;
    const intensity = env * spatial;
    if (intensity > bestIntensity){
      bestIntensity = intensity;
      bestTRatio = tRatio;
      bestInverted = !!imp.inverted;
    }
  }
  return { intensity: bestIntensity, tRatio: bestTRatio, inverted: bestInverted };
}

function drawMember(a, b, alphaScale, now, useMx, useMy, inkRgb){
  const ax = a.x, ay = a.y, bx2 = b.x, by2 = b.y;
  const yFade = Math.max(0, Math.min(1, 1 - Math.min(ay, by2)/(MH*1.1)));
  if (yFade < 0.03) return;

  const midx = (ax+bx2)/2, midy = (ay+by2)/2;
  let hover = 0;
  if (useMx > -1000){
    const dx = useMx - midx, dy = useMy - midy;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < HOVER_RADIUS) hover = 1 - d/HOVER_RADIUS;
  }

  const imp = impulseAt(midx, midy, now);

  if (imp.intensity > 0.04){
    const alpha = (0.30 + imp.intensity*0.55) * alphaScale * yFade;
    const lw = 0.5 + imp.intensity * 1.5 + hover*0.5;
    const tRatio = imp.inverted ? (1 - imp.tRatio) : imp.tRatio;
    mctx.strokeStyle = femColor(tRatio, alpha);
    mctx.lineWidth = lw;
    mctx.beginPath(); mctx.moveTo(ax, ay); mctx.lineTo(bx2, by2); mctx.stroke();
    return;
  }

  const baseAlpha = 0.16 + hover*0.18;
  const baseLw = 0.65 + hover*0.7;
  mctx.strokeStyle = `rgba(${inkRgb[0]},${inkRgb[1]},${inkRgb[2]},${(baseAlpha*yFade*alphaScale).toFixed(3)})`;
  mctx.lineWidth = baseLw;
  mctx.beginPath(); mctx.moveTo(ax, ay); mctx.lineTo(bx2, by2); mctx.stroke();
}

function hexToRgb(h){
  h = (h||'').replace('#','').trim();
  if (h.length===3) h = h.split('').map(c=>c+c).join('');
  if (h.length<6) return [0,0,0];
  const n = parseInt(h, 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
requestAnimationFrame(meshFrame);

/* ===========================================================
   PEN TRAIL
   =========================================================== */
const penCanvas = document.getElementById('pen-trail');
const pctx = penCanvas.getContext('2d');
let PW=0, PH=0;
function resizePen(){
  PW = window.innerWidth; PH = window.innerHeight;
  penCanvas.width = PW*DPR; penCanvas.height = PH*DPR;
  penCanvas.style.width = PW+'px'; penCanvas.style.height = PH+'px';
  pctx.setTransform(DPR,0,0,DPR,0,0);
}
resizePen();
const trail = [];
const cursorMode = () => document.documentElement.dataset.cursor;
function penFrame(){
  if (cursorMode() === 'pen') trail.push({x: cx, y: cy, t: performance.now()});
  const now = performance.now();
  pctx.clearRect(0, 0, PW, PH);
  while (trail.length && now - trail[0].t > 500) trail.shift();
  if (cursorMode() === 'pen' && trail.length > 1){
    pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2F5D3A';
    for (let i = 1; i < trail.length; i++){
      const a = trail[i-1], b = trail[i];
      const age = (now - b.t)/500;
      const alpha = Math.max(0, 1 - age);
      pctx.strokeStyle = accent;
      pctx.globalAlpha = alpha*0.8;
      pctx.lineWidth = 2*(1-age);
      pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke();
    }
    pctx.globalAlpha = 1;
  } else { trail.length = 0; }
  requestAnimationFrame(penFrame);
}
requestAnimationFrame(penFrame);
