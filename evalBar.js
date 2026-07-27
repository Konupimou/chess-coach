// evalBar.js
// Simple evaluation bar rendered to the right of the board
// Usage: new EvalBar({ parentId: 'board-container' })

export class EvalBar {
  constructor({ parentEl = null, parentId = 'board-container', width = 40, height = null } = {}) {
    // Resolve parent element
    let parent = null;
    if (parentEl && parentEl.nodeType === 1) parent = parentEl;
    else if (typeof parentEl === 'string') parent = document.getElementById(parentEl);
    else parent = document.getElementById(parentId);

    if (!parent) {
      console.error('[EvalBar] Parent element not found. Tried parentEl/parentId=', parentEl || parentId);
      return;
    }

    // Try to size the bar roughly to the board height; otherwise use fallback
    const boardEl = document.getElementById('board');
    const boardHeight = (boardEl && (boardEl.offsetHeight || boardEl.clientHeight)) || 480;
    const barHeight = height != null ? height : boardHeight;

    // Ensure parent is flex so the bar sits to the right of the board
    const parentStyle = parent.style;
    if (!parentStyle.display) parentStyle.display = 'flex';
    if (!parentStyle.gap) parentStyle.gap = '16px';
    if (!parentStyle.alignItems) parentStyle.alignItems = 'flex-start';
    if (!parentStyle.justifyContent) parentStyle.justifyContent = 'center';

    // Container
    this.container = document.createElement('div');
    this.container.id = 'analysis-panel';
    this.container.setAttribute("role", "meter");
    this.container.setAttribute("aria-label", "Stockfish-Bewertung aus Sicht von Weiß");
    this.container.setAttribute("aria-valuemin", "-8");
    this.container.setAttribute("aria-valuemax", "8");
    this.container.style.width = `${Math.max(28, width)}px`;
    this.container.style.minHeight = `${barHeight}px`;
    this.container.style.fontFamily = 'system-ui, -apple-system, Arial';
    this.container.style.fontSize = '13px';

    // Title
    const title = document.createElement('div');
    title.className = "eval-title";
    title.textContent = 'Bewertung';
    title.style.textAlign = 'center';
    title.style.marginBottom = '8px';
    this.container.appendChild(title);

    // Bar
    this.bar = document.createElement('div');
    this.bar.id = 'eval-bar';
    this.bar.style.height = `${barHeight - 40}px`;
    this.bar.style.width = '28px';
    this.bar.style.border = '1px solid rgba(255, 255, 255, 0.22)';
    this.bar.style.margin = '0 auto';
    this.bar.style.position = 'relative';
    this.bar.style.background = '#05070b';
    this.bar.style.borderRadius = '4px';
    this.bar.style.overflow = 'hidden';

    // White overlay from top to percentage
    this.overlay = document.createElement('div');
    this.overlay.id = 'eval-overlay';
    this.overlay.style.position = 'absolute';
    this.overlay.style.left = '0';
    this.overlay.style.bottom = '0';
    this.overlay.style.width = '100%';
    this.overlay.style.height = '50%';
    this.overlay.style.background = '#f5f7fa';

    // Marker line
    this.marker = document.createElement('div');
    this.marker.id = 'eval-marker';
    this.marker.style.position = 'absolute';
    this.marker.style.left = '-6px';
    this.marker.style.width = '40px';
    this.marker.style.height = '2px';
    this.marker.style.background = '#2a6';
    this.marker.style.top = '50%';

    this.bar.appendChild(this.overlay);
    this.bar.appendChild(this.marker);

    // Label
    this.label = document.createElement('div');
    this.label.id = 'eval-label';
    this.label.style.textAlign = 'center';
    this.label.style.marginTop = '8px';
    this.label.textContent = '0.00';

    this.container.appendChild(this.bar);
    this.container.appendChild(this.label);

    parent.appendChild(this.container);

    // Initial state
    this.update(0);
  }

  // evalScore in pawns (positive = better for White, negative = better for Black)
  update(evalScore) {
    if (typeof evalScore !== 'number' || Number.isNaN(evalScore)) return;

    // Clamp to +/- 8 pawns for display
    const clamped = Math.max(-8, Math.min(8, evalScore));
    // Convert to white percentage (0..100). 0 -> 50%
    const whitePct = 50 + (clamped / 8) * 50;

    // Update visuals
    this.overlay.style.height = `${whitePct}%`;
    this.marker.style.top = `${100 - whitePct}%`;

    // Label text: show +/- with two decimals
    this.label.textContent = (evalScore >= 0 ? '+' : '') + evalScore.toFixed(2);
    this.container.setAttribute("aria-valuenow", String(clamped));
    this.container.setAttribute("aria-valuetext", `${this.label.textContent} Bauern für Weiß`);
    this.container.classList.remove("is-pending");
  }

  setPending() {
    if (!this.container) return;
    this.container.classList.add("is-pending");
    this.label.textContent = "…";
    this.container.removeAttribute("aria-valuenow");
    this.container.setAttribute("aria-valuetext", "Analyse läuft");
  }

  resizeToBoard() {
    const boardEl = document.getElementById("board");
    const boardHeight = boardEl?.offsetHeight || boardEl?.clientHeight;
    if (!boardHeight || !this.container || !this.bar) return;
    this.container.style.minHeight = `${boardHeight}px`;
    this.bar.style.height = `${Math.max(120, boardHeight - 40)}px`;
  }

  destroy() {
    this.container?.remove();
  }
}

// Rückwärtskompatibilität für bestehende Importe.
export const evalBar = EvalBar;
