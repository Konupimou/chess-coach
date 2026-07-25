import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree, findNodeByFen } from "./moveTree.js";
import { MoveListView } from "./MoveListView.js";
import { attachKeyboard } from "./keyboard.js";
import { Engine } from "./engine.js";
import { EvalBar } from "./evalBar.js";
import { moveTreeToPgn } from "./moveTreeToPgn.js";
import { renderChatMarkup } from "./chatMarkup.js";

export class ChessApp {
  ensureEngine() {
    if (!this.engine && !this.engineFailed) {
      try {
        this.engine = new Engine({
          onEvaluation: (evalPawns, meta) => {
            if (meta?.fen && meta.fen !== this.analysisFen) return;
            if (
              meta?.searchId
              && this.suggestionState?.searchId
              && meta.searchId !== this.suggestionState.searchId
            ) return;
            this.lastEvalPawns = evalPawns;
            if (this.evalBar && typeof this.evalBar.update === 'function') {
              this.evalBar.update(evalPawns);
            }
          },
          onInfo: (info) => this.handleEngineInfo(info),
          onError: (error) => this.handleEngineError(error),
          multiPV: Math.max(1, this.suggestionCount || 1)
        });
      } catch (e) {
        console.error('[ChessApp] Engine init failed:', e);
        this.engineFailed = true;
      }
    }
    return Boolean(this.engine);
  }

  constructor() {
    if (typeof window.Chessboard !== "function") {
      throw new Error("Chessboard.js wurde nicht geladen.");
    }

    this.destroyed = false;
    this.engine = null;
    this.engineFailed = false;
    this.game = new Chess();
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;

    this.board = window.Chessboard("board", {
      position: this.currentNode.fen,
      draggable: true,
      pieceTheme: "./libs/img/{piece}.png",
      onDrop: this.handleMove.bind(this),
      dropOffBoard: "snapback",
      onSnapbackEnd: () => this.board.position(this.game.fen())
    });

    this.listView = new MoveListView({
      afterElementId: "board",
      onJump: (fen) => this.jumpToFen(fen)
    });

    this.suggestionCount = 3;
    this.analysisFen = this.game.fen();
    this.suggestionState = null;
    this.suggestionsEl = null;
    this._onEngineHashChanged = null;
    this._onEngineThreadsChanged = null;
    this.chatMessages = [];
    this.chatBodyEl = null;
    this.chatInputEl = null;
    this.chatSendBtn = null;
    this.chatStatusEl = null;
    this.chatBusy = false;
    this.lastEvalPawns = null;
    this.chatRequestController = null;

    const boardEl = document.getElementById("board");
    let wrap = document.getElementById("board-container");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "board-container";
      wrap.style.display = "flex";
      wrap.style.gap = "16px";
      wrap.style.justifyContent = "center";
      wrap.style.alignItems = "flex-start";
      wrap.style.flexWrap = 'wrap';
      const parent = boardEl.parentElement;
      parent.insertBefore(wrap, boardEl);
    }

    let boardStack = document.getElementById('board-stack');
    if (!boardStack) {
      boardStack = document.createElement('div');
      boardStack.id = 'board-stack';
      boardStack.className = 'board-stack';
      wrap.appendChild(boardStack);
    }

    let boardRow = document.getElementById("board-row");
    if (!boardRow) {
      boardRow = document.createElement("div");
      boardRow.id = "board-row";
      boardRow.className = "board-row";
      boardStack.appendChild(boardRow);
    }
    boardRow.appendChild(boardEl);
    this.board.resize();

    let analysisColumn = document.getElementById('analysis-column');
    if (!analysisColumn) {
      analysisColumn = document.createElement('div');
      analysisColumn.id = 'analysis-column';
      analysisColumn.className = 'analysis-column';
      wrap.appendChild(analysisColumn);
    }
    this.analysisColumn = analysisColumn;

    const engineAvailable = this.ensureEngine();

    this.evalBar = new EvalBar({ parentEl: boardRow, width: 32, height: null });
    this.scheduleBoardResize();

    const boardToolbar = document.createElement("div");
    boardToolbar.className = "board-toolbar";

    this.gameStatusEl = document.createElement("div");
    this.gameStatusEl.className = "game-status";
    this.gameStatusEl.setAttribute("role", "status");
    this.gameStatusEl.setAttribute("aria-live", "polite");
    boardToolbar.appendChild(this.gameStatusEl);

