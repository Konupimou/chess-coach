import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree, findNodeByFen } from "./moveTree.js";
import { MoveListView } from "./MoveListView.js";
import { attachKeyboard } from "./keyboard.js";
import { Engine } from "./engine.js";
import { EvalBar } from "./evalBar.js";
import { moveTreeToPgn } from "./moveTreeToPgn.js";
import { renderChatMarkup } from "./chatMarkup.js";
import { MOVE_ARROW_STYLES, MoveArrowOverlay } from "./moveArrows.js";
import {
  MOVE_QUALITY,
  analysisEntryFromInfo,
  buildFallbackFeedback,
  buildPvFrames,
  pathToNode,
  reviewDepthForPlies,
  summarizeGameReview,
  terminalWhiteCp,
} from "./gameReview.js";
import {
  createAccountState,
  createGameId,
  deserializeMoveTree,
  findNodeByPath,
  loadAccountState,
  mergeAccountStates,
  nodePathFromRoot,
  removeSavedGame,
  saveAccountState,
  serializeMoveTree,
  storageKeyForIdentity,
  upsertSavedGame,
} from "./gameStorage.js";

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
      onDragStart: () => {
        if (this.previewState || this.reviewRunning) return false;
        this.moveArrows?.setVisible(false);
        return true;
      },
      onDrop: this.handleMove.bind(this),
      dropOffBoard: "snapback",
      onSnapEnd: () => this.moveArrows?.setVisible(true),
      onSnapbackEnd: () => {
        this.board.position(this.game.fen());
        this.moveArrows?.setVisible(true);
      }
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
    this.previewState = null;
    this.previewTimer = null;
    this.previewToken = 0;
    this.suggestionsDirtyDuringPreview = false;
    this.reviewRunning = false;
    this.reviewEngine = null;
    this.reviewPendingSearch = null;
    this.reviewCancelled = false;
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.engineSettingsOpen = false;
    this.modalKeyHandler = null;
    this.activeGameId = createGameId();
    this.activeGameDeletedExternally = false;
    this.accountIdentity = null;
    this.accountStorageKey = storageKeyForIdentity(null);
    try {
      this.browserStorage = window.localStorage;
    } catch {
      this.browserStorage = null;
    }
    this.accountState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      { name: "Lokales Profil", source: "local" },
    );

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
    let boardSurface = document.getElementById("board-surface");
    if (!boardSurface) {
      boardSurface = document.createElement("div");
      boardSurface.id = "board-surface";
      boardSurface.className = "board-surface";
    }
    boardSurface.appendChild(boardEl);
    boardRow.appendChild(boardSurface);
    this.board.resize();
    this.moveArrows = new MoveArrowOverlay({
      hostEl: boardSurface,
      boardEl,
      orientation: this.board.orientation(),
    });

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

    const statusGroup = document.createElement("div");
    statusGroup.className = "board-status-group";
    this.gameStatusEl = document.createElement("div");
    this.gameStatusEl.className = "game-status";
    this.gameStatusEl.setAttribute("role", "status");
    this.gameStatusEl.setAttribute("aria-live", "polite");
    statusGroup.appendChild(this.gameStatusEl);
    this.accuracyEl = document.createElement("div");
    this.accuracyEl.className = "accuracy-chip is-pending";
    this.accuracyEl.textContent = "Genauigkeit —";
    this.accuracyEl.title = "Wird aus den Engine-Bewertungen der gespielten Züge berechnet.";
    statusGroup.appendChild(this.accuracyEl);
    boardToolbar.appendChild(statusGroup);

    const boardActions = document.createElement("div");
    boardActions.className = "board-actions";

    this.engineSettingsButton = document.createElement("button");
    this.engineSettingsButton.type = "button";
    this.engineSettingsButton.className = "secondary-button";
    this.engineSettingsButton.textContent = "⚙ Engine";
    this.engineSettingsButton.setAttribute("aria-haspopup", "dialog");
    this.engineSettingsButton.setAttribute("aria-expanded", "false");
    this.engineSettingsButton.addEventListener("click", () => this.openEngineSettings());
    boardActions.appendChild(this.engineSettingsButton);

    const flipButton = document.createElement("button");
    flipButton.type = "button";
    flipButton.className = "secondary-button";
    flipButton.textContent = "Brett drehen";
    flipButton.addEventListener("click", () => {
      this.stopSuggestionPreview();
      const orientation = this.board.flip();
      this.moveArrows?.setOrientation(orientation);
      this.scheduleBoardResize();
    });
    boardActions.appendChild(flipButton);

    this.feedbackButton = document.createElement("button");
    this.feedbackButton.type = "button";
    this.feedbackButton.className = "primary-action-button";
    this.feedbackButton.textContent = "Partie analysieren";
    this.feedbackButton.disabled = true;
    this.feedbackButton.addEventListener("click", () => this.startFullGameReview());
    boardActions.appendChild(this.feedbackButton);

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "secondary-button";
    exportBtn.textContent = "PGN";
    exportBtn.addEventListener("click", () => this.exportPgn());
    boardActions.appendChild(exportBtn);

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
    this.suggestionsEl.innerHTML = [
      '<div class="suggestions-heading">',
      '<div class="card-title">Vorschläge</div>',
      '<span>Hover = Variante zeigen</span>',
      '</div>',
      '<div class="lines muted">Warten auf Analyse…</div>',
    ].join('');
    analysisColumn.appendChild(this.suggestionsEl);

    const chatWrapper = document.createElement('div');
    chatWrapper.className = 'chat-wrapper';
    this.createChatPanel(chatWrapper);
    analysisColumn.appendChild(chatWrapper);

    const controls = document.createElement('dialog');
    controls.id = 'engine-settings-dialog';
    controls.className = 'modal-dialog engine-settings-dialog';
    controls.setAttribute('aria-labelledby', 'engine-settings-title');
    this.engineSettingsDialog = controls;

    const controlsHeader = document.createElement('div');
    controlsHeader.className = 'dialog-heading';
    const controlsTitle = document.createElement('div');
    controlsTitle.id = 'engine-settings-title';
    controlsTitle.className = 'card-title';
    controlsTitle.textContent = 'Engine-Einstellungen';
    controlsHeader.appendChild(controlsTitle);
    const controlsClose = document.createElement('button');
    controlsClose.type = 'button';
    controlsClose.className = 'dialog-close';
    controlsClose.setAttribute('aria-label', 'Engine-Einstellungen schließen');
    controlsClose.textContent = '×';
    controlsClose.addEventListener('click', () => controls.close());
    controlsHeader.appendChild(controlsClose);
    controls.appendChild(controlsHeader);

    const controlsDescription = document.createElement('p');
    controlsDescription.className = 'dialog-description';
    controlsDescription.textContent = 'Änderungen werden gemeinsam übernommen und lösen nur eine neue Analyse aus.';
    controls.appendChild(controlsDescription);

    const controlsForm = document.createElement('div');
    controlsForm.className = 'engine-controls';
    controls.appendChild(controlsForm);

    const makeRow = () => {
      const row = document.createElement('div');
      row.className = 'control-row';
      controlsForm.appendChild(row);
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

    const controlsActions = document.createElement('div');
    controlsActions.className = 'dialog-actions';
    const controlsCancel = document.createElement('button');
    controlsCancel.type = 'button';
    controlsCancel.className = 'secondary-button';
    controlsCancel.textContent = 'Abbrechen';
    controlsCancel.addEventListener('click', () => controls.close());
    controlsActions.appendChild(controlsCancel);
    const controlsApply = document.createElement('button');
    controlsApply.type = 'button';
    controlsApply.className = 'primary-action-button';
    controlsApply.textContent = 'Übernehmen';
    controlsApply.disabled = !engineAvailable;
    controlsApply.addEventListener('click', () => {
      if (!this.engine) return;
      const depth = Number.parseInt(input.value, 10);
      const threads = Number.parseInt(tInput.value, 10);
      const hash = Number.parseInt(hInput.value, 10);
      const suggestions = Number.parseInt(pvInput.value, 10);
      if (
        !Number.isInteger(depth) || depth < 1 || depth > 99
        || !Number.isInteger(threads) || threads < 1 || threads > 32
        || !Number.isInteger(hash) || hash < 16 || hash > 512
        || !Number.isInteger(suggestions) || suggestions < 0 || suggestions > 5
      ) {
        this.showToast('Bitte prüfe die Engine-Werte.');
        return;
      }
      this.engine.setDepth(depth);
      this.engine.setThreads(threads);
      this.engine.setHashMB(hash);
      this.suggestionCount = suggestions;
      this.engine.setMultiPV(suggestions === 0 ? 1 : suggestions);
      pvInput.value = String(suggestions);
      controls.close();
      this.evaluateCurrentPosition();
    });
    controlsActions.appendChild(controlsApply);
    controls.appendChild(controlsActions);
    controls.addEventListener('close', () => {
      this.engineSettingsOpen = false;
      this.engineSettingsButton?.setAttribute('aria-expanded', 'false');
      this.engineSettingsButton?.focus();
    });
    document.body.appendChild(controls);

    this.createFeedbackDialog();
    this.createAccountPanel();

    this.detachKeys = attachKeyboard({
      onLeft: () => this.goBackOnePly(),
      onRight: () => this.goForwardOnePly(),
      onUp: () => this.cycleVariation(-1),
      onDown: () => this.cycleVariation(1)
    });

    this._onBeforeUnload = () => this.destroy();
    this._onResize = () => this.scheduleBoardResize();
    this._onKeyDown = (event) => {
      if (event.key === 'Escape' && this.previewState) this.stopSuggestionPreview();
    };
    this._onStorage = (event) => {
      if (event.key !== this.accountStorageKey) return;
      const activeWasSaved = this.accountState?.games?.some(
        (game) => game.id === this.activeGameId,
      );
      const nextState = loadAccountState(
        this.browserStorage,
        this.accountStorageKey,
        this.accountState?.profile,
      );
      const activeWasDeleted = nextState.deletedGames?.some(
        (deletion) => deletion.id === this.activeGameId,
      );
      this.accountState = nextState;
      if (activeWasSaved && activeWasDeleted) {
        this.activeGameDeletedExternally = true;
        this.showToast(
          'Diese geöffnete Partie wurde in einem anderen Tab gelöscht. Weitere Änderungen werden nicht gespeichert.',
        );
      }
      this.updateAccountButton();
      if (this.accountDialog?.open) this.renderAccountDialog();
    };
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("storage", this._onStorage);

    this.renderMoveList();
    this.updateGameStatus();
    this.updateAccuracyDisplay();
    this.evaluateCurrentPosition();
    this.initializeAccountIdentity();
  }

  handleMove(source, target) {
    if (this.reviewRunning) return "snapback";
    this.stopSuggestionPreview();
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
    this.gameReviewReport = null;
    this.savedGameReview = null;
    setTimeout(() => this.board.position(this.game.fen()), 0);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
    this.persistCurrentGame();
  }

  goBackOnePly() {
    if (this.reviewRunning) return;
    this.stopSuggestionPreview();
    if (!this.currentNode.parent) return;
    this.currentNode = this.currentNode.parent;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  goForwardOnePly() {
    if (this.reviewRunning) return;
    this.stopSuggestionPreview();
    const next = this.currentNode.mainline;
    if (!next) return;
    this.currentNode = next;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  cycleVariation(offset) {
    if (this.reviewRunning) return;
    this.stopSuggestionPreview();
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
    this.gameReviewReport = null;
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  evaluateCurrentPosition() {
    if (this.previewState) this.stopSuggestionPreview();
    const fen = this.game.fen();
    this.analysisFen = fen;
    this.lastEvalPawns = null;
    this.evalBar?.setPending?.();
    this.suggestionState = {
      fen,
      node: this.currentNode,
      searchId: null,
      targetDepth: this.engine?.depth || 15,
      depth: 0,
      lines: new Map(),
    };
    this.moveArrows?.clear();
    this.renderSuggestions();
    let terminalCp = terminalWhiteCp(fen);
    if (!Number.isFinite(terminalCp) && this.game.isDraw()) terminalCp = 0;
    if (Number.isFinite(terminalCp)) {
      this.currentNode.analysis = {
        whiteCp: terminalCp,
        depth: this.engine?.depth || 15,
        pv: [],
        complete: true,
      };
      this.refreshLiveAccuracy();
      return;
    }
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
    if (!this.suggestionState.searchId || info.searchId !== this.suggestionState.searchId) return;
    const index = info.multipv || 1;
    const previous = this.suggestionState.lines.get(index);
    if (
      previous?.depth
      && info.depth
      && info.depth < previous.depth
    ) return;
    this.suggestionState.lines.set(index, info);
    if (info.depth) {
      this.suggestionState.depth = Math.max(this.suggestionState.depth || 0, info.depth);
    }
    if (index === 1) {
      const analysis = analysisEntryFromInfo(info);
      const node = this.suggestionState.node;
      if (
        analysis
        && node
        && node.fen === info.fen
        && (!info.depth || info.depth >= this.suggestionState.targetDepth)
        && (!node.analysis?.depth || !analysis.depth || analysis.depth >= node.analysis.depth)
      ) {
        node.analysis = analysis;
        this.refreshLiveAccuracy();
      }
    }
    if (this.suggestionCount > 0) {
      if (this.previewState) {
        this.suggestionsDirtyDuringPreview = true;
      } else {
        this.renderSuggestions();
      }
    }
  }

  renderSuggestions() {
    this.renderMoveArrows();
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

    body.style.color = '#fff';
    body.innerHTML = '';
    lines.forEach(([idx, data]) => {
      const row = document.createElement('div');
      row.className = 'suggestion-line';
      row.tabIndex = 0;
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
      label.style.color = MOVE_ARROW_STYLES[Math.min(idx - 1, MOVE_ARROW_STYLES.length - 1)].color;
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
        depthSpan.style.color = '#93a5c8';
        depthSpan.textContent = `d${data.depth}`;
        header.appendChild(depthSpan);
      }

      const moves = document.createElement('div');
      moves.className = 'moves';
      moves.style.fontSize = '12px';
      moves.style.color = '#c7d4ed';
      const sanMoves = this.pvToSanList(data.pv, data.fen);
      moves.textContent = sanMoves.length > 0 ? sanMoves.join(' ') : '(keine Züge)';
      row.setAttribute(
        'aria-label',
        `Variante ${idx} vorführen: ${sanMoves.join(' ') || 'keine legalen Züge'}`,
      );
      row.title = 'Zeiger darüber halten, um die Variante auf dem Brett abzuspielen.';
      row.addEventListener('pointerenter', () => this.startSuggestionPreview(data, row));
      row.addEventListener('pointerleave', () => this.stopSuggestionPreview(row));
      row.addEventListener('focus', () => this.startSuggestionPreview(data, row));
      row.addEventListener('blur', () => this.stopSuggestionPreview(row));

      row.appendChild(header);
      row.appendChild(moves);
      body.appendChild(row);
    });
  }

  renderMoveArrows() {
    if (!this.moveArrows) return;
    if (
      this.suggestionCount === 0
      || !this.suggestionState
      || this.suggestionState.lines.size === 0
    ) {
      this.moveArrows.clear();
      return;
    }

    const moves = Array.from(this.suggestionState.lines.entries())
      .sort(([left], [right]) => left - right)
      .slice(0, this.suggestionCount)
      .map(([rank, data]) => ({ rank, move: data?.pv?.[0] }));
    this.moveArrows.setMoves(moves);
  }

  startSuggestionPreview(data, row) {
    if (
      this.reviewRunning
      || !data
      || data.fen !== this.analysisFen
      || data.fen !== this.game.fen()
      || data.searchId !== this.suggestionState?.searchId
    ) return;
    const frames = buildPvFrames(data.fen, data.pv, 8);
    if (frames.length === 0) return;
    if (this.previewState?.row === row) return;
    if (this.previewState) this.stopSuggestionPreview(null, { deferRender: true });

    const token = ++this.previewToken;
    const boardSurface = document.getElementById('board-surface');
    if (!this.previewBadge && boardSurface) {
      this.previewBadge = document.createElement('div');
      this.previewBadge.className = 'board-preview-badge';
      boardSurface.appendChild(this.previewBadge);
    }
    this.previewState = { token, row, frames, index: -1 };
    row?.classList.add('is-previewing');
    this.moveArrows?.setVisible(false);
    this.board.position(data.fen, false);
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      this.previewBadge.textContent = 'Varianten-Vorschau';
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reducedMotion) {
      const last = frames[frames.length - 1];
      this.board.position(last.fen, false);
      if (this.previewBadge) this.previewBadge.textContent = `Vorschau · ${last.san}`;
      return;
    }

    const showFrame = (index) => {
      if (!this.previewState || this.previewState.token !== token) return;
      const frame = frames[index];
      if (!frame) return;
      this.previewState.index = index;
      this.board.position(frame.fen, true);
      if (this.previewBadge) {
        this.previewBadge.textContent = `Vorschau ${index + 1}/${frames.length} · ${frame.san}`;
      }
      if (index + 1 < frames.length) {
        this.previewTimer = window.setTimeout(() => showFrame(index + 1), 620);
      }
    };
    this.previewTimer = window.setTimeout(() => showFrame(0), 180);
  }

  stopSuggestionPreview(row = null, { deferRender = false } = {}) {
    if (!this.previewState) return;
    if (row && this.previewState.row !== row) return;
    this.previewToken += 1;
    if (this.previewTimer) window.clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.previewState.row?.classList.remove('is-previewing');
    this.previewState = null;
    if (!this.destroyed) {
      this.board?.position?.(this.game.fen(), false);
      this.moveArrows?.setVisible(true);
      this.renderMoveArrows();
    }
    if (this.previewBadge) this.previewBadge.hidden = true;
    if (this.suggestionsDirtyDuringPreview && !deferRender) {
      this.suggestionsDirtyDuringPreview = false;
      requestAnimationFrame(() => {
        if (!this.previewState && !this.destroyed) this.renderSuggestions();
      });
    }
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

  getCurrentPath() {
    try {
      return pathToNode(this.currentNode);
    } catch (error) {
      console.warn('[ChessApp] Ungültiger Variantenpfad', error);
      return [this.moveTree].filter(Boolean);
    }
  }

  refreshLiveAccuracy() {
    const path = this.getCurrentPath();
    const minimumDepth = this.engine?.depth || 1;
    const evaluations = path.map((node) => (
      node.analysis?.complete
      && Number.isFinite(node.analysis.depth)
      && node.analysis.depth >= minimumDepth
        ? node.analysis
        : null
    ));
    this.liveAccuracyReport = summarizeGameReview(path, evaluations, {
      depth: this.engine?.depth || null,
      final: false,
    });
    this.updateAccuracyDisplay();
  }

  updateAccuracyDisplay() {
    if (!this.accuracyEl) return;
    const report = this.gameReviewReport || this.liveAccuracyReport;
    const accuracy = report?.overallAccuracy;
    if (!Number.isFinite(accuracy) || report?.analyzedMoves === 0) {
      this.accuracyEl.textContent = 'Genauigkeit —';
      this.accuracyEl.classList.add('is-pending');
      this.accuracyEl.title = 'Nach den ersten vollständig bewerteten Zügen erscheint hier die Genauigkeit.';
      return;
    }
    const provisional = !report.final || report.analyzedMoves < report.totalMoves;
    this.accuracyEl.classList.toggle('is-pending', provisional);
    this.accuracyEl.textContent = `${provisional ? 'Vorläufig ' : ''}${accuracy.toFixed(1)} %`;
    const white = Number.isFinite(report.whiteAccuracy) ? `${report.whiteAccuracy.toFixed(1)} %` : '—';
    const black = Number.isFinite(report.blackAccuracy) ? `${report.blackAccuracy.toFixed(1)} %` : '—';
    this.accuracyEl.title = `Geschätzte Engine-Genauigkeit · Weiß ${white} · Schwarz ${black} · ${report.analyzedMoves}/${report.totalMoves} Züge`;
  }

  openEngineSettings() {
    const dialog = this.engineSettingsDialog;
    if (!dialog || dialog.open) return;
    const [depthInput, threadsInput, hashInput, suggestionsInput] = this.engineInputs || [];
    if (depthInput) depthInput.value = String(this.engine?.depth ?? 15);
    if (threadsInput) threadsInput.value = String(this.engine?.threads ?? 1);
    if (hashInput) hashInput.value = String(this.engine?.hashMB ?? 128);
    if (suggestionsInput) suggestionsInput.value = String(this.suggestionCount);
    this.stopSuggestionPreview();
    this.engineSettingsOpen = true;
    this.engineSettingsButton?.setAttribute('aria-expanded', 'true');
    dialog.showModal();
    depthInput?.focus();
  }

  showToast(message) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'app-toast';
      this.toastEl.setAttribute('role', 'status');
      this.toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl?.classList.remove('is-visible');
    }, 2600);
  }

  createFeedbackDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'game-feedback-dialog';
    dialog.className = 'modal-dialog feedback-dialog';
    dialog.setAttribute('aria-labelledby', 'game-feedback-title');
    this.feedbackDialog = dialog;

    const heading = document.createElement('div');
    heading.className = 'dialog-heading';
    const title = document.createElement('div');
    title.id = 'game-feedback-title';
    title.className = 'card-title';
    title.textContent = 'Partieanalyse';
    heading.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dialog-close';
    close.setAttribute('aria-label', 'Partieanalyse schließen');
    close.textContent = '×';
    close.addEventListener('click', () => dialog.close());
    heading.appendChild(close);
    dialog.appendChild(heading);

    this.feedbackBodyEl = document.createElement('div');
    this.feedbackBodyEl.className = 'feedback-body';
    dialog.appendChild(this.feedbackBodyEl);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    this.feedbackCancelButton = document.createElement('button');
    this.feedbackCancelButton.type = 'button';
    this.feedbackCancelButton.className = 'secondary-button';
    this.feedbackCancelButton.textContent = 'Schließen';
    this.feedbackCancelButton.addEventListener('click', () => {
      if (this.reviewRunning) {
        this.cancelFullGameReview();
      } else {
        dialog.close();
      }
    });
    actions.appendChild(this.feedbackCancelButton);
    dialog.appendChild(actions);

    dialog.addEventListener('close', () => {
      if (this.reviewRunning) this.cancelFullGameReview();
      this.reviewCoachController?.abort();
      this.reviewCoachController = null;
      this.feedbackButton?.focus();
    });
    document.body.appendChild(dialog);
  }

  renderReviewProgress(current, total, depth, label = 'Stockfish prüft jede Stellung …') {
    if (!this.feedbackBodyEl) return;
    this.feedbackBodyEl.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'dialog-description';
    intro.textContent = label;
    this.feedbackBodyEl.appendChild(intro);

    const progress = document.createElement('progress');
    progress.className = 'review-progress';
    progress.max = Math.max(1, total);
    progress.value = Math.max(0, current);
    progress.setAttribute('aria-label', 'Fortschritt der Partieanalyse');
    this.feedbackBodyEl.appendChild(progress);

    const status = document.createElement('div');
    status.className = 'review-progress-label';
    status.textContent = `Stellung ${Math.min(current, total)} von ${total} · Tiefe ${depth}`;
    this.feedbackBodyEl.appendChild(status);
  }

  handleReviewEngineInfo(info) {
    const pending = this.reviewPendingSearch;
    if (
      !pending
      || !info
      || info.searchId !== pending.searchId
      || info.fen !== pending.fen
      || (info.multipv || 1) !== 1
    ) return;
    const entry = analysisEntryFromInfo(info);
    if (!entry) return;
    pending.latest = entry;
    if (info.depth && info.depth >= pending.depth) {
      pending.resolve(entry);
    }
  }

  analyzeReviewFen(fen, depth) {
    if (!this.reviewEngine || this.reviewCancelled) {
      const error = new Error('Partieanalyse abgebrochen.');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const searchId = this.reviewEngine.evaluate(fen, depth);
      if (!searchId) {
        reject(new Error('Stockfish konnte die Stellung nicht starten.'));
        return;
      }
      const timeout = window.setTimeout(() => {
        if (this.reviewPendingSearch?.searchId === searchId) {
          this.reviewPendingSearch = null;
        }
        reject(new Error('Eine Stellung konnte nicht rechtzeitig analysiert werden.'));
      }, 30_000);
      this.reviewPendingSearch = {
        fen,
        depth,
        searchId,
        latest: null,
        resolve: (entry) => {
          window.clearTimeout(timeout);
          if (this.reviewPendingSearch?.searchId === searchId) this.reviewPendingSearch = null;
          resolve(entry);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          if (this.reviewPendingSearch?.searchId === searchId) this.reviewPendingSearch = null;
          reject(error);
        },
      };
    });
  }

  cancelFullGameReview() {
    this.reviewCancelled = true;
    const error = new Error('Partieanalyse abgebrochen.');
    error.name = 'AbortError';
    this.reviewPendingSearch?.reject(error);
    this.reviewPendingSearch = null;
    try { this.reviewEngine?.quit?.(); } catch {}
    this.reviewEngine = null;
    this.reviewCoachController?.abort();
    this.reviewCoachController = null;
  }

  async startFullGameReview() {
    if (this.reviewRunning) return;
    let path;
    try {
      path = pathToNode(this.currentNode);
    } catch (error) {
      this.showToast(error?.message || 'Diese Partie kann nicht analysiert werden.');
      return;
    }
    if (path.length < 2) {
      this.showToast('Spiele zuerst mindestens einen Zug.');
      return;
    }

    this.stopSuggestionPreview();
    this.engine?.cancelSearch?.();
    this.reviewCancelled = false;
    this.reviewRunning = true;
    this.feedbackButton.disabled = true;
    this.feedbackCancelButton.textContent = 'Abbrechen';
    if (!this.feedbackDialog.open) this.feedbackDialog.showModal();

    const depth = reviewDepthForPlies(path.length - 1, this.engine?.depth || 15);
    const evaluations = [];
    const cache = new Map();
    let report = null;
    this.renderReviewProgress(0, path.length, depth);

    try {
      this.reviewEngine = new Engine({
        depth,
        threads: 1,
        hashMB: 32,
        multiPV: 1,
        onInfo: (info) => this.handleReviewEngineInfo(info),
        onError: (error) => {
          this.reviewPendingSearch?.reject(error);
        },
      });

      for (let index = 0; index < path.length; index += 1) {
        if (this.reviewCancelled) {
          const error = new Error('Partieanalyse abgebrochen.');
          error.name = 'AbortError';
          throw error;
        }
        const node = path[index];
        const terminal = terminalWhiteCp(node.fen);
        let entry;
        if (Number.isFinite(terminal)) {
          entry = { whiteCp: terminal, depth, pv: [], complete: true };
        } else if (cache.has(node.fen)) {
          entry = cache.get(node.fen);
        } else {
          entry = await this.analyzeReviewFen(node.fen, depth);
          cache.set(node.fen, entry);
        }
        evaluations.push(entry);
        if (!node.analysis?.depth || !entry.depth || entry.depth >= node.analysis.depth) {
          node.analysis = entry;
        }
        this.renderReviewProgress(index + 1, path.length, depth);
      }

      report = summarizeGameReview(path, evaluations, { depth, final: true });
      report.result = this.getGameResult();
      report.feedback = buildFallbackFeedback(report);
      this.gameReviewReport = report;
      this.savedGameReview = report;
      this.liveAccuracyReport = report;
      this.updateAccuracyDisplay();
      this.persistCurrentGame();
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (this.feedbackDialog.open) {
          this.renderReviewProgress(0, 1, depth, 'Analyse abgebrochen. Deine Partie bleibt unverändert.');
        }
      } else {
        console.error('[ChessApp] Partieanalyse fehlgeschlagen', error);
        if (this.feedbackBodyEl) {
          this.feedbackBodyEl.textContent = error?.message || 'Die Partieanalyse ist fehlgeschlagen.';
        }
      }
    } finally {
      try { this.reviewEngine?.quit?.(); } catch {}
      this.reviewEngine = null;
      this.reviewPendingSearch = null;
      this.reviewRunning = false;
      this.feedbackCancelButton.textContent = 'Schließen';
      this.updateFeedbackAvailability();
      if (!this.destroyed) this.evaluateCurrentPosition();
    }

    if (!report || this.reviewCancelled) return;
    this.renderFeedbackReport(report, report.feedback, { coachPending: true });

    try {
      const feedback = await this.requestCoachGameFeedback(report, path);
      if (feedback && this.gameReviewReport === report) {
        report.feedback = feedback;
        this.savedGameReview = report;
        this.persistCurrentGame();
        this.renderFeedbackReport(report, feedback);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        this.renderFeedbackReport(report, report.feedback, {
          coachNote: 'Der KI-Coach ist gerade nicht verfügbar; die lokale Stockfish-Auswertung ist vollständig.',
        });
      }
    }
  }

  async requestCoachGameFeedback(report, path) {
    this.reviewCoachController?.abort();
    this.reviewCoachController = new AbortController();
    const payload = {
      message: 'Formuliere auf Basis der gelieferten Engine-Statistik eine abschließende, motivierende Partieanalyse mit Stärken, kritischen Momenten und einem konkreten Trainingsfokus.',
      fen: path.at(-1)?.fen || '',
      evalPawns: null,
      suggestions: [],
      history: path.slice(1).map((node) => node.move?.san).filter(Boolean),
      conversation: [],
      gameReview: {
        overallAccuracy: report.overallAccuracy,
        whiteAccuracy: report.whiteAccuracy,
        blackAccuracy: report.blackAccuracy,
        averageCentipawnLoss: report.averageCentipawnLoss,
        analyzedMoves: report.analyzedMoves,
        totalMoves: report.totalMoves,
        depth: report.depth,
        counts: report.counts,
        criticalMoments: report.criticalMoments.map((move) => ({
          move: `${move.moveNumber}${move.color === 'b' ? '…' : '.'} ${move.san}`,
          color: move.color,
          bestMove: move.bestSan,
          quality: MOVE_QUALITY[move.quality]?.label || move.quality,
          lossCp: move.lossCp,
          accuracy: move.accuracy,
        })),
      },
    };
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: this.reviewCoachController.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const body = await response.json();
    return typeof body?.reply === 'string' ? body.reply.trim() : '';
  }

  renderFeedbackReport(report, feedback, { coachPending = false, coachNote = '' } = {}) {
    if (!this.feedbackBodyEl) return;
    this.feedbackBodyEl.replaceChildren();

    const lead = document.createElement('div');
    lead.className = 'review-lead';
    const overall = document.createElement('div');
    overall.className = 'review-score';
    overall.textContent = Number.isFinite(report.overallAccuracy)
      ? `${report.overallAccuracy.toFixed(1)} %`
      : '—';
    lead.appendChild(overall);
    const leadCopy = document.createElement('div');
    const leadTitle = document.createElement('strong');
    leadTitle.textContent = 'Geschätzte Engine-Genauigkeit';
    leadCopy.appendChild(leadTitle);
    const coverage = document.createElement('span');
    coverage.textContent = `${report.analyzedMoves}/${report.totalMoves} Züge · Tiefe ${report.depth || '—'}`;
    leadCopy.appendChild(coverage);
    lead.appendChild(leadCopy);
    this.feedbackBodyEl.appendChild(lead);

    const metrics = document.createElement('div');
    metrics.className = 'review-metrics';
    [
      ['Weiß', report.whiteAccuracy, report.whiteAverageCentipawnLoss],
      ['Schwarz', report.blackAccuracy, report.blackAverageCentipawnLoss],
      ['Ø Verlust', null, report.averageCentipawnLoss],
    ].forEach(([label, accuracy, loss]) => {
      const card = document.createElement('div');
      card.className = 'review-metric';
      const title = document.createElement('span');
      title.textContent = label;
      const value = document.createElement('strong');
      value.textContent = Number.isFinite(accuracy)
        ? `${accuracy.toFixed(1)} %`
        : Number.isFinite(loss)
          ? `${loss.toFixed(1)} cp`
          : '—';
      const detail = document.createElement('small');
      detail.textContent = Number.isFinite(accuracy) && Number.isFinite(loss)
        ? `Ø ${loss.toFixed(1)} cp Verlust`
        : 'über alle analysierten Züge';
      card.append(title, value, detail);
      metrics.appendChild(card);
    });
    this.feedbackBodyEl.appendChild(metrics);

    const qualityHeading = document.createElement('h3');
    qualityHeading.textContent = 'Zugqualität';
    this.feedbackBodyEl.appendChild(qualityHeading);
    const qualities = document.createElement('div');
    qualities.className = 'quality-grid';
    Object.entries(MOVE_QUALITY).forEach(([key, value]) => {
      const item = document.createElement('div');
      item.className = `quality-count quality-${value.tone}`;
      const number = document.createElement('strong');
      number.textContent = String(report.counts?.[key] || 0);
      const label = document.createElement('span');
      label.textContent = value.shortLabel;
      item.append(number, label);
      qualities.appendChild(item);
    });
    this.feedbackBodyEl.appendChild(qualities);

    if (report.criticalMoments?.length > 0) {
      const criticalHeading = document.createElement('h3');
      criticalHeading.textContent = 'Kritische Momente';
      this.feedbackBodyEl.appendChild(criticalHeading);
      const list = document.createElement('div');
      list.className = 'critical-list';
      report.criticalMoments.forEach((move) => {
        const item = document.createElement('div');
        item.className = 'critical-move';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${move.moveNumber}${move.color === 'b' ? '…' : '.'} ${move.san}`;
        const description = document.createElement('span');
        const quality = MOVE_QUALITY[move.quality]?.label || move.quality;
        description.textContent = `${quality} · ${(move.lossCp / 100).toFixed(2)} Bauerneinheiten${move.bestSan ? ` · Besser: ${move.bestSan}` : ''}`;
        copy.append(title, description);
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'secondary-button';
        jump.textContent = 'Stellung';
        jump.addEventListener('click', () => {
          this.feedbackDialog.close();
          this.jumpToFen(move.fenAfter);
        });
        item.append(copy, jump);
        list.appendChild(item);
      });
      this.feedbackBodyEl.appendChild(list);
    }

    const coachHeading = document.createElement('h3');
    coachHeading.textContent = 'Abschlussfeedback';
    this.feedbackBodyEl.appendChild(coachHeading);
    const coach = document.createElement('div');
    coach.className = 'final-feedback';
    const displayFeedback = (feedback || buildFallbackFeedback(report))
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*-\s+/gm, '• ');
    renderChatMarkup(coach, displayFeedback);
    this.feedbackBodyEl.appendChild(coach);
    if (coachPending || coachNote) {
      const status = document.createElement('p');
      status.className = 'coach-review-status';
      status.textContent = coachPending
        ? 'Der Coach formuliert noch eine persönliche Zusammenfassung …'
        : coachNote;
      this.feedbackBodyEl.appendChild(status);
    }
  }

  createAccountPanel() {
    const slot = document.getElementById('account-slot');
    if (!slot) return;
    this.accountButton = document.createElement('button');
    this.accountButton.type = 'button';
    this.accountButton.className = 'account-button';
    this.accountButton.setAttribute('aria-haspopup', 'dialog');
    this.accountButton.addEventListener('click', () => this.openAccountDialog());
    slot.appendChild(this.accountButton);

    const dialog = document.createElement('dialog');
    dialog.id = 'account-dialog';
    dialog.className = 'modal-dialog account-dialog';
    dialog.setAttribute('aria-labelledby', 'account-dialog-title');
    this.accountDialog = dialog;

    const heading = document.createElement('div');
    heading.className = 'dialog-heading';
    const title = document.createElement('div');
    title.id = 'account-dialog-title';
    title.className = 'card-title';
    title.textContent = 'Mein Account';
    heading.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dialog-close';
    close.setAttribute('aria-label', 'Account schließen');
    close.textContent = '×';
    close.addEventListener('click', () => dialog.close());
    heading.appendChild(close);
    dialog.appendChild(heading);

    this.accountBodyEl = document.createElement('div');
    this.accountBodyEl.className = 'account-body';
    dialog.appendChild(this.accountBodyEl);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const closeAction = document.createElement('button');
    closeAction.type = 'button';
    closeAction.className = 'secondary-button';
    closeAction.textContent = 'Schließen';
    closeAction.addEventListener('click', () => dialog.close());
    actions.appendChild(closeAction);
    dialog.appendChild(actions);
    dialog.addEventListener('close', () => this.accountButton?.focus());
    document.body.appendChild(dialog);
    this.updateAccountButton();
  }

  async initializeAccountIdentity() {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      if (!response.ok) return;
      const identity = await response.json();
      if (!identity?.authenticated || !identity.user?.email) return;
      const profile = {
        email: identity.user.email,
        name: identity.user.name,
        source: 'sites',
      };
      const nextKey = storageKeyForIdentity(profile);
      const previousGames = this.accountState?.games || [];
      const nextState = loadAccountState(this.browserStorage, nextKey, profile);
      if (nextState.games.length === 0 && previousGames.length > 0) {
        nextState.games = previousGames;
      }
      this.accountIdentity = profile;
      this.accountStorageKey = nextKey;
      this.accountState = nextState;
      this.activeGameDeletedExternally = false;
      saveAccountState(this.browserStorage, this.accountStorageKey, this.accountState);
      this.updateAccountButton();
      if (this.accountDialog?.open) this.renderAccountDialog();
    } catch {
      // Auf localhost bleibt das lokale Profil aktiv.
    }
  }

  updateAccountButton() {
    if (!this.accountButton) return;
    const profile = this.accountState?.profile || createAccountState().profile;
    const initial = (profile.name || profile.email || 'A').trim().slice(0, 1).toUpperCase();
    this.accountButton.replaceChildren();
    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = initial;
    const copy = document.createElement('span');
    copy.className = 'account-button-copy';
    const label = document.createElement('strong');
    label.textContent = profile.source === 'sites' ? profile.name : 'Mein Account';
    const detail = document.createElement('small');
    const count = this.accountState?.games?.length || 0;
    detail.textContent = `${count} ${count === 1 ? 'Partie' : 'Partien'}`;
    copy.append(label, detail);
    this.accountButton.append(avatar, copy);
  }

  openAccountDialog() {
    if (!this.accountDialog || this.accountDialog.open) return;
    this.stopSuggestionPreview();
    this.renderAccountDialog();
    this.accountDialog.showModal();
  }

  renderAccountDialog() {
    if (!this.accountBodyEl) return;
    this.accountBodyEl.replaceChildren();
    const profile = this.accountState?.profile || createAccountState().profile;

    const profileCard = document.createElement('div');
    profileCard.className = 'account-profile-card';
    const profileTitle = document.createElement('strong');
    profileTitle.textContent = profile.name || 'Schachspieler';
    const profileDetail = document.createElement('span');
    profileDetail.textContent = profile.source === 'sites'
      ? profile.email
      : 'Lokales Profil auf diesem Gerät';
    profileCard.append(profileTitle, profileDetail);
    this.accountBodyEl.appendChild(profileCard);

    if (profile.source !== 'sites') {
      const localForm = document.createElement('div');
      localForm.className = 'local-profile-form';
      const label = document.createElement('label');
      label.htmlFor = 'local-profile-name';
      label.textContent = 'Anzeigename';
      const input = document.createElement('input');
      input.id = 'local-profile-name';
      input.value = profile.name === 'Lokales Profil' ? '' : profile.name;
      input.placeholder = 'Dein Name';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'secondary-button';
      save.textContent = 'Name speichern';
      save.addEventListener('click', () => {
        const name = input.value.trim().slice(0, 80);
        if (!name) return;
        this.accountState.profile.name = name;
        saveAccountState(this.browserStorage, this.accountStorageKey, this.accountState);
        this.updateAccountButton();
        this.renderAccountDialog();
      });
      localForm.append(label, input, save);
      this.accountBodyEl.appendChild(localForm);
    }

    const storageNote = document.createElement('p');
    storageNote.className = 'account-storage-note';
    storageNote.textContent = profile.source === 'sites'
      ? 'Du bist über Sites angemeldet. Partien werden in dieser Version automatisch in diesem Browser gespeichert.'
      : 'Partien werden automatisch in diesem Browser gespeichert und bleiben nach dem Neuladen erhalten.';
    this.accountBodyEl.appendChild(storageNote);

    const saveCurrent = document.createElement('button');
    saveCurrent.type = 'button';
    saveCurrent.className = 'primary-action-button account-save-button';
    saveCurrent.textContent = 'Aktuelle Partie jetzt speichern';
    saveCurrent.disabled = this.getCurrentPath().length < 2;
    saveCurrent.addEventListener('click', () => {
      if (this.persistCurrentGame({ notify: true })) this.renderAccountDialog();
    });
    this.accountBodyEl.appendChild(saveCurrent);

    const gamesHeading = document.createElement('div');
    gamesHeading.className = 'account-section-title';
    gamesHeading.textContent = 'Gespeicherte Partien';
    this.accountBodyEl.appendChild(gamesHeading);

    const games = this.accountState?.games || [];
    if (games.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Noch keine Partie gespeichert.';
      this.accountBodyEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'saved-games-list';
    games.forEach((game) => {
      const item = document.createElement('div');
      item.className = 'saved-game';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = game.title;
      const detail = document.createElement('span');
      let date = game.updatedAt;
      try {
        date = new Intl.DateTimeFormat('de-DE', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(game.updatedAt));
      } catch {}
      detail.textContent = `${date} · ${game.plyCount} Halbzüge · ${game.result}`;
      copy.append(title, detail);

      const itemActions = document.createElement('div');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary-button';
      open.textContent = 'Öffnen';
      open.addEventListener('click', () => this.openSavedGame(game));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger-button';
      remove.textContent = 'Löschen';
      remove.addEventListener('click', () => this.deleteSavedGame(game));
      itemActions.append(open, remove);
      item.append(copy, itemActions);
      list.appendChild(item);
    });
    this.accountBodyEl.appendChild(list);
  }

  makeSavedGameTitle(path) {
    const moves = path.slice(1, 7).map((node) => node.move?.san).filter(Boolean).join(' ');
    const date = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    return moves ? `${moves} · ${date}` : `Partie · ${date}`;
  }

  persistCurrentGame({ notify = false } = {}) {
    const path = this.getCurrentPath();
    if (path.length < 2 || !this.moveTree) return false;
    if (this.activeGameDeletedExternally) {
      if (notify) {
        this.showToast(
          'Diese Partie wurde in einem anderen Tab gelöscht. Starte eine neue Partie, um wieder zu speichern.',
        );
      }
      return false;
    }
    const latestState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      this.accountState?.profile,
    );
    try {
      this.accountState = mergeAccountStates(this.accountState, latestState);
    } catch (error) {
      this.showToast(error?.message || 'Die gespeicherten Partien konnten nicht zusammengeführt werden.');
      return false;
    }
    if (this.accountState.deletedGames?.some(
      (deletion) => deletion.id === this.activeGameId,
    )) {
      this.activeGameDeletedExternally = true;
      this.showToast(
        'Diese Partie wurde in einem anderen Tab gelöscht und wird nicht erneut gespeichert.',
      );
      return false;
    }
    const existing = this.accountState?.games?.find((game) => game.id === this.activeGameId);
    const now = new Date().toISOString();
    try {
      const record = {
        id: this.activeGameId,
        title: existing?.title || this.makeSavedGameTitle(path),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        result: this.getGameResult(),
        plyCount: path.length - 1,
        currentFen: this.currentNode.fen,
        currentPath: nodePathFromRoot(this.currentNode),
        pgn: moveTreeToPgn(this.moveTree),
        tree: serializeMoveTree(this.moveTree),
        review: this.gameReviewReport || this.savedGameReview,
      };
      this.accountState = upsertSavedGame(this.accountState, record);
    } catch (error) {
      this.showToast(error?.message || 'Die Partie konnte nicht gespeichert werden.');
      return false;
    }
    const saved = saveAccountState(this.browserStorage, this.accountStorageKey, this.accountState);
    this.updateAccountButton();
    if (!saved && !this.storageWarningShown) {
      this.storageWarningShown = true;
      this.showToast('Der Browser konnte die Partie nicht dauerhaft speichern.');
    } else if (saved && notify) {
      this.showToast('Partie gespeichert.');
    }
    return saved;
  }

  openSavedGame(record) {
    if (!record?.tree) return;
    this.persistCurrentGame();
    this.cancelFullGameReview();
    this.stopSuggestionPreview();
    try {
      const root = deserializeMoveTree(record.tree);
      if (!root) throw new Error('Ungültiger Spielstand.');
      const canUseStoredPath = Array.isArray(record.currentPath)
        && (record.currentPath.length > 0 || record.currentFen === root.fen);
      const node = (canUseStoredPath ? findNodeByPath(root, record.currentPath) : null)
        || findNodeByFen(root, record.currentFen)
        || root;
      const game = new Chess();
      game.load(node.fen);
      this.moveTree = root;
      this.currentNode = node;
      this.game = game;
      this.activeGameId = record.id;
      this.activeGameDeletedExternally = false;
      this.gameReviewReport = record.review || null;
      this.savedGameReview = record.review || null;
      this.liveAccuracyReport = record.review || null;
      this.board.position(node.fen, false);
      this.renderMoveList();
      this.updateGameStatus();
      this.updateAccuracyDisplay();
      this.evaluateCurrentPosition();
      this.accountDialog?.close();
      this.showToast('Gespeicherte Partie geöffnet.');
    } catch (error) {
      console.error('[ChessApp] Gespeicherte Partie ungültig', error);
      this.showToast('Diese gespeicherte Partie konnte nicht geöffnet werden.');
    }
  }

  deleteSavedGame(record) {
    if (!record?.id) return;
    const confirmed = window.confirm(`„${record.title}“ wirklich löschen?`);
    if (!confirmed) return;
    this.accountState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      this.accountState?.profile,
    );
    this.accountState = removeSavedGame(this.accountState, record.id);
    saveAccountState(this.browserStorage, this.accountStorageKey, this.accountState);
    if (record.id === this.activeGameId) this.resetGame({ skipPersist: true });
    this.updateAccountButton();
    this.renderAccountDialog();
    this.showToast('Gespeicherte Partie gelöscht.');
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
    if (this.reviewRunning) return;
    this.stopSuggestionPreview();
    if (!fen) return;
    const node = findNodeByFen(this.moveTree, fen);
    if (!node) return;
    this.currentNode = node;
    this.game.load(node.fen);
    this.gameReviewReport = null;
    this.board.position(node.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
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
      this.moveArrows?.resize?.();
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
    this.updateFeedbackAvailability();
  }

  resetGame({ skipPersist = false } = {}) {
    this.cancelFullGameReview();
    this.reviewCoachController?.abort();
    this.stopSuggestionPreview();
    if (!skipPersist) this.persistCurrentGame();
    this.game.reset();
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;
    this.activeGameId = createGameId();
    this.activeGameDeletedExternally = false;
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.liveAccuracyReport = null;
    this.board.start();
    this.renderMoveList();
    this.updateGameStatus();
    this.updateAccuracyDisplay();
    this.evaluateCurrentPosition();
  }

  updateFeedbackAvailability() {
    if (!this.feedbackButton) return;
    this.feedbackButton.disabled = this.reviewRunning || !this.currentNode?.parent || !this.engine;
    this.feedbackButton.textContent = this.reviewRunning ? 'Analysiere …' : 'Partie analysieren';
  }

  handleEngineError(error) {
    console.error("[ChessApp] Engine nicht verfügbar", error);
    this.stopSuggestionPreview();
    this.engineFailed = true;
    this.engine = null;
    this.moveArrows?.clear();
    this.renderEngineUnavailable();
    this.engineInputs?.forEach((input) => {
      input.disabled = true;
    });
    this.updateFeedbackAvailability();
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
    this.persistCurrentGame();
    this.cancelFullGameReview();
    this.stopSuggestionPreview();
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.chatRequestController?.abort();
    this.reviewCoachController?.abort();
    try { this.detachKeys?.(); } catch {}
    try { this.engine?.quit(); } catch {}
    try { this.reviewEngine?.quit?.(); } catch {}
    try { this.moveArrows?.destroy?.(); } catch {}
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
    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
    }
    if (this._onStorage) {
      window.removeEventListener("storage", this._onStorage);
    }
    this.engineSettingsDialog?.remove();
    this.feedbackDialog?.remove();
    this.accountDialog?.remove();
    this.toastEl?.remove();
  }
  
}
