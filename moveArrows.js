const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";
let overlaySequence = 0;

export const MOVE_ARROW_STYLES = Object.freeze([
  { color: "#5aa2ff", opacity: 0.94, width: 2.15 },
  { color: "#5aa2ff", opacity: 0.82, width: 1.85 },
  { color: "#5aa2ff", opacity: 0.74, width: 1.65 },
  { color: "#5aa2ff", opacity: 0.68, width: 1.5 },
  { color: "#5aa2ff", opacity: 0.64, width: 1.4 },
]);

export function parseUciMove(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);
  if (!match || match[1].toLowerCase() === match[2].toLowerCase()) return null;
  return {
    from: match[1].toLowerCase(),
    to: match[2].toLowerCase(),
    promotion: match[3]?.toLowerCase() || null,
    uci: match[0].toLowerCase(),
  };
}

export function squareCenter(square, orientation = "white") {
  if (typeof square !== "string" || !/^[a-h][1-8]$/i.test(square)) return null;
  if (orientation !== "white" && orientation !== "black") return null;
  const file = FILES.indexOf(square[0].toLowerCase());
  const rank = Number.parseInt(square[1], 10);
  const isBlack = orientation === "black";
  const column = isBlack ? 7 - file : file;
  const row = isBlack ? rank - 1 : 8 - rank;

  return {
    x: (column + 0.5) * 12.5,
    y: (row + 0.5) * 12.5,
  };
}

export function arrowGeometry(value, orientation = "white", endInset = 3.4) {
  const move = typeof value === "string" ? parseUciMove(value) : value;
  if (!move?.from || !move?.to) return null;
  const from = squareCenter(move.from, orientation);
  const target = squareCenter(move.to, orientation);
  if (!from || !target) return null;

  const deltaX = target.x - from.x;
  const deltaY = target.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) return null;

  return {
    x1: from.x,
    y1: from.y,
    x2: target.x - (deltaX / distance) * endInset,
    y2: target.y - (deltaY / distance) * endInset,
  };
}

export function normalizeArrowMoves(entries, limit = 5) {
  if (!Array.isArray(entries) || limit <= 0) return [];
  const normalized = new Map();

  entries.forEach((entry, index) => {
    const move = parseUciMove(typeof entry === "string" ? entry : entry?.move);
    if (!move) return;
    const key = `${move.from}${move.to}`;
    const requestedRank = Number.parseInt(entry?.rank, 10);
    const candidate = {
      ...move,
      rank: Number.isInteger(requestedRank) && requestedRank > 0
        ? Math.min(requestedRank, MOVE_ARROW_STYLES.length)
        : Math.min(index + 1, MOVE_ARROW_STYLES.length),
    };
    const existing = normalized.get(key);
    if (!existing || candidate.rank < existing.rank) {
      normalized.set(key, candidate);
    }
  });

  return Array.from(normalized.values())
    .sort((left, right) => left.rank - right.rank)
    .slice(0, Math.min(limit, MOVE_ARROW_STYLES.length));
}

export class MoveArrowOverlay {
  constructor({ hostEl, boardEl, orientation = "white" } = {}) {
    if (!hostEl || !boardEl) {
      throw new Error("Für Zugpfeile fehlen Board-Host oder Brett.");
    }

    this.hostEl = hostEl;
    this.boardEl = boardEl;
    this.orientation = orientation === "black" ? "black" : "white";
    this.moves = [];
    this.visible = true;
    this.destroyed = false;
    this.resizeFrame = null;
    this.markerPrefix = `move-arrow-${++overlaySequence}`;

    const documentRef = hostEl.ownerDocument || document;
    this.svg = documentRef.createElementNS(SVG_NAMESPACE, "svg");
    this.svg.classList.add("move-arrows");
    this.svg.setAttribute("viewBox", "0 0 100 100");
    this.svg.setAttribute("preserveAspectRatio", "none");
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.setAttribute("focusable", "false");
    hostEl.appendChild(this.svg);

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(hostEl);
    }

