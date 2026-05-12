import { animate } from 'motion';

export interface CursorRenderContext {
  size: number;
  color: string;
  label: string;
}

export interface CursorRenderResult {
  element: SVGSVGElement;
  hotspot: { x: number; y: number };
}

export interface CursorOptions {
  /** Where the cursor lives in the DOM. Default: document.body. */
  container?: HTMLElement;
  /** Base pixel size of the cursor (arrow icon). Default: 28. */
  size?: number;
  /** Primary color (arrow fill + pill background + click ripple). Default: indigo. */
  color?: string;
  /** Pill label text. Pass empty string to hide the pill. Default: "Companion". */
  label?: string;
  /** Custom shape renderer. Replaces the default arrow+pill entirely. */
  render?: (ctx: CursorRenderContext) => CursorRenderResult;
  /** z-index of the cursor layer. Default: one below max. */
  zIndex?: number;
}

const NS = 'http://www.w3.org/2000/svg';
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;

export class VisibleCursor {
  private root: HTMLDivElement | null = null;
  private cursorSvg: SVGSVGElement | null = null;
  private currentX = 0;
  private currentY = 0;
  private hotspot: { x: number; y: number } = { x: 0, y: 0 };
  private readonly size: number;
  private readonly color: string;
  private readonly label: string;
  private readonly render?: CursorOptions['render'];
  private readonly zIndex: number;
  private readonly container: HTMLElement;

  constructor(options: CursorOptions = {}) {
    this.size = options.size ?? 28;
    this.color = options.color ?? 'rgb(99 102 241)';
    this.label = options.label ?? 'Companion';
    this.render = options.render;
    this.zIndex = options.zIndex ?? 2147483646;
    this.container = options.container ?? document.body;
  }

  mount(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.setAttribute('data-web-companion-cursor', '');
    Object.assign(root.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: String(this.zIndex),
    });

    const built = this.render
      ? this.render({ size: this.size, color: this.color, label: this.label })
      : this.makeDefaultCursor();
    this.hotspot = built.hotspot;
    const svg = built.element;
    Object.assign(svg.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      willChange: 'transform',
      filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))',
    });
    root.appendChild(svg);
    this.container.appendChild(root);
    this.root = root;
    this.cursorSvg = svg;

    this.currentX = window.innerWidth - 140;
    this.currentY = 80;
    svg.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
    this.cursorSvg = null;
  }

  /** Where the cursor's acting hotspot (arrow tip) is on the page. */
  get position(): { x: number; y: number } {
    return { x: this.currentX + this.hotspot.x, y: this.currentY + this.hotspot.y };
  }

  async flyTo(x: number, y: number, opts: { duration?: number } = {}): Promise<void> {
    if (!this.cursorSvg) throw new Error('Cursor not mounted — call mount() first');
    const duration = opts.duration ?? 0.6;
    await animate(
      this.cursorSvg,
      { x, y },
      { duration, ease: [0.22, 1, 0.36, 1] },
    );
    this.currentX = x;
    this.currentY = y;
  }

  async flyToElement(
    element: Element,
    opts: { duration?: number; offset?: { x: number; y: number } } = {},
  ): Promise<void> {
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 + (opts.offset?.x ?? 0);
    const cy = rect.top + rect.height / 2 + (opts.offset?.y ?? 0);
    const flyOpts: { duration?: number } = {};
    if (opts.duration !== undefined) flyOpts.duration = opts.duration;
    await this.flyTo(cx - this.hotspot.x, cy - this.hotspot.y, flyOpts);
  }

  async click(): Promise<void> {
    if (!this.cursorSvg || !this.root) return;
    const r = this.size / 2;
    const cx = this.currentX + this.hotspot.x;
    const cy = this.currentY + this.hotspot.y;

    // Position with left/top so motion.animate can own transform (scale) without
    // clobbering the placement. Wrapping in a fixed-position div also detaches the
    // ripple from the cursor root's transform context.
    const ripple = document.createElementNS(NS, 'svg');
    Object.assign(ripple.style, {
      position: 'fixed',
      left: `${cx - r}px`,
      top: `${cy - r}px`,
      width: `${this.size}px`,
      height: `${this.size}px`,
      pointerEvents: 'none',
    });
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', String(r));
    ring.setAttribute('cy', String(r));
    ring.setAttribute('r', String(r - 2));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', this.color);
    ring.setAttribute('stroke-width', '2');
    ripple.appendChild(ring);
    this.root.appendChild(ripple);

    await Promise.all([
      animate(this.cursorSvg, { scale: [1, 0.92, 1] }, { duration: 0.25 }),
      animate(
        ripple,
        { scale: [1, 2.4], opacity: [0.85, 0] },
        { duration: 0.5, ease: 'easeOut' },
      ),
    ]);
    ripple.remove();
  }

  private makeDefaultCursor(): CursorRenderResult {
    const size = this.size;
    // Arrow path is authored in a 24x24 viewBox with the tip at (3, 3).
    const arrowScale = size / 24;
    const hotspotX = 3 * arrowScale;
    const hotspotY = 3 * arrowScale;
    const arrowPath = 'M 3 3 L 3 19.4 L 7.8 15.3 L 10.7 21.5 L 13.6 20.2 L 10.7 14 L 17 14 Z';

    const showPill = this.label.length > 0;
    const fontSize = Math.max(10, Math.round(size * 0.42));
    const padX = Math.round(fontSize * 0.6);
    const padY = Math.round(fontSize * 0.28);
    const pillH = fontSize + padY * 2;
    const labelW = this.estimateTextWidth(this.label, fontSize);
    const pillW = labelW + padX * 2;
    const pillX = size * 0.62;
    const pillY = size * 0.72;
    const pillRadius = pillH / 2;

    const totalW = showPill ? Math.max(size, pillX + pillW + 2) : size;
    const totalH = showPill ? Math.max(size, pillY + pillH + 2) : size;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.setAttribute('width', String(totalW));
    svg.setAttribute('height', String(totalH));

    const arrowG = document.createElementNS(NS, 'g');
    arrowG.setAttribute('transform', `scale(${arrowScale})`);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', arrowPath);
    path.setAttribute('fill', this.color);
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', String(1.4 / arrowScale));
    path.setAttribute('stroke-linejoin', 'round');
    arrowG.appendChild(path);
    svg.appendChild(arrowG);

    if (showPill) {
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(pillX));
      rect.setAttribute('y', String(pillY));
      rect.setAttribute('rx', String(pillRadius));
      rect.setAttribute('ry', String(pillRadius));
      rect.setAttribute('width', String(pillW));
      rect.setAttribute('height', String(pillH));
      rect.setAttribute('fill', this.color);
      svg.appendChild(rect);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', String(pillX + pillW / 2));
      text.setAttribute('y', String(pillY + pillH / 2));
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('font-size', String(fontSize));
      text.setAttribute(
        'font-family',
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", sans-serif',
      );
      text.setAttribute('font-weight', '600');
      text.textContent = this.label;
      svg.appendChild(text);
    }

    return {
      element: svg,
      hotspot: { x: hotspotX, y: hotspotY },
    };
  }

  private estimateTextWidth(text: string, fontSize: number): number {
    let w = 0;
    for (const ch of text) {
      w += CJK_RE.test(ch) ? fontSize : fontSize * 0.58;
    }
    return Math.ceil(w);
  }
}