    const boardActions = document.createElement("div");
    boardActions.className = "board-actions";
    const flipButton = document.createElement("button");
    flipButton.type = "button";
    flipButton.className = "secondary-button";
    flipButton.textContent = "Brett drehen";
    flipButton.addEventListener("click", () => this.board.flip());
    boardActions.appendChild(flipButton);

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "secondary-button";
    resetButton.textContent = "Neue Partie";
    resetButton.addEventListener("click", () => this.resetGame());
    boardActions.appendChild(resetButton);
    boardToolbar.appendChild(boardActions);
    boardStack.appendChild(boardToolbar);

    this.suggestionsEl = document.createElement('div');
    this.suggestionsEl.id = 'engine-suggestions';
    this.suggestionsEl.className = 'card suggestions-card';
    this.suggestionsEl.innerHTML = '<div class="card-title">Vorschläge</div><div class="lines muted">Warten auf Analyse…</div>';
    analysisColumn.appendChild(this.suggestionsEl);

    const chatWrapper = document.createElement('div');
    chatWrapper.className = 'chat-wrapper';
    this.createChatPanel(chatWrapper);
    analysisColumn.appendChild(chatWrapper);

    // UI: Engine-Tiefe-Eingabe hinzufügen
    const controls = document.createElement('div');
    controls.className = 'card engine-controls';

    const controlsHeader = document.createElement('div');
    controlsHeader.className = 'card-title';
    controlsHeader.textContent = 'Engine-Einstellungen';
    controls.appendChild(controlsHeader);

    const makeRow = () => {
      const row = document.createElement('div');
      row.className = 'control-row';
      controls.appendChild(row);
      return row;
    };

    const depthRow = makeRow();
    const label = document.createElement('label');
    label.textContent = 'Tiefe';
    label.htmlFor = 'engine-depth-input';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'engine-depth-input';
    input.min = '1';
    input.max = '99';
    input.value = String(this.engine?.depth ?? 15);
    input.disabled = !engineAvailable;
    input.addEventListener('change', () => {
      if (!this.engine) return;
      this.engine.setDepth(input.value);
      this.evaluateCurrentPosition();
    });
    depthRow.appendChild(label);
    depthRow.appendChild(input);

    const tRow = makeRow();
    const tLabel = document.createElement('label');
    tLabel.textContent = 'Threads';
    tLabel.htmlFor = 'engine-threads-input';
    const tInput = document.createElement('input');
    tInput.type = 'number';
    tInput.id = 'engine-threads-input';
    tInput.min = '1';
    tInput.max = '32';
    tInput.value = String(this.engine?.threads ?? 1);
    tInput.disabled = !engineAvailable;
    tInput.addEventListener('change', () => {
      if (!this.engine) return;
      const v = parseInt(tInput.value, 10);
      if (!Number.isNaN(v) && v > 0 && v <= 32) {
        this.engine.setThreads(v);
        tInput.value = String(this.engine.threads);
        this.evaluateCurrentPosition();
      } else {
        tInput.value = String(this.engine.threads);
      }
    });
    tRow.appendChild(tLabel);
    tRow.appendChild(tInput);

    const hRow = makeRow();
    const hLabel = document.createElement('label');
    hLabel.textContent = 'Hash (MB)';
    hLabel.htmlFor = 'engine-hash-input';
    const hInput = document.createElement('input');
    hInput.type = 'number';
    hInput.id = 'engine-hash-input';
    hInput.min = '16';
    hInput.max = '512';
    hInput.step = '16';
    hInput.value = String(this.engine?.hashMB ?? 128);
    hInput.disabled = !engineAvailable;
    hInput.addEventListener('change', () => {
      if (!this.engine) return;
      const v = parseInt(hInput.value, 10);
      if (!Number.isNaN(v) && v >= 16 && v <= 512) {
        this.engine.setHashMB(v);
        hInput.value = String(this.engine.hashMB);
        this.evaluateCurrentPosition();
      } else {
        hInput.value = String(this.engine.hashMB);
      }
    });
    hRow.appendChild(hLabel);
    hRow.appendChild(hInput);

