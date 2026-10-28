/** Small 2D-canvas helpers used to paint procedural textures. */
export type Ctx = CanvasRenderingContext2D;

export function mkCanvas(w = 512, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** read = the pixels will be read back (relief and normal maps); otherwise the canvas stays GPU-accelerated */
export function ctx2d(c: HTMLCanvasElement, read = true): Ctx {
  return c.getContext('2d', { willReadFrequently: read }) as Ctx;
}

/** Deterministic xorshift RNG so textures look the same on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Draw something 9 times offset by the tile size so it wraps seamlessly. */
export function wrapDraw(ctx: Ctx, W: number, H: number, fn: () => void) {
  for (const dx of [-W, 0, W])
    for (const dy of [-H, 0, H]) {
      ctx.save();
      ctx.translate(dx, dy);
      fn();
      ctx.restore();
    }
}

export function grout(ctx: Ctx, W: number, H: number, cols: number, rows: number, color: string, lw: number) {
  ctx.fillStyle = color;
  for (let i = 0; i <= cols; i++) ctx.fillRect((i * W) / cols - lw / 2, 0, lw, H);
  for (let j = 0; j <= rows; j++) ctx.fillRect(0, (j * H) / rows - lw / 2, W, lw);
}

export function offsetGrout(ctx: Ctx, W: number, H: number, cols: number, rows: number, color: string, lw: number) {
  ctx.fillStyle = color;
  const rh = H / rows;
  const bw = W / cols;
  for (let j = 0; j <= rows; j++) ctx.fillRect(0, j * rh - lw / 2, W, lw);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i <= cols + 1; i++) ctx.fillRect(i * bw + (j % 2 ? bw / 2 : 0) - lw / 2, j * rh, lw, rh);
}

export function speckle(ctx: Ctx, W: number, H: number, n: number, seed: number, cols: string[]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[Math.floor(r() * cols.length)];
    ctx.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5);
  }
}

export function grain(ctx: Ctx, y0: number, h: number, W: number, r: () => number, count: number, rgb: string) {
  for (let k = 0; k < count; k++) {
    const y = y0 + r() * h;
    const amp = 1 + r() * 3;
    const per = 1 + Math.floor(r() * 3);
    ctx.strokeStyle = `rgba(${rgb},${0.07 + r() * 0.12})`;
    ctx.lineWidth = 0.8 + r() * 1.4;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 16) {
      const yy = y + Math.sin((x / W) * Math.PI * 2 * per) * amp;
      if (x) ctx.lineTo(x, yy);
      else ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
}

/** Relief painters: white = raised surface, black = grout / seams. */
export const relief = {
  grid: (c: number, r: number, lw: number) => (ctx: Ctx, W: number, H: number) => {
    ctx.filter = 'blur(1.2px)';
    grout(ctx, W, H, c, r, '#000', lw);
    ctx.filter = 'none';
  },
  offset: (c: number, r: number, lw: number) => (ctx: Ctx, W: number, H: number) => {
    ctx.filter = 'blur(1.2px)';
    offsetGrout(ctx, W, H, c, r, '#000', lw);
    ctx.filter = 'none';
  },
};

/** Greyscale relief from the luminance of a painted canvas. */
export function lumaRelief(src: HTMLCanvasElement, invert = false, size = 512): HTMLCanvasElement {
  const rc = mkCanvas(size);
  const x = ctx2d(rc);
  x.drawImage(src, 0, 0, size, size);
  const d = x.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) {
    let l = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
    if (invert) l = 255 - l;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
  }
  x.putImageData(d, 0, 0);
  return rc;
}

/** Normal map (Sobel) + roughness map from a relief canvas. rough = [surface, grout]. */
export function makeMaps(rc: HTMLCanvasElement, strength: number, rough: [number, number]) {
  const W = rc.width;
  const H = rc.height;
  const src = ctx2d(rc).getImageData(0, 0, W, H).data;
  const hg = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hg[i] = src[i * 4] / 255;
  const nc = mkCanvas(W, H);
  const nx = ctx2d(nc);
  const nd = nx.createImageData(W, H);
  const qc = mkCanvas(W, H);
  const qx = ctx2d(qc);
  const qd = qx.createImageData(W, H);
  const at = (x: number, y: number) => hg[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const a = -dx * strength;
      const b = dy * strength;
      const l = Math.sqrt(a * a + b * b + 1);
      const i = (y * W + x) * 4;
      nd.data[i] = (a / l * 0.5 + 0.5) * 255;
      nd.data[i + 1] = (b / l * 0.5 + 0.5) * 255;
      nd.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nd.data[i + 3] = 255;
      const q = (rough[0] + (1 - at(x, y)) * (rough[1] - rough[0])) * 255;
      qd.data[i] = qd.data[i + 1] = qd.data[i + 2] = q;
      qd.data[i + 3] = 255;
    }
  nx.putImageData(nd, 0, 0);
  qx.putImageData(qd, 0, 0);
  return { normal: nc, rough: qc };
}