    this.resize();
    this.render();
  }

  setMoves(entries) {
    if (this.destroyed) return;
    this.moves = normalizeArrowMoves(entries);
    this.visible = true;
    this.resize();
    this.render();
  }

  setOrientation(orientation) {
    if (this.destroyed) return;
    const next = orientation === "black" ? "black" : "white";
    if (next === this.orientation) return;
    this.orientation = next;
    this.render();
  }

  setVisible(visible) {
    if (this.destroyed) return;
    this.visible = Boolean(visible);
    this.svg.hidden = !this.visible || this.moves.length === 0;
  }

  clear() {
    if (this.destroyed) return;
    this.moves = [];
    this.render();
  }

  scheduleResize() {
    if (this.destroyed) return;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.resize();
    });
  }

  resize() {
    if (this.destroyed) return;
    const boardSurface = this.boardEl.querySelector(".board-b72b1");
    if (!boardSurface) return;
    const hostRect = this.hostEl.getBoundingClientRect();
    const boardRect = boardSurface.getBoundingClientRect();
    const width = boardSurface.clientWidth;
    const height = boardSurface.clientHeight;
    if (!width || !height) return;

    this.svg.style.left = `${boardRect.left - hostRect.left + boardSurface.clientLeft}px`;
    this.svg.style.top = `${boardRect.top - hostRect.top + boardSurface.clientTop}px`;
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
  }

  render() {
    if (this.destroyed) return;
    this.svg.replaceChildren();
    this.svg.hidden = !this.visible || this.moves.length === 0;
    if (this.svg.hidden) return;

    const documentRef = this.hostEl.ownerDocument || document;
    const definitions = documentRef.createElementNS(SVG_NAMESPACE, "defs");
    MOVE_ARROW_STYLES.forEach((style, index) => {
      const marker = documentRef.createElementNS(SVG_NAMESPACE, "marker");
      marker.id = `${this.markerPrefix}-${index}`;
      marker.setAttribute("viewBox", "0 0 5 5");
      marker.setAttribute("refX", "4.15");
      marker.setAttribute("refY", "2.5");
      marker.setAttribute("markerWidth", "4.4");
      marker.setAttribute("markerHeight", "4.4");
      marker.setAttribute("orient", "auto-start-reverse");
      const tip = documentRef.createElementNS(SVG_NAMESPACE, "path");
      tip.setAttribute("d", "M 0 0 L 5 2.5 L 0 5 z");
      tip.setAttribute("fill", style.color);
      marker.appendChild(tip);
      definitions.appendChild(marker);
    });
    this.svg.appendChild(definitions);

    [...this.moves].reverse().forEach((move) => {
      const geometry = arrowGeometry(move, this.orientation);
      if (!geometry) return;
      const styleIndex = Math.max(0, Math.min(move.rank - 1, MOVE_ARROW_STYLES.length - 1));
      const style = MOVE_ARROW_STYLES[styleIndex];

      const outline = documentRef.createElementNS(SVG_NAMESPACE, "line");
      this.applyLineGeometry(outline, geometry);
      outline.classList.add("move-arrow-outline");
      outline.setAttribute("stroke-width", String(style.width + 1.05));
      outline.setAttribute("opacity", String(Math.min(0.66, style.opacity)));
      this.svg.appendChild(outline);

      const arrow = documentRef.createElementNS(SVG_NAMESPACE, "line");
      this.applyLineGeometry(arrow, geometry);
      arrow.classList.add("move-arrow-line");
      arrow.dataset.rank = String(move.rank);
      arrow.dataset.move = move.uci;
      arrow.setAttribute("stroke", style.color);
      arrow.setAttribute("stroke-width", String(style.width));
      arrow.setAttribute("opacity", String(style.opacity));
      arrow.setAttribute("marker-end", `url(#${this.markerPrefix}-${styleIndex})`);
      this.svg.appendChild(arrow);
    });
  }

  applyLineGeometry(line, geometry) {
    line.setAttribute("x1", String(geometry.x1));
    line.setAttribute("y1", String(geometry.y1));
    line.setAttribute("x2", String(geometry.x2));
    line.setAttribute("y2", String(geometry.y2));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeObserver?.disconnect();
    this.svg?.remove();
    this.moves = [];
  }
}