    const pvRow = makeRow();
    const pvLabel = document.createElement('label');
    pvLabel.textContent = 'Vorschläge';
    pvLabel.htmlFor = 'engine-suggestions-input';
    const pvInput = document.createElement('input');
    pvInput.type = 'number';
    pvInput.id = 'engine-suggestions-input';
    pvInput.min = '0';
    pvInput.max = '5';
    pvInput.value = String(this.suggestionCount);
    pvInput.disabled = !engineAvailable;
    pvInput.addEventListener('change', () => {
      const v = parseInt(pvInput.value, 10);
      if (Number.isNaN(v) || v < 0 || v > 5) {
        pvInput.value = String(this.suggestionCount);
        return;
      }
      this.setSuggestionCount(v);
      pvInput.value = String(this.suggestionCount);
    });
    pvRow.appendChild(pvLabel);
    pvRow.appendChild(pvInput);
    this.suggestionInput = pvInput;
    this.engineInputs = [input, tInput, hInput, pvInput];

    this._onEngineHashChanged = (event) => {
      const next = event?.detail?.hashMB;
      if (typeof next === 'number' && !Number.isNaN(next)) {
        hInput.value = String(next);
      }
    };
    this._onEngineThreadsChanged = (event) => {
      const next = event?.detail?.threads;
      if (typeof next === 'number' && !Number.isNaN(next)) {
        tInput.value = String(next);
      }
    };
    window.addEventListener('engine-hash-changed', this._onEngineHashChanged);
    window.addEventListener('engine-threads-changed', this._onEngineThreadsChanged);

    const exportRow = makeRow();
    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'PGN kopieren';
    exportBtn.addEventListener('click', () => this.exportPgn());
    exportRow.appendChild(exportBtn);

    boardStack.appendChild(controls);

    this.detachKeys = attachKeyboard({
      onLeft: () => this.goBackOnePly(),
      onRight: () => this.goForwardOnePly(),
      onUp: () => this.cycleVariation(-1),
      onDown: () => this.cycleVariation(1)
    });

