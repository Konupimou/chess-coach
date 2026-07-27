const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";

export const MOVE_ARROW_STYLES = Object.freeze([
  { color: "#6aa9ef", opacity: 0.92, width: 1.72 },
  { color: "#6aa9ef", opacity: 0.78, width: 1.42 },
  { color: "#6aa9ef", opacity: 0.68, width: 1.2 },
  { color: "#6aa9ef", opacity: 0.6, width: 1.04 },
  { color: "#6aa9ef", opacity: 0.54, width: 0.94 },
]);

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

const rounded = (value) => Number(value.toFixed(3));

export function arrowPathGeometry(value, orientation = "white", width = 1.5) {
  const line = arrowGeometry(value, orientation);
  if (!line || !Number.isFinite(width) || width <= 0) return null;
  const deltaX = line.x2 - line.x1;
  const deltaY = line.y2 - line.y1;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance) return null;

  const unit = { x: deltaX / distance, y: deltaY / distance };
  const normal = { x: -unit.y, y: unit.x };
  const shaftHalf = width / 2;
  const headLength = clamp(width * 3.4, 4.6, Math.min(7.4, distance * 0.42));
  const headHalf = clamp(width * 1.72, 2.4, 4.4);
  const join = {
    x: line.x2 - unit.x * headLength,
    y: line.y2 - unit.y * headLength,
  };
  const point = (base, offset) => ({
    x: rounded(base.x + normal.x * offset),
    y: rounded(base.y + normal.y * offset),
  });
  const start = { x: line.x1, y: line.y1 };
  const tip = { x: rounded(line.x2), y: rounded(line.y2) };
  const shaftJoin = {
    left: point(join, shaftHalf),
    right: point(join, -shaftHalf),
  };
  const points = [
    point(start, shaftHalf),
    shaftJoin.left,
    point(join, headHalf),
    tip,
    point(join, -headHalf),
    shaftJoin.right,
    point(start, -shaftHalf),
  ];
  const path = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ") + " Z";

  return { path, points, tip, shaftJoin, headLength: rounded(headLength) };
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
    [...this.moves].reverse().forEach((move) => {
      const styleIndex = Math.max(0, Math.min(move.rank - 1, MOVE_ARROW_STYLES.length - 1));
      const style = MOVE_ARROW_STYLES[styleIndex];
      const impact = Number.isFinite(move.impact) ? move.impact : 1;
      const width = Math.max(0.86, style.width * (0.76 + impact * 0.24));
      const opacity = Math.max(0.48, style.opacity * (0.8 + impact * 0.2));
      const geometry = arrowPathGeometry(move, this.orientation, width);
      if (!geometry) return;

      const arrow = documentRef.createElementNS(SVG_NAMESPACE, "path");
      arrow.classList.add("move-arrow-shape");
      arrow.dataset.rank = String(move.rank);
      arrow.dataset.move = move.uci;
      arrow.setAttribute("d", geometry.path);
      arrow.setAttribute("fill", style.color);
      arrow.setAttribute("stroke", "rgba(8, 12, 22, 0.68)");
      arrow.setAttribute("stroke-width", "0.48");
      arrow.setAttribute("stroke-linejoin", "round");
      arrow.setAttribute("opacity", String(opacity));
      this.svg.appendChild(arrow);
    });
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
