const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";

export const MOVE_ARROW_STYLES = Object.freeze([
  { color: "#6aa9ef", opacity: 0.92, width: 1.72 },
  { color: "#6aa9ef", opacity: 0.78, width: 1.42 },
  { color: "#6aa9ef", opacity: 0.68, width: 1.2 },
  { color: "#6aa9ef", opacity: 0.6, width: 1.04 },
  { color: "#6aa9ef", opacity: 0.54, width: 0.94 },
]);

export const MOVE_ARROW_ROLE_STYLES = Object.freeze({
  primary: Object.freeze({ color: "#6aa9ef" }),
  threat: Object.freeze({ color: "#f0b86a" }),
  danger: Object.freeze({ color: "#ff7474" }),
  defense: Object.freeze({ color: "#53e0a1" }),
  concept: Object.freeze({ color: "#9a8cff" }),
});

export const SQUARE_HIGHLIGHT_STYLES = Object.freeze({
  origin: Object.freeze({ fill: "#6aa9ef", opacity: 0.72, stroke: "#6aa9ef" }),
  destination: Object.freeze({ fill: "#53e0a1", opacity: 0.82, stroke: "#53e0a1" }),
  target: Object.freeze({ fill: "#f0b86a", opacity: 0.84, stroke: "#f0b86a" }),
  danger: Object.freeze({ fill: "#ff7474", opacity: 0.86, stroke: "#ff7474" }),
  concept: Object.freeze({ fill: "#9a8cff", opacity: 0.76, stroke: "#9a8cff" }),
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function scoreToCentipawns(score) {
  if (!score || typeof score !== "object") return null;
  if (score.unit === "mate" && Number.isFinite(score.value)) {
    return score.value === 0 ? 0 : score.value > 0 ? 10_000 : -10_000;
  }
  if (Number.isFinite(score.pawns)) return Math.round(score.pawns * 100);
  if (score.unit === "cp" && Number.isFinite(score.value)) return Math.round(score.value);
  return null;
}

export function selectImpactArrowMoves(entries, limit = 5) {
  if (!Array.isArray(entries) || limit <= 0) return [];
  const candidates = entries
    .map((entry, index) => {
      const data = Array.isArray(entry) ? entry[1] : entry?.data || entry;
      const rankValue = Array.isArray(entry) ? entry[0] : entry?.rank;
      const rank = Math.max(1, Number.parseInt(rankValue, 10) || index + 1);
      const move = data?.pv?.[0] || entry?.move;
      const parsed = parseUciMove(move);
      if (!parsed) return null;
      const sideToMove = String(data?.fen || "").split(" ")[1] === "b" ? "b" : "w";
      const whiteCp = scoreToCentipawns(data?.whiteScore || data?.score);
      const moverCp = Number.isFinite(whiteCp)
        ? whiteCp * (sideToMove === "b" ? -1 : 1)
        : null;
      return { rank, move: parsed.uci, moverCp };
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, Math.min(limit, MOVE_ARROW_STYLES.length));

  if (candidates.length < 2 || !candidates.every((entry) => Number.isFinite(entry.moverCp))) {
    return candidates.map(({ rank, move }, index) => ({
      rank,
      move,
      impact: clamp(1 - index * 0.17, 0.32, 1),
    }));
  }

  const bestScore = Math.max(...candidates.map((entry) => entry.moverCp));
  const withGap = candidates.map((entry) => ({
    ...entry,
    gap: Math.max(0, bestScore - entry.moverCp),
  }));
  const topTier = withGap.filter((entry) => entry.gap <= 35);
  const visible = topTier.length === 1
    ? [topTier[0]]
    : withGap.filter((entry) => entry.gap <= 110);

  return visible.map(({ rank, move, gap }) => ({
    rank,
    move,
    impact: clamp(1 - gap / 125, 0.28, 1),
  }));
}

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

export function arrowGeometry(value, orientation = "white", endInset = 1.65, startInset = 1.15) {
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
    x1: from.x + (deltaX / distance) * startInset,
    y1: from.y + (deltaY / distance) * startInset,
    x2: target.x - (deltaX / distance) * endInset,
    y2: target.y - (deltaY / distance) * endInset,
  };
}

export function arrowHeadGeometry(geometry, shaftWidth = 1.5) {
  if (!geometry) return null;
  const deltaX = geometry.x2 - geometry.x1;
  const deltaY = geometry.y2 - geometry.y1;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) return null;

  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const headLength = clamp(3.35 + shaftWidth * 0.72, 4.05, 4.85);
  const halfWidth = clamp(1.55 + shaftWidth * 0.55, 2.05, 2.75);
  const baseX = geometry.x2 - unitX * headLength;
  const baseY = geometry.y2 - unitY * headLength;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;

  return {
    tip: { x: geometry.x2, y: geometry.y2 },
    left: {
      x: baseX + perpendicularX * halfWidth,
      y: baseY + perpendicularY * halfWidth,
    },
    right: {
      x: baseX - perpendicularX * halfWidth,
      y: baseY - perpendicularY * halfWidth,
    },
    shaftEnd: {
      x: geometry.x2 - unitX * headLength * 0.68,
      y: geometry.y2 - unitY * headLength * 0.68,
    },
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
      ...(MOVE_ARROW_ROLE_STYLES[entry?.role]
        ? { role: entry.role }
        : {}),
      ...(Number.isFinite(entry?.impact)
        ? { impact: clamp(entry.impact, 0.2, 1) }
        : {}),
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

export function normalizeSquareHighlights(entries, limit = 12) {
  if (!Array.isArray(entries) || limit <= 0) return [];
  const normalized = new Map();
  entries.forEach((entry) => {
    const square = String(entry?.square || "").toLowerCase();
    if (!/^[a-h][1-8]$/.test(square)) return;
    const role = SQUARE_HIGHLIGHT_STYLES[entry?.role]
      ? entry.role
      : "target";
    normalized.set(square, { square, role });
  });
  return [...normalized.values()].slice(0, Math.min(12, limit));
}

export function squareBounds(square, orientation = "white") {
  const center = squareCenter(square, orientation);
  if (!center) return null;
  return {
    x: center.x - 6.25,
    y: center.y - 6.25,
    width: 12.5,
    height: 12.5,
  };
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
    this.highlights = [];
    this.visible = true;
    this.destroyed = false;
    this.resizeFrame = null;
    const documentRef = hostEl.ownerDocument || document;
    this.svg = documentRef.createElementNS(SVG_NAMESPACE, "svg");
    this.svg.classList.add("move-arrows");
    this.svg.setAttribute("viewBox", "0 0 100 100");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
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
    this.highlights = [];
    this.visible = true;
    this.resize();
    this.render();
  }

  setAnnotations({ arrows = [], highlights = [] } = {}) {
    if (this.destroyed) return;
    this.moves = normalizeArrowMoves(arrows);
    this.highlights = normalizeSquareHighlights(highlights);
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
    this.svg.hidden = (
      !this.visible
      || (this.moves.length === 0 && this.highlights.length === 0)
    );
  }

  clear() {
    if (this.destroyed) return;
    this.moves = [];
    this.highlights = [];
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
    this.svg.hidden = (
      !this.visible
      || (this.moves.length === 0 && this.highlights.length === 0)
    );
    if (this.svg.hidden) return;

    const documentRef = this.hostEl.ownerDocument || document;
    this.highlights.forEach((highlight) => {
      const bounds = squareBounds(highlight.square, this.orientation);
      const style = SQUARE_HIGHLIGHT_STYLES[highlight.role];
      if (!bounds || !style) return;
      const square = documentRef.createElementNS(SVG_NAMESPACE, "path");
      square.classList.add("coach-square-highlight");
      square.dataset.square = highlight.square;
      square.dataset.role = highlight.role;
      const outerInset = 0.62;
      const innerInset = 1.72;
      const outerLeft = bounds.x + outerInset;
      const outerTop = bounds.y + outerInset;
      const outerRight = bounds.x + bounds.width - outerInset;
      const outerBottom = bounds.y + bounds.height - outerInset;
      const innerLeft = bounds.x + innerInset;
      const innerTop = bounds.y + innerInset;
      const innerRight = bounds.x + bounds.width - innerInset;
      const innerBottom = bounds.y + bounds.height - innerInset;
      square.setAttribute(
        "d",
        [
          `M ${outerLeft} ${outerTop}`,
          `H ${outerRight} V ${outerBottom} H ${outerLeft} Z`,
          `M ${innerLeft} ${innerTop}`,
          `H ${innerRight} V ${innerBottom} H ${innerLeft} Z`,
        ].join(" "),
      );
      square.setAttribute("fill-rule", "evenodd");
      square.setAttribute("fill", style.fill);
      square.setAttribute("fill-opacity", String(style.opacity));
      square.setAttribute("stroke", style.stroke);
      square.setAttribute("stroke-opacity", "0.9");
      square.setAttribute("stroke-width", "0.34");
      this.svg.appendChild(square);
    });
    [...this.moves].reverse().forEach((move) => {
      const styleIndex = Math.max(0, Math.min(move.rank - 1, MOVE_ARROW_STYLES.length - 1));
      const baseStyle = MOVE_ARROW_STYLES[styleIndex];
      const roleStyle = MOVE_ARROW_ROLE_STYLES[move.role];
      const style = roleStyle
        ? { ...baseStyle, color: roleStyle.color }
        : baseStyle;
      const impact = Number.isFinite(move.impact) ? move.impact : 1;
      const width = Math.max(0.86, style.width * (0.76 + impact * 0.24));
      const opacity = Math.max(0.48, style.opacity * (0.8 + impact * 0.2));
      const head = arrowHeadGeometry(geometry, width);
      if (!head) return;
      const shaftGeometry = {
        ...geometry,
        x2: head.shaftEnd.x,
        y2: head.shaftEnd.y,
      };

      const outline = documentRef.createElementNS(SVG_NAMESPACE, "line");
      this.applyLineGeometry(outline, shaftGeometry);
      outline.classList.add("move-arrow-outline");
      outline.setAttribute("stroke-width", String(width + 0.48));
      outline.setAttribute("opacity", String(Math.min(0.42, opacity)));
      this.svg.appendChild(outline);

      const arrow = documentRef.createElementNS(SVG_NAMESPACE, "line");
      this.applyLineGeometry(arrow, shaftGeometry);
      arrow.classList.add("move-arrow-line");
      arrow.dataset.rank = String(move.rank);
      arrow.dataset.move = move.uci;
      arrow.setAttribute("d", geometry.path);
      arrow.setAttribute("fill", style.color);
      arrow.setAttribute("stroke", "rgba(8, 12, 22, 0.68)");
      arrow.setAttribute("stroke-width", "0.48");
      arrow.setAttribute("stroke-linejoin", "round");
      arrow.setAttribute("opacity", String(opacity));
      this.svg.appendChild(arrow);

      const arrowHead = documentRef.createElementNS(SVG_NAMESPACE, "path");
      arrowHead.classList.add("move-arrow-head");
      arrowHead.dataset.rank = String(move.rank);
      arrowHead.dataset.move = move.uci;
      arrowHead.setAttribute(
        "d",
        `M ${head.tip.x} ${head.tip.y} L ${head.left.x} ${head.left.y} L ${head.right.x} ${head.right.y} Z`,
      );
      arrowHead.setAttribute("fill", style.color);
      arrowHead.setAttribute("opacity", String(opacity));
      this.svg.appendChild(arrowHead);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeObserver?.disconnect();
    this.svg?.remove();
    this.moves = [];
    this.highlights = [];
  }
}