    this._onBeforeUnload = () => this.destroy();
    this._onResize = () => this.scheduleBoardResize();
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("resize", this._onResize);

    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  handleMove(source, target) {
    const turn = this.game.turn();
    const fromPiece = this.game.get(source);
    if (!fromPiece || (turn === "w" && fromPiece.color !== "w") || (turn === "b" && fromPiece.color !== "b")) {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }

    let move;
    try {
      move = this.game.move({ from: source, to: target, promotion: "q" });
    } catch {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }
    if (move === null) {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }

    this.currentNode = addMoveToTree(this.currentNode, move, this.game.fen());
    this.currentNode.result = this.getGameResult();
    setTimeout(() => this.board.position(this.game.fen()), 0);
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  goBackOnePly() {
    if (!this.currentNode.parent) return;
    this.currentNode = this.currentNode.parent;
    this.game.load(this.currentNode.fen);
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  goForwardOnePly() {
    const next = this.currentNode.mainline;
    if (!next) return;
    this.currentNode = next;
    this.game.load(this.currentNode.fen);
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  cycleVariation(offset) {
    if (!this.currentNode || !this.currentNode.parent || !this.currentNode.move) return;
    const parent = this.currentNode.parent;
    const color = this.currentNode.move.color;
    if (color !== "w" && color !== "b") return;

    const siblings = [];
    if (parent.mainline && parent.mainline.move && parent.mainline.move.color === color) {
      siblings.push(parent.mainline);
    }
    if (Array.isArray(parent.variations)) {
      for (const v of parent.variations) {
        if (v && v.move && v.move.color === color) siblings.push(v);
      }
    }
    if (siblings.length <= 1) return;

    const index = siblings.findIndex((node) => node === this.currentNode);
    if (index === -1) return;

    const nextIndex = (index + offset + siblings.length) % siblings.length;
    const target = siblings[nextIndex];
    this.currentNode = target;
    this.game.load(this.currentNode.fen);
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  evaluateCurrentPosition() {
    const fen = this.game.fen();
    this.analysisFen = fen;
    this.lastEvalPawns = null;
    this.evalBar?.setPending?.();
    this.suggestionState = { fen, searchId: null, depth: 0, lines: new Map() };
    this.renderSuggestions();
    if (!this.engine) {
      this.renderEngineUnavailable();
      return;
    }
    this.suggestionState.searchId = this.engine.evaluate(fen);
  }

  setSuggestionCount(value) {
    const clamped = Math.max(0, Math.min(5, value));
    if (clamped === this.suggestionCount) {
      if (this.suggestionInput) this.suggestionInput.value = String(this.suggestionCount);
      return;
    }
    this.suggestionCount = clamped;
    if (this.suggestionInput) this.suggestionInput.value = String(this.suggestionCount);
    if (this.engine) this.engine.setMultiPV(clamped === 0 ? 1 : clamped);
    this.renderSuggestions();
    this.evaluateCurrentPosition();
  }

  handleEngineInfo(info) {
    if (!info || !Array.isArray(info.pv) || info.pv.length === 0) return;
    if (!this.suggestionState || info.fen !== this.suggestionState.fen) return;
    if (
      this.suggestionState.searchId
      && info.searchId
      && info.searchId !== this.suggestionState.searchId
    ) return;
    const index = info.multipv || 1;
    this.suggestionState.lines.set(index, info);
    if (info.depth) {
      this.suggestionState.depth = Math.max(this.suggestionState.depth || 0, info.depth);
    }
    if (this.suggestionCount > 0) this.renderSuggestions();
  }

  renderSuggestions() {
    if (!this.suggestionsEl) return;
    const body = this.suggestionsEl.querySelector('.lines');
    if (!body) return;

    if (this.suggestionCount === 0) {
      body.style.color = '#666';
      body.textContent = 'Vorschläge deaktiviert.';
      return;
    }

    if (!this.suggestionState || this.suggestionState.lines.size === 0) {
      body.style.color = '#666';
      body.textContent = 'Warten auf Analyse…';
      return;
    }

    const lines = Array.from(this.suggestionState.lines.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, this.suggestionCount);

    if (lines.length === 0) {
      body.style.color = '#666';
      body.textContent = 'Warten auf Analyse…';
      return;
    }

    body.style.color = '#222';
    body.innerHTML = '';
    lines.forEach(([idx, data]) => {
      const row = document.createElement('div');
      row.className = 'suggestion-line';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '2px';
      row.style.padding = '4px 0';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'baseline';

      const label = document.createElement('span');
      label.style.fontWeight = '600';
      label.textContent = `#${idx}`;

      const scoreSpan = document.createElement('span');
      scoreSpan.style.fontVariantNumeric = 'tabular-nums';
      scoreSpan.textContent = this.formatScore(data.whiteScore || data.score);

      header.appendChild(label);
      header.appendChild(scoreSpan);

      if (data.depth) {
        const depthSpan = document.createElement('span');
        depthSpan.style.marginLeft = '8px';
        depthSpan.style.fontSize = '11px';
        depthSpan.style.color = '#666';
        depthSpan.textContent = `d${data.depth}`;
        header.appendChild(depthSpan);
      }

      const moves = document.createElement('div');
      moves.className = 'moves';
      moves.style.fontSize = '12px';
      moves.style.color = '#333';
      const sanMoves = this.pvToSanList(data.pv, data.fen);
      moves.textContent = sanMoves.length > 0 ? sanMoves.join(' ') : '(keine Züge)';

      row.appendChild(header);
      row.appendChild(moves);
      body.appendChild(row);
    });
  }

  formatScore(score) {
    if (!score) return '—';
    if (score.unit === 'mate') {
      const prefix = score.value > 0 ? '#' : '#-';
      return `${prefix}${Math.abs(score.value)}`;
    }
    const val = typeof score.pawns === 'number' ? score.pawns : (score.value || 0) / 100;
    const clamped = Math.max(-20, Math.min(20, val));
    return `${clamped >= 0 ? '+' : ''}${clamped.toFixed(2)}`;
  }

  pvToSanList(pv, fen = this.analysisFen) {
    if (!Array.isArray(pv) || pv.length === 0) return [];
    const baseFen = fen || this.analysisFen || this.game.fen();
    const temp = new Chess();
    try {
      temp.load(baseFen);
    } catch {
      return [];
    }

    const sanMoves = [];
    for (const move of pv) {
      if (typeof move !== 'string' || move.length < 4) break;
      const from = move.slice(0, 2);
      const to = move.slice(2, 4);
      const promotion = move.length > 4 ? move.slice(4).toLowerCase() : undefined;
      const result = temp.move({ from, to, promotion });
      if (!result) break;
      sanMoves.push(result.san);
      if (sanMoves.length >= 8) break;
    }
    return sanMoves;
  }

  createChatPanel(container) {
    const panel = document.createElement('div');
    panel.id = 'coach-chat';
    panel.className = 'card chat-card';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = 'Coach Chat';
    panel.appendChild(title);

    this.chatBodyEl = document.createElement('div');
    this.chatBodyEl.className = 'chat-body';
    panel.appendChild(this.chatBodyEl);

    this.chatStatusEl = document.createElement('div');
    this.chatStatusEl.className = 'chat-status muted';
    panel.appendChild(this.chatStatusEl);

    const form = document.createElement('div');
    form.style.display = 'flex';
    form.style.marginTop = '8px';
    form.style.gap = '6px';

    this.chatInputEl = document.createElement('textarea');
    this.chatInputEl.rows = 2;
    this.chatInputEl.placeholder = 'Frag den Coach...';
    this.chatInputEl.style.flex = '1';
    this.chatInputEl.style.resize = 'none';
    this.chatInputEl.style.fontFamily = 'system-ui, -apple-system, Arial';
    form.appendChild(this.chatInputEl);

    this.chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleChatSubmit();
      }
    });

    this.chatSendBtn = document.createElement('button');
    this.chatSendBtn.textContent = 'Senden';
    this.chatSendBtn.style.padding = '6px 12px';
    this.chatSendBtn.addEventListener('click', () => this.handleChatSubmit());
    form.appendChild(this.chatSendBtn);

    panel.appendChild(form);
    container.appendChild(panel);

    this.chatMessages = [
      { role: 'assistant', content: 'Hallo! Stell eine Frage oder beschreibe deine Idee, und ich gebe dir Hinweise.' }
    ];
    this.renderChat();
    this.checkCoachHealth();
  }

  handleChatSubmit() {
    if (!this.chatInputEl) return;
    const text = this.chatInputEl.value.trim();
    if (!text) return;
    this.chatInputEl.value = '';
    this.sendChatMessage(text);
  }

  appendChatMessage(role, content) {
    this.chatMessages.push({ role, content });
    const maxMessages = 20;
    if (this.chatMessages.length > maxMessages) this.chatMessages.splice(0, this.chatMessages.length - maxMessages);
    this.renderChat();
  }

  renderChat() {
    if (!this.chatBodyEl) return;
    this.chatBodyEl.innerHTML = '';
    this.chatMessages.forEach((msg) => {
      const bubble = document.createElement('div');
      bubble.style.margin = '4px 0';
      bubble.style.padding = '6px 8px';
      bubble.style.borderRadius = '6px';
      bubble.style.whiteSpace = 'pre-wrap';
      bubble.style.fontSize = '13px';
      if (msg.role === 'assistant') {
        bubble.style.background = 'rgba(90, 162, 255, 0.18)';
        bubble.style.border = '1px solid rgba(90, 162, 255, 0.4)';
        bubble.style.color = '#f7fbff';
      } else {
        bubble.style.background = 'rgba(255, 255, 255, 0.08)';
        bubble.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        bubble.style.color = '#fff';
      }
      renderChatMarkup(bubble, msg.content);
      this.chatBodyEl.appendChild(bubble);
    });
    this.chatBodyEl.scrollTop = this.chatBodyEl.scrollHeight;
  }

  async sendChatMessage(text) {
    if (this.chatBusy) return;
    const conversation = this.chatMessages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    this.appendChatMessage('user', text);
    this.setChatBusy(true);
    this.chatRequestController?.abort();
    this.chatRequestController = new AbortController();
    const payload = {
      message: text,
      fen: this.analysisFen,
      evalPawns: typeof this.lastEvalPawns === 'number' ? this.lastEvalPawns : null,
      suggestions: this.buildSuggestionPayload(),
      history: this.game.history(),
      conversation,
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: this.chatRequestController.signal,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data?.reply || data?.choices?.[0]?.message?.content || 'Keine Antwort erhalten.';
      this.appendChatMessage('assistant', reply.trim());
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error('[Chat] request failed', err);
      this.appendChatMessage(
        'assistant',
        err?.message || 'Entschuldigung, der Coach ist momentan nicht erreichbar.',
      );
    } finally {
      this.chatRequestController = null;
      this.setChatBusy(false);
    }
  }

  setChatBusy(state) {
    this.chatBusy = state;
    if (this.chatSendBtn) this.chatSendBtn.disabled = !!state;
    if (this.chatInputEl) this.chatInputEl.disabled = !!state;
    if (this.chatStatusEl) {
      this.chatStatusEl.textContent = state ? 'Coach denkt nach…' : '';
    }
  }

  buildSuggestionPayload() {
    if (!this.suggestionState || !this.suggestionState.lines) return [];
    return Array.from(this.suggestionState.lines.entries())
      .sort(([a], [b]) => a - b)
      .map(([, data]) => ({
        score: this.formatScore(data.whiteScore || data.score),
        moves: this.pvToSanList(data.pv, data.fen),
      }));
  }

  exportPgn() {
    const pgn = moveTreeToPgn(this.moveTree);
    if (!pgn) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(pgn).then(() => {
        console.info('[ChessApp] PGN copied to clipboard.');
      }).catch((err) => {
        console.warn('[ChessApp] Clipboard write failed, showing manual copy prompt.', err);
        this._showPgnPrompt(pgn);
      });
    } else {
      this._showPgnPrompt(pgn);
    }
  }

