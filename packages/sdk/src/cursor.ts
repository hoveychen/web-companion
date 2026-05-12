import { animate } from 'motion';

export interface CursorOptions {
  /** Where the cursor lives in the DOM. Default: document.body. */
  container?: HTMLElement;
  /** Pixel size of the cursor circle. Default: 28. */
  size?: number;
  /** CSS color for the cursor. Default: indigo. */
  color?: string;
  /** z-index of the cursor layer. Default: one below max. */
  zIndex?: number;
}

const NS = 'http://www.w3.org/2000/svg';

export class VisibleCursor {
  private root: HTMLDivElement | null = null;
  private cursor: SVGSVGElement | null = null;
  private currentX = 0;
  private currentY = 0;
  private readonly size: number;
  private readonly color: string;
  private readonly zIndex: number;
  private readonly container: HTMLElement;

  constructor(options: CursorOptions = {}) {
    this.size = options.size ?? 28;
    this.color = options.color ?? 'rgb(99 102 241)';
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

    const svg = this.makeCursorSvg();
    root.appendChild(svg);
    this.container.appendChild(root);
    this.root = root;
    this.cursor = svg;

    this.currentX = window.innerWidth - 80;
    this.currentY = 80;
    svg.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
  }

  unmount(): void {
    this.root?.remove();
    this.root = null;
    this.cursor = null;
  }

  get position(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  async flyTo(x: number, y: number, opts: { duration?: number } = {}): Promise<void> {
    if (!this.cursor) throw new Error('Cursor not mounted — call mount() first');
    const duration = opts.duration ?? 0.6;
    await animate(
      this.cursor,
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
    const half = this.size / 2;
    const flyOpts: { duration?: number } = {};
    if (opts.duration !== undefined) flyOpts.duration = opts.duration;
    await this.flyTo(cx - half, cy - half, flyOpts);
  }

  async click(): Promise<void> {
    if (!this.cursor || !this.root) return;

    const ripple = document.createElementNS(NS, 'svg');
    Object.assign(ripple.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${this.size}px`,
      height: `${this.size}px`,
      pointerEvents: 'none',
      transform: `translate(${this.currentX}px, ${this.currentY}px)`,
    });
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', String(this.size / 2));
    ring.setAttribute('cy', String(this.size / 2));
    ring.setAttribute('r', String(this.size / 2 - 2));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', this.color);
    ring.setAttribute('stroke-width', '2');
    ripple.appendChild(ring);
    this.root.appendChild(ripple);

    await Promise.all([
      animate(this.cursor, { scale: [1, 0.82, 1] }, { duration: 0.25 }),
      animate(
        ripple,
        { scale: [1, 2.4], opacity: [0.85, 0] },
        { duration: 0.5, ease: 'easeOut' },
      ),
    ]);
    ripple.remove();
  }

  private makeCursorSvg(): SVGSVGElement {
    const svg = document.createElementNS(NS, 'svg');
    Object.assign(svg.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${this.size}px`,
      height: `${this.size}px`,
      pointerEvents: 'none',
      willChange: 'transform',
      filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))',
    });
    svg.setAttribute('viewBox', `0 0 ${this.size} ${this.size}`);

    const outer = document.createElementNS(NS, 'circle');
    outer.setAttribute('cx', String(this.size / 2));
    outer.setAttribute('cy', String(this.size / 2));
    outer.setAttribute('r', String(this.size / 2 - 2));
    outer.setAttribute('fill', this.color);
    outer.setAttribute('fill-opacity', '0.2');
    outer.setAttribute('stroke', this.color);
    outer.setAttribute('stroke-width', '2');

    const inner = document.createElementNS(NS, 'circle');
    inner.setAttribute('cx', String(this.size / 2));
    inner.setAttribute('cy', String(this.size / 2));
    inner.setAttribute('r', '3');
    inner.setAttribute('fill', this.color);

    svg.appendChild(outer);
    svg.appendChild(inner);
    return svg;
  }
}
