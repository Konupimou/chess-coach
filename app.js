import { Chess } from "chess.js";
import { MoveTreeNode, addMoveToTree, findNodeByFen } from "./moveTree.js";
import { MoveListView } from "./MoveListView.js";
import { attachKeyboard } from "./keyboard.js";
import { Engine } from "./engine.js";
import { EvalBar } from "./evalBar.js";
import { moveTreeToPgn } from "./moveTreeToPgn.js";
import { renderChatMarkup } from "./chatMarkup.js";
import {
  MOVE_ARROW_STYLES,
  MoveArrowOverlay,
  selectImpactArrowMoves,
} from "./moveArrows.js";
import {
  MOVE_QUALITY,
  analysisEntryFromInfo,
  buildFallbackFeedback,
  buildPvFrames,
  calculateMoveAccuracy,
  explainMoveQuality,
  pathToNode,
  reviewDepthForPlies,
  summarizeGameReview,
  terminalWhiteCp,
  uciToSan,
} from "./gameReview.js";
import {
  createAccountState,
  createGameId,
  deserializeMoveTree,
  findNodeByPath,
  loadAccountState,
  MAX_SAVED_GAMES,
  mergeAccountStates,
  nodePathFromRoot,
  removeSavedGame,
  saveAccountState,
  serializeMoveTree,
  storageKeyForIdentity,
  upsertSavedGame,
} from "./gameStorage.js";
import {
  lichessGameToSavedRecord,
  lichessImportability,
} from "./lichessImport.js";
import {
  createGameSaveDraft,
  inferOpeningFromPath,
  RESULT_LABELS,
  TIME_FORMAT_LABELS,
} from "./gameMetadata.js";
import { buildPlayerProfile } from "./playerProfile.js";
import {
  describeLiveMove,
  engineOpponentLabel,
  ENGINE_LEVELS,
  nextStrongMoveStreak,
  normalizeEngineLevel,
  resolvePlayerColor,
} from "./playMode.js";

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
          onBestMove: (result) => this.handleEngineBestMove(result),
          onReady: () => this.handleEngineReady(),
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
    this.engineReady = false;
    this.appMode = "play";
    this.playSession = {
      active: false,
      colorPreference: "random",
      playerColor: "w",
      engineColor: "b",
      level: "medium",
      liveFeedback: true,
      phase: "idle",
      generation: 0,
      expectedFen: null,
      expectedSearchId: null,
      lastFeedbackPly: 0,
      feedbackHistory: [],
      coachMessages: [],
      coachBusy: false,
      coachQueue: [],
      streak: 0,
      bestStreak: 0,
    };
    this.game = new Chess();
    this.declaredGameResult = null;
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;

    this.board = window.Chessboard("board", {
      position: this.currentNode.fen,
      draggable: true,
      pieceTheme: "./libs/img/{piece}.png",
      onDragStart: (source, piece) => this.handleDragStart(source, piece),
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
      onJump: (fen) => this.jumpToFen(fen),
      onPreview: (fen, element) => this.startMoveListPreview(fen, element),
      onPreviewEnd: (_fen, element) => this.stopMoveListPreview(element),
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
    this.coachConfigured = null;
    this.lastEvalPawns = null;
    this.chatRequestController = null;
    this.playCoachController = null;
    this.suggestionCoachController = null;
    this.suggestionCoachTimer = null;
    this.suggestionCoachKey = "";
    this.suggestionCoachReasons = new Map();
    this.suggestionCoachBusy = false;
    this.previewState = null;
    this.moveListPreviewState = null;
    this.previewTimer = null;
    this.previewToken = 0;
    this.suggestionsDirtyDuringPreview = false;
    this.reviewRunning = false;
    this.reviewEngine = null;
    this.reviewPendingSearch = null;
    this.reviewCancelled = false;
    this.batchReviewRunning = false;
    this.batchReviewCancelled = false;
    this.batchReviewProgress = null;
    this.batchReviewSummary = null;
    this.batchReviewEngines = new Set();
    this.batchCoachControllers = new Set();
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.engineSettingsOpen = false;
    this.modalKeyHandler = null;
    this.activeGameId = createGameId();
    this.activeGameDeletedExternally = false;
    this.activeGamePersisted = false;
    this.gameDirty = false;
    this.loadedRecordUpdatedAt = null;
    this.gameSaveDraft = createGameSaveDraft();
    this.gameSaveDraftDirty = false;
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
    this.lichessConnection = {
      loading: true,
      connected: false,
      user: null,
      error: "",
    };
    this.lichessFetchedGames = [];
    this.lichessImportBusy = false;

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
    this.boardStack = boardStack;

    let boardRow = document.getElementById("board-row");
    if (!boardRow) {
      boardRow = document.createElement("div");
      boardRow.id = "board-row";
      boardRow.className = "board-row";
      boardStack.appendChild(boardRow);
    }
    this.boardRow = boardRow;
    let boardSurface = document.getElementById("board-surface");
    if (!boardSurface) {
      boardSurface = document.createElement("div");
      boardSurface.id = "board-surface";
      boardSurface.className = "board-surface";
    }
    boardSurface.appendChild(boardEl);
    boardRow.appendChild(boardSurface);
    this.setupBoardKeyboard(boardEl, boardSurface);
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
    this.boardContainer = wrap;
    this.boardStage = document.getElementById("app");
    this.boardSurface = boardSurface;
    this.playModeButton = document.getElementById("play-mode-button");
    this.analysisModeButton = document.getElementById("analysis-mode-button");
    this.moveListSection = document.querySelector(".move-list-section");
    this.moveListEyebrow = document.getElementById("move-list-eyebrow");
    this.moveListTitle = document.getElementById("move-list-title");
    this.keyboardHint = document.getElementById("keyboard-hint");

    const engineAvailable = this.ensureEngine();

    this.evalBar = new EvalBar({ parentEl: boardRow, width: 32, height: null });
    this.scheduleBoardResize();

    const boardToolbar = document.createElement("div");
    boardToolbar.className = "board-toolbar";
    this.boardToolbar = boardToolbar;

    const statusGroup = document.createElement("div");
    statusGroup.className = "board-status-group";
    this.gameStatusEl = document.createElement("div");
    this.gameStatusEl.className = "game-status";
    this.gameStatusEl.setAttribute("role", "status");
    this.gameStatusEl.setAttribute("aria-live", "polite");
    statusGroup.appendChild(this.gameStatusEl);
    this.accuracyEl = document.createElement("div");
    this.accuracyEl.className = "accuracy-chip is-pending";
    this.accuracyEl.setAttribute("role", "status");
    this.accuracyEl.setAttribute("aria-live", "polite");
    const accuracyLabel = document.createElement("span");
    accuracyLabel.className = "accuracy-chip-label";
    accuracyLabel.textContent = "Genauigkeit";
    this.accuracyLabelEl = accuracyLabel;
    this.accuracyEl.appendChild(accuracyLabel);
    const createAccuracySide = (label, color) => {
      const side = document.createElement("span");
      side.className = "accuracy-side";
      const marker = document.createElement("span");
      marker.className = `accuracy-side-marker is-${color}`;
      marker.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("strong");
      value.textContent = "—";
      side.append(marker, name, value);
      this.accuracyEl.appendChild(side);
      if (color === "white") this.whiteAccuracySideEl = side;
      if (color === "black") this.blackAccuracySideEl = side;
      return value;
    };
    this.whiteAccuracyEl = createAccuracySide("Weiß", "white");
    this.blackAccuracyEl = createAccuracySide("Schwarz", "black");
    this.accuracyModeEl = document.createElement("span");
    this.accuracyModeEl.className = "accuracy-mode";
    this.accuracyEl.appendChild(this.accuracyModeEl);
    this.accuracyEl.setAttribute(
      "aria-label",
      "Genauigkeit: Weiß noch nicht berechnet, Schwarz noch nicht berechnet",
    );
    this.accuracyEl.title = "Wird aus den Engine-Bewertungen der gespielten Züge berechnet.";
    statusGroup.appendChild(this.accuracyEl);
    this.saveStatusEl = document.createElement("div");
    this.saveStatusEl.className = "save-status is-unsaved";
    this.saveStatusEl.setAttribute("role", "status");
    this.saveStatusEl.setAttribute("aria-live", "polite");
    this.saveStatusEl.textContent = "Noch nicht gespeichert";
    statusGroup.appendChild(this.saveStatusEl);
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

    this.flipButton = document.createElement("button");
    this.flipButton.type = "button";
    this.flipButton.className = "secondary-button";
    this.flipButton.textContent = "Brett drehen";
    this.flipButton.addEventListener("click", () => {
      this.stopSuggestionPreview();
      const orientation = this.board.flip();
      this.moveArrows?.setOrientation(orientation);
      this.resetBoardKeyboardCursor();
      this.scheduleBoardResize();
    });
    boardActions.appendChild(this.flipButton);

    this.saveGameButton = document.createElement("button");
    this.saveGameButton.type = "button";
    this.saveGameButton.className = "primary-action-button save-game-button";
    this.saveGameButton.textContent = "Partie speichern";
    this.saveGameButton.setAttribute("aria-haspopup", "dialog");
    this.saveGameButton.addEventListener("click", () => this.openSaveGameDialog());
    boardActions.appendChild(this.saveGameButton);

    this.feedbackButton = document.createElement("button");
    this.feedbackButton.type = "button";
    this.feedbackButton.className = "primary-action-button";
    this.feedbackButton.textContent = "Partie analysieren";
    this.feedbackButton.disabled = true;
    this.feedbackButton.addEventListener("click", () => this.startFullGameReview());
    boardActions.appendChild(this.feedbackButton);

    this.exportButton = document.createElement("button");
    this.exportButton.type = "button";
    this.exportButton.className = "secondary-button";
    this.exportButton.textContent = "PGN";
    this.exportButton.addEventListener("click", () => this.exportPgn());
    boardActions.appendChild(this.exportButton);

    this.resetButton = document.createElement("button");
    this.resetButton.type = "button";
    this.resetButton.className = "secondary-button";
    this.resetButton.textContent = "Neue Partie";
    this.resetButton.addEventListener("click", () => {
      if (this.appMode === "play") {
        this.prepareNewEngineGame();
      } else {
        this.resetGame();
      }
    });
    boardActions.appendChild(this.resetButton);
    boardToolbar.appendChild(boardActions);
    boardStack.appendChild(boardToolbar);

    this.createPlayPanel(engineAvailable);

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
    this.chatWrapper = chatWrapper;
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
    this.createSaveGameDialog();
    this.createAccountPanel();
    this._onPlayModeClick = () => this.setAppMode("play");
    this._onAnalysisModeClick = () => this.setAppMode("analysis");
    this.playModeButton?.addEventListener("click", this._onPlayModeClick);
    this.analysisModeButton?.addEventListener("click", this._onAnalysisModeClick);

    this.detachKeys = attachKeyboard({
      onLeft: () => this.goBackOnePly(),
      onRight: () => this.goForwardOnePly(),
      onUp: () => this.cycleVariation(-1),
      onDown: () => this.cycleVariation(1)
    });

    this._onBeforeUnload = (event) => {
      if (this.hasUnsavedGameChanges()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
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
        this.activeGamePersisted = false;
        this.gameDirty = this.getCurrentPath().length > 1;
        this.updateSaveGameButton();
        this.showToast(
          'Diese Partie wurde in einem anderen Tab gelöscht. Du kannst sie über „Partie speichern“ als neue Kopie sichern.',
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
    this.updateSaveGameButton();
    this.updateModeUi();
    this.evaluateCurrentPosition();
    this.initializeAccountIdentity();
    this.initializeLichessConnection();
  }

  createPlayPanel(engineAvailable) {
    const panel = document.createElement("section");
    panel.id = "play-mode-panel";
    panel.className = "card play-mode-card";
    panel.setAttribute("aria-labelledby", "play-mode-title");
    this.playPanel = panel;

    const heading = document.createElement("div");
    heading.className = "play-mode-heading";
    const headingCopy = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Gegen die Engine";
    const title = document.createElement("h2");
    title.id = "play-mode-title";
    title.textContent = "Deine Partie";
    const description = document.createElement("p");
    description.textContent = "Spiele gegen Stockfish und erhalte direkt nach deinen Zügen ein klares Feedback.";
    headingCopy.append(eyebrow, title, description);
    const engineBadge = document.createElement("span");
    engineBadge.className = "play-engine-badge";
    engineBadge.textContent = !engineAvailable
      ? "Engine nicht verfügbar"
      : this.engineReady
        ? "Stockfish bereit"
        : "Stockfish wird geladen …";
    this.playEngineBadgeEl = engineBadge;
    heading.append(headingCopy, engineBadge);
    panel.appendChild(heading);

    this.playEmptyView = document.createElement("div");
    this.playEmptyView.className = "play-empty-state";
    const emptyTitle = document.createElement("h3");
    emptyTitle.textContent = "Neue Engine-Partie starten";
    const emptyText = document.createElement("p");
    emptyText.textContent = "Wähle deine Farbe, die Schwierigkeit und ob der Live-Coach deine Züge bewerten soll.";
    const benefits = document.createElement("ul");
    [
      "Du bewegst ausschließlich deine eigenen Figuren.",
      "Keine Lösung wird vor deinem Zug eingeblendet.",
      "Gespeichert wird weiterhin nur nach deinem Klick.",
    ].forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      benefits.appendChild(item);
    });
    this.playStartButton = document.createElement("button");
    this.playStartButton.type = "button";
    this.playStartButton.className = "primary-action-button play-start-button";
    this.playStartButton.textContent = "Partie einrichten";
    this.playStartButton.disabled = !engineAvailable || !this.engineReady;
    this.playStartButton.addEventListener("click", () => this.openPlaySetupDialog(
      this.playStartButton,
    ));
    this.playEmptyView.append(emptyTitle, emptyText, benefits, this.playStartButton);
    panel.appendChild(this.playEmptyView);

    this.playActiveView = document.createElement("div");
    this.playActiveView.className = "play-active-view";
    this.playActiveView.hidden = true;

    const summary = document.createElement("div");
    summary.className = "play-session-summary";
    this.playColorSummaryEl = document.createElement("span");
    this.playLevelSummaryEl = document.createElement("span");
    summary.append(this.playColorSummaryEl, this.playLevelSummaryEl);
    this.playActiveView.appendChild(summary);

    this.playTurnStatusEl = document.createElement("div");
    this.playTurnStatusEl.className = "play-turn-status";
    this.playActiveView.appendChild(this.playTurnStatusEl);

    this.playStreakEl = document.createElement("section");
    this.playStreakEl.className = "play-streak board-streak";
    this.playStreakEl.hidden = true;
    this.playStreakEl.title = "Beste und sehr gute Züge füllen den Streak.";
    const streakHeading = document.createElement("div");
    streakHeading.className = "play-streak-heading";
    const streakTitle = document.createElement("strong");
    streakTitle.textContent = "Streak";
    this.playStreakValueEl = document.createElement("span");
    streakHeading.append(streakTitle, this.playStreakValueEl);
    this.playStreakTrackEl = document.createElement("div");
    this.playStreakTrackEl.className = "play-streak-track";
    this.playStreakTrackEl.setAttribute("role", "progressbar");
    this.playStreakTrackEl.setAttribute("aria-label", "Starke Züge in Folge");
    this.playStreakTrackEl.setAttribute("aria-valuemin", "0");
    this.playStreakTrackEl.setAttribute("aria-valuemax", "5");
    this.playStreakFillEl = document.createElement("span");
    this.playStreakTrackEl.appendChild(this.playStreakFillEl);
    const streakHint = document.createElement("small");
    streakHint.textContent = "Beste und sehr gute Züge füllen den Balken.";
    this.playStreakEl.append(streakHeading, this.playStreakTrackEl, streakHint);
    this.boardRow?.appendChild(this.playStreakEl);

    const liveCoach = document.createElement("section");
    liveCoach.className = "live-coach";
    const liveHeading = document.createElement("div");
    liveHeading.className = "live-coach-heading";
    const liveTitle = document.createElement("h3");
    liveTitle.textContent = "Live-Coach";
    const liveSwitch = document.createElement("label");
    liveSwitch.className = "live-feedback-switch";
    this.playLiveFeedbackInput = document.createElement("input");
    this.playLiveFeedbackInput.type = "checkbox";
    this.playLiveFeedbackInput.setAttribute("role", "switch");
    this.playLiveFeedbackInput.checked = true;
    this.playLiveFeedbackInput.addEventListener("change", () => {
      this.playSession.liveFeedback = this.playLiveFeedbackInput.checked;
      this.updateModeUi();
      this.renderPlayPanel();
    });
    const liveSwitchText = document.createElement("span");
    liveSwitchText.textContent = "Feedback";
    liveSwitch.append(this.playLiveFeedbackInput, liveSwitchText);
    liveHeading.append(liveTitle, liveSwitch);
    liveCoach.appendChild(liveHeading);

    this.playFeedbackEl = document.createElement("div");
    this.playFeedbackEl.className = "live-feedback-state is-waiting";
    this.playFeedbackEl.setAttribute("role", "status");
    this.playFeedbackEl.setAttribute("aria-live", "polite");
    this.playFeedbackBadgeEl = document.createElement("span");
    this.playFeedbackBadgeEl.className = "live-feedback-badge";
    this.playFeedbackTitleEl = document.createElement("strong");
    this.playFeedbackDetailEl = document.createElement("p");
    this.playFeedbackEl.append(
      this.playFeedbackBadgeEl,
      this.playFeedbackTitleEl,
      this.playFeedbackDetailEl,
    );
    this.playFeedbackPreviewButton = document.createElement("button");
    this.playFeedbackPreviewButton.type = "button";
    this.playFeedbackPreviewButton.className = "secondary-button live-feedback-preview";
    this.playFeedbackPreviewButton.textContent = "Coach-Zug am Brett zeigen";
    this.playFeedbackPreviewButton.hidden = true;
    this.playFeedbackPreviewButton.addEventListener("click", () => {
      const latest = this.playSession.feedbackHistory[0];
      if (latest) this.previewCoachMove(latest);
    });
    this.playFeedbackEl.appendChild(this.playFeedbackPreviewButton);
    liveCoach.appendChild(this.playFeedbackEl);

    this.playFeedbackHistoryEl = document.createElement("ol");
    this.playFeedbackHistoryEl.className = "live-feedback-history";
    liveCoach.appendChild(this.playFeedbackHistoryEl);

    this.playCoachConversationEl = document.createElement("div");
    this.playCoachConversationEl.className = "play-coach-conversation";
    liveCoach.appendChild(this.playCoachConversationEl);
    const replyForm = document.createElement("div");
    replyForm.className = "play-coach-reply";
    this.playCoachInputEl = document.createElement("textarea");
    this.playCoachInputEl.rows = 2;
    this.playCoachInputEl.placeholder = "Frag nach: Warum war der Zug gut? Was sollte ich sehen?";
    this.playCoachInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.handlePlayCoachReply();
      }
    });
    this.playCoachSendButton = document.createElement("button");
    this.playCoachSendButton.type = "button";
    this.playCoachSendButton.className = "secondary-button";
    this.playCoachSendButton.textContent = "Coach fragen";
    this.playCoachSendButton.addEventListener("click", () => this.handlePlayCoachReply());
    replyForm.append(this.playCoachInputEl, this.playCoachSendButton);
    liveCoach.appendChild(replyForm);
    this.playActiveView.appendChild(liveCoach);

    const actions = document.createElement("div");
    actions.className = "play-session-actions";
    this.playSaveAction = document.createElement("button");
    this.playSaveAction.type = "button";
    this.playSaveAction.className = "primary-action-button";
    this.playSaveAction.textContent = "Partie speichern";
    this.playSaveAction.addEventListener("click", () => this.openSaveGameDialog(
      this.playSaveAction,
    ));
    this.playAnalyzeAction = document.createElement("button");
    this.playAnalyzeAction.type = "button";
    this.playAnalyzeAction.className = "secondary-button";
    this.playAnalyzeAction.textContent = "Beenden & analysieren";
    this.playAnalyzeAction.addEventListener("click", () => this.finishPlayAndAnalyze());
    this.playResignAction = document.createElement("button");
    this.playResignAction.type = "button";
    this.playResignAction.className = "danger-button";
    this.playResignAction.textContent = "Aufgeben";
    this.playResignAction.addEventListener("click", () => this.resignEngineGame());
    actions.append(this.playSaveAction, this.playAnalyzeAction, this.playResignAction);
    this.playActiveView.appendChild(actions);
    panel.appendChild(this.playActiveView);

    this.analysisColumn.appendChild(panel);
    this.playMobileFeedbackEl = document.createElement("div");
    this.playMobileFeedbackEl.className = "play-mobile-feedback is-waiting";
    this.playMobileFeedbackEl.setAttribute("aria-hidden", "true");
    this.playMobileFeedbackTitleEl = document.createElement("strong");
    this.playMobileFeedbackDetailEl = document.createElement("span");
    this.playMobileFeedbackEl.append(
      this.playMobileFeedbackTitleEl,
      this.playMobileFeedbackDetailEl,
    );
    this.boardStack?.insertBefore(this.playMobileFeedbackEl, this.boardToolbar || null);
    this.createPlaySetupDialog(engineAvailable);
    this.renderPlayPanel();
  }

  createPlaySetupDialog(engineAvailable) {
    const dialog = document.createElement("dialog");
    dialog.id = "play-setup-dialog";
    dialog.className = "modal-dialog play-setup-dialog";
    dialog.setAttribute("aria-labelledby", "play-setup-title");
    dialog.setAttribute("aria-describedby", "play-setup-description");
    this.playSetupDialog = dialog;

    const heading = document.createElement("div");
    heading.className = "dialog-heading";
    const title = document.createElement("div");
    title.id = "play-setup-title";
    title.className = "card-title";
    title.textContent = "Neue Partie gegen die Engine";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", "Partieeinrichtung schließen");
    close.textContent = "×";
    close.addEventListener("click", () => dialog.close());
    heading.append(title, close);
    dialog.appendChild(heading);

    const description = document.createElement("p");
    description.id = "play-setup-description";
    description.className = "dialog-description";
    description.textContent = "Wähle deine Seite und ein Trainingsniveau. Die Spielstärke gilt nur für diese Partie.";
    dialog.appendChild(description);

    const form = document.createElement("form");
    form.className = "play-setup-form";
    this.playSetupForm = form;

    const colorGroup = document.createElement("fieldset");
    colorGroup.className = "play-option-group";
    const colorLegend = document.createElement("legend");
    colorLegend.textContent = "Deine Farbe";
    colorGroup.appendChild(colorLegend);
    const colorGrid = document.createElement("div");
    colorGrid.className = "play-color-options";
    [
      { value: "w", label: "Weiß", detail: "Du beginnst" },
      { value: "random", label: "Zufällig", detail: "wird ausgelost" },
      { value: "b", label: "Schwarz", detail: "Engine beginnt" },
    ].forEach(({ value, label, detail }) => {
      const option = document.createElement("label");
      option.className = "play-option-card";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "playerColor";
      input.value = value;
      input.checked = value === "random";
      const copy = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = label;
      const small = document.createElement("small");
      small.textContent = detail;
      copy.append(strong, small);
      option.append(input, copy);
      colorGrid.appendChild(option);
    });
    colorGroup.appendChild(colorGrid);
    form.appendChild(colorGroup);

    const levelGroup = document.createElement("fieldset");
    levelGroup.className = "play-option-group";
    const levelLegend = document.createElement("legend");
    levelLegend.textContent = "Schwierigkeit";
    levelGroup.appendChild(levelLegend);
    const levelGrid = document.createElement("div");
    levelGrid.className = "play-level-options";
    Object.entries(ENGINE_LEVELS).forEach(([value, level]) => {
      const option = document.createElement("label");
      option.className = "play-option-card";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "engineLevel";
      input.value = value;
      input.checked = value === "medium";
      const copy = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = level.label;
      const small = document.createElement("small");
      small.textContent = level.description;
      copy.append(strong, small);
      option.append(input, copy);
      levelGrid.appendChild(option);
    });
    levelGroup.appendChild(levelGrid);
    form.appendChild(levelGroup);

    const feedbackOption = document.createElement("label");
    feedbackOption.className = "play-feedback-option";
    this.playSetupFeedbackInput = document.createElement("input");
    this.playSetupFeedbackInput.type = "checkbox";
    this.playSetupFeedbackInput.name = "liveFeedback";
    this.playSetupFeedbackInput.setAttribute("role", "switch");
    this.playSetupFeedbackInput.checked = true;
    const feedbackCopy = document.createElement("span");
    const feedbackTitle = document.createElement("strong");
    feedbackTitle.textContent = "Live-Feedback anzeigen";
    const feedbackDetail = document.createElement("small");
    feedbackDetail.textContent = "Bewertet deinen Zug erst danach und verrät vorher keine Lösung.";
    feedbackCopy.append(feedbackTitle, feedbackDetail);
    feedbackOption.append(this.playSetupFeedbackInput, feedbackCopy);
    form.appendChild(feedbackOption);

    if (!engineAvailable) {
      const unavailable = document.createElement("p");
      unavailable.className = "error-text";
      unavailable.textContent = "Stockfish konnte nicht gestartet werden. Bitte lade die Seite neu.";
      form.appendChild(unavailable);
    }

    const actions = document.createElement("div");
    actions.className = "dialog-actions play-setup-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Abbrechen";
    cancel.addEventListener("click", () => dialog.close());
    this.playSetupSubmitButton = document.createElement("button");
    this.playSetupSubmitButton.type = "submit";
    this.playSetupSubmitButton.className = "primary-action-button";
    this.playSetupSubmitButton.textContent = "Partie starten";
    this.playSetupSubmitButton.disabled = !engineAvailable || !this.engineReady;
    actions.append(cancel, this.playSetupSubmitButton);
    form.appendChild(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const started = this.startEngineGame({
        colorPreference: data.get("playerColor"),
        level: data.get("engineLevel"),
        liveFeedback: this.playSetupFeedbackInput.checked,
      });
      if (started) dialog.close();
    });
    dialog.appendChild(form);
    dialog.addEventListener("close", () => this.playSetupReturnFocus?.focus?.());
    document.body.appendChild(dialog);
  }

  openPlaySetupDialog(returnFocus = this.playStartButton) {
    if (!this.playSetupDialog || this.playSetupDialog.open) return;
    const color = this.playSession.colorPreference || "random";
    const level = normalizeEngineLevel(this.playSession.level);
    this.playSetupForm?.querySelectorAll('input[name="playerColor"]').forEach((input) => {
      input.checked = input.value === color;
    });
    this.playSetupForm?.querySelectorAll('input[name="engineLevel"]').forEach((input) => {
      input.checked = input.value === level;
    });
    if (this.playSetupFeedbackInput) {
      this.playSetupFeedbackInput.checked = this.playSession.liveFeedback !== false;
    }
    this.playSetupReturnFocus = returnFocus;
    this.playSetupDialog.showModal();
    this.playSetupForm?.querySelector('input[name="playerColor"]:checked')?.focus();
  }

  renderPlayPanel() {
    if (!this.playPanel) return;
    const session = this.playSession;
    const active = Boolean(session.active);
    this.playEmptyView.hidden = active;
    this.playActiveView.hidden = !active;
    if (this.playStreakEl) {
      this.playStreakEl.hidden = (
        this.appMode !== "play"
        || !active
        || !session.liveFeedback
      );
    }
    if (this.playMobileFeedbackEl) {
      this.playMobileFeedbackEl.hidden = !active || this.appMode !== "play";
    }
    if (!active) return;

    const playerLabel = session.playerColor === "b" ? "Schwarz" : "Weiß";
    const engineLabel = session.engineColor === "b" ? "Schwarz" : "Weiß";
    const level = ENGINE_LEVELS[normalizeEngineLevel(session.level)];
    this.playColorSummaryEl.textContent = `Du: ${playerLabel} · Engine: ${engineLabel}`;
    this.playLevelSummaryEl.textContent = `Stufe: ${level.label}`;

    let status = "Partie wird vorbereitet …";
    if (session.phase === "player-turn") {
      status = `Du bist am Zug${this.game.isCheck() ? " · Schach" : ""}`;
    } else if (session.phase === "feedback") {
      status = "Dein Zug wird bewertet …";
    } else if (session.phase === "engine-thinking") {
      status = "Stockfish denkt …";
    } else if (session.phase === "game-over") {
      const result = this.getGameResult();
      const playerWon = (session.playerColor === "w" && result === "1-0")
        || (session.playerColor === "b" && result === "0-1");
      const engineWon = (session.engineColor === "w" && result === "1-0")
        || (session.engineColor === "b" && result === "0-1");
      status = result === "1/2-1/2"
        ? "Partie beendet · Remis"
        : playerWon
          ? "Partie beendet · Du gewinnst"
          : engineWon
            ? "Partie beendet · Stockfish gewinnt"
            : "Partie beendet";
    }
    this.playTurnStatusEl.textContent = status;

    if (this.playLiveFeedbackInput) {
      this.playLiveFeedbackInput.checked = session.liveFeedback;
    }
    if (this.playStreakEl) {
      const streak = Math.max(0, Number.parseInt(session.streak, 10) || 0);
      const goal = 5;
      const visibleStreak = Math.min(goal, streak);
      this.playStreakEl.classList.toggle("is-hot", streak >= goal);
      this.playStreakValueEl.textContent = streak >= goal
        ? `🔥 ${streak} in Folge`
        : `${streak} / ${goal}`;
      this.playStreakFillEl.style.height = `${visibleStreak / goal * 100}%`;
      this.playStreakTrackEl.setAttribute("aria-valuenow", String(visibleStreak));
      this.playStreakTrackEl.setAttribute(
        "aria-valuetext",
        `${streak} starke Züge in Folge`,
      );
    }
    const latest = session.feedbackHistory[0] || null;
    if (!session.liveFeedback) {
      this.playFeedbackEl.className = "live-feedback-state is-disabled";
      this.playFeedbackBadgeEl.textContent = "Aus";
      this.playFeedbackTitleEl.textContent = "Live-Feedback ist ausgeschaltet";
      this.playFeedbackDetailEl.textContent = "Die vollständige Auswertung bleibt nach der Partie verfügbar.";
    } else if (latest) {
      this.playFeedbackEl.className = `live-feedback-state is-${latest.tone}`;
      this.playFeedbackBadgeEl.textContent = latest.badge;
      this.playFeedbackTitleEl.textContent = latest.title;
      this.playFeedbackDetailEl.textContent = latest.detail;
    } else {
      this.playFeedbackEl.className = "live-feedback-state is-waiting";
      this.playFeedbackBadgeEl.textContent = "Bereit";
      this.playFeedbackTitleEl.textContent = session.phase === "player-turn"
        ? "Spiele deinen Zug"
        : "Der Live-Coach bereitet die Bewertung vor";
      this.playFeedbackDetailEl.textContent = "Dein Urteil erscheint hier, bevor Stockfish antwortet.";
    }
    if (this.playFeedbackPreviewButton) {
      this.playFeedbackPreviewButton.hidden = !latest?.bestUci
        || latest.bestUci === latest.playedUci;
    }
    if (this.playMobileFeedbackEl) {
      const tone = !session.liveFeedback
        ? "disabled"
        : latest?.tone || "waiting";
      this.playMobileFeedbackEl.className = `play-mobile-feedback is-${tone}`;
      this.playMobileFeedbackTitleEl.textContent = session.liveFeedback
        ? this.playFeedbackTitleEl.textContent
        : "Live-Feedback aus";
      this.playMobileFeedbackDetailEl.textContent = session.liveFeedback
        ? `${status} · ${this.playFeedbackDetailEl.textContent}`
        : status;
    }

    this.playFeedbackHistoryEl.replaceChildren();
    if (session.liveFeedback && session.feedbackHistory.length > 1) {
      session.feedbackHistory.slice(1, 5).forEach((feedback) => {
        const item = document.createElement("li");
        const badge = document.createElement("span");
        badge.className = `is-${feedback.tone}`;
        badge.textContent = feedback.badge;
        const move = document.createElement("span");
        move.textContent = feedback.title;
        item.append(badge, move);
        this.playFeedbackHistoryEl.appendChild(item);
      });
    }

    if (this.playCoachConversationEl) {
      this.playCoachConversationEl.replaceChildren();
      session.coachMessages.slice(-6).forEach((message) => {
        const bubble = document.createElement("div");
        bubble.className = `play-coach-message is-${message.role}`;
        renderChatMarkup(bubble, message.content);
        this.playCoachConversationEl.appendChild(bubble);
      });
      if (session.coachBusy) {
        const thinking = document.createElement("div");
        thinking.className = "play-coach-message is-assistant is-thinking";
        thinking.textContent = "Coach denkt nach …";
        this.playCoachConversationEl.appendChild(thinking);
      }
      this.playCoachConversationEl.scrollTop = this.playCoachConversationEl.scrollHeight;
    }
    if (this.playCoachInputEl) {
      this.playCoachInputEl.disabled = !session.active || !session.liveFeedback || session.coachBusy;
    }
    if (this.playCoachSendButton) {
      this.playCoachSendButton.disabled = !session.active || !session.liveFeedback || session.coachBusy;
    }

    const hasMoves = this.getCurrentPath().length > 1;
    const busy = ["preparing", "feedback", "engine-thinking"].includes(session.phase);
    this.playSaveAction.disabled = !hasMoves || busy || this.reviewRunning;
    this.playAnalyzeAction.disabled = !hasMoves || this.reviewRunning;
    this.playAnalyzeAction.textContent = session.phase === "game-over"
      ? "Vollständig analysieren"
      : "Beenden & analysieren";
    this.playResignAction.hidden = session.phase === "game-over";
  }

  setAppMode(mode, { force = false, silent = false } = {}) {
    const nextMode = mode === "analysis" ? "analysis" : "play";
    if (nextMode === this.appMode) {
      this.updateModeUi();
      return true;
    }
    if (this.reviewRunning) {
      this.showToast("Beende zuerst die laufende Partieanalyse.");
      return false;
    }
    if (
      nextMode === "analysis"
      && this.playSession.active
      && this.playSession.phase !== "game-over"
      && !force
    ) {
      const confirmed = window.confirm(
        "Die laufende Engine-Partie wird beendet und die aktuelle Stellung im Analysebereich geöffnet. Fortfahren?",
      );
      if (!confirmed) return false;
    }

    this.stopSuggestionPreview();
    this.engine?.cancelSearch?.();
    if (nextMode === "analysis") {
      this.cancelPlaySession();
      this.appMode = "analysis";
      this.engine?.setMultiPV?.(this.suggestionCount === 0 ? 1 : this.suggestionCount);
    } else {
      this.appMode = "play";
      this.engine?.setMultiPV?.(1);
      this.moveArrows?.clear();
    }
    this.updateModeUi();
    if (nextMode === "analysis") this.evaluateCurrentPosition();
    if (!silent) {
      this.showToast(nextMode === "analysis" ? "Analysebereich geöffnet." : "Spielbereich geöffnet.");
    }
    return true;
  }

  updateModeUi() {
    const isPlay = this.appMode === "play";
    const setModeButton = (button, active) => {
      if (!button) return;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    };
    setModeButton(this.playModeButton, isPlay);
    setModeButton(this.analysisModeButton, !isPlay);
    this.boardContainer?.classList.toggle("is-play-mode", isPlay);
    if (this.boardStage) {
      this.boardStage.setAttribute(
        "aria-label",
        isPlay ? "Partie gegen die Engine" : "Schachanalyse",
      );
    }
    if (this.playPanel) this.playPanel.hidden = !isPlay;
    if (this.suggestionsEl) this.suggestionsEl.hidden = isPlay;
    if (this.chatWrapper) this.chatWrapper.hidden = isPlay;
    if (this.evalBar?.container) this.evalBar.container.hidden = isPlay;
    if (this.engineSettingsButton) this.engineSettingsButton.hidden = isPlay;
    if (this.feedbackButton) this.feedbackButton.hidden = isPlay;
    if (this.exportButton) this.exportButton.hidden = isPlay;
    if (this.accuracyEl) {
      this.accuracyEl.hidden = isPlay && (
        !this.playSession.active
        || !this.playSession.liveFeedback
      );
    }
    if (this.accuracyLabelEl) {
      this.accuracyLabelEl.textContent = isPlay ? "Deine Genauigkeit" : "Genauigkeit";
    }
    if (this.whiteAccuracySideEl) {
      this.whiteAccuracySideEl.hidden = isPlay && this.playSession.playerColor !== "w";
    }
    if (this.blackAccuracySideEl) {
      this.blackAccuracySideEl.hidden = isPlay && this.playSession.playerColor !== "b";
    }
    [this.gameStatusEl, this.accuracyEl, this.saveStatusEl].forEach((element) => {
      element?.setAttribute("aria-live", isPlay ? "off" : "polite");
    });
    if (this.resetButton) {
      this.resetButton.textContent = isPlay ? "Neue Engine-Partie" : "Neue Analyse";
    }
    if (this.moveListEyebrow) {
      this.moveListEyebrow.textContent = isPlay ? "Partieverlauf" : "Variantenbaum";
    }
    if (this.moveListTitle) {
      this.moveListTitle.textContent = isPlay ? "Gespielte Züge" : "Zugliste";
    }
    if (this.keyboardHint) this.keyboardHint.hidden = isPlay;
    this.moveListSection?.classList.toggle("is-play-mode", isPlay);
    this.renderMoveList();
    if (isPlay) this.moveArrows?.clear();
    else this.renderMoveArrows();
    this.renderPlayPanel();
    this.updateFeedbackAvailability();
    this.updateSaveGameButton();
    this.scheduleBoardResize();
  }

  cancelPlaySession() {
    this.playSession.generation += 1;
    this.playCoachController?.abort();
    this.playCoachController = null;
    this.playSession.active = false;
    this.playSession.phase = "idle";
    this.playSession.expectedFen = null;
    this.playSession.expectedSearchId = null;
    this.engine?.cancelSearch?.();
    if (this.appMode === "play" && this.accuracyEl) this.accuracyEl.hidden = true;
    this.renderPlayPanel();
  }

  prepareNewEngineGame() {
    this.openPlaySetupDialog(this.resetButton || this.playStartButton);
  }

  startEngineGame({ colorPreference = "random", level = "medium", liveFeedback = true } = {}) {
    if (!this.engine || !this.engineReady || this.reviewRunning) {
      this.showToast("Stockfish wird noch geladen. Bitte versuche es gleich erneut.");
      return false;
    }
    if (!this.confirmDiscardUnsavedGame("eine neue Engine-Partie beginnen")) return false;

    this.resetGame({ skipDiscardPrompt: true });
    const normalizedLevel = normalizeEngineLevel(level);
    const playerColor = resolvePlayerColor(colorPreference);
    const generation = this.playSession.generation + 1;
    this.playSession = {
      active: true,
      colorPreference: ["w", "b", "random"].includes(colorPreference)
        ? colorPreference
        : "random",
      playerColor,
      engineColor: playerColor === "w" ? "b" : "w",
      level: normalizedLevel,
      liveFeedback: Boolean(liveFeedback),
      phase: playerColor === "w" ? "preparing" : "engine-thinking",
      generation,
      expectedFen: null,
      expectedSearchId: null,
      lastFeedbackPly: 0,
      feedbackHistory: [],
      coachMessages: [],
      coachBusy: false,
      coachQueue: [],
      streak: 0,
      bestStreak: 0,
    };
    this.declaredGameResult = null;
    this.gameSaveDraft = {
      ...createGameSaveDraft(),
      playerColor,
      opponent: engineOpponentLabel(normalizedLevel),
      opponentType: "engine",
      engineLevel: normalizedLevel,
      timeFormat: "training",
      platform: "Chess Coach",
      event: "Training gegen die Engine",
      rated: "no",
      result: "*",
    };
    this.gameSaveDraftDirty = true;
    this.board.orientation(playerColor === "w" ? "white" : "black");
    this.moveArrows?.setOrientation(this.board.orientation());
    this.resetBoardKeyboardCursor();
    this.engine.setMultiPV(1);
    this.updateModeUi();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
    this.showToast(`Engine-Partie gestartet · Du spielst ${playerColor === "w" ? "Weiß" : "Schwarz"}.`);
    return true;
  }

  finishPlayAndAnalyze() {
    if (!this.playSession.active || this.getCurrentPath().length < 2) return;
    if (this.playSession.phase !== "game-over") {
      const confirmed = window.confirm(
        "Wenn du jetzt analysierst, wird die Engine-Partie beendet und kann nicht fortgesetzt werden.",
      );
      if (!confirmed) return;
    }
    if (!this.setAppMode("analysis", { force: true, silent: true })) return;
    window.setTimeout(() => this.startFullGameReview(), 0);
  }

  resignEngineGame() {
    if (!this.playSession.active || this.playSession.phase === "game-over") return;
    if (!window.confirm("Möchtest du die Partie wirklich aufgeben?")) return;
    this.engine?.cancelSearch?.();
    this.playSession.generation += 1;
    this.playSession.expectedFen = null;
    this.playSession.expectedSearchId = null;
    this.playSession.phase = "game-over";
    this.declaredGameResult = this.playSession.playerColor === "w" ? "0-1" : "1-0";
    this.currentNode.result = this.declaredGameResult;
    this.gameSaveDraft.result = this.declaredGameResult;
    this.gameSaveDraftDirty = true;
    this.markGameDirty();
    this.updateGameStatus();
    this.renderPlayPanel();
    this.updateSaveGameButton();
  }

  setupBoardKeyboard(boardEl, boardSurface) {
    if (!boardEl || !boardSurface) return;
    this.boardEl = boardEl;
    boardEl.tabIndex = 0;
    boardEl.setAttribute("role", "group");
    boardEl.setAttribute("aria-roledescription", "interaktives Schachbrett");
    boardEl.setAttribute("aria-describedby", "board-keyboard-instructions");

    const instructions = document.createElement("p");
    instructions.id = "board-keyboard-instructions";
    instructions.className = "sr-only";
    instructions.textContent = [
      "Mit den Pfeiltasten ein Feld wählen.",
      "Mit Enter oder Leertaste eine Figur aufnehmen und auf dem Zielfeld absetzen.",
      "Escape hebt die Auswahl auf.",
    ].join(" ");
    this.boardKeyboardStatusEl = document.createElement("p");
    this.boardKeyboardStatusEl.className = "sr-only";
    this.boardKeyboardStatusEl.setAttribute("role", "status");
    this.boardKeyboardStatusEl.setAttribute("aria-live", "polite");
    this.boardKeyboardStatusEl.setAttribute("aria-atomic", "true");
    boardSurface.append(instructions, this.boardKeyboardStatusEl);

    this.boardKeyboardSquare = this.board.orientation() === "black" ? "h8" : "a1";
    this.boardKeyboardSelectedSquare = null;
    this._onBoardFocus = () => {
      this.updateBoardKeyboardHighlights();
      this.announceBoardKeyboardSquare("Pfeiltasten wählen ein Feld.");
    };
    this._onBoardBlur = () => boardEl.classList.remove("is-keyboard-navigation");
    this._onBoardPointerDown = () => boardEl.classList.remove("is-keyboard-navigation");
    this._onBoardKeyDown = (event) => this.handleBoardKeyDown(event);
    boardEl.addEventListener("focus", this._onBoardFocus);
    boardEl.addEventListener("blur", this._onBoardBlur);
    boardEl.addEventListener("pointerdown", this._onBoardPointerDown);
    boardEl.addEventListener("keydown", this._onBoardKeyDown);
    this.skipLink = document.querySelector('.skip-link[href="#board"]');
    this._onSkipLinkClick = (event) => {
      event.preventDefault();
      boardEl.focus({ preventScroll: true });
      boardEl.scrollIntoView({ block: "start" });
    };
    this.skipLink?.addEventListener("click", this._onSkipLinkClick);

    if (typeof MutationObserver === "function") {
      this.boardKeyboardObserver = new MutationObserver(() => {
        if (this.boardKeyboardFrame) cancelAnimationFrame(this.boardKeyboardFrame);
        this.boardKeyboardFrame = requestAnimationFrame(() => {
          this.boardKeyboardFrame = null;
          this.updateBoardKeyboardHighlights();
        });
      });
      this.boardKeyboardObserver.observe(boardEl, { childList: true, subtree: true });
    }
    this.updateBoardKeyboardHighlights();
  }

  resetBoardKeyboardCursor() {
    this.boardKeyboardSquare = this.board?.orientation?.() === "black" ? "h8" : "a1";
    this.boardKeyboardSelectedSquare = null;
    this.updateBoardKeyboardHighlights();
  }

  updateBoardKeyboardHighlights() {
    if (!this.boardEl) return;
    this.boardEl
      .querySelectorAll(".keyboard-board-cursor, .keyboard-board-selected")
      .forEach((square) => {
        square.classList.remove("keyboard-board-cursor", "keyboard-board-selected");
      });
    const cursor = this.boardKeyboardSquare
      ? this.boardEl.querySelector(`.square-${this.boardKeyboardSquare}`)
      : null;
    cursor?.classList.add("keyboard-board-cursor");
    const selected = this.boardKeyboardSelectedSquare
      ? this.boardEl.querySelector(`.square-${this.boardKeyboardSelectedSquare}`)
      : null;
    selected?.classList.add("keyboard-board-selected");
  }

  describeBoardSquare(square) {
    const piece = this.game?.get?.(square);
    if (!piece) return `${square}, leeres Feld`;
    const names = {
      w: {
        p: "weißer Bauer",
        n: "weißer Springer",
        b: "weißer Läufer",
        r: "weißer Turm",
        q: "weiße Dame",
        k: "weißer König",
      },
      b: {
        p: "schwarzer Bauer",
        n: "schwarzer Springer",
        b: "schwarzer Läufer",
        r: "schwarzer Turm",
        q: "schwarze Dame",
        k: "schwarzer König",
      },
    };
    return `${square}, ${names[piece.color]?.[piece.type] || "Figur"}`;
  }

  announceBoardKeyboardSquare(suffix = "") {
    if (!this.boardKeyboardStatusEl || !this.boardKeyboardSquare) return;
    const selected = this.boardKeyboardSelectedSquare
      ? ` Ausgewählt: ${this.describeBoardSquare(this.boardKeyboardSelectedSquare)}.`
      : "";
    this.boardKeyboardStatusEl.textContent = [
      this.describeBoardSquare(this.boardKeyboardSquare),
      selected,
      suffix,
    ].filter(Boolean).join(" ");
  }

  moveBoardKeyboardCursor(key) {
    const files = "abcdefgh";
    const square = /^[a-h][1-8]$/.test(this.boardKeyboardSquare || "")
      ? this.boardKeyboardSquare
      : this.board?.orientation?.() === "black" ? "h8" : "a1";
    let file = files.indexOf(square[0]);
    let rank = Number.parseInt(square[1], 10);
    const blackOrientation = this.board?.orientation?.() === "black";
    if (key === "ArrowLeft") file += blackOrientation ? 1 : -1;
    if (key === "ArrowRight") file += blackOrientation ? -1 : 1;
    if (key === "ArrowUp") rank += blackOrientation ? -1 : 1;
    if (key === "ArrowDown") rank += blackOrientation ? 1 : -1;
    file = Math.max(0, Math.min(7, file));
    rank = Math.max(1, Math.min(8, rank));
    this.boardKeyboardSquare = `${files[file]}${rank}`;
    this.updateBoardKeyboardHighlights();
    this.announceBoardKeyboardSquare();
  }

  handleBoardKeyDown(event) {
    if (!event || event.defaultPrevented) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) {
      this.boardEl?.classList.add("is-keyboard-navigation");
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.moveBoardKeyboardCursor(event.key);
      return;
    }
    if (event.key === "Escape" && this.boardKeyboardSelectedSquare) {
      event.preventDefault();
      event.stopPropagation();
      this.boardKeyboardSelectedSquare = null;
      this.updateBoardKeyboardHighlights();
      this.announceBoardKeyboardSquare("Auswahl aufgehoben.");
      return;
    }
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const square = this.boardKeyboardSquare;
    const piece = this.game?.get?.(square);

    if (!this.boardKeyboardSelectedSquare) {
      const pieceCode = piece ? `${piece.color}${piece.type.toUpperCase()}` : "";
      if (
        !piece
        || piece.color !== this.game.turn()
        || this.handleDragStart(square, pieceCode) === false
      ) {
        this.announceBoardKeyboardSquare("Diese Figur kannst du gerade nicht ziehen.");
        return;
      }
      this.boardKeyboardSelectedSquare = square;
      this.updateBoardKeyboardHighlights();
      this.announceBoardKeyboardSquare("Figur ausgewählt. Wähle jetzt das Zielfeld.");
      return;
    }

    const source = this.boardKeyboardSelectedSquare;
    if (source === square) {
      this.boardKeyboardSelectedSquare = null;
      this.updateBoardKeyboardHighlights();
      this.announceBoardKeyboardSquare("Auswahl aufgehoben.");
      return;
    }
    const sourcePiece = this.game?.get?.(source);
    if (
      piece
      && sourcePiece
      && piece.color === sourcePiece.color
      && piece.color === this.game.turn()
    ) {
      const pieceCode = `${piece.color}${piece.type.toUpperCase()}`;
      if (this.handleDragStart(square, pieceCode) !== false) {
        this.boardKeyboardSelectedSquare = square;
        this.updateBoardKeyboardHighlights();
        this.announceBoardKeyboardSquare("Andere Figur ausgewählt.");
      }
      return;
    }

    const result = this.handleMove(source, square);
    if (result === "snapback") {
      this.announceBoardKeyboardSquare("Dieser Zug ist nicht legal.");
      return;
    }
    const san = this.currentNode?.move?.san || `${source} nach ${square}`;
    this.boardKeyboardSelectedSquare = null;
    this.updateBoardKeyboardHighlights();
    this.announceBoardKeyboardSquare(`Zug ${san} gespielt.`);
  }

  handleDragStart(source, piece) {
    if (this.previewState || this.moveListPreviewState || this.reviewRunning) return false;
    if (this.appMode === "play") {
      if (
        !this.playSession.active
        || this.playSession.phase !== "player-turn"
        || this.game.isGameOver()
        || this.game.turn() !== this.playSession.playerColor
      ) {
        return false;
      }
      const pieceColor = typeof piece === "string" ? piece.slice(0, 1).toLowerCase() : "";
      const boardPiece = this.game.get(source);
      if (
        !boardPiece
        || boardPiece.color !== this.playSession.playerColor
        || (pieceColor && pieceColor !== this.playSession.playerColor)
      ) {
        return false;
      }
    }
    this.moveArrows?.setVisible(false);
    return true;
  }

  applyMove(moveSpec, { actor = "analysis" } = {}) {
    if (actor === "analysis") this.declaredGameResult = null;
    let move;
    try {
      move = this.game.move(moveSpec);
    } catch {
      return null;
    }
    if (!move) return null;

    this.currentNode = addMoveToTree(this.currentNode, move, this.game.fen());
    this.currentNode.result = this.getGameResult();
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.markGameDirty();

    if (this.appMode === "play" && this.playSession.active) {
      this.playSession.expectedFen = null;
      this.playSession.expectedSearchId = null;
      if (this.game.isGameOver()) {
        const result = this.getGameResult();
        this.playSession.phase = "game-over";
        this.currentNode.result = result;
        this.gameSaveDraft.result = result;
        this.gameSaveDraftDirty = true;
      } else if (actor === "player") {
        this.playSession.phase = this.playSession.liveFeedback
          ? "feedback"
          : "engine-thinking";
      } else if (actor === "engine") {
        this.playSession.phase = "preparing";
      }
    }

    if (actor === "engine") {
      this.board.position(this.game.fen());
    } else {
      window.setTimeout(() => this.board.position(this.game.fen()), 0);
    }
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.renderPlayPanel();
    this.evaluateCurrentPosition();
    return move;
  }

  handleMove(source, target) {
    if (this.reviewRunning) return "snapback";
    this.stopSuggestionPreview();
    this.stopMoveListPreview();
    if (
      this.appMode === "play"
      && (
        !this.playSession.active
        || this.playSession.phase !== "player-turn"
        || this.game.turn() !== this.playSession.playerColor
      )
    ) {
      window.setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }
    const turn = this.game.turn();
    const fromPiece = this.game.get(source);
    if (!fromPiece || (turn === "w" && fromPiece.color !== "w") || (turn === "b" && fromPiece.color !== "b")) {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }
    if (this.appMode === "play" && fromPiece.color !== this.playSession.playerColor) {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }
    const move = this.applyMove(
      { from: source, to: target, promotion: "q" },
      { actor: this.appMode === "play" ? "player" : "analysis" },
    );
    if (!move) {
      setTimeout(() => this.board.position(this.game.fen()), 0);
      return "snapback";
    }
    return undefined;
  }

  goBackOnePly() {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopSuggestionPreview();
    if (!this.currentNode.parent) return;
    this.currentNode = this.currentNode.parent;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  goForwardOnePly() {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopSuggestionPreview();
    const next = this.currentNode.mainline;
    if (!next) return;
    this.currentNode = next;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  cycleVariation(offset) {
    if (this.reviewRunning || this.appMode === "play") return;
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
    this.markGameDirty();
    this.board.position(this.currentNode.fen);
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.evaluateCurrentPosition();
  }

  getCurrentSearchPlan() {
    if (this.appMode !== "play") {
      return {
        purpose: "analysis",
        depth: this.engine?.depth || 15,
        generation: null,
      };
    }
    if (!this.playSession.active || this.playSession.phase === "game-over") return null;
    const generation = this.playSession.generation;
    if (this.playSession.phase === "preparing") {
      return { purpose: "play-baseline", depth: 12, generation };
    }
    if (this.playSession.phase === "feedback") {
      return { purpose: "play-feedback", depth: 12, generation };
    }
    if (this.playSession.phase === "engine-thinking") {
      const level = ENGINE_LEVELS[normalizeEngineLevel(this.playSession.level)];
      return { purpose: "play-move", depth: level.depth, generation };
    }
    return null;
  }

  evaluateCurrentPosition() {
    if (this.previewState) this.stopSuggestionPreview();
    const fen = this.game.fen();
    const searchPlan = this.getCurrentSearchPlan();
    const targetDepth = searchPlan?.depth || this.engine?.depth || 15;
    this.analysisFen = fen;
    this.lastEvalPawns = null;
    this.evalBar?.setPending?.();
    this.suggestionState = {
      fen,
      node: this.currentNode,
      searchId: null,
      targetDepth,
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
        depth: targetDepth,
        pv: [],
        complete: true,
      };
      this.refreshLiveAccuracy();
      if (this.appMode === "play" && this.playSession.active) {
        if (this.playSession.liveFeedback) this.recordLatestPlayFeedback();
        this.playSession.phase = "game-over";
        this.playSession.expectedFen = null;
        this.playSession.expectedSearchId = null;
        const result = this.getGameResult();
        this.currentNode.result = result;
        this.gameSaveDraft.result = result;
        this.gameSaveDraftDirty = true;
        this.renderPlayPanel();
        this.updateSaveGameButton();
      }
      return;
    }
    if (!searchPlan) {
      this.renderPlayPanel();
      return;
    }
    if (!this.engine) {
      this.renderEngineUnavailable();
      return;
    }
    if (searchPlan.purpose === "play-move") {
      const level = ENGINE_LEVELS[normalizeEngineLevel(this.playSession.level)];
      this.engine.setPlayingStrength?.(level.elo);
    } else {
      this.engine.setAnalysisStrength?.();
    }
    this.suggestionState.searchId = this.engine.evaluate(fen, targetDepth, searchPlan);
    if (this.appMode === "play" && this.playSession.active) {
      this.playSession.expectedFen = fen;
      this.playSession.expectedSearchId = this.suggestionState.searchId;
      this.renderPlayPanel();
      this.updateSaveGameButton();
    }
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
    if (this.appMode === "analysis" && this.suggestionCount > 0) {
      if (this.previewState) {
        this.suggestionsDirtyDuringPreview = true;
      } else {
        this.renderSuggestions();
      }
    }
  }

  handleEngineBestMove(result) {
    const context = result?.context;
    if (
      this.destroyed
      ||
      this.appMode !== "play"
      || !this.playSession.active
      || !context
      || context.generation !== this.playSession.generation
      || result.fen !== this.game.fen()
      || result.fen !== this.playSession.expectedFen
      || result.searchId !== this.playSession.expectedSearchId
    ) {
      return;
    }

    this.playSession.expectedFen = null;
    this.playSession.expectedSearchId = null;
    if (context.purpose === "play-baseline") {
      if (this.game.turn() !== this.playSession.playerColor) return;
      this.playSession.phase = "player-turn";
      this.renderPlayPanel();
      this.updateSaveGameButton();
      return;
    }

    if (context.purpose === "play-feedback") {
      this.recordLatestPlayFeedback();
      if (this.game.isGameOver()) {
        this.playSession.phase = "game-over";
        this.renderPlayPanel();
        return;
      }
      this.playSession.phase = "engine-thinking";
      this.renderPlayPanel();
      this.evaluateCurrentPosition();
      return;
    }

    if (
      context.purpose !== "play-move"
      || this.game.turn() !== this.playSession.engineColor
    ) {
      return;
    }
    const uci = result.move;
    const move = typeof uci === "string"
      ? this.applyMove({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
      }, { actor: "engine" })
      : null;
    if (!move) {
      this.showToast("Stockfish konnte keinen legalen Zug ausführen. Die Stellung bleibt zur Analyse erhalten.");
      this.cancelPlaySession();
      this.updateModeUi();
    }
  }

  recordLatestPlayFeedback() {
    const session = this.playSession;
    const path = this.getCurrentPath();
    const ply = path.length - 1;
    if (
      !session.active
      || !session.liveFeedback
      || ply <= 0
      || ply === session.lastFeedbackPly
      || path.at(-1)?.move?.color !== session.playerColor
    ) {
      return null;
    }
    this.refreshLiveAccuracy();
    const reportMove = this.liveAccuracyReport?.moves?.find((move) => move.ply === ply);
    const feedback = describeLiveMove(reportMove);
    if (!feedback) return null;
    session.lastFeedbackPly = ply;
    session.streak = nextStrongMoveStreak(session.streak, reportMove.quality);
    session.bestStreak = Math.max(session.bestStreak || 0, session.streak);
    this.celebratePlayedPiece(path[ply]?.move?.to, reportMove.quality);
    const node = path[ply];
    const beforeNode = path[ply - 1];
    const playedUci = node?.move
      ? `${node.move.from || ""}${node.move.to || ""}${node.move.promotion || ""}`
      : "";
    const feedbackEntry = {
      ...feedback,
      ply,
      bestUci: reportMove.bestUci || "",
      bestSan: reportMove.bestSan || "",
      playedUci,
      beforeFen: beforeNode?.fen || "",
    };
    session.feedbackHistory.unshift(feedbackEntry);
    session.feedbackHistory = session.feedbackHistory.slice(0, 12);
    this.renderPlayPanel();
    this.requestAutomaticPlayCoachFeedback(feedbackEntry, reportMove);
    return feedback;
  }

  handlePlayCoachReply() {
    const text = this.playCoachInputEl?.value?.trim();
    if (!text || this.playSession.coachBusy) return;
    this.playCoachInputEl.value = "";
    this.playSession.coachMessages.push({ role: "user", content: text });
    this.requestPlayCoachMessage(text);
  }

  async requestAutomaticPlayCoachFeedback(feedback, reportMove) {
    if (!feedback || !this.playSession.liveFeedback || this.coachConfigured === false) return;
    const alternative = reportMove?.bestSan && reportMove.bestSan !== reportMove.san
      ? `Die stärkere Engine-Alternative ist ${reportMove.bestSan}.`
      : "";
    this.playSession.coachQueue.push({
      message: [
        `Gib zu ${feedback.title} genau ein kurzes Live-Coaching in ein bis zwei Sätzen.`,
        feedback.detail,
        alternative,
        "Erkläre das wichtigste Motiv oder den nächsten Denk-Schritt ohne lange Zugfolge.",
      ].filter(Boolean).join(" "),
      ply: feedback.ply,
    });
    this.playSession.coachQueue = this.playSession.coachQueue.slice(-6);
    this.drainPlayCoachQueue();
  }

  async drainPlayCoachQueue() {
    const session = this.playSession;
    if (!session.active || session.coachBusy || session.coachQueue.length === 0) return;
    const next = session.coachQueue.shift();
    await this.requestPlayCoachMessage(next.message, {
      automatic: true,
      ply: next.ply,
    });
  }

  async requestPlayCoachMessage(message, { automatic = false, ply = null } = {}) {
    const session = this.playSession;
    if (!session.active || session.coachBusy) return;
    session.coachBusy = true;
    this.renderPlayPanel();
    this.playCoachController?.abort();
    this.playCoachController = new AbortController();
    const generation = session.generation;
    const conversation = session.coachMessages.slice(-8);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          fen: this.game.fen(),
          evalPawns: this.lastEvalPawns,
          suggestions: [],
          history: this.game.history(),
          conversation,
        }),
        signal: this.playCoachController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (this.playSession.generation !== generation) return;
      const reply = String(payload.reply || "").trim();
      if (!reply) return;
      session.coachMessages.push({ role: "assistant", content: reply, ply });
      session.coachMessages = session.coachMessages.slice(-12);
      if (automatic && Number.isInteger(ply)) {
        const item = session.feedbackHistory.find((entry) => entry.ply === ply);
        if (item) item.coachText = reply;
      }
    } catch (error) {
      if (error?.name !== "AbortError" && !automatic) {
        session.coachMessages.push({
          role: "assistant",
          content: error?.message || "Der Coach ist gerade nicht erreichbar.",
        });
      }
    } finally {
      if (this.playSession.generation === generation) {
        session.coachBusy = false;
        this.playCoachController = null;
        this.renderPlayPanel();
        this.drainPlayCoachQueue();
      }
    }
  }

  previewCoachMove(feedback) {
    if (!feedback?.beforeFen || !feedback?.bestUci || this.reviewRunning) return;
    this.stopSuggestionPreview();
    const frames = buildPvFrames(feedback.beforeFen, [feedback.bestUci], 1);
    if (frames.length === 0) return;
    const token = ++this.previewToken;
    this.previewState = { token, row: null, frames, index: -1, coach: true };
    this.board.position(feedback.beforeFen, false);
    this.moveArrows?.setMoves([{ rank: 1, move: feedback.bestUci, impact: 1 }]);
    const boardSurface = this.boardSurface || document.getElementById("board-surface");
    if (!this.previewBadge && boardSurface) {
      this.previewBadge = document.createElement("div");
      this.previewBadge.className = "board-preview-badge";
      boardSurface.appendChild(this.previewBadge);
    }
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      this.previewBadge.textContent = `Coach-Zug · ${feedback.bestSan || frames[0].san} · ${feedback.detail}`;
    }
    this.previewTimer = window.setTimeout(() => {
      if (this.previewState?.token !== token) return;
      this.board.position(frames[0].fen, true);
      this.previewTimer = window.setTimeout(() => this.stopSuggestionPreview(), 1400);
    }, 650);
  }

  celebratePlayedPiece(square, quality) {
    if (
      !/^[a-h][1-8]$/.test(square || "")
      || !["best", "excellent", "good"].includes(quality)
      || !this.boardEl
    ) return;
    const squareEl = this.boardEl.querySelector(`.square-${square}`);
    const pieceEl = squareEl?.querySelector(".piece-417db");
    if (!squareEl || !pieceEl) return;

    if (this.successAnimationTimer) {
      window.clearTimeout(this.successAnimationTimer);
    }
    this.successAnimationElements?.forEach((element) => {
      element?.classList.remove(
        "move-success-square",
        "piece-success-pop",
        "is-brilliant",
      );
    });

    const brilliant = quality === "best" || quality === "excellent";
    squareEl.classList.remove("move-success-square", "is-brilliant");
    pieceEl.classList.remove("piece-success-pop", "is-brilliant");
    void pieceEl.offsetWidth;
    squareEl.classList.add("move-success-square");
    pieceEl.classList.add("piece-success-pop");
    if (brilliant) {
      squareEl.classList.add("is-brilliant");
      pieceEl.classList.add("is-brilliant");
    }
    this.successAnimationElements = [squareEl, pieceEl];
    this.successAnimationTimer = window.setTimeout(() => {
      this.successAnimationElements?.forEach((element) => {
        element?.classList.remove(
          "move-success-square",
          "piece-success-pop",
          "is-brilliant",
        );
      });
      this.successAnimationElements = null;
      this.successAnimationTimer = null;
    }, 900);
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

      const coachReason = document.createElement('div');
      coachReason.className = 'suggestion-coach-reason';
      const reason = this.suggestionCoachReasons.get(idx);
      coachReason.textContent = reason
        ? `Coach-Idee: ${reason}`
        : this.suggestionCoachBusy
          ? 'Coach ordnet den Zug kurz ein …'
          : 'Coach-Erklärung wird vorbereitet …';
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
      row.appendChild(coachReason);
      body.appendChild(row);
    });
    this.scheduleSuggestionCoachReasons(lines);
  }

  scheduleSuggestionCoachReasons(lines) {
    if (
      this.appMode !== "analysis"
      || this.coachConfigured === false
      || !Array.isArray(lines)
      || lines.length === 0
      || (this.suggestionState?.depth || 0) < Math.min(10, this.suggestionState?.targetDepth || 10)
    ) return;
    const key = [
      this.suggestionState?.fen || "",
      ...lines.map(([, data]) => data?.pv?.[0] || ""),
    ].join("|");
    if (!key || key === this.suggestionCoachKey) return;
    if (this.suggestionCoachTimer) window.clearTimeout(this.suggestionCoachTimer);
    this.suggestionCoachTimer = window.setTimeout(() => {
      this.suggestionCoachTimer = null;
      this.requestSuggestionCoachReasons(lines, key);
    }, 550);
  }

  async requestSuggestionCoachReasons(lines, key) {
    this.suggestionCoachController?.abort();
    this.suggestionCoachController = new AbortController();
    this.suggestionCoachKey = key;
    this.suggestionCoachReasons = new Map();
    this.suggestionCoachBusy = true;
    this.renderSuggestions();
    const suggestions = lines.map(([, data]) => ({
      score: this.formatScore(data.whiteScore || data.score),
      moves: this.pvToSanList(data.pv, data.fen).slice(0, 4),
    }));
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: [
            `Erkläre jeden der ${suggestions.length} Engine-Kandidaten in genau einem kurzen deutschen Satz.`,
            "Antworte zeilenweise im Format „1: Begründung“. Beschreibe Plan, Motiv oder konkrete Wirkung und verwende keine lange Zugfolge.",
          ].join(" "),
          fen: this.suggestionState?.fen || "",
          evalPawns: this.lastEvalPawns,
          suggestions,
          history: this.game.history(),
          conversation: [],
        }),
        signal: this.suggestionCoachController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const reply = String(payload.reply || "").trim();
      const reasons = new Map();
      reply.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*(\d+)\s*[:.)-]\s*(.+?)\s*$/);
        if (!match) return;
        const rank = Number.parseInt(match[1], 10);
        if (rank >= 1 && rank <= lines.length) reasons.set(rank, match[2]);
      });
      if (reasons.size === 0 && reply) reasons.set(1, reply);
      if (this.suggestionCoachKey === key) this.suggestionCoachReasons = reasons;
    } catch (error) {
      if (error?.name !== "AbortError" && this.suggestionCoachKey === key) {
        this.suggestionCoachReasons = new Map();
      }
    } finally {
      if (this.suggestionCoachKey === key) {
        this.suggestionCoachBusy = false;
        this.suggestionCoachController = null;
        if (!this.previewState) this.renderSuggestions();
      }
    }
  }

  renderMoveArrows() {
    if (!this.moveArrows) return;
    if (
      this.appMode === "play"
      ||
      this.suggestionCount === 0
      || !this.suggestionState
      || this.suggestionState.lines.size === 0
    ) {
      this.moveArrows.clear();
      return;
    }

    const lines = Array.from(this.suggestionState.lines.entries())
      .sort(([left], [right]) => left - right)
      .slice(0, this.suggestionCount);
    const moves = selectImpactArrowMoves(lines, this.suggestionCount);
    this.moveArrows.setMoves(moves);
  }

  startSuggestionPreview(data, row) {
    if (
      this.appMode === "play"
      ||
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
    this.moveArrows?.setMoves([
      { rank: 1, move: data.pv?.[0], impact: 1 },
    ]);
    this.board.position(data.fen, false);
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      const rank = data.multipv || 1;
      const reason = this.suggestionCoachReasons.get(rank);
      this.previewBadge.textContent = reason
        ? `Coach-Vorschau · ${reason}`
        : 'Coach-Vorschau';
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

  startMoveListPreview(fen, element) {
    if (
      this.destroyed
      || this.reviewRunning
      || typeof fen !== "string"
      || !fen
    ) return;
    try {
      const previewGame = new Chess();
      previewGame.load(fen);
    } catch {
      return;
    }
    if (
      this.moveListPreviewState?.fen === fen
      && this.moveListPreviewState?.element === element
    ) return;
    this.stopSuggestionPreview();
    this.stopMoveListPreview();
    this.moveListPreviewState = { fen, element };
    element?.classList.add("is-previewing");
    this.moveArrows?.setVisible(false);
    this.board?.position?.(fen, false);

    const boardSurface = this.boardSurface || document.getElementById("board-surface");
    if (!this.previewBadge && boardSurface) {
      this.previewBadge = document.createElement("div");
      this.previewBadge.className = "board-preview-badge";
      boardSurface.appendChild(this.previewBadge);
    }
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      this.previewBadge.textContent = "Zugvorschau";
    }
  }

  stopMoveListPreview(element = null) {
    if (!this.moveListPreviewState) return;
    if (element && this.moveListPreviewState.element !== element) return;
    this.moveListPreviewState.element?.classList.remove("is-previewing");
    this.moveListPreviewState = null;
    if (!this.destroyed) {
      this.board?.position?.(this.game.fen(), false);
      this.moveArrows?.setVisible(true);
      this.renderMoveArrows();
    }
    if (this.previewBadge) this.previewBadge.hidden = true;
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
    const minimumDepth = this.appMode === "play" && this.playSession.active
      ? 12
      : this.engine?.depth || 1;
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
    this.renderMoveList();
  }

  updateAccuracyDisplay() {
    if (!this.accuracyEl) return;
    const report = this.gameReviewReport || this.liveAccuracyReport;
    const whiteAccuracy = report?.whiteAccuracy;
    const blackAccuracy = report?.blackAccuracy;
    const formatAccuracy = (value) => (
      Number.isFinite(value) ? `${value.toFixed(1).replace('.', ',')} %` : '—'
    );
    const white = formatAccuracy(whiteAccuracy);
    const black = formatAccuracy(blackAccuracy);
    this.whiteAccuracyEl.textContent = white;
    this.blackAccuracyEl.textContent = black;
    const ownOnly = this.appMode === "play" && this.playSession.active;
    const ownAccuracy = this.playSession.playerColor === "b" ? blackAccuracy : whiteAccuracy;
    const own = this.playSession.playerColor === "b" ? black : white;
    if (ownOnly) {
      this.accuracyEl.hidden = !this.playSession.liveFeedback;
      this.accuracyLabelEl.textContent = "Deine Genauigkeit";
      this.whiteAccuracySideEl.hidden = this.playSession.playerColor !== "w";
      this.blackAccuracySideEl.hidden = this.playSession.playerColor !== "b";
      const provisional = !report?.final || report?.analyzedMoves < report?.totalMoves;
      this.accuracyEl.classList.toggle("is-pending", !Number.isFinite(ownAccuracy) || provisional);
      this.accuracyModeEl.textContent = Number.isFinite(ownAccuracy) && provisional
        ? "vorläufig"
        : "";
      this.accuracyEl.setAttribute(
        "aria-label",
        Number.isFinite(ownAccuracy)
          ? `${provisional ? "Vorläufige " : ""}eigene Genauigkeit: ${own}`
          : "Eigene Genauigkeit noch nicht berechnet",
      );
      this.accuracyEl.title = Number.isFinite(ownAccuracy)
        ? `Geschätzte Genauigkeit deiner Züge · ${own}`
        : "Nach deinem ersten vollständig bewerteten Zug erscheint hier deine Genauigkeit.";
      return;
    }
    this.accuracyLabelEl.textContent = "Genauigkeit";
    this.whiteAccuracySideEl.hidden = false;
    this.blackAccuracySideEl.hidden = false;
    if (
      (!Number.isFinite(whiteAccuracy) && !Number.isFinite(blackAccuracy))
      || report?.analyzedMoves === 0
    ) {
      this.accuracyEl.classList.add('is-pending');
      this.accuracyModeEl.textContent = '';
      this.accuracyEl.setAttribute(
        'aria-label',
        'Genauigkeit: Weiß noch nicht berechnet, Schwarz noch nicht berechnet',
      );
      this.accuracyEl.title = 'Nach den ersten vollständig bewerteten Zügen erscheint hier die Genauigkeit.';
      return;
    }
    const provisional = !report.final || report.analyzedMoves < report.totalMoves;
    this.accuracyEl.classList.toggle('is-pending', provisional);
    this.accuracyModeEl.textContent = provisional ? 'vorläufig' : '';
    this.accuracyEl.setAttribute(
      'aria-label',
      `${provisional ? 'Vorläufige ' : ''}Genauigkeit: Weiß ${white}, Schwarz ${black}`,
    );
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
        if (this.batchReviewRunning) this.batchReviewCancelled = true;
        this.cancelFullGameReview();
      } else {
        dialog.close();
      }
    });
    actions.appendChild(this.feedbackCancelButton);
    dialog.appendChild(actions);

    dialog.addEventListener('close', () => {
      if (this.reviewRunning) {
        if (this.batchReviewRunning) this.batchReviewCancelled = true;
        this.cancelFullGameReview();
      }
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

  async startFullGameReview({ batchLabel = "" } = {}) {
    if (this.reviewRunning) return null;
    if (this.appMode === "play" && this.playSession.active) {
      this.showToast("Beende die Engine-Partie zuerst über „Beenden & analysieren“.");
      return;
    }
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
    this.markGameDirty();
    this.feedbackButton.disabled = true;
    this.feedbackCancelButton.textContent = 'Abbrechen';
    if (!this.feedbackDialog.open) this.feedbackDialog.showModal();

    const depth = reviewDepthForPlies(path.length - 1, this.engine?.depth || 15);
    const evaluations = [];
    const cache = new Map();
    let report = null;
    this.renderReviewProgress(
      0,
      path.length,
      depth,
      batchLabel || 'Stockfish prüft jede Stellung …',
    );

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
      this.markGameDirty();
      this.updateAccuracyDisplay();
      this.renderMoveList();
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

    if (!report || this.reviewCancelled) return null;
    this.renderFeedbackReport(report, report.feedback, { coachPending: true });

    try {
      const feedback = await this.requestCoachGameFeedback(report, path);
      if (feedback && this.gameReviewReport === report) {
        report.feedback = feedback;
        this.savedGameReview = report;
        this.markGameDirty();
        this.renderFeedbackReport(report, feedback);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        this.renderFeedbackReport(report, report.feedback, {
          coachNote: 'Der KI-Coach ist gerade nicht verfügbar; die lokale Stockfish-Auswertung ist vollständig.',
        });
      }
    }
    if (
      !this.batchReviewRunning
      && this.activeGamePersisted
      && this.gameReviewReport === report
    ) {
      this.saveCurrentGame({ silent: true });
    }
    return report;
  }

  async requestCoachGameFeedback(report, path, { signal = null } = {}) {
    if (!signal) {
      this.reviewCoachController?.abort();
      this.reviewCoachController = new AbortController();
    }
    const payload = {
      message: 'Formuliere fünf kurze, motivierende Abschnitte: Spielverlauf, Hauptmotive, besonders starke Entscheidungen, wichtigste Verbesserung und konkreter Trainingsfokus. Arbeite die aussagekräftigsten Punkte heraus. Nenne höchstens einzelne kurze Varianten mit maximal zwei bis vier Halbzügen; erkläre vor allem die Idee.',
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
      signal: signal || this.reviewCoachController.signal,
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
      ? `${report.overallAccuracy.toFixed(1).replace('.', ',')} %`
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
        ? `${accuracy.toFixed(1).replace('.', ',')} %`
        : Number.isFinite(loss)
          ? `${loss.toFixed(1).replace('.', ',')} cp`
          : '—';
      const detail = document.createElement('small');
      detail.textContent = Number.isFinite(accuracy) && Number.isFinite(loss)
        ? `Ø ${loss.toFixed(1).replace('.', ',')} cp Verlust`
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

    if (report.moves?.length > 0) {
      const movesHeading = document.createElement("h3");
      movesHeading.textContent = "Zug für Zug";
      this.feedbackBodyEl.appendChild(movesHeading);
      const moveExplanations = document.createElement("div");
      moveExplanations.className = "review-move-explanations";
      report.moves.forEach((move) => {
        const quality = MOVE_QUALITY[move.quality];
        const item = document.createElement("button");
        item.type = "button";
        item.className = `review-move-explanation quality-${quality?.tone || "good"}`;
        const top = document.createElement("span");
        top.className = "review-move-explanation-top";
        const title = document.createElement("strong");
        title.textContent = `${move.moveNumber}${move.color === "b" ? "…" : "."} ${move.san}`;
        const badge = document.createElement("span");
        badge.textContent = quality?.label || "Bewertet";
        top.append(title, badge);
        const reason = document.createElement("span");
        reason.className = "review-move-reason";
        reason.textContent = move.explanation || explainMoveQuality(move);
        item.append(top, reason);
        item.addEventListener("click", () => {
          this.feedbackDialog.close();
          this.jumpToFen(move.fenAfter);
        });
        moveExplanations.appendChild(item);
      });
      this.feedbackBodyEl.appendChild(moveExplanations);
    }

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

  hasUnsavedGameChanges() {
    return this.gameSaveDraftDirty
      || (
        this.getCurrentPath().length > 1
        && (!this.activeGamePersisted || this.gameDirty)
      );
  }

  markGameDirty() {
    if (this.getCurrentPath().length < 2) return;
    this.gameDirty = true;
    this.updateSaveGameButton();
  }

  updateSaveGameButton() {
    if (!this.saveGameButton) return;
    const hasMoves = this.getCurrentPath().length > 1;
    const hasPendingChanges = this.gameDirty || this.gameSaveDraftDirty;
    const playBusy = this.appMode === "play"
      && this.playSession.active
      && ["preparing", "feedback", "engine-thinking"].includes(this.playSession.phase);
    let buttonLabel = 'Partie speichern';
    let statusLabel = hasMoves ? 'Noch nicht gespeichert' : 'Noch nicht gespeichert';
    let statusClass = 'is-unsaved';

    if (!hasMoves && this.gameSaveDraftDirty) {
      buttonLabel = 'Partiedaten';
      statusLabel = 'Partiedaten vorgemerkt';
      statusClass = 'is-dirty';
    } else if (this.activeGamePersisted && !hasPendingChanges) {
      buttonLabel = 'Partiedaten';
      statusLabel = 'Gespeichert';
      statusClass = 'is-saved';
    } else if (this.activeGamePersisted && hasPendingChanges) {
      buttonLabel = 'Änderungen speichern';
      statusLabel = 'Ungespeicherte Änderungen';
      statusClass = 'is-dirty';
    }

    this.saveGameButton.textContent = buttonLabel;
    this.saveGameButton.disabled = this.reviewRunning || playBusy;
    if (this.saveStatusEl) {
      this.saveStatusEl.textContent = statusLabel;
      this.saveStatusEl.className = `save-status ${statusClass}`;
    }
    if (this.saveGameSubmitButton) {
      this.saveGameSubmitButton.disabled = !hasMoves || this.reviewRunning || playBusy;
    }
    if (this.saveGameAvailabilityEl) {
      this.saveGameAvailabilityEl.textContent = playBusy
        ? "Warte kurz, bis Stockfish seinen Zug beendet hat."
        : hasMoves
          ? 'Die Partie wird erst durch den Speicher-Klick deinem Account hinzugefügt.'
          : 'Speichern ist nach dem ersten Zug möglich. Deine vorbereiteten Angaben bleiben erhalten.';
    }
    this.renderPlayPanel();
  }

  confirmDiscardUnsavedGame(action) {
    if (!this.hasUnsavedGameChanges()) return true;
    return window.confirm(
      `Diese Partie enthält ungespeicherte Änderungen. Möchtest du wirklich ${action} und sie verwerfen?`,
    );
  }

  createSaveGameDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'save-game-dialog';
    dialog.className = 'modal-dialog save-game-dialog';
    dialog.setAttribute('aria-labelledby', 'save-game-dialog-title');
    dialog.setAttribute('aria-describedby', 'save-game-dialog-description');
    this.saveGameDialog = dialog;

    const heading = document.createElement('div');
    heading.className = 'dialog-heading';
    const title = document.createElement('div');
    title.id = 'save-game-dialog-title';
    title.className = 'card-title';
    title.textContent = 'Partie speichern';
    heading.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dialog-close';
    close.setAttribute('aria-label', 'Speicherdialog schließen');
    close.textContent = '×';
    close.addEventListener('click', () => dialog.close());
    heading.appendChild(close);
    dialog.appendChild(heading);

    const description = document.createElement('p');
    description.id = 'save-game-dialog-description';
    description.className = 'dialog-description';
    description.textContent = 'Ergänze die Partiedaten. Farbe, Datum, Ergebnis und Zeitformat werden für dein Spielerprofil benötigt.';
    dialog.appendChild(description);

    const requiredHint = document.createElement('p');
    requiredHint.className = 'required-hint';
    requiredHint.textContent = '* Pflichtfeld';
    dialog.appendChild(requiredHint);

    const form = document.createElement('form');
    form.className = 'save-game-form';
    this.saveGameForm = form;
    this.saveGameInputs = {};

    const addField = ({
      key,
      label,
      type = 'text',
      required = false,
      options = null,
      placeholder = '',
      maxLength = null,
      min = null,
      max = null,
      full = false,
      textarea = false,
    }) => {
      const field = document.createElement('label');
      field.className = `save-game-field${full ? ' is-full' : ''}`;
      const labelText = document.createElement('span');
      labelText.textContent = `${label}${required ? ' *' : ''}`;
      field.appendChild(labelText);
      let input;
      if (textarea) {
        input = document.createElement('textarea');
        input.rows = 3;
      } else if (options) {
        input = document.createElement('select');
        options.forEach(({ value, text, disabled = false }) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          option.disabled = disabled;
          input.appendChild(option);
        });
      } else {
        input = document.createElement('input');
        input.type = type;
      }
      input.name = key;
      input.required = required;
      input.placeholder = placeholder;
      if (maxLength) input.maxLength = maxLength;
      if (min !== null) input.min = String(min);
      if (max !== null) input.max = String(max);
      input.addEventListener('input', () => {
        this.gameSaveDraft[key] = input.value;
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
      });
      input.addEventListener('change', () => {
        this.gameSaveDraft[key] = input.value;
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
      });
      field.appendChild(input);
      form.appendChild(field);
      this.saveGameInputs[key] = input;
      return input;
    };

    addField({
      key: 'playerColor',
      label: 'Deine Farbe',
      required: true,
      options: [
        { value: '', text: 'Bitte wählen', disabled: true },
        { value: 'w', text: 'Weiß' },
        { value: 'b', text: 'Schwarz' },
      ],
    });
    addField({
      key: 'playedAt',
      label: 'Partiedatum',
      type: 'date',
      required: true,
    });
    addField({
      key: 'result',
      label: 'Ergebnis',
      required: true,
      options: [
        { value: '*', text: 'Noch nicht beendet' },
        { value: '1-0', text: '1–0 · Weiß gewinnt' },
        { value: '0-1', text: '0–1 · Schwarz gewinnt' },
        { value: '1/2-1/2', text: 'Remis' },
      ],
    });
    addField({
      key: 'timeFormat',
      label: 'Zeitformat',
      required: true,
      options: [
        { value: '', text: 'Bitte wählen', disabled: true },
        ...Object.entries(TIME_FORMAT_LABELS).map(([value, text]) => ({ value, text })),
      ],
    });
    addField({
      key: 'opponent',
      label: 'Gegner',
      placeholder: 'Name oder Benutzername',
      maxLength: 80,
    });
    addField({
      key: 'timeControl',
      label: 'Genaue Bedenkzeit',
      placeholder: 'z. B. 10+0 oder 15+10',
      maxLength: 30,
    });
    addField({
      key: 'opening',
      label: 'Eröffnung (erkannt, editierbar)',
      placeholder: 'Wird aus den ersten Zügen erkannt',
      maxLength: 100,
      full: true,
    });
    addField({
      key: 'platform',
      label: 'Plattform oder Ort',
      placeholder: 'z. B. Lichess oder Schachverein',
      maxLength: 80,
    });
    addField({
      key: 'event',
      label: 'Turnier / Event',
      placeholder: 'Optional',
      maxLength: 100,
    });
    addField({
      key: 'playerRating',
      label: 'Deine Wertungszahl',
      type: 'number',
      min: 100,
      max: 4000,
    });
    addField({
      key: 'opponentRating',
      label: 'Wertungszahl des Gegners',
      type: 'number',
      min: 100,
      max: 4000,
    });
    addField({
      key: 'rated',
      label: 'Wertung',
      options: [
        { value: '', text: 'Nicht angegeben' },
        { value: 'yes', text: 'Gewertete Partie' },
        { value: 'no', text: 'Ungewertete Partie' },
      ],
    });
    addField({
      key: 'title',
      label: 'Eigener Titel',
      placeholder: 'Leer lassen für automatischen Titel',
      maxLength: 100,
      full: true,
    });
    addField({
      key: 'notes',
      label: 'Notizen',
      placeholder: 'Was möchtest du dir zu dieser Partie merken?',
      maxLength: 1500,
      full: true,
      textarea: true,
    });

    this.saveGameAvailabilityEl = document.createElement('p');
    this.saveGameAvailabilityEl.className = 'save-game-availability is-full';
    form.appendChild(this.saveGameAvailabilityEl);

    const actions = document.createElement('div');
    actions.className = 'dialog-actions save-game-actions is-full';
    const remember = document.createElement('button');
    remember.type = 'button';
    remember.className = 'secondary-button';
    remember.textContent = 'Daten vormerken & schließen';
    remember.addEventListener('click', () => dialog.close());
    this.saveGameSubmitButton = document.createElement('button');
    this.saveGameSubmitButton.type = 'submit';
    this.saveGameSubmitButton.className = 'primary-action-button';
    this.saveGameSubmitButton.textContent = 'Partie speichern';
    actions.append(remember, this.saveGameSubmitButton);
    form.appendChild(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveCurrentGame();
    });
    dialog.appendChild(form);
    dialog.addEventListener('close', () => this.saveDialogReturnFocus?.focus?.());
    document.body.appendChild(dialog);
    this.updateSaveGameButton();
  }

  openSaveGameDialog(returnFocus = this.saveGameButton) {
    if (!this.saveGameDialog || this.saveGameDialog.open) return;
    this.stopSuggestionPreview();
    const path = this.getCurrentPath();
    if (!this.gameSaveDraft.opening) {
      this.gameSaveDraft.opening = inferOpeningFromPath(path);
    }
    const boardResult = this.getGameResult();
    if (boardResult !== '*' && this.gameSaveDraft.result === '*') {
      this.gameSaveDraft.result = boardResult;
    }
    Object.entries(this.saveGameInputs || {}).forEach(([key, input]) => {
      input.value = this.gameSaveDraft[key] ?? '';
    });
    this.saveDialogReturnFocus = returnFocus;
    this.updateSaveGameButton();
    this.saveGameDialog.showModal();
    const firstMissing = ['playerColor', 'timeFormat']
      .map((key) => this.saveGameInputs[key])
      .find((input) => !input?.value);
    (firstMissing || this.saveGameInputs.playerColor)?.focus();
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
    this.createLichessImportDialog();
    this.updateAccountButton();
  }

  createLichessImportDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "lichess-import-dialog";
    dialog.className = "modal-dialog lichess-import-dialog";
    dialog.setAttribute("aria-labelledby", "lichess-import-title");
    this.lichessImportDialog = dialog;

    const heading = document.createElement("div");
    heading.className = "dialog-heading";
    const title = document.createElement("div");
    title.id = "lichess-import-title";
    title.className = "card-title";
    title.textContent = "Lichess-Partien importieren";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", "Lichess-Import schließen");
    close.textContent = "×";
    close.addEventListener("click", () => dialog.close());
    heading.append(title, close);
    dialog.appendChild(heading);

    const description = document.createElement("p");
    description.className = "dialog-description";
    description.textContent = "Es werden ausschließlich abgeschlossene Standardschach-Partien geladen. Erst dein Import-Klick speichert eine Auswahl im Spielerprofil.";
    dialog.appendChild(description);

    const form = document.createElement("form");
    form.className = "lichess-filter-form";
    this.lichessImportForm = form;
    const addSelect = (labelText, name, options) => {
      const label = document.createElement("label");
      const text = document.createElement("span");
      text.textContent = labelText;
      const select = document.createElement("select");
      select.name = name;
      options.forEach(({ value, label: optionLabel }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = optionLabel;
        select.appendChild(option);
      });
      label.append(text, select);
      form.appendChild(label);
      return select;
    };
    this.lichessMaxInput = addSelect("Anzahl", "max", [
      { value: "5", label: "5 neueste" },
      { value: "10", label: "10 neueste" },
      { value: "20", label: "20 neueste" },
      { value: "40", label: "Alle verfügbaren (max. 40)" },
    ]);
    this.lichessMaxInput.value = "10";
    this.lichessPerfInput = addSelect("Zeitformat", "perfType", [
      { value: "", label: "Alle Formate" },
      { value: "bullet", label: "Bullet" },
      { value: "blitz", label: "Blitz" },
      { value: "rapid", label: "Rapid" },
      { value: "classical", label: "Klassisch" },
      { value: "correspondence", label: "Korrespondenz" },
    ]);
    this.lichessRatedInput = addSelect("Wertung", "rated", [
      { value: "", label: "Gewertet und ungewertet" },
      { value: "true", label: "Nur gewertet" },
      { value: "false", label: "Nur ungewertet" },
    ]);
    this.lichessColorInput = addSelect("Deine Farbe", "color", [
      { value: "", label: "Weiß und Schwarz" },
      { value: "white", label: "Nur Weiß" },
      { value: "black", label: "Nur Schwarz" },
    ]);
    const dateLabel = document.createElement("label");
    const dateText = document.createElement("span");
    dateText.textContent = "Gespielt seit";
    this.lichessSinceInput = document.createElement("input");
    this.lichessSinceInput.type = "date";
    this.lichessSinceInput.name = "since";
    dateLabel.append(dateText, this.lichessSinceInput);
    form.appendChild(dateLabel);
    this.lichessLoadButton = document.createElement("button");
    this.lichessLoadButton.type = "submit";
    this.lichessLoadButton.className = "primary-action-button";
    this.lichessLoadButton.textContent = "Partien laden";
    form.appendChild(this.lichessLoadButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.loadLichessGames();
    });
    dialog.appendChild(form);

    this.lichessImportStatusEl = document.createElement("p");
    this.lichessImportStatusEl.className = "lichess-import-status";
    this.lichessImportStatusEl.setAttribute("role", "status");
    this.lichessImportStatusEl.setAttribute("aria-live", "polite");
    dialog.appendChild(this.lichessImportStatusEl);

    this.lichessImportResultsEl = document.createElement("div");
    this.lichessImportResultsEl.className = "lichess-import-results";
    dialog.appendChild(this.lichessImportResultsEl);

    const actions = document.createElement("div");
    actions.className = "dialog-actions lichess-import-actions";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "secondary-button";
    back.textContent = "Zurück zum Profil";
    back.addEventListener("click", () => dialog.close());
    this.lichessImportButton = document.createElement("button");
    this.lichessImportButton.type = "button";
    this.lichessImportButton.className = "primary-action-button";
    this.lichessImportButton.textContent = "Ausgewählte importieren";
    this.lichessImportButton.disabled = true;
    this.lichessImportButton.addEventListener("click", () => this.importSelectedLichessGames());
    this.lichessImportAllButton = document.createElement("button");
    this.lichessImportAllButton.type = "button";
    this.lichessImportAllButton.className = "primary-action-button";
    this.lichessImportAllButton.textContent = "Alle neuen importieren";
    this.lichessImportAllButton.disabled = true;
    this.lichessImportAllButton.addEventListener("click", () => this.importAllLichessGames());
    actions.append(back, this.lichessImportButton, this.lichessImportAllButton);
    dialog.appendChild(actions);
    dialog.addEventListener("close", () => {
      if (this.lichessReturnToAccount) {
        this.lichessReturnToAccount = false;
        requestAnimationFrame(() => this.openAccountDialog());
      }
    });
    document.body.appendChild(dialog);
  }

  async initializeLichessConnection() {
    this.lichessConnection = {
      loading: true,
      connected: false,
      user: null,
      error: "",
    };
    if (this.accountDialog?.open) this.renderAccountDialog();
    try {
      const response = await fetch("/api/lichess/status", { cache: "no-store" });
      const status = await response.json().catch(() => ({}));
      this.lichessConnection = response.ok && status.connected
        ? { loading: false, connected: true, user: status.user, error: "" }
        : {
          loading: false,
          connected: false,
          user: null,
          error: status.expired ? "Die Verbindung ist abgelaufen." : "",
        };
    } catch {
      this.lichessConnection = {
        loading: false,
        connected: false,
        user: null,
        error: "Lichess ist gerade nicht erreichbar.",
      };
    }

    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("lichess");
    if (outcome) {
      url.searchParams.delete("lichess");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      if (outcome === "connected") {
        this.showToast("Lichess erfolgreich verbunden.");
      } else if (outcome === "cancelled") {
        this.showToast("Lichess-Verbindung abgebrochen.");
      } else {
        this.showToast("Lichess konnte nicht verbunden werden.");
      }
      requestAnimationFrame(() => this.openAccountDialog());
    } else if (this.accountDialog?.open) {
      this.renderAccountDialog();
    }
  }

  renderLichessConnectionCard(parent) {
    const card = document.createElement("section");
    card.className = "lichess-connection-card";
    const brand = document.createElement("div");
    brand.className = "lichess-connection-brand";
    const mark = document.createElement("span");
    mark.className = "lichess-mark";
    mark.textContent = "♞";
    mark.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Lichess";
    const detail = document.createElement("span");
    copy.append(title, detail);
    brand.append(mark, copy);
    const actions = document.createElement("div");
    actions.className = "lichess-connection-actions";

    if (this.lichessConnection.loading) {
      detail.textContent = "Verbindung wird geprüft …";
    } else if (this.lichessConnection.connected) {
      const username = this.lichessConnection.user?.username || "Verbunden";
      detail.textContent = `${username} · nur Lesen und Import`;
      const importButton = document.createElement("button");
      importButton.type = "button";
      importButton.className = "primary-action-button";
      importButton.textContent = "Partien importieren";
      importButton.addEventListener("click", () => this.openLichessImportDialog());
      const disconnect = document.createElement("button");
      disconnect.type = "button";
      disconnect.className = "secondary-button";
      disconnect.textContent = "Trennen";
      disconnect.addEventListener("click", () => this.disconnectLichess());
      actions.append(importButton, disconnect);
    } else {
      detail.textContent = this.lichessConnection.error
        || "Sicher verbinden – keine Spiel- oder Schreibrechte";
      const connect = document.createElement("button");
      connect.type = "button";
      connect.className = "primary-action-button";
      connect.textContent = "Mit Lichess verbinden";
      connect.addEventListener("click", () => {
        window.location.assign("/api/lichess/connect");
      });
      actions.appendChild(connect);
    }
    card.append(brand, actions);
    parent.appendChild(card);
  }

  async disconnectLichess() {
    if (this.lichessImportBusy) return;
    const confirmed = window.confirm(
      "Lichess-Verbindung trennen? Bereits importierte Partien bleiben erhalten.",
    );
    if (!confirmed) return;
    this.lichessImportBusy = true;
    try {
      await fetch("/api/lichess/disconnect", { method: "POST" });
      this.lichessConnection = {
        loading: false,
        connected: false,
        user: null,
        error: "",
      };
      this.showToast("Lichess-Verbindung getrennt.");
    } catch {
      this.showToast("Lichess konnte nicht getrennt werden.");
    } finally {
      this.lichessImportBusy = false;
      if (this.accountDialog?.open) this.renderAccountDialog();
    }
  }

  openLichessImportDialog() {
    if (!this.lichessConnection.connected || !this.lichessImportDialog) return;
    this.lichessFetchedGames = [];
    this.lichessImportResultsEl.replaceChildren();
    this.lichessImportStatusEl.textContent = "Wähle Filter und lade deine abgeschlossenen Partien.";
    this.lichessImportButton.disabled = true;
    this.lichessImportAllButton.disabled = true;
    this.lichessReturnToAccount = true;
    this.accountDialog?.close();
    this.lichessImportDialog.showModal();
    this.lichessLoadButton?.focus();
  }

  async loadLichessGames() {
    if (this.lichessImportBusy || !this.lichessConnection.connected) return;
    this.lichessImportBusy = true;
    this.lichessLoadButton.disabled = true;
    this.lichessImportButton.disabled = true;
    this.lichessImportAllButton.disabled = true;
    this.lichessImportStatusEl.textContent = "Lichess-Partien werden geladen …";
    this.lichessImportResultsEl.replaceChildren();
    const params = new URLSearchParams();
    params.set("max", this.lichessMaxInput.value || "10");
    if (this.lichessPerfInput.value) params.set("perfType", this.lichessPerfInput.value);
    if (this.lichessRatedInput.value) params.set("rated", this.lichessRatedInput.value);
    if (this.lichessColorInput.value) params.set("color", this.lichessColorInput.value);
    if (this.lichessSinceInput.value) {
      const since = new Date(`${this.lichessSinceInput.value}T00:00:00`).getTime();
      if (Number.isFinite(since)) params.set("since", String(since));
    }
    try {
      const response = await fetch(`/api/lichess/games?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Partien konnten nicht geladen werden.");
      this.lichessFetchedGames = Array.isArray(payload.games) ? payload.games : [];
      this.renderLichessImportResults(payload.username);
    } catch (error) {
      this.lichessImportStatusEl.textContent = error?.message || "Lichess ist gerade nicht erreichbar.";
    } finally {
      this.lichessImportBusy = false;
      this.lichessLoadButton.disabled = false;
    }
  }

  renderLichessImportResults(username = this.lichessConnection.user?.username) {
    this.lichessImportResultsEl.replaceChildren();
    const existingIds = new Set((this.accountState?.games || []).map((game) => game.id));
    const deletedIds = new Set((this.accountState?.deletedGames || []).map((game) => game.id));
    let selectable = 0;
    this.lichessFetchedGames.forEach((game) => {
      const recordId = `lichess:${game.id}`;
      const importError = lichessImportability(game, username);
      const alreadyImported = existingIds.has(recordId);
      const previouslyDeleted = deletedIds.has(recordId);
      const disabledReason = alreadyImported
        ? "Bereits importiert"
        : previouslyDeleted
          ? "Zuvor gelöscht"
          : importError;
      const label = document.createElement("label");
      label.className = `lichess-game-option${disabledReason ? " is-disabled" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = game.id;
      checkbox.checked = !disabledReason;
      checkbox.disabled = Boolean(disabledReason);
      checkbox.addEventListener("change", () => {
        const hasSelected = Boolean(this.lichessImportResultsEl
          .querySelector('input[type="checkbox"]:checked:not(:disabled)'));
        this.lichessImportButton.disabled = !hasSelected;
      });
      const copy = document.createElement("span");
      const players = document.createElement("strong");
      const white = game.players?.white?.user?.name || "Gast";
      const black = game.players?.black?.user?.name || "Gast";
      players.textContent = `${white} – ${black}`;
      const details = document.createElement("span");
      let date = "Datum unbekannt";
      try {
        date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" })
          .format(new Date(game.createdAt));
      } catch {}
      const result = game.winner === "white"
        ? "1–0"
        : game.winner === "black" ? "0–1" : "Remis";
      const format = TIME_FORMAT_LABELS[{
        ultraBullet: "bullet",
        bullet: "bullet",
        blitz: "blitz",
        rapid: "rapid",
        classical: "classical",
        correspondence: "correspondence",
      }[game.speed]] || game.speed || "Unbekannt";
      details.textContent = `${date} · ${format} · ${result}${game.rated ? " · gewertet" : ""}`;
      const opening = document.createElement("small");
      opening.textContent = disabledReason || game.opening?.name || "Eröffnung nicht angegeben";
      copy.append(players, details, opening);
      label.append(checkbox, copy);
      this.lichessImportResultsEl.appendChild(label);
      if (!disabledReason) selectable += 1;
    });
    if (this.lichessFetchedGames.length === 0) {
      this.lichessImportStatusEl.textContent = "Für diese Filter wurden keine Partien gefunden.";
    } else {
      this.lichessImportStatusEl.textContent = selectable > 0
        ? `${this.lichessFetchedGames.length} gefunden · ${selectable} noch nicht importiert`
        : `${this.lichessFetchedGames.length} gefunden · keine neue importierbare Partie`;
    }
    this.lichessImportButton.disabled = selectable === 0;
    this.lichessImportAllButton.disabled = selectable === 0;
  }

  importAllLichessGames() {
    if (this.lichessImportBusy) return;
    this.lichessImportResultsEl
      .querySelectorAll('input[type="checkbox"]:not(:disabled)')
      .forEach((input) => {
        input.checked = true;
      });
    this.importSelectedLichessGames();
  }

  importSelectedLichessGames() {
    if (this.lichessImportBusy) return;
    const selectedIds = new Set(
      Array.from(
        this.lichessImportResultsEl.querySelectorAll(
          'input[type="checkbox"]:checked:not(:disabled)',
        ),
      ).map((input) => input.value),
    );
    if (selectedIds.size === 0) {
      this.showToast("Wähle mindestens eine neue Partie aus.");
      return;
    }
    const username = this.lichessConnection.user?.username;
    const selectedGames = this.lichessFetchedGames.filter((game) => selectedIds.has(game.id));
    const latestState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      this.accountState?.profile,
    );
    let nextState;
    try {
      nextState = mergeAccountStates(this.accountState, latestState);
      const records = selectedGames.map((game) => (
        lichessGameToSavedRecord(game, username)
      ));
      if (nextState.games.length + records.length > MAX_SAVED_GAMES) {
        throw new Error(
          `Es passen noch ${Math.max(0, MAX_SAVED_GAMES - nextState.games.length)} Partien in dein Profil.`,
        );
      }
      records.forEach((record) => {
        nextState = upsertSavedGame(nextState, record);
      });
    } catch (error) {
      this.showToast(error?.message || "Die Auswahl konnte nicht importiert werden.");
      return;
    }
    if (!saveAccountState(this.browserStorage, this.accountStorageKey, nextState)) {
      this.showToast("Der Browser konnte die importierten Partien nicht speichern.");
      return;
    }
    this.accountState = nextState;
    this.updateAccountButton();
    this.showToast(
      `${selectedGames.length} ${selectedGames.length === 1 ? "Partie" : "Partien"} importiert. Die Analyse kann jetzt gestartet werden.`,
    );
    this.lichessImportDialog.close();
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
      const nextState = loadAccountState(this.browserStorage, nextKey, profile);
      const activeInNextAccount = nextState.games.find(
        (game) => game.id === this.activeGameId,
      );
      const activeDeletedInNextAccount = nextState.deletedGames?.some(
        (deletion) => deletion.id === this.activeGameId,
      );
      const wasPersistedInPreviousAccount = this.activeGamePersisted;
      this.accountIdentity = profile;
      this.accountStorageKey = nextKey;
      this.accountState = nextState;
      this.activeGameDeletedExternally = Boolean(activeDeletedInNextAccount);
      this.activeGamePersisted = Boolean(activeInNextAccount);
      this.loadedRecordUpdatedAt = activeInNextAccount?.updatedAt || null;
      if (wasPersistedInPreviousAccount && !activeInNextAccount) {
        this.gameDirty = this.getCurrentPath().length > 1;
        if (this.gameDirty) {
          this.showToast(
            'Die laufende Partie ist in diesem Account noch nicht gespeichert. Nutze dafür „Partie speichern“.',
          );
        }
      }
      this.updateAccountButton();
      this.updateSaveGameButton();
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
    this.accountButton.setAttribute(
      'aria-label',
      `Mein Account und Spielerprofil, ${count} ${count === 1 ? 'gespeicherte Partie' : 'gespeicherte Partien'}`,
    );
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
      ? 'Du bist über Sites angemeldet. Partien werden nur nach deinem Speicher- oder Import-Klick in diesem Browser abgelegt.'
      : 'Partien werden nur nach deinem Speicher- oder Import-Klick in diesem Browser abgelegt und bleiben nach dem Neuladen erhalten.';
    this.accountBodyEl.appendChild(storageNote);
    this.renderLichessConnectionCard(this.accountBodyEl);

    const saveCurrent = document.createElement('button');
    saveCurrent.type = 'button';
    saveCurrent.className = 'primary-action-button account-save-button';
    saveCurrent.textContent = this.activeGamePersisted
      ? 'Partiedaten und Änderungen speichern'
      : 'Aktuelle Partie speichern';
    saveCurrent.addEventListener('click', () => {
      this.accountDialog.close();
      this.openSaveGameDialog(this.saveGameButton);
    });
    this.accountBodyEl.appendChild(saveCurrent);

    const games = this.accountState?.games || [];
    const playerStats = buildPlayerProfile(games);
    const analyzedGameIds = new Set(playerStats.analyzedGameIds);
    const pendingAnalysisGames = games.filter((game) => !analyzedGameIds.has(game.id));
    const analyzeSavedGame = (game) => {
      if (!game || !this.openSavedGame(game)) return;
      requestAnimationFrame(() => this.startFullGameReview());
    };
    const formatPercent = (value) => (
      Number.isFinite(value) ? `${value.toFixed(1).replace('.', ',')} %` : '—'
    );
    const formatDecimal = (value, suffix = '') => (
      Number.isFinite(value) ? `${value.toFixed(1).replace('.', ',')}${suffix}` : '—'
    );
    const gamesLabel = (count) => `${count} ${count === 1 ? 'Partie' : 'Partien'}`;

    const profileHeading = document.createElement('div');
    profileHeading.className = 'account-section-title profile-section-title';
    const profileHeadingCopy = document.createElement('div');
    const profileHeadingTitle = document.createElement('strong');
    profileHeadingTitle.textContent = 'Spielerprofil';
    const profileCoverage = document.createElement('span');
    profileCoverage.textContent = `${playerStats.totalGames} gespeichert · ${playerStats.analyzedGames} analysiert`;
    profileHeadingCopy.append(profileHeadingTitle, profileCoverage);
    profileHeading.appendChild(profileHeadingCopy);
    this.accountBodyEl.appendChild(profileHeading);

    const overview = document.createElement('dl');
    overview.className = 'profile-overview';
    const appendMetric = (label, value, detail) => {
      const metric = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      const small = document.createElement('small');
      small.textContent = detail;
      metric.append(term, description, small);
      overview.appendChild(metric);
    };
    appendMetric(
      'Deine Genauigkeit',
      formatPercent(playerStats.ownAccuracy),
      'gewichtet nach deinen analysierten Zügen',
    );
    appendMetric(
      'Bilanz',
      `${playerStats.results.wins} S · ${playerStats.results.draws} R · ${playerStats.results.losses} N`,
      `${gamesLabel(playerStats.results.unknown)} noch ohne Ergebnis`,
    );
    appendMetric(
      'Punktquote',
      formatPercent(playerStats.results.scoreRate),
      'Siege plus halbe Remispunkte',
    );
    appendMetric(
      'Analyseabdeckung',
      `${playerStats.analyzedGames} / ${playerStats.totalGames}`,
      'nur gespeicherte Partien',
    );
    this.accountBodyEl.appendChild(overview);

    if (this.batchReviewRunning && this.batchReviewProgress) {
      const processed = this.batchReviewProgress.completed + this.batchReviewProgress.failed;
      const progressCard = document.createElement('section');
      progressCard.className = 'batch-analysis-card is-running';
      const progressTop = document.createElement('div');
      const progressTitle = document.createElement('strong');
      progressTitle.textContent = 'Gesamtanalyse läuft im Hintergrund';
      const progressValue = document.createElement('span');
      progressValue.textContent = `${processed}/${this.batchReviewProgress.total} verarbeitet · ${this.batchReviewProgress.completed} erfolgreich`;
      progressTop.append(progressTitle, progressValue);
      const progress = document.createElement('progress');
      progress.max = Math.max(1, this.batchReviewProgress.total);
      progress.value = processed;
      progress.setAttribute('aria-label', 'Fortschritt der Gesamtanalyse');
      const active = document.createElement('small');
      active.textContent = this.batchReviewProgress.activeTitles.length
        ? `Parallel aktiv: ${this.batchReviewProgress.activeTitles.join(' · ')}`
        : 'Die nächsten Partien werden vorbereitet …';
      progressCard.append(progressTop, progress, active);
      this.accountBodyEl.appendChild(progressCard);
    } else if (this.batchReviewSummary) {
      const summary = this.batchReviewSummary;
      const summaryCard = document.createElement('section');
      summaryCard.className = 'batch-analysis-card is-complete';
      const title = document.createElement('strong');
      title.textContent = 'Gesamtanalyse abgeschlossen';
      const lead = document.createElement('p');
      lead.textContent = `${summary.completed} Partien neu analysiert${summary.failed ? ` · ${summary.failed} nicht abgeschlossen` : ''}. Deine Gesamtgenauigkeit liegt bei ${formatPercent(summary.ownAccuracy)}.`;
      const facts = document.createElement('div');
      facts.className = 'batch-analysis-summary-facts';
      [
        ['Punktquote', formatPercent(summary.scoreRate)],
        ['Stärkere Farbe', summary.strongerColor],
        ['Lieblingseröffnung', summary.favoriteOpening],
        ['Trainingssignal', summary.trainingSignal],
      ].forEach(([label, value]) => {
        const item = document.createElement('div');
        const itemLabel = document.createElement('span');
        itemLabel.textContent = label;
        const itemValue = document.createElement('strong');
        itemValue.textContent = value;
        item.append(itemLabel, itemValue);
        facts.appendChild(item);
      });
      summaryCard.append(title, lead, facts);
      this.accountBodyEl.appendChild(summaryCard);
    }

    if (pendingAnalysisGames.length > 0) {
      const analysisPending = document.createElement('div');
      analysisPending.className = 'profile-analysis-pending';
      const pendingCopy = document.createElement('div');
      const pendingTitle = document.createElement('strong');
      pendingTitle.textContent = this.batchReviewRunning
        ? `${gamesLabel(pendingAnalysisGames.length)} wird im Hintergrund analysiert`
        : `${gamesLabel(pendingAnalysisGames.length)} wartet auf vollständige Analyse`;
      const pendingDetail = document.createElement('span');
      pendingDetail.textContent = this.batchReviewRunning
        ? 'Du kannst im Profil bleiben oder weiterarbeiten. Das Brett wird nicht gewechselt.'
        : 'Ein Klick analysiert alle ausstehenden Partien parallel, ohne sie einzeln zu öffnen.';
      pendingCopy.append(pendingTitle, pendingDetail);
      const analyzeAll = document.createElement('button');
      analyzeAll.type = 'button';
      analyzeAll.className = 'primary-action-button';
      analyzeAll.textContent = `Alle ${pendingAnalysisGames.length} parallel analysieren`;
      analyzeAll.disabled = this.batchReviewRunning;
      analyzeAll.addEventListener('click', () => this.analyzeAllSavedGames());
      const pendingActions = document.createElement('div');
      pendingActions.className = 'profile-analysis-actions';
      pendingActions.append(analyzeAll);
      analysisPending.append(pendingCopy, pendingActions);
      this.accountBodyEl.appendChild(analysisPending);
    }

    const factsHeading = document.createElement('div');
    factsHeading.className = 'account-subsection-title';
    factsHeading.textContent = 'Deine Key Facts';
    this.accountBodyEl.appendChild(factsHeading);
    const facts = document.createElement('div');
    facts.className = 'profile-facts';
    const appendFact = (label, value, detail = '') => {
      const fact = document.createElement('div');
      const factLabel = document.createElement('span');
      factLabel.textContent = label;
      const factValue = document.createElement('strong');
      factValue.textContent = value;
      fact.append(factLabel, factValue);
      if (detail) {
        const factDetail = document.createElement('small');
        factDetail.textContent = detail;
        fact.appendChild(factDetail);
      }
      facts.appendChild(fact);
    };
    let strongerColor = 'Noch offen';
    if (Number.isFinite(playerStats.whiteAccuracy) && Number.isFinite(playerStats.blackAccuracy)) {
      strongerColor = playerStats.whiteAccuracy === playerStats.blackAccuracy
        ? 'Ausgeglichen'
        : playerStats.whiteAccuracy > playerStats.blackAccuracy ? 'Weiß' : 'Schwarz';
    }
    appendFact(
      'Stärkere Farbe',
      strongerColor,
      `Weiß ${formatPercent(playerStats.whiteAccuracy)} · Schwarz ${formatPercent(playerStats.blackAccuracy)}`,
    );
    appendFact(
      'Lieblingseröffnung',
      playerStats.favoriteOpening?.name || 'Noch offen',
      playerStats.favoriteOpening ? gamesLabel(playerStats.favoriteOpening.games) : 'Eröffnung beim Speichern erfassen',
    );
    appendFact(
      'Beste Eröffnung',
      playerStats.bestOpening?.name || 'Mehr Partien nötig',
      playerStats.bestOpening
        ? `${formatPercent(playerStats.bestOpening.scoreRate)} Punktquote`
        : 'wird ab zwei Partien verglichen',
    );
    appendFact(
      'Häufigstes Zeitformat',
      playerStats.mostCommonTimeFormat?.name || 'Noch offen',
      playerStats.mostCommonTimeFormat
        ? gamesLabel(playerStats.mostCommonTimeFormat.games)
        : 'Zeitformat beim Speichern wählen',
    );
    appendFact(
      'Ø Verlust pro Zug',
      formatDecimal(playerStats.ownAverageCentipawnLoss, ' cp'),
      'nur deine analysierten Züge',
    );
    appendFact(
      'Letzte Form',
      formatPercent(playerStats.currentForm.scoreRate),
      playerStats.currentForm.sequence.length
        ? playerStats.currentForm.sequence
          .map((result) => ({ W: 'S', D: 'R', L: 'N' }[result] || '–'))
          .join(' · ')
        : 'Noch keine abgeschlossenen Partien',
    );
    appendFact(
      'Ø Partielänge',
      Number.isFinite(playerStats.averageMoves) ? `${playerStats.averageMoves} Züge` : '—',
      playerStats.longestGame ? `längste: ${playerStats.longestGame.moves} Züge` : '',
    );
    appendFact(
      'Eigene Fehler',
      `${playerStats.ownMistakes} Fehler · ${playerStats.ownBlunders} Patzer`,
      playerStats.ownQualityCounts.sourceGames === 1
        ? 'aus 1 detaillierter Analyse'
        : `aus ${playerStats.ownQualityCounts.sourceGames} detaillierten Analysen`,
    );
    this.accountBodyEl.appendChild(facts);

    if (playerStats.openingStats.length > 0) {
      const openingsHeading = document.createElement('div');
      openingsHeading.className = 'account-subsection-title';
      openingsHeading.textContent = 'Eröffnungsrepertoire';
      this.accountBodyEl.appendChild(openingsHeading);
      const openings = document.createElement('div');
      openings.className = 'opening-profile-list';
      playerStats.openingStats.slice(0, 4).forEach((opening) => {
        const item = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = opening.name;
        const detail = document.createElement('span');
        detail.textContent = `${gamesLabel(opening.games)} · ${formatPercent(opening.scoreRate)} Punktquote · ${formatPercent(opening.ownAccuracy)} Genauigkeit`;
        item.append(name, detail);
        openings.appendChild(item);
      });
      this.accountBodyEl.appendChild(openings);
    }

    const bestHeading = document.createElement('div');
    bestHeading.className = 'account-section-title';
    bestHeading.textContent = 'Deine besten Partien';
    this.accountBodyEl.appendChild(bestHeading);
    if (playerStats.topGameIds.length === 0) {
      const bestEmpty = document.createElement('p');
      bestEmpty.className = 'muted';
      bestEmpty.textContent = 'Nach der ersten analysierten und gespeicherten Partie erscheint hier dein Highlight.';
      this.accountBodyEl.appendChild(bestEmpty);
    } else {
      const bestList = document.createElement('ol');
      bestList.className = 'best-games-list';
      playerStats.topGameIds.forEach((id, index) => {
        const game = games.find((candidate) => candidate.id === id);
        const ranking = playerStats.bestGames.find((candidate) => candidate.id === id);
        if (!game || !ranking) return;
        const item = document.createElement('li');
        item.className = `best-game-card rank-${index + 1}`;
        const badge = document.createElement('span');
        badge.className = 'best-game-badge';
        badge.textContent = index === 0 ? '#1 Bestpartie' : `#${index + 1} Top-Partie`;
        const title = document.createElement('strong');
        title.textContent = game.title;
        const details = document.createElement('span');
        details.textContent = `${formatPercent(ranking.accuracy)} Genauigkeit · ${ranking.blunders} Patzer · ${formatPercent(ranking.coverage)} analysiert`;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'secondary-button';
        open.textContent = 'Öffnen';
        open.addEventListener('click', () => this.openSavedGame(game));
        item.append(badge, title, details, open);
        bestList.appendChild(item);
      });
      this.accountBodyEl.appendChild(bestList);
    }

    const gamesHeading = document.createElement('div');
    gamesHeading.className = 'account-section-title';
    gamesHeading.textContent = 'Alle gespeicherten Partien';
    this.accountBodyEl.appendChild(gamesHeading);

    if (games.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Noch keine gespeicherte Partie. Spiele mindestens einen Zug und wähle „Partie speichern“.';
      this.accountBodyEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'saved-games-list';
    games.forEach((game) => {
      const item = document.createElement('div');
      item.className = 'saved-game';
      const topRank = playerStats.topGameIds.indexOf(game.id);
      if (topRank >= 0) item.classList.add('is-top-game', `rank-${topRank + 1}`);
      const copy = document.createElement('div');
      if (topRank >= 0) {
        const badge = document.createElement('span');
        badge.className = 'saved-game-highlight';
        badge.textContent = topRank === 0 ? '★ Bestpartie' : `Top ${topRank + 1}`;
        copy.appendChild(badge);
      }
      const title = document.createElement('strong');
      title.textContent = game.title;
      const detail = document.createElement('span');
      let date = game.metadata?.playedAt || game.updatedAt;
      try {
        const parsed = game.metadata?.playedAt
          ? new Date(`${game.metadata.playedAt}T12:00:00`)
          : new Date(game.updatedAt);
        date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(parsed);
      } catch {}
      const color = game.metadata?.playerColor === 'w'
        ? 'als Weiß'
        : game.metadata?.playerColor === 'b' ? 'als Schwarz' : 'Farbe fehlt';
      const opponent = game.metadata?.opponent ? `gegen ${game.metadata.opponent}` : 'Gegner offen';
      detail.textContent = `${date} · ${opponent} · ${color} · ${RESULT_LABELS[game.result] || game.result}`;
      const analysis = document.createElement('span');
      const opening = game.metadata?.opening || 'Eröffnung nicht erfasst';
      const format = TIME_FORMAT_LABELS[game.metadata?.timeFormat] || 'Zeitformat fehlt';
      if (analyzedGameIds.has(game.id)) {
        const ownAccuracy = game.metadata?.playerColor === 'w'
          ? game.review?.whiteAccuracy
          : game.metadata?.playerColor === 'b' ? game.review?.blackAccuracy : game.review?.overallAccuracy;
        analysis.textContent = `${opening} · ${format} · ${formatPercent(ownAccuracy)} Genauigkeit`;
      } else {
        analysis.textContent = `${opening} · ${format} · Analyse ausstehend`;
        analysis.classList.add('analysis-pending-label');
      }
      copy.append(title, detail, analysis);
      if (analyzedGameIds.has(game.id) && game.review?.feedback) {
        const coachSummary = document.createElement('span');
        coachSummary.className = 'saved-game-coach-summary';
        coachSummary.textContent = String(game.review.feedback)
          .replace(/[*#_`]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 190);
        copy.appendChild(coachSummary);
      }

      const itemActions = document.createElement('div');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'secondary-button';
      open.textContent = 'Öffnen';
      open.addEventListener('click', () => this.openSavedGame(game));
      itemActions.appendChild(open);
      if (!analyzedGameIds.has(game.id)) {
        const analyze = document.createElement('button');
        analyze.type = 'button';
        analyze.className = 'secondary-button';
        analyze.textContent = 'Einzeln analysieren';
        analyze.addEventListener('click', () => analyzeSavedGame(game));
        itemActions.appendChild(analyze);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary-button';
      edit.textContent = 'Partiedaten';
      edit.addEventListener('click', () => {
        if (this.openSavedGame(game)) this.openSaveGameDialog(this.saveGameButton);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger-button';
      remove.textContent = 'Löschen';
      remove.addEventListener('click', () => this.deleteSavedGame(game));
      itemActions.append(edit, remove);
      item.append(copy, itemActions);
      list.appendChild(item);
    });
    this.accountBodyEl.appendChild(list);
  }

  async analyzeSavedPathInBackground(path, depth) {
    let pending = null;
    const engine = new Engine({
      depth,
      threads: 1,
      hashMB: 32,
      multiPV: 1,
      onInfo: (info) => {
        if (
          !pending
          || info?.searchId !== pending.searchId
          || info?.fen !== pending.fen
          || (info?.multipv || 1) !== 1
        ) return;
        const entry = analysisEntryFromInfo(info);
        if (entry && (!info.depth || info.depth >= pending.depth)) pending.resolve(entry);
      },
      onError: (error) => pending?.reject(error),
    });
    this.batchReviewEngines.add(engine);
    const cache = new Map();
    const evaluations = [];
    const analyzeFen = (fen) => new Promise((resolve, reject) => {
      const searchId = engine.evaluate(fen, depth);
      if (!searchId) {
        reject(new Error("Stockfish konnte eine Hintergrundanalyse nicht starten."));
        return;
      }
      const timeout = window.setTimeout(() => {
        if (pending?.searchId === searchId) pending = null;
        reject(new Error("Eine Partieanalyse hat zu lange gedauert."));
      }, 30_000);
      pending = {
        fen,
        depth,
        searchId,
        resolve: (entry) => {
          window.clearTimeout(timeout);
          if (pending?.searchId === searchId) pending = null;
          resolve(entry);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          if (pending?.searchId === searchId) pending = null;
          reject(error);
        },
      };
    });

    try {
      for (const node of path) {
        const terminal = terminalWhiteCp(node.fen);
        let entry;
        if (Number.isFinite(terminal)) {
          entry = { whiteCp: terminal, depth, pv: [], complete: true };
        } else if (cache.has(node.fen)) {
          entry = cache.get(node.fen);
        } else {
          entry = await analyzeFen(node.fen);
          cache.set(node.fen, entry);
        }
        evaluations.push(entry);
        if (!node.analysis?.depth || !entry.depth || entry.depth >= node.analysis.depth) {
          node.analysis = entry;
        }
      }
      return evaluations;
    } finally {
      pending?.reject?.(new DOMException("Analyse beendet.", "AbortError"));
      try { engine.quit?.(); } catch {}
      this.batchReviewEngines.delete(engine);
    }
  }

  async analyzeSavedRecordInBackground(record) {
    const root = deserializeMoveTree(record?.tree);
    if (!root) throw new Error(`„${record?.title || "Partie"}“ enthält keinen gültigen Spielstand.`);
    const node = (Array.isArray(record.currentPath)
      ? findNodeByPath(root, record.currentPath)
      : null)
      || findNodeByFen(root, record.currentFen)
      || root;
    const path = pathToNode(node);
    if (path.length < 2) throw new Error(`„${record.title}“ enthält noch keinen Zug.`);
    const depth = reviewDepthForPlies(path.length - 1, this.engine?.depth || 15);
    const evaluations = await this.analyzeSavedPathInBackground(path, depth);
    const report = summarizeGameReview(path, evaluations, { depth, final: true });
    report.result = record.result;
    report.feedback = buildFallbackFeedback(report);

    const coachController = new AbortController();
    this.batchCoachControllers.add(coachController);
    try {
      const feedback = await this.requestCoachGameFeedback(report, path, {
        signal: coachController.signal,
      });
      if (feedback) report.feedback = feedback;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    } finally {
      this.batchCoachControllers.delete(coachController);
    }

    return {
      ...record,
      updatedAt: new Date().toISOString(),
      tree: serializeMoveTree(root),
      review: report,
    };
  }

  persistBackgroundReview(record) {
    const latestState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      this.accountState?.profile,
    );
    let nextState = mergeAccountStates(this.accountState, latestState);
    nextState = upsertSavedGame(nextState, record);
    if (!saveAccountState(this.browserStorage, this.accountStorageKey, nextState)) {
      throw new Error("Eine fertige Hintergrundanalyse konnte nicht gespeichert werden.");
    }
    this.accountState = nextState;
    if (record.id === this.activeGameId) {
      this.savedGameReview = record.review;
      this.gameReviewReport = record.review;
      this.loadedRecordUpdatedAt = record.updatedAt;
      this.updateAccuracyDisplay();
    }
  }

  updateBatchReviewUi() {
    if (this.accountDialog?.open) this.renderAccountDialog();
    this.updateAccountButton();
  }

  async analyzeAllSavedGames() {
    if (this.batchReviewRunning || this.reviewRunning) return;
    const playerStats = buildPlayerProfile(this.accountState?.games || []);
    const analyzedIds = new Set(playerStats.analyzedGameIds);
    const pendingGames = (this.accountState?.games || [])
      .filter((game) => !analyzedIds.has(game.id));
    if (pendingGames.length === 0) {
      this.showToast("Alle gespeicherten Partien sind bereits analysiert.");
      return;
    }
    const confirmed = window.confirm(
      `${pendingGames.length} gespeicherte ${pendingGames.length === 1 ? "Partie" : "Partien"} im Hintergrund analysieren? Zwei Partien werden parallel verarbeitet; dein aktuelles Brett bleibt unverändert.`,
    );
    if (!confirmed) return;

    this.batchReviewRunning = true;
    this.batchReviewCancelled = false;
    this.batchReviewSummary = null;
    this.batchReviewProgress = {
      total: pendingGames.length,
      completed: 0,
      failed: 0,
      activeTitles: [],
    };
    this.updateBatchReviewUi();

    let cursor = 0;
    const worker = async () => {
      while (cursor < pendingGames.length && !this.batchReviewCancelled) {
        const index = cursor;
        cursor += 1;
        const record = pendingGames[index];
        this.batchReviewProgress.activeTitles.push(record.title);
        this.updateBatchReviewUi();
        try {
          const analyzedRecord = await this.analyzeSavedRecordInBackground(record);
          this.persistBackgroundReview(analyzedRecord);
          this.batchReviewProgress.completed += 1;
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.error("[ChessApp] Hintergrundanalyse fehlgeschlagen", record.title, error);
            this.batchReviewProgress.failed += 1;
          }
        } finally {
          this.batchReviewProgress.activeTitles = this.batchReviewProgress.activeTitles
            .filter((title) => title !== record.title);
          this.updateBatchReviewUi();
        }
      }
    };

    try {
      const concurrency = Math.min(2, pendingGames.length);
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      this.batchReviewRunning = false;
      this.batchReviewCancelled = false;
      const stats = buildPlayerProfile(this.accountState?.games || []);
      const strongerColor = Number.isFinite(stats.whiteAccuracy)
        && Number.isFinite(stats.blackAccuracy)
        ? stats.whiteAccuracy === stats.blackAccuracy
          ? "Ausgeglichen"
          : stats.whiteAccuracy > stats.blackAccuracy ? "Weiß" : "Schwarz"
        : "Noch offen";
      const mistakes = (stats.ownMistakes || 0) + (stats.ownBlunders || 0);
      this.batchReviewSummary = {
        completed: this.batchReviewProgress.completed,
        failed: this.batchReviewProgress.failed,
        ownAccuracy: stats.ownAccuracy,
        scoreRate: stats.results.scoreRate,
        strongerColor,
        favoriteOpening: stats.favoriteOpening?.name || "Noch offen",
        trainingSignal: mistakes > 0
          ? `${mistakes} kritische Fehler gezielt nachtrainieren`
          : "Starke Konstanz – anspruchsvollere Stellungen trainieren",
      };
      this.updateBatchReviewUi();
      this.showToast(
        `${this.batchReviewSummary.completed}/${pendingGames.length} Partien im Hintergrund analysiert.`,
      );
    }
  }

  makeSavedGameTitle(path) {
    const moves = path.slice(1, 7).map((node) => node.move?.san).filter(Boolean).join(' ');
    const opponent = this.gameSaveDraft?.opponent?.trim();
    const opening = this.gameSaveDraft?.opening?.trim();
    let date = this.gameSaveDraft?.playedAt || new Date().toISOString().slice(0, 10);
    try {
      date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
        .format(new Date(`${date}T12:00:00`));
    } catch {}
    const subject = opponent
      ? `Partie gegen ${opponent}`
      : opening || moves || 'Schachpartie';
    return `${subject} · ${date}`;
  }

  saveCurrentGame({ silent = false } = {}) {
    const path = this.getCurrentPath();
    if (path.length < 2 || !this.moveTree) {
      this.showToast('Spiele zuerst mindestens einen Zug.');
      return false;
    }
    const draft = this.gameSaveDraft || createGameSaveDraft();
    if (!draft.playerColor || !draft.playedAt || !draft.timeFormat || !draft.result) {
      this.showToast('Bitte fülle alle Pflichtfelder aus.');
      return false;
    }

    const latestState = loadAccountState(
      this.browserStorage,
      this.accountStorageKey,
      this.accountState?.profile,
    );
    let mergedState;
    try {
      mergedState = mergeAccountStates(this.accountState, latestState);
    } catch (error) {
      this.showToast(error?.message || 'Die gespeicherten Partien konnten nicht zusammengeführt werden.');
      return false;
    }

    const latestExisting = mergedState.games?.find((game) => game.id === this.activeGameId);
    const externallyChanged = this.activeGamePersisted
      && this.loadedRecordUpdatedAt
      && latestExisting?.updatedAt
      && latestExisting.updatedAt !== this.loadedRecordUpdatedAt;
    if (externallyChanged) {
      const saveCopy = window.confirm(
        'Diese Partie wurde in einem anderen Tab verändert. Als neue Kopie speichern?',
      );
      if (!saveCopy) return false;
      this.activeGameId = createGameId();
      this.activeGamePersisted = false;
      this.loadedRecordUpdatedAt = null;
    }

    if (
      this.activeGameDeletedExternally
      || mergedState.deletedGames?.some(
      (deletion) => deletion.id === this.activeGameId,
      )
    ) {
      this.activeGameId = createGameId();
      this.activeGameDeletedExternally = false;
      this.activeGamePersisted = false;
      this.loadedRecordUpdatedAt = null;
    }

    const existing = mergedState.games?.find((game) => game.id === this.activeGameId);
    const now = new Date().toISOString();
    const reviewCandidate = this.gameReviewReport || this.savedGameReview;
    const completeReview = reviewCandidate?.final === true
      && Number.isFinite(reviewCandidate.coverage)
      && reviewCandidate.coverage >= 95
      ? reviewCandidate
      : null;
    let nextState;
    let record;
    try {
      record = {
        id: this.activeGameId,
        title: draft.title.trim() || this.makeSavedGameTitle(path),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        manualSavedAt: now,
        result: draft.result,
        plyCount: path.length - 1,
        currentFen: this.currentNode.fen,
        currentPath: nodePathFromRoot(this.currentNode),
        pgn: moveTreeToPgn(this.moveTree),
        tree: serializeMoveTree(this.moveTree),
        review: completeReview,
        metadata: {
          playerColor: draft.playerColor,
          playedAt: draft.playedAt,
          opponent: draft.opponent,
          opponentType: draft.opponentType,
          engineLevel: draft.engineLevel,
          opening: draft.opening,
          timeFormat: draft.timeFormat,
          timeControl: draft.timeControl,
          platform: draft.platform,
          event: draft.event,
          playerRating: draft.playerRating,
          opponentRating: draft.opponentRating,
          rated: draft.rated === 'yes' ? true : draft.rated === 'no' ? false : null,
          notes: draft.notes,
        },
      };
      nextState = upsertSavedGame(mergedState, record);
    } catch (error) {
      this.showToast(error?.message || 'Die Partie konnte nicht gespeichert werden.');
      return false;
    }

    const saved = saveAccountState(this.browserStorage, this.accountStorageKey, nextState);
    if (!saved) {
      this.storageWarningShown = true;
      this.showToast('Der Browser konnte die Partie nicht speichern. Der Entwurf bleibt erhalten.');
      return false;
    }

    this.accountState = nextState;
    this.activeGamePersisted = true;
    this.gameDirty = false;
    this.gameSaveDraftDirty = false;
    this.loadedRecordUpdatedAt = now;
    this.gameSaveDraft.title = record.title;
    this.updateAccountButton();
    this.updateSaveGameButton();
    if (this.accountDialog?.open) this.renderAccountDialog();
    this.saveGameDialog?.close();
    if (!silent) {
      this.showToast(
        completeReview
          ? 'Partie gespeichert und Spielerprofil aktualisiert.'
          : 'Partie gespeichert. Die vollständige Profilanalyse steht noch aus.',
      );
    }
    return true;
  }

  openSavedGame(record) {
    if (!record?.tree) return false;
    if (!this.confirmDiscardUnsavedGame('eine andere Partie öffnen')) return false;
    this.cancelPlaySession();
    this.appMode = "analysis";
    this.engine?.setMultiPV?.(this.suggestionCount === 0 ? 1 : this.suggestionCount);
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
      this.declaredGameResult = !game.isGameOver()
        && ["1-0", "0-1", "1/2-1/2"].includes(record.result)
          ? record.result
          : null;
      this.activeGameId = record.id;
      this.activeGameDeletedExternally = false;
      this.activeGamePersisted = true;
      this.gameDirty = false;
      this.loadedRecordUpdatedAt = record.updatedAt || null;
      this.gameSaveDraft = createGameSaveDraft(record);
      this.gameSaveDraftDirty = false;
      this.gameReviewReport = record.review || null;
      this.savedGameReview = record.review || null;
      this.liveAccuracyReport = record.review || null;
      this.board.position(node.fen, false);
      this.renderMoveList();
      this.updateGameStatus();
      this.updateAccuracyDisplay();
      this.updateSaveGameButton();
      this.updateModeUi();
      this.evaluateCurrentPosition();
      this.accountDialog?.close();
      this.showToast('Gespeicherte Partie geöffnet.');
      return true;
    } catch (error) {
      console.error('[ChessApp] Gespeicherte Partie ungültig', error);
      this.showToast('Diese gespeicherte Partie konnte nicht geöffnet werden.');
      return false;
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
    if (record.id === this.activeGameId) {
      this.activeGameId = createGameId();
      this.activeGameDeletedExternally = false;
      this.activeGamePersisted = false;
      this.loadedRecordUpdatedAt = null;
      this.gameDirty = this.getCurrentPath().length > 1;
      this.updateSaveGameButton();
    }
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
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopSuggestionPreview();
    if (!fen) return;
    const node = findNodeByFen(this.moveTree, fen);
    if (!node) return;
    this.currentNode = node;
    this.game.load(node.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
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

  buildMoveAnnotations() {
    const annotations = new Map();
    const path = this.getCurrentPath();
    const report = this.gameReviewReport || this.liveAccuracyReport || this.savedGameReview;

    if (Array.isArray(report?.moves)) {
      report.moves.forEach((move) => {
        const node = path[move?.ply];
        if (!node?.move) return;
        const quality = MOVE_QUALITY[move.quality];
        annotations.set(node, {
          ...move,
          label: quality?.label || "",
          explanation: move.explanation || explainMoveQuality(move),
        });
      });
    }

    const visited = new Set();
    const visit = (node) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (
        node.parent?.analysis
        && node.analysis
        && node.move
        && !annotations.has(node)
      ) {
        const metrics = calculateMoveAccuracy(
          node.parent.analysis.whiteCp,
          node.analysis.whiteCp,
          node.move.color,
        );
        if (metrics) {
          const bestUci = node.parent.analysis.pv?.[0] || "";
          const move = {
            color: node.move.color,
            san: node.move.san,
            bestSan: uciToSan(node.parent.fen, bestUci),
            accuracy: metrics.accuracy,
            lossCp: metrics.lossCp,
            quality: metrics.quality,
          };
          annotations.set(node, {
            ...move,
            label: MOVE_QUALITY[metrics.quality]?.label || "",
            explanation: explainMoveQuality(move),
          });
        }
      }
      visit(node.mainline);
      node.variations?.forEach(visit);
    };
    visit(this.moveTree);

    if (this.appMode === "analysis") {
      visited.forEach((node) => {
        if (node.move && !annotations.has(node)) {
          annotations.set(node, {
            quality: null,
            label: "Analyse ausstehend",
            explanation: "Bewertung wird berechnet …",
          });
        }
      });
    }
    return annotations;
  }

  renderMoveList() {
    this.stopMoveListPreview();
    this.listView.render(this.moveTree, this.currentNode, {
      annotations: this.buildMoveAnnotations(),
      showExplanations: this.appMode === "analysis",
    });
  }

  scheduleBoardResize() {
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.destroyed) return;
      this.board?.resize?.();
      this.evalBar?.resizeToBoard?.();
      this.moveArrows?.resize?.();
      this.updateBoardKeyboardHighlights();
    });
  }

  getGameResult() {
    if (["1-0", "0-1", "1/2-1/2"].includes(this.declaredGameResult)) {
      return this.declaredGameResult;
    }
    if (this.game.isCheckmate()) return this.game.turn() === "w" ? "0-1" : "1-0";
    if (this.game.isDraw()) return "1/2-1/2";
    return "*";
  }

  updateGameStatus() {
    if (!this.gameStatusEl) return;
    let label;
    if (this.declaredGameResult) {
      label = this.declaredGameResult === "1/2-1/2"
        ? "Partie beendet · Remis"
        : `Partie beendet · ${this.declaredGameResult === "1-0" ? "Weiß" : "Schwarz"} gewinnt`;
    } else if (this.game.isCheckmate()) {
      label = `Schachmatt · ${this.game.turn() === "w" ? "Schwarz" : "Weiß"} gewinnt`;
    } else if (this.game.isDraw()) {
      label = "Remis";
    } else {
      label = `${this.game.turn() === "w" ? "Weiß" : "Schwarz"} am Zug${this.game.isCheck() ? " · Schach" : ""}`;
    }
    this.gameStatusEl.textContent = label;
    this.updateFeedbackAvailability();
    this.renderPlayPanel();
  }

  resetGame({ skipDiscardPrompt = false } = {}) {
    if (!skipDiscardPrompt && !this.confirmDiscardUnsavedGame('eine neue Partie beginnen')) {
      return false;
    }
    this.cancelPlaySession();
    this.cancelFullGameReview();
    this.reviewCoachController?.abort();
    this.stopSuggestionPreview();
    this.game.reset();
    this.declaredGameResult = null;
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;
    this.activeGameId = createGameId();
    this.activeGameDeletedExternally = false;
    this.activeGamePersisted = false;
    this.gameDirty = false;
    this.loadedRecordUpdatedAt = null;
    this.gameSaveDraft = createGameSaveDraft();
    this.gameSaveDraftDirty = false;
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.liveAccuracyReport = null;
    this.board.start();
    this.resetBoardKeyboardCursor();
    this.renderMoveList();
    this.updateGameStatus();
    this.updateAccuracyDisplay();
    this.updateSaveGameButton();
    this.updateModeUi();
    this.evaluateCurrentPosition();
    return true;
  }

  updateFeedbackAvailability() {
    if (!this.feedbackButton) return;
    this.feedbackButton.disabled = this.reviewRunning || !this.currentNode?.parent || !this.engine;
    this.feedbackButton.textContent = this.reviewRunning ? 'Analysiere …' : 'Partie analysieren';
    this.updateSaveGameButton();
  }

  handleEngineReady() {
    if (this.destroyed) return;
    this.engineReady = true;
    if (this.playStartButton) this.playStartButton.disabled = false;
    if (this.playSetupSubmitButton) this.playSetupSubmitButton.disabled = false;
    if (this.playEngineBadgeEl) this.playEngineBadgeEl.textContent = "Stockfish bereit";
    this.renderPlayPanel();
  }

  handleEngineError(error) {
    console.error("[ChessApp] Engine nicht verfügbar", error);
    this.stopSuggestionPreview();
    this.engineFailed = true;
    this.engineReady = false;
    this.engine = null;
    if (this.playSession.active) this.cancelPlaySession();
    if (this.playStartButton) this.playStartButton.disabled = true;
    if (this.playSetupSubmitButton) this.playSetupSubmitButton.disabled = true;
    if (this.playEngineBadgeEl) this.playEngineBadgeEl.textContent = "Engine nicht verfügbar";
    this.moveArrows?.clear();
    this.renderEngineUnavailable();
    this.engineInputs?.forEach((input) => {
      input.disabled = true;
    });
    this.updateFeedbackAvailability();
    this.renderPlayPanel();
    this.showToast("Stockfish ist ausgefallen. Die aktuelle Stellung bleibt zur Analyse erhalten.");
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
      this.coachConfigured = Boolean(status.coachConfigured);
      if (!status.coachConfigured && this.chatStatusEl) {
        this.chatStatusEl.textContent = "Für den Coach fehlt noch OPENAI_API_KEY.";
      }
      if (status.coachConfigured && this.appMode === "analysis") this.renderSuggestions();
    } catch {
      // Die Schachanalyse funktioniert auch ohne Coach-Backend.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelFullGameReview();
    this.stopSuggestionPreview();
    this.stopMoveListPreview();
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.boardKeyboardFrame) cancelAnimationFrame(this.boardKeyboardFrame);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.successAnimationTimer) window.clearTimeout(this.successAnimationTimer);
    this.chatRequestController?.abort();
    this.playCoachController?.abort();
    this.suggestionCoachController?.abort();
    if (this.suggestionCoachTimer) window.clearTimeout(this.suggestionCoachTimer);
    this.reviewCoachController?.abort();
    this.batchReviewCancelled = true;
    this.batchCoachControllers?.forEach((controller) => controller.abort());
    this.batchReviewEngines?.forEach((engine) => {
      try { engine.quit?.(); } catch {}
    });
    try { this.detachKeys?.(); } catch {}
    try { this.boardKeyboardObserver?.disconnect?.(); } catch {}
    if (this._onBoardFocus) {
      this.boardEl?.removeEventListener("focus", this._onBoardFocus);
    }
    if (this._onBoardBlur) {
      this.boardEl?.removeEventListener("blur", this._onBoardBlur);
    }
    if (this._onBoardPointerDown) {
      this.boardEl?.removeEventListener("pointerdown", this._onBoardPointerDown);
    }
    if (this._onBoardKeyDown) {
      this.boardEl?.removeEventListener("keydown", this._onBoardKeyDown);
    }
    if (this._onSkipLinkClick) {
      this.skipLink?.removeEventListener("click", this._onSkipLinkClick);
    }
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
    if (this._onPlayModeClick) {
      this.playModeButton?.removeEventListener("click", this._onPlayModeClick);
    }
    if (this._onAnalysisModeClick) {
      this.analysisModeButton?.removeEventListener("click", this._onAnalysisModeClick);
    }
    this.engineSettingsDialog?.remove();
    this.feedbackDialog?.remove();
    this.saveGameDialog?.remove();
    this.playSetupDialog?.remove();
    this.accountDialog?.remove();
    this.lichessImportDialog?.remove();
    this.toastEl?.remove();
  }
  
}