  _showPgnPrompt(pgn) {
    try {
      window.prompt('PGN kopieren:', pgn);
    } catch (err) {
      console.error('[ChessApp] Unable to display PGN prompt.', err);
    }
  }

  jumpToFen(fen) {
    if (!fen) return;
    const node = findNodeByFen(this.moveTree, fen);
    if (!node) return;
    this.currentNode = node;
    this.game.load(node.fen);
    this.board.position(node.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  getMainlineNodes() {
    const arr = [];
    let n = this.moveTree.mainline;
    while (n && n.move) { arr.push(n); n = n.mainline; }
    return arr;
  }

  renderMoveList() {
    this.listView.render(this.moveTree, this.currentNode);
  }

  scheduleBoardResize() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.destroyed) return;
      this.board?.resize?.();
      this.evalBar?.resizeToBoard?.();
    });
  }

  getGameResult() {
    if (this.game.isCheckmate()) return this.game.turn() === "w" ? "0-1" : "1-0";
    if (this.game.isDraw()) return "1/2-1/2";
    return "*";
  }

  updateGameStatus() {
    if (!this.gameStatusEl) return;
    let label;
    if (this.game.isCheckmate()) {
      label = `Schachmatt · ${this.game.turn() === "w" ? "Schwarz" : "Weiß"} gewinnt`;
    } else if (this.game.isDraw()) {
      label = "Remis";
    } else {
      label = `${this.game.turn() === "w" ? "Weiß" : "Schwarz"} am Zug${this.game.isCheck() ? " · Schach" : ""}`;
    }
    this.gameStatusEl.textContent = label;
  }

  resetGame() {
    this.game.reset();
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;
    this.board.start();
    this.renderMoveList();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
  }

  handleEngineError(error) {
    console.error("[ChessApp] Engine nicht verfügbar", error);
    this.engineFailed = true;
    this.engine = null;
    this.renderEngineUnavailable();
    this.engineInputs?.forEach((input) => {
      input.disabled = true;
    });
  }

  renderEngineUnavailable() {
    const body = this.suggestionsEl?.querySelector(".lines");
    if (!body) return;
    body.textContent = "Stockfish konnte nicht gestartet werden. Bitte lade die Seite neu.";
    body.classList.add("error-text");
  }

  async checkCoachHealth() {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) return;
      const status = await response.json();
      if (!status.coachConfigured && this.chatStatusEl) {
        this.chatStatusEl.textContent = "Für den Coach fehlt noch OPENAI_API_KEY.";
      }
    } catch {
      // Die Schachanalyse funktioniert auch ohne Coach-Backend.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.chatRequestController?.abort();
    try { this.detachKeys?.(); } catch {}
    try { this.engine?.quit(); } catch {}
    try { this.board?.destroy?.(); } catch {}
    try { this.evalBar?.destroy?.(); } catch {}
    if (this._onEngineHashChanged) {
      window.removeEventListener("engine-hash-changed", this._onEngineHashChanged);
    }
    if (this._onEngineThreadsChanged) {
      window.removeEventListener("engine-threads-changed", this._onEngineThreadsChanged);
    }
    if (this._onBeforeUnload) {
      window.removeEventListener("beforeunload", this._onBeforeUnload);
    }
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
    }
  }
  
}
