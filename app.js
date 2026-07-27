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
  buildLearningSummary,
  buildPvFrames,
  calculateMoveAccuracy,
  describeMoveAssessment,
  explainMoveQuality,
  groundedSuggestionReason,
  legalPv,
  legalUciMove,
  pathToNode,
  reviewDepthForPlies,
  summarizeGameReview,
  terminalWhiteCp,
  uciToSan,
  verifiedMoveReview,
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
  RESULT_LABELS,
  TIME_FORMAT_LABELS,
} from "./gameMetadata.js";
import {
  loadOpeningBook,
  openingCoachContext,
} from "./openingRecognition.js";
import {
  deriveOpeningLifecycle,
  openingAnnouncementContext,
  openingMetadataName,
} from "./openingLifecycle.js";
import {
  openingKnowledgeForFamily,
  openingKnowledgeForVariation,
} from "./openingKnowledge.js";
import { gameLibraryModel } from "./gameLibrary.js";
import { buildPlayerProfile } from "./playerProfile.js";
import {
  describeLiveMove,
  engineOpponentLabel,
  ENGINE_LEVELS,
  nextStrongMoveStreak,
  normalizeEngineLevel,
  resolvePlayerColor,
} from "./playMode.js";
import { buildPositionEvidence } from "./positionEvidence.js";
import {
  buildLearnerProfile,
  learnerProfileForCoach,
} from "./learnerProfile.js";
import {
  buildLocalMoveExplanation,
  compactMoveExplanationClaims,
  moveExplanationCacheKey,
  moveExplanationToMarkdown,
} from "./coachExplanation.js";
import {
  buildCoachVisualPlan,
  moveQualityPresentation,
} from "./coachVisualization.js";

const MAX_CHAT_MESSAGES = 160;

function movePathSignature(path, maximumPly = null) {
  const nodes = Array.isArray(path) ? path : [];
  const end = Number.isInteger(maximumPly)
    ? Math.max(1, Math.min(nodes.length, maximumPly + 1))
    : nodes.length;
  return nodes
    .slice(1, end)
    .map((node) => (
      `${node?.move?.from || ""}${node?.move?.to || ""}${node?.move?.promotion || ""}`
    ).toLowerCase())
    .join(" ");
}

function reviewJourneyMomentKey(journey, move) {
  const ply = Number.isInteger(move?.ply) ? move.ply : -1;
  return [
    ply,
    move?.playedUci || "",
    move?.fenBefore || "",
    move?.fenAfter || "",
    movePathSignature(journey?.path, ply),
  ].join("|");
}

function compactReviewForStorage(review) {
  if (!review || typeof review !== "object") return review || null;
  const stripExplanation = (move) => {
    if (!move || typeof move !== "object") return move;
    const {
      coachExplanation: _coachExplanation,
      coachExplanationKey: _coachExplanationKey,
      ...compact
    } = move;
    return compact;
  };
  return {
    ...review,
    moves: Array.isArray(review.moves)
      ? review.moves.map(stripExplanation)
      : review.moves,
    criticalMoments: Array.isArray(review.criticalMoments)
      ? review.criticalMoments.map(stripExplanation)
      : review.criticalMoments,
  };
}

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
      coachAutomaticBusy: false,
      coachQueue: [],
      streak: 0,
      bestStreak: 0,
    };
    this.game = new Chess();
    this.declaredGameResult = null;
    this.moveTree = new MoveTreeNode({ fen: this.game.fen() });
    this.currentNode = this.moveTree;
    this.reduceBoardMotion = Boolean(
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
    this.boardAnimationTimer = null;

    this.board = window.Chessboard("board", {
      position: this.currentNode.fen,
      draggable: true,
      pieceTheme: "./libs/img/{piece}.png",
      moveSpeed: this.reduceBoardMotion ? 0 : 360,
      appearSpeed: this.reduceBoardMotion ? 0 : 220,
      trashSpeed: this.reduceBoardMotion ? 0 : 180,
      onDragStart: (source, piece) => this.handleDragStart(source, piece),
      onDrop: this.handleMove.bind(this),
      dropOffBoard: "snapback",
      onMoveEnd: () => this.handleBoardMoveEnd(),
      onSnapEnd: () => this.moveArrows?.setVisible(true),
      onSnapbackEnd: () => {
        this.board.position(this.game.fen());
        this.moveArrows?.setVisible(true);
      }
    });

    this.listView = new MoveListView({
      afterElementId: "board",
      onJump: (fen, node) => this.jumpToFen(fen, node),
      onPreview: (fen, element) => this.startMoveListPreview(fen, element),
      onPreviewEnd: (_fen, element) => this.stopMoveListPreview(element),
    });

    this.suggestionCount = 1;
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
    this.expandedSuggestionRanks = new Set();
    this.suggestionCoachExplanation = null;
    this.suggestionCoachPositionEvidence = null;
    this.suggestionCoachBusy = false;
    this.latestComputerExplanation = null;
    this.computerExplanationExpanded = false;
    this.suggestionExplanationExpanded = false;
    this.moveExplanationControllers = new Map();
    this.moveExplanationCache = new Map();
    this.moveExplanationStorageKey = "chess-coach.move-explanations.v3";
    this.coachGameGeneration = 1;
    this.previewState = null;
    this.moveListPreviewState = null;
    this.previewTimer = null;
    this.previewToken = 0;
    this.suggestionsDirtyDuringPreview = false;
    this._onDocumentPreviewPointerDown = (event) => {
      const activeToken = this.previewState?.row || null;
      if (
        activeToken?.getAttribute?.("aria-pressed") === "true"
        && !activeToken.contains(event.target)
      ) {
        this.stopSuggestionPreview();
      }
    };
    document.addEventListener(
      "pointerdown",
      this._onDocumentPreviewPointerDown,
      true,
    );
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
    this.reviewJourney = null;
    this.reviewJourneyCoachController = null;
    this.engineSettingsOpen = false;
    this.modalKeyHandler = null;
    this.activeGameId = createGameId();
    this.activeGameDeletedExternally = false;
    this.activeGamePersisted = false;
    this.gameDirty = false;
    this.loadedRecordUpdatedAt = null;
    this.gameSaveDraft = createGameSaveDraft();
    this.gameSaveDraftDirty = false;
    this.analysisPerspective = "w";
    this.openingBook = null;
    this.openingRecognition = null;
    this.openingLifecycle = null;
    this.openingRecordLifecycle = null;
    this.openingAutoValue = "";
    this.openingManualOverride = false;
    this.openingBookError = "";
    this.accountIdentity = null;
    this.accountStorageKey = storageKeyForIdentity(null);
    try {
      this.browserStorage = window.localStorage;
    } catch {
      this.browserStorage = null;
    }
    this.loadMoveExplanationCache();
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

    const statusGroup = document.createElement("section");
    statusGroup.className = "board-status-group game-library-card";
    statusGroup.setAttribute("aria-label", "Partieübersicht");
    const libraryHeader = document.createElement("div");
    libraryHeader.className = "game-library-header";
    const contextEyebrow = document.createElement("span");
    contextEyebrow.className = "board-context-eyebrow";
    contextEyebrow.textContent = "Partie";
    libraryHeader.appendChild(contextEyebrow);
    this.saveStatusEl = document.createElement("div");
    this.saveStatusEl.className = "save-status is-unsaved";
    this.saveStatusEl.setAttribute("role", "status");
    this.saveStatusEl.setAttribute("aria-live", "polite");
    this.saveStatusEl.textContent = "Noch nicht gespeichert";
    libraryHeader.appendChild(this.saveStatusEl);
    statusGroup.appendChild(libraryHeader);

    const facts = document.createElement("div");
    facts.className = "game-library-facts";
    const addPlayerField = (label, key) => {
      const field = document.createElement("label");
      field.className = "game-library-fact game-library-player";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 80;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `Spielername ${label}`);
      input.addEventListener("input", () => {
        this.gameSaveDraft[key] = input.value;
        const playerColor = this.gameSaveDraft.playerColor;
        if (
          (key === "whitePlayer" && playerColor === "b")
          || (key === "blackPlayer" && playerColor === "w")
        ) {
          this.gameSaveDraft.opponent = input.value;
          if (this.saveGameInputs?.opponent) {
            this.saveGameInputs.opponent.value = input.value;
          }
        }
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
      });
      field.append(caption, input);
      facts.appendChild(field);
      return input;
    };
    this.whitePlayerInput = addPlayerField("Weiß", "whitePlayer");
    this.blackPlayerInput = addPlayerField("Schwarz", "blackPlayer");

    const addFact = (label, className = "") => {
      const fact = document.createElement("div");
      fact.className = `game-library-fact${className ? ` ${className}` : ""}`;
      const caption = document.createElement("span");
      caption.textContent = label;
      const value = document.createElement("strong");
      fact.append(caption, value);
      facts.appendChild(fact);
      return value;
    };
    this.playedAtDisplayEl = addFact("Datum");
    this.resultDisplayEl = addFact("Ergebnis");
    this.detectedOpeningEl = document.createElement("span");
    const openingFact = document.createElement("div");
    openingFact.className = "game-library-fact game-library-opening";
    const openingCaption = document.createElement("span");
    openingCaption.textContent = "Eröffnung";
    this.detectedOpeningEl.className = "board-opening";
    this.detectedOpeningEl.setAttribute("role", "status");
    this.detectedOpeningEl.setAttribute("aria-live", "polite");
    openingFact.append(openingCaption, this.detectedOpeningEl);
    facts.appendChild(openingFact);
    statusGroup.appendChild(facts);
    boardToolbar.appendChild(statusGroup);

    const moreActions = document.createElement("details");
    moreActions.className = "board-more-actions game-library-actions";
    this.boardMoreActions = moreActions;
    const moreSummary = document.createElement("summary");
    moreSummary.textContent = "•••";
    moreSummary.setAttribute("aria-label", "Weitere Brettaktionen");
    moreActions.appendChild(moreSummary);
    const moreMenu = document.createElement("div");
    moreMenu.className = "board-more-menu";
    moreActions.appendChild(moreMenu);

    this.engineSettingsButton = document.createElement("button");
    this.engineSettingsButton.type = "button";
    this.engineSettingsButton.className = "secondary-button expert-settings-button";
    this.engineSettingsButton.textContent = "⚙ Expertenmodus";
    this.engineSettingsButton.setAttribute("aria-haspopup", "dialog");
    this.engineSettingsButton.setAttribute("aria-expanded", "false");
    this.engineSettingsButton.addEventListener("click", () => {
      this.openEngineSettings();
      moreActions.open = false;
    });
    moreMenu.appendChild(this.engineSettingsButton);

    this.flipButton = document.createElement("button");
    this.flipButton.type = "button";
    this.flipButton.className = "secondary-button";
    this.flipButton.textContent = "Brett drehen";
    this.flipButton.addEventListener("click", () => {
      this.stopAllBoardPreviews();
      const orientation = this.board.flip();
      this.moveArrows?.setOrientation(orientation);
      if (this.appMode === "analysis") {
        this.setAnalysisPerspective(orientation === "black" ? "b" : "w", {
          updateBoard: false,
        });
      }
      this.resetBoardKeyboardCursor();
      this.scheduleBoardResize();
      moreActions.open = false;
    });
    moreMenu.appendChild(this.flipButton);

    this.saveGameButton = document.createElement("button");
    this.saveGameButton.type = "button";
    this.saveGameButton.className = "secondary-button save-game-button";
    this.saveGameButton.textContent = "Partie speichern";
    this.saveGameButton.setAttribute("aria-haspopup", "dialog");
    this.saveGameButton.addEventListener("click", () => {
      this.openSaveGameDialog();
      moreActions.open = false;
    });
    moreMenu.prepend(this.saveGameButton);

    this.feedbackButton = document.createElement("button");
    this.feedbackButton.type = "button";
    this.feedbackButton.className = "secondary-button";
    this.feedbackButton.textContent = "Partie analysieren";
    this.feedbackButton.disabled = true;
    this.feedbackButton.addEventListener("click", () => {
      this.startFullGameReview();
      moreActions.open = false;
    });
    moreMenu.insertBefore(this.feedbackButton, this.engineSettingsButton);

    this.exportButton = document.createElement("button");
    this.exportButton.type = "button";
    this.exportButton.className = "secondary-button";
    this.exportButton.textContent = "PGN";
    this.exportButton.addEventListener("click", () => {
      this.exportPgn();
      moreActions.open = false;
    });
    moreMenu.appendChild(this.exportButton);

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
      moreActions.open = false;
    });
    moreMenu.appendChild(this.resetButton);
    libraryHeader.appendChild(moreActions);
    boardStack.appendChild(boardToolbar);

    this.createPlayPanel(engineAvailable);
    this.createReviewJourneyPanel();

    this.suggestionsEl = document.createElement('div');
    this.suggestionsEl.id = 'engine-suggestions';
    this.suggestionsEl.className = 'card suggestions-card';
    this.suggestionsEl.innerHTML = [
      '<div class="suggestions-heading">',
      '<p class="eyebrow">Schachcomputer</p>',
      '<span>Berühren oder fokussieren: am Brett ansehen</span>',
      '</div>',
      '<div class="lines muted">Warten auf Analyse…</div>',
    ].join('');
    const suggestionsHeading = this.suggestionsEl.querySelector('.suggestions-heading');
    const perspective = document.createElement("div");
    perspective.className = "analysis-perspective";
    perspective.setAttribute("role", "group");
    perspective.setAttribute("aria-label", "Deine Farbe und Brettansicht");
    const perspectiveLabel = document.createElement("span");
    perspectiveLabel.textContent = "Deine Sicht";
    perspective.appendChild(perspectiveLabel);
    this.analysisPerspectiveButtons = {};
    [["w", "Weiß"], ["b", "Schwarz"]].forEach(([color, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "analysis-perspective-button";
      button.textContent = label;
      button.addEventListener("click", () => this.setAnalysisPerspective(color));
      this.analysisPerspectiveButtons[color] = button;
      perspective.appendChild(button);
    });
    suggestionsHeading?.appendChild(perspective);
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
    controlsTitle.textContent = 'Erweiterte Einstellungen für den Schachcomputer';
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
    controlsDescription.id = 'engine-settings-description';
    controlsDescription.className = 'dialog-description';
    controlsDescription.textContent = 'Für erfahrene Nutzer: Diese technischen Werte beeinflussen Rechenzeit und Detailtiefe. Für normales Training sind die Voreinstellungen empfohlen.';
    controls.setAttribute('aria-describedby', controlsDescription.id);
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
    label.textContent = 'Analysetiefe';
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
    tLabel.textContent = 'Rechenkerne';
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
    hLabel.textContent = 'Arbeitsspeicher (MB)';
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
    pvLabel.textContent = 'Anzahl Zugideen';
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
      onLeft: () => this.reviewJourney
        ? this.navigateReviewJourney(-1)
        : this.goBackOnePly(),
      onRight: () => this.reviewJourney
        ? this.navigateReviewJourney(1)
        : this.goForwardOnePly(),
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
    if (typeof ResizeObserver === "function" && this.boardStack) {
      this.boardStackResizeObserver = new ResizeObserver(() => {
        this.syncAnalysisColumnHeight();
      });
      this.boardStackResizeObserver.observe(this.boardStack);
    }
    this._onKeyDown = (event) => {
      if (
        event.key === "Escape"
        && (this.previewState || this.moveListPreviewState)
      ) {
        this.stopAllBoardPreviews();
      }
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
      this.refreshCoachContextAfterProfileChange();
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
    this.initializeOpeningBook();
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
    eyebrow.textContent = "Gegen den Schachcomputer";
    const title = document.createElement("h2");
    title.id = "play-mode-title";
    title.textContent = "Deine Partie";
    const description = document.createElement("p");
    description.textContent = "Spiele eine Trainingspartie und erhalte nach jedem eigenen Zug eine kurze, verständliche Rückmeldung.";
    headingCopy.append(eyebrow, title, description);
    const engineBadge = document.createElement("span");
    engineBadge.className = "play-engine-badge";
    engineBadge.textContent = !engineAvailable
      ? "Nicht verfügbar"
      : this.engineReady
        ? "Bereit"
        : "Wird geladen …";
    this.playEngineBadgeEl = engineBadge;
    heading.append(headingCopy, engineBadge);
    panel.appendChild(heading);

    this.playEmptyView = document.createElement("div");
    this.playEmptyView.className = "play-empty-state";
    const emptyTitle = document.createElement("h3");
    emptyTitle.textContent = "Neue Trainingspartie starten";
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
    liveTitle.textContent = "Dein letzter Zug";
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
    this.playFeedbackEl.tabIndex = 0;
    this.bindCoachPlanPreview(this.playFeedbackEl, () => {
      const latest = this.playSession.feedbackHistory[0];
      if (latest) this.previewCoachMove(latest);
    });
    liveCoach.appendChild(this.playFeedbackEl);

    this.playFeedbackHistoryEl = document.createElement("ol");
    this.playFeedbackHistoryEl.className = "live-feedback-history";
    this.playFeedbackHistoryEl.hidden = true;
    liveCoach.appendChild(this.playFeedbackHistoryEl);

    this.playCoachConversationEl = document.createElement("div");
    this.playCoachConversationEl.className = "play-coach-conversation";
    liveCoach.appendChild(this.playCoachConversationEl);
    const replyForm = document.createElement("div");
    replyForm.className = "play-coach-reply";
    this.playCoachInputEl = document.createElement("textarea");
    this.playCoachInputEl.rows = 2;
    this.playCoachInputEl.placeholder = "Hast du eine Frage zu deinem letzten Zug?";
    this.playCoachInputEl.setAttribute("aria-label", "Frage an den Coach zum letzten Zug");
    this.playCoachInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.handlePlayCoachReply();
      }
    });
    this.playCoachSendButton = document.createElement("button");
    this.playCoachSendButton.type = "button";
    this.playCoachSendButton.className = "secondary-button";
    this.playCoachSendButton.textContent = "Fragen";
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

  createReviewJourneyPanel() {
    const panel = document.createElement("section");
    panel.className = "card review-journey";
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    this.reviewJourneyEl = panel;

    const top = document.createElement("div");
    top.className = "review-journey-top";
    this.reviewJourneyProgressEl = document.createElement("span");
    this.reviewJourneyProgressEl.className = "review-journey-progress";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Geführte Review beenden");
    close.addEventListener("click", () => this.stopReviewJourney());
    top.append(this.reviewJourneyProgressEl, close);

    this.reviewJourneyTitleEl = document.createElement("h3");
    this.reviewJourneyMoveEl = document.createElement("div");
    this.reviewJourneyMoveEl.className = "review-journey-move";
    this.reviewJourneyCoachEl = document.createElement("div");
    this.reviewJourneyCoachEl.className = "review-journey-coach";

    const hint = document.createElement("p");
    hint.className = "review-journey-hint";
    hint.textContent = "Die farbigen Felder zeigen Schlüsselfigur, Ziel und Gefahr. Nutze auch ← und →.";

    const controls = document.createElement("div");
    controls.className = "review-journey-controls";
    this.reviewJourneyPrevEl = document.createElement("button");
    this.reviewJourneyPrevEl.type = "button";
    this.reviewJourneyPrevEl.className = "secondary-button";
    this.reviewJourneyPrevEl.textContent = "← Vorheriger Moment";
    this.reviewJourneyPrevEl.addEventListener("click", () => this.navigateReviewJourney(-1));
    this.reviewJourneyNextEl = document.createElement("button");
    this.reviewJourneyNextEl.type = "button";
    this.reviewJourneyNextEl.className = "primary-action-button";
    this.reviewJourneyNextEl.textContent = "Nächster Moment →";
    this.reviewJourneyNextEl.addEventListener("click", () => this.navigateReviewJourney(1));
    controls.append(this.reviewJourneyPrevEl, this.reviewJourneyNextEl);
    panel.append(top, this.reviewJourneyTitleEl, this.reviewJourneyMoveEl, this.reviewJourneyCoachEl, hint, controls);
    this.analysisColumn.prepend(panel);
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
    title.textContent = "Neue Partie gegen den Schachcomputer";
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
      { value: "b", label: "Schwarz", detail: "Computer beginnt" },
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
      unavailable.textContent = "Der Schachcomputer konnte nicht gestartet werden. Bitte lade die Seite neu.";
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
    this.playColorSummaryEl.textContent = `Du: ${playerLabel} · Computer: ${engineLabel}`;
    this.playLevelSummaryEl.textContent = `Stufe: ${level.label}`;

    let status = "Partie wird vorbereitet …";
    if (session.phase === "player-turn") {
      status = `Du bist am Zug${this.game.isCheck() ? " · Schach" : ""}`;
    } else if (session.phase === "feedback") {
      status = "Dein Zug wird bewertet …";
    } else if (session.phase === "engine-thinking") {
      status = "Der Schachcomputer denkt …";
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
            ? "Partie beendet · Der Computer gewinnt"
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
      const presentation = moveQualityPresentation({
        quality: latest.quality,
        playedUci: latest.playedUci,
        bestUci: latest.bestUci,
        lossCp: latest.lossCp,
      });
      this.playFeedbackBadgeEl.textContent = presentation.symbol;
      this.playFeedbackTitleEl.textContent = presentation.label;
      const hasBetterMove = latest.bestUci
        && latest.bestUci !== latest.playedUci
        && latest.bestSan;
      const simpleFallback = hasBetterMove
        ? `Dein Zug: ${latest.playedSan || latest.title}. Besser war ${latest.bestSan}.`
        : `Dein Zug: ${latest.playedSan || latest.title}. Das war die erste Wahl.`;
      this.playFeedbackDetailEl.textContent = simpleFallback;
    } else {
      this.playFeedbackEl.className = "live-feedback-state is-waiting";
      this.playFeedbackBadgeEl.textContent = "Bereit";
      this.playFeedbackTitleEl.textContent = session.phase === "player-turn"
        ? "Spiele deinen Zug"
        : "Die Bewertung wird vorbereitet";
      this.playFeedbackDetailEl.textContent = "Danach siehst du hier sofort, ob dein Zug gut war.";
    }
    this.playFeedbackEl.querySelector(".suggestion-coach-popover")?.remove();
    const livePlan = latest?.coachPlan || null;
    const livePopover = this.createSuggestionCoachPopover({
      plan: livePlan,
      explanation: livePlan?.explanation,
      variantLabel: latest?.bestUci !== latest?.playedUci
        ? `Bessere Alternative: ${latest?.bestSan || ""}`
        : "So trägt die Idee",
    });
    if (livePopover && session.liveFeedback) {
      livePopover.id = "live-feedback-coach-explanation";
      this.playFeedbackEl.setAttribute("aria-describedby", livePopover.id);
      this.playFeedbackEl.appendChild(livePopover);
    } else {
      this.playFeedbackEl.removeAttribute("aria-describedby");
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

    if (this.playCoachConversationEl) {
      this.playCoachConversationEl.replaceChildren();
      session.coachMessages.slice(-6).forEach((message) => {
        const bubble = document.createElement("div");
        bubble.className = `play-coach-message is-${message.role}`;
        renderChatMarkup(bubble, message.content);
        this.playCoachConversationEl.appendChild(bubble);
      });
      if (session.coachBusy && !session.coachAutomaticBusy) {
        const thinking = document.createElement("div");
        thinking.className = "play-coach-message is-assistant is-thinking";
        thinking.textContent = "Der Coach formuliert eine einfache Antwort …";
        this.playCoachConversationEl.appendChild(thinking);
      }
      this.playCoachConversationEl.hidden = (
        session.coachMessages.length === 0
        && (!session.coachBusy || session.coachAutomaticBusy)
      );
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

    this.stopAllBoardPreviews();
    this.engine?.cancelSearch?.();
    if (nextMode === "analysis") {
      this.cancelPlaySession();
      this.appMode = "analysis";
      this.engine?.setMultiPV?.(this.suggestionCount === 0 ? 1 : this.suggestionCount);
      this.setAnalysisPerspective(
        this.gameSaveDraft?.playerColor || this.analysisPerspective,
        { markDirty: false },
      );
    } else {
      this.stopReviewJourney({ silent: true });
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

    if (this.exportButton) this.exportButton.hidden = isPlay;
    if (this.saveGameButton) this.saveGameButton.hidden = isPlay;
    this.saveStatusEl?.setAttribute("aria-live", isPlay ? "off" : "polite");
    if (this.resetButton) {
      this.resetButton.textContent = isPlay ? "Neue Trainingspartie" : "Neue Analyse";
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
    this.renderPlayPanel();
  }

  prepareNewEngineGame() {
    this.openPlaySetupDialog(this.resetButton || this.playStartButton);
  }

  startEngineGame({ colorPreference = "random", level = "medium", liveFeedback = true } = {}) {
    if (!this.engine || !this.engineReady || this.reviewRunning) {
      this.showToast("Der Schachcomputer wird noch geladen. Bitte versuche es gleich erneut.");
      return false;
    }
    if (!this.confirmDiscardUnsavedGame("eine neue Trainingspartie beginnen")) return false;

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
      coachAutomaticBusy: false,
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
    const ownName = String(this.accountState?.profile?.name || "Du").trim() || "Du";
    const engineName = engineOpponentLabel(normalizedLevel);
    this.gameSaveDraft.whitePlayer = playerColor === "w" ? ownName : engineName;
    this.gameSaveDraft.blackPlayer = playerColor === "b" ? ownName : engineName;
    this.gameSaveDraftDirty = true;
    this.board.orientation(playerColor === "w" ? "white" : "black");
    this.moveArrows?.setOrientation(this.board.orientation());
    this.resetBoardKeyboardCursor();
    this.engine.setMultiPV(1);
    this.updateModeUi();
    this.updateGameStatus();
    this.evaluateCurrentPosition();
    this.showToast(`Trainingspartie gestartet · Du spielst ${playerColor === "w" ? "Weiß" : "Schwarz"}.`);
    return true;
  }

  finishPlayAndAnalyze() {
    if (!this.playSession.active || this.getCurrentPath().length < 2) return;
    if (this.playSession.phase !== "game-over") {
      const confirmed = window.confirm(
        "Wenn du jetzt analysierst, wird die Trainingspartie beendet und kann nicht fortgesetzt werden.",
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
    this.refreshOpeningRecognition();
    return move;
  }

  handleMove(source, target) {
    if (this.reviewRunning) return "snapback";
    this.stopAllBoardPreviews();
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

  handleBoardMoveEnd() {
    if (this.boardAnimationTimer) {
      window.clearTimeout(this.boardAnimationTimer);
      this.boardAnimationTimer = null;
    }
    this.boardSurface?.classList.remove("is-navigating");
    if (!this.previewState && !this.moveListPreviewState) {
      this.moveArrows?.setVisible(true);
    }
    this.updateBoardKeyboardHighlights();
  }

  animateBoardPosition(fen, { fromFen = null } = {}) {
    if (!fen || !this.board) return;
    if (fromFen && this.board.fen?.() !== fromFen.split(/\s+/)[0]) {
      this.board.position(fromFen, false);
    }
    this.boardSurface?.classList.toggle("is-navigating", !this.reduceBoardMotion);
    this.moveArrows?.setVisible(false);
    this.board.position(fen, !this.reduceBoardMotion);
    if (this.boardAnimationTimer) window.clearTimeout(this.boardAnimationTimer);
    this.boardAnimationTimer = window.setTimeout(
      () => this.handleBoardMoveEnd(),
      this.reduceBoardMotion ? 0 : 520,
    );
  }

  goBackOnePly() {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopAllBoardPreviews();
    if (!this.currentNode.parent) return;
    const sourceFen = this.currentNode.fen;
    this.currentNode = this.currentNode.parent;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.animateBoardPosition(this.currentNode.fen, { fromFen: sourceFen });
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.refreshOpeningRecognition();
    this.evaluateCurrentPosition();
  }

  goForwardOnePly() {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopAllBoardPreviews();
    const next = this.currentNode.mainline;
    if (!next) return;
    const sourceFen = this.currentNode.fen;
    this.currentNode = next;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.animateBoardPosition(this.currentNode.fen, { fromFen: sourceFen });
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.refreshOpeningRecognition();
    this.evaluateCurrentPosition();
  }

  cycleVariation(offset) {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopAllBoardPreviews();
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
    this.board.position(parent.fen, false);
    this.currentNode = target;
    this.game.load(this.currentNode.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.animateBoardPosition(this.currentNode.fen, { fromFen: parent.fen });
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.refreshOpeningRecognition();
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
    if (this.previewState || this.moveListPreviewState) {
      this.stopAllBoardPreviews();
    }
    this.resetSuggestionCoachState({ abortChat: true });
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
    this.expandedSuggestionRanks.clear();
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
      this.renderMoveList();
      this.renderSuggestions();
      if (this.appMode === "analysis") this.scheduleLatestMoveExplanation();
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
    const suppliedPv = info.pv.slice(0, 20);
    const legalFrames = legalPv(info.fen, suppliedPv, 20);
    if (legalFrames.length === 0 || legalFrames.length !== suppliedPv.length) return;
    const verifiedInfo = {
      ...info,
      pv: legalFrames.map((frame) => frame.uci),
    };
    const index = info.multipv || 1;
    const previous = this.suggestionState.lines.get(index);
    if (
      previous?.depth
      && info.depth
      && info.depth < previous.depth
    ) return;
    this.suggestionState.lines.set(index, verifiedInfo);
    if (info.depth) {
      this.suggestionState.depth = Math.max(this.suggestionState.depth || 0, info.depth);
    }
    if (index === 1) {
      const analysis = analysisEntryFromInfo(verifiedInfo);
      const node = this.suggestionState.node;
      const analysisReady = (
        analysis
        && node
        && node.fen === info.fen
        && (!info.depth || info.depth >= this.suggestionState.targetDepth)
      );
      if (analysisReady) {
        if (
          !node.analysis?.depth
          || !analysis.depth
          || analysis.depth >= node.analysis.depth
        ) {
          node.analysis = analysis;
        }
        this.refreshLiveAccuracy();
        this.scheduleLatestMoveExplanation();
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
    const verifiedBestMove = legalUciMove(result?.fen, result?.move);
    if (
      verifiedBestMove
      && this.suggestionState
      && result.fen === this.suggestionState.fen
      && result.searchId === this.suggestionState.searchId
    ) {
      const ponderFrames = legalPv(result.fen, [verifiedBestMove.uci, result.ponder], 2);
      this.suggestionState.bestMoveUci = verifiedBestMove.uci;
      this.suggestionState.ponderUci = ponderFrames[1]?.uci || "";
      if (this.appMode === "analysis") this.renderSuggestions();
    }
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
    const uci = verifiedBestMove?.uci || "";
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
    const engineContext = this.buildMoveCoachEngineContext(reportMove);
    const coachPlan = buildCoachVisualPlan({
      fen: beforeNode?.fen || "",
      pv: engineContext?.moveReview?.pv?.uci || [],
      rank: 1,
    });
    const feedbackEntry = {
      ...feedback,
      quality: reportMove.quality,
      lossCp: reportMove.lossCp,
      ply,
      bestUci: reportMove.bestUci || "",
      bestSan: reportMove.bestSan || "",
      playedUci,
      playedSan: reportMove.san || node?.move?.san || "",
      beforeFen: beforeNode?.fen || "",
      engineContext,
      coachPlan,
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
    this.requestPlayCoachMessage(text, {
      engineContext: this.playSession.feedbackHistory[0]?.engineContext || null,
    });
  }

  async requestAutomaticPlayCoachFeedback(feedback, reportMove) {
    if (!feedback || !this.playSession.liveFeedback || this.coachConfigured === false) return;
    const alternative = reportMove?.bestSan && reportMove.bestSan !== reportMove.san;
    const opening = alternative
      ? `Beginne genau mit „Besser wäre ${reportMove.bestSan}, weil …“.`
      : feedback.quality === "best" || feedback.quality === "excellent"
        ? "Beginne mit „Das war sehr gut, weil …“."
        : "Beginne mit „Das war gut, weil …“.";
    this.playSession.coachQueue.push({
      message: [
        `Bewerte ${feedback.title} für einen Schachanfänger in höchstens zwei kurzen Sätzen.`,
        opening,
        "Erkläre nur, was sich sicher aus den gelieferten Analysedaten ablesen lässt.",
        "Verwende einfache Wörter und keine Begriffe wie Engine, Stockfish, PV, Centipawn, Initiative oder Kandidatenzug.",
        "Nenne keine Zugfolge und keinen Zug für die jetzt entstandene Stellung.",
      ].filter(Boolean).join(" "),
      ply: feedback.ply,
      engineContext: this.buildMoveCoachEngineContext(reportMove),
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
      engineContext: next.engineContext,
    });
  }

  async requestPlayCoachMessage(
    message,
    { automatic = false, ply = null, engineContext = null } = {},
  ) {
    const session = this.playSession;
    if (!session.active || session.coachBusy) return;
    session.coachBusy = true;
    session.coachAutomaticBusy = automatic;
    this.renderPlayPanel();
    this.playCoachController?.abort();
    this.playCoachController = new AbortController();
    const generation = session.generation;
    const conversation = session.coachMessages.slice(-8);
    if (
      !automatic
      && conversation.at(-1)?.role === "user"
      && conversation.at(-1)?.content === message
    ) {
      conversation.pop();
    }
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${message}\nAntworte nur zum bereits gespielten Zug. Eine bessere rückblickende Wahl darfst du nur nennen, wenn sie ausdrücklich in den gelieferten Daten steht. Nenne keinen Zug für die jetzt entstandene Stellung und keine Zugfolge.`,
          engineContext,
          openingContext: this.buildOpeningCoachContext(),
          learnerProfile: this.getCoachLearnerProfile(),
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
      if (automatic && Number.isInteger(ply)) {
        const item = session.feedbackHistory.find((entry) => entry.ply === ply);
        if (item) item.coachText = reply;
      } else {
        session.coachMessages.push({ role: "assistant", content: reply, ply });
        session.coachMessages = session.coachMessages.slice(-12);
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
        session.coachAutomaticBusy = false;
        this.playCoachController = null;
        this.renderPlayPanel();
        this.drainPlayCoachQueue();
      }
    }
  }

  previewCoachMove(feedback) {
    const plan = feedback?.coachPlan || buildCoachVisualPlan({
      fen: feedback?.beforeFen,
      pv: feedback?.engineContext?.moveReview?.pv?.uci || [feedback?.bestUci],
      rank: 1,
    });
    if (!feedback?.beforeFen || !plan || this.reviewRunning) return;
    this.startCoachPlanPreview({
      fen: feedback.beforeFen,
      plan,
      row: this.playFeedbackEl,
      label: feedback.bestUci === feedback.playedUci
        ? `Dein Zug ${feedback.playedSan || feedback.bestSan}`
        : `Besser: ${feedback.bestSan}`,
    });
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

  resolvedExplanationMoves(claim, positionEvidence) {
    if (!claim || !positionEvidence?.valid || !Array.isArray(claim.moveRefs)) {
      return [];
    }
    const lines = new Map();
    if (positionEvidence.playedMove?.evidenceId) {
      lines.set(positionEvidence.playedMove.evidenceId, {
        legal: positionEvidence.playedMove.legal === true,
        complete: true,
        moves: [positionEvidence.playedMove],
      });
    }
    (positionEvidence.verifiedLines || []).forEach((line) => {
      if (line?.evidenceId) lines.set(line.evidenceId, line);
    });

    const resolved = [];
    for (const reference of claim.moveRefs) {
      const line = lines.get(reference?.lineEvidenceId);
      const startPly = Number.parseInt(reference?.startPly, 10);
      const uci = Array.isArray(reference?.uci)
        ? reference.uci.map((move) => String(move || "").toLowerCase())
        : [];
      if (
        !line?.legal
        || line.complete !== true
        || !Number.isInteger(startPly)
        || startPly < 0
        || uci.length === 0
      ) continue;
      const moves = line.moves?.slice(startPly, startPly + uci.length) || [];
      if (
        moves.length !== uci.length
        || moves.some((move, index) => (
          move?.legal !== true
          || move.uci !== uci[index]
          || !move.fenBefore
          || !move.fenAfter
        ))
      ) continue;
      moves.forEach((move, index) => {
        resolved.push({
          move,
          sequence: moves.slice(0, index + 1),
        });
      });
    }
    return resolved;
  }

  moveTokenAliases(move) {
    const normalize = (value) => String(value || "")
      .trim()
      .replace(/^\d+\.(?:\.\.)?/, "")
      .replace(/[+#]+$/, "")
      .replace(/^0-0-0$/i, "O-O-O")
      .replace(/^0-0$/i, "O-O")
      .toLocaleLowerCase("de-DE");
    const san = String(move?.san || "");
    const localizedSan = san.replace(
      /^[KQRBN]/,
      (piece) => ({ K: "K", Q: "D", R: "T", B: "L", N: "S" })[piece] || piece,
    );
    return new Set([
      normalize(move?.uci),
      normalize(san),
      normalize(localizedSan),
    ].filter(Boolean));
  }

  createMovePreviewButton({
    label,
    fenBefore,
    uci,
    previewLabel = "Zugidee",
  }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "computer-move-token";
    button.textContent = label;
    button.setAttribute(
      "aria-label",
      `${label} am Brett ansehen`,
    );
    button.setAttribute("aria-pressed", "false");
    let pointerInside = false;
    let focused = false;
    const start = (event = null) => {
      if (event?.pointerType && event.pointerType !== "mouse") return;
      this.startExplanationPreview({
        fenBefore,
        uci,
        label: previewLabel,
      }, button);
    };
    const stopNow = (event = null) => {
      if (event?.pointerType && event.pointerType !== "mouse") return;
      this.stopSuggestionPreview(button);
      button.setAttribute("aria-pressed", "false");
    };
    const stopUnlessActive = (event = null) => {
      if (
        pointerInside
        || focused
        || button.getAttribute("aria-pressed") === "true"
      ) return;
      stopNow(event);
    };
    button.addEventListener("pointerenter", (event) => {
      pointerInside = true;
      start(event);
    });
    button.addEventListener("pointerleave", (event) => {
      pointerInside = false;
      stopUnlessActive(event);
    });
    button.addEventListener("focus", (event) => {
      focused = true;
      start(event);
    });
    button.addEventListener("blur", (event) => {
      focused = false;
      stopUnlessActive(event);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const previewIsPinned = button.getAttribute("aria-pressed") === "true";
      if (this.previewState?.row === button && previewIsPinned) {
        stopNow();
      } else {
        if (this.previewState?.row !== button) {
          this.startExplanationPreview({
            fenBefore,
            uci,
            label: previewLabel,
          }, button);
        }
        button.setAttribute("aria-pressed", "true");
      }
    });
    return button;
  }

  renderInteractiveExplanationText(container, claim, positionEvidence) {
    const text = String(claim?.text || "").trim();
    if (!text) return;
    const resolved = this.resolvedExplanationMoves(claim, positionEvidence);
    if (resolved.length === 0) {
      container.textContent = text;
      return;
    }

    let cursor = 0;
    const parts = text.split(/(\s+)/);
    parts.forEach((part) => {
      const core = part
        .replace(/^[("'„“‚‘\[]+/, "")
        .replace(/[)"'“”‘’\],.;:!?]+$/, "");
      const normalized = core
        .replace(/^\d+\.(?:\.\.)?/, "")
        .replace(/[+#]+$/, "")
        .replace(/^0-0-0$/i, "O-O-O")
        .replace(/^0-0$/i, "O-O")
        .toLocaleLowerCase("de-DE");
      const index = resolved.findIndex((entry, candidateIndex) => (
        candidateIndex >= cursor
        && this.moveTokenAliases(entry.move).has(normalized)
      ));
      if (!normalized || index < 0) {
        container.appendChild(document.createTextNode(part));
        return;
      }
      const prefixLength = part.indexOf(core);
      const prefix = part.slice(0, Math.max(0, prefixLength));
      const suffix = part.slice(Math.max(0, prefixLength) + core.length);
      if (prefix) container.appendChild(document.createTextNode(prefix));
      const entry = resolved[index];
      container.appendChild(this.createMovePreviewButton({
        label: core,
        fenBefore: entry.sequence[0].fenBefore,
        uci: entry.sequence.map((move) => move.uci),
        previewLabel: `Coach-Erklärung · ${entry.move.san}`,
      }));
      if (suffix) container.appendChild(document.createTextNode(suffix));
      cursor = index + 1;
    });
  }

  startExplanationPreview({ fenBefore, uci, label }, element) {
    if (
      this.destroyed
      || this.reviewRunning
      || !fenBefore
      || !Array.isArray(uci)
      || uci.length === 0
    ) return;
    const frames = buildPvFrames(fenBefore, uci, 8);
    if (frames.length !== uci.length) return;
    if (this.previewState?.row === element) return;
    this.stopAllBoardPreviews({ restore: false, deferRender: true });

    const token = ++this.previewToken;
    this.previewState = {
      token,
      row: element,
      frames,
      index: -1,
      kind: "explanation",
    };
    element?.classList.add("is-previewing");
    this.board?.position?.(fenBefore, false);
    this.moveArrows?.setMoves([{ rank: 1, move: uci[0], impact: 1 }]);
    const boardSurface = this.boardSurface || document.getElementById("board-surface");
    if (!this.previewBadge && boardSurface) {
      this.previewBadge = document.createElement("div");
      this.previewBadge.className = "board-preview-badge";
      boardSurface.appendChild(this.previewBadge);
    }
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      this.previewBadge.textContent = label || "Coach-Vorschau";
    }

    const showFrame = (index) => {
      if (!this.previewState || this.previewState.token !== token) return;
      const frame = frames[index];
      this.previewState.index = index;
      this.board?.position?.(frame.fen, !this.reduceBoardMotion);
      if (this.previewBadge) {
        this.previewBadge.textContent =
          `${label || "Coach-Vorschau"} · ${index + 1}/${frames.length} · ${frame.san}`;
      }
      if (index + 1 < frames.length) {
        this.previewTimer = window.setTimeout(
          () => showFrame(index + 1),
          this.reduceBoardMotion ? 120 : 650,
        );
      }
    };
    this.previewTimer = window.setTimeout(
      () => showFrame(0),
      this.reduceBoardMotion ? 0 : 160,
    );
  }

  renderComputerExplanation({
    explanation,
    positionEvidence,
    expanded = false,
    onToggle = null,
  }) {
    if (!explanation || !positionEvidence?.valid) return null;
    const section = document.createElement("section");
    section.className = "computer-explanation";
    const title = document.createElement("strong");
    title.className = "computer-explanation-title";
    title.textContent = "Coach-Erklärung";
    section.appendChild(title);

    const claims = document.createElement("div");
    claims.className = "computer-explanation-claims";
    const summary = expanded
      ? (explanation.summary || []).filter(
        (claim) => !["assessment", "opening"].includes(claim?.claimKind),
      )
      : compactMoveExplanationClaims(explanation, { maximum: 4 })
        .filter((claim) => !["assessment", "opening"].includes(claim?.claimKind))
        .slice(0, 2);
    const selected = [];
    const seen = new Set();
    [...summary, ...(expanded ? explanation.deepDive || [] : [])].forEach((claim) => {
      const text = String(claim?.text || "").trim();
      const key = text.toLocaleLowerCase("de-DE");
      if (!text || seen.has(key)) return;
      seen.add(key);
      selected.push(claim);
    });
    if (selected.length === 0) return null;
    selected.forEach((claim) => {
      const row = document.createElement("p");
      row.className = "computer-explanation-claim";
      this.renderInteractiveExplanationText(row, claim, positionEvidence);
      claims.appendChild(row);
    });
    section.appendChild(claims);

    if (typeof onToggle === "function" && (explanation.deepDive?.length || 0) > 0) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "computer-explanation-toggle";
      toggle.textContent = expanded ? "Kürzer anzeigen" : "Mehr vom Coach";
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.stopAllBoardPreviews();
        onToggle();
      });
      section.appendChild(toggle);
    }
    return section;
  }

  createSuggestionCoachPopover({
    plan,
    explanation = "",
    variantLabel = "Beispielvariante",
  } = {}) {
    if (!plan?.san?.length) return null;
    const popover = document.createElement("aside");
    popover.className = "suggestion-coach-popover";
    popover.setAttribute("role", "tooltip");

    const eyebrow = document.createElement("span");
    eyebrow.className = "suggestion-coach-popover-eyebrow";
    eyebrow.textContent = plan.tactical ? "Taktik erkannt" : "Coach-Idee";
    const headline = document.createElement("strong");
    headline.className = "suggestion-coach-popover-title";
    headline.textContent = plan.headline;
    const copy = document.createElement("p");
    copy.textContent = String(explanation || "").trim() || plan.explanation;

    const variation = document.createElement("div");
    variation.className = "suggestion-coach-variation";
    const label = document.createElement("span");
    label.textContent = variantLabel;
    const moves = document.createElement("strong");
    moves.textContent = plan.san.join(" ");
    variation.append(label, moves);

    const hint = document.createElement("span");
    hint.className = "suggestion-coach-popover-hint";
    hint.textContent = "Klicken oder tippen zum Fixieren · erneut zum Lösen";
    popover.append(eyebrow, headline, copy, variation, hint);
    return popover;
  }

  bindCoachPlanPreview(row, startPreview, {
    onToggleExpanded = null,
  } = {}) {
    if (!row || typeof startPreview !== "function") return;
    row.setAttribute("aria-pressed", "false");
    let pointerInside = false;
    let focused = false;
    const start = (event = null) => {
      if (event?.pointerType && event.pointerType !== "mouse") return;
      startPreview();
    };
    const stopUnlessPinned = () => {
      if (
        pointerInside
        || focused
        || row.getAttribute("aria-pressed") === "true"
      ) return;
      this.stopSuggestionPreview(row);
    };
    row.addEventListener("pointerenter", (event) => {
      pointerInside = true;
      start(event);
    });
    row.addEventListener("pointerleave", () => {
      pointerInside = false;
      stopUnlessPinned();
    });
    row.addEventListener("focus", () => {
      focused = true;
      startPreview();
    });
    row.addEventListener("blur", () => {
      focused = false;
      stopUnlessPinned();
    });
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onToggleExpanded === "function") {
        const expanded = row.getAttribute("aria-expanded") === "true";
        const nextExpanded = !expanded;
        row.setAttribute("aria-expanded", String(nextExpanded));
        row.classList.toggle("is-expanded", nextExpanded);
        onToggleExpanded(nextExpanded);
        if (!nextExpanded) {
          this.stopSuggestionPreview(row);
          row.setAttribute("aria-pressed", "false");
          return;
        }
        startPreview();
        row.setAttribute("aria-pressed", "true");
        return;
      }
      const pinned = row.getAttribute("aria-pressed") === "true";
      if (pinned && this.previewState?.row === row) {
        this.stopSuggestionPreview(row);
        row.setAttribute("aria-pressed", "false");
        return;
      }
      startPreview();
      row.setAttribute("aria-pressed", "true");
    });
    row.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      row.click();
    });
  }

  renderOpeningMilestone() {
    const announcement = this.buildOpeningCoachContext()?.announcement;
    if (!announcement) return null;
    const milestone = document.createElement("section");
    milestone.className = `opening-milestone is-${announcement.kind}`;
    const title = document.createElement("strong");
    const copy = document.createElement("p");

    if (announcement.kind === "database_exit") {
      title.textContent = "Ab hier eigene Wege";
      copy.textContent =
        "Mit diesem Zug verlässt die Partie unsere lokale Eröffnungsdatenbank. Das bedeutet nicht, dass die Theorie endet – nur für diese Zugfolge liegt lokal kein weiterer Eintrag vor.";
      milestone.append(title, copy);
      const continuation = announcement.continuation;
      if (
        continuation?.fenBefore
        && continuation?.uci?.length > 0
        && continuation.uci.length === continuation.san?.length
      ) {
        const line = document.createElement("div");
        line.className = "opening-milestone-line";
        const label = document.createElement("span");
        label.textContent = `${continuation.label}:`;
        line.appendChild(label);
        continuation.san.forEach((san, index) => {
          line.appendChild(this.createMovePreviewButton({
            label: san,
            fenBefore: continuation.fenBefore,
            uci: continuation.uci.slice(0, index + 1),
            previewLabel: "Gespeicherte Eröffnungsfortsetzung",
          }));
        });
        milestone.appendChild(line);
      }
      return milestone;
    }

    const displayName = announcement.kind === "family"
      ? announcement.familyDisplay || announcement.displayName
      : announcement.displayName || announcement.variationKey;
    title.textContent = announcement.kind === "family"
      ? `Jetzt beginnt: ${displayName}`
      : `Jetzt erreicht: ${displayName}`;
    const knowledge = openingKnowledgeForFamily(announcement.familyKey || "");
    const variationKnowledge = announcement.kind === "variation"
      ? openingKnowledgeForVariation(
        announcement.familyKey || "",
        announcement.variationKey || "",
      )
      : null;
    copy.textContent = variationKnowledge?.idea || knowledge.overview;
    milestone.append(title, copy);
    const plans = document.createElement("p");
    plans.className = "opening-milestone-plans";
    plans.textContent = variationKnowledge
      ? [
        `Weiß: ${variationKnowledge.whitePlan}`,
        `Schwarz: ${variationKnowledge.blackPlan}`,
      ].join(" ")
      : [
        knowledge.whitePlans?.[0] ? `Weiß: ${knowledge.whitePlans[0]}` : "",
        knowledge.blackPlans?.[0] ? `Schwarz: ${knowledge.blackPlans[0]}` : "",
      ].filter(Boolean).join(" ");
    if (plans.textContent) milestone.appendChild(plans);
    return milestone;
  }

  renderSuggestions() {
    if (!this.suggestionsEl) return;
    if (this.previewState || this.moveListPreviewState) {
      this.suggestionsDirtyDuringPreview = true;
      return;
    }
    this.renderMoveArrows();
    const body = this.suggestionsEl.querySelector('.lines');
    if (!body) return;
    const ownTurn = this.game.turn() === this.getAnalysisPerspective();
    const hint = this.suggestionsEl.querySelector(".suggestions-heading span");
    if (hint) {
      hint.textContent = ownTurn
        ? "Berühren oder fokussieren: am Brett ansehen"
        : "Rückblick auf deinen letzten Zug";
    }

    if (!ownTurn) {
      const path = this.getCurrentPath();
      const latest = this.latestComputerExplanation;
      const currentMove = path.at(-1)?.move;
      const currentUci = currentMove
        ? `${currentMove.from || ""}${currentMove.to || ""}${currentMove.promotion || ""}`.toLowerCase()
        : "";
      const currentPathSignature = movePathSignature(path);
      const currentExplanation = (
        latest?.explanation
        && latest.positionEvidence?.valid
        && latest.gameGeneration === this.coachGameGeneration
        && latest.ply === path.length - 1
        && (!latest.playedUci || latest.playedUci === currentUci)
        && latest.positionFenBefore === path.at(-2)?.fen
        && latest.positionFenAfter === path.at(-1)?.fen
        && latest.pathSignature === currentPathSignature
      )
        ? latest.explanation
        : null;
      this.renderLastPerspectiveMoveAssessment(body, {
        explanation: currentExplanation,
      });
      const milestone = this.renderOpeningMilestone();
      if (milestone) body.prepend(milestone);
      return;
    }

    if (this.suggestionCount === 0) {
      body.style.color = '#666';
      body.replaceChildren();
      const milestone = this.renderOpeningMilestone();
      if (milestone) body.appendChild(milestone);
      body.appendChild(document.createTextNode('Vorschläge deaktiviert.'));
      return;
    }

    if (!this.suggestionState || this.suggestionState.lines.size === 0) {
      body.style.color = '#666';
      body.replaceChildren();
      const milestone = this.renderOpeningMilestone();
      if (milestone) body.appendChild(milestone);
      body.appendChild(document.createTextNode('Warten auf Analyse…'));
      return;
    }

    const lines = Array.from(this.suggestionState.lines.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, this.suggestionCount);

    if (lines.length === 0) {
      body.style.color = '#666';
      body.replaceChildren();
      const milestone = this.renderOpeningMilestone();
      if (milestone) body.appendChild(milestone);
      body.appendChild(document.createTextNode('Warten auf Analyse…'));
      return;
    }

    body.style.color = '#fff';
    body.innerHTML = '';
    const milestone = this.renderOpeningMilestone();
    if (milestone) body.appendChild(milestone);
    lines.forEach(([idx, data]) => {
      const plan = buildCoachVisualPlan({
        fen: data.fen,
        pv: data.pv,
        rank: idx,
      });
      const row = document.createElement('div');
      row.className = 'suggestion-line';
      const isPrimary = idx === 1;
      const isExpanded = isPrimary || this.expandedSuggestionRanks.has(idx);
      row.classList.toggle("is-primary", isPrimary);
      row.classList.toggle("is-expanded", !isPrimary && isExpanded);
      if (!isPrimary) row.setAttribute("aria-expanded", String(isExpanded));
      row.tabIndex = 0;

      const header = document.createElement('div');
      header.className = "suggestion-line-header";
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'baseline';

      const label = document.createElement('span');
      label.style.fontWeight = '600';
      label.style.color = MOVE_ARROW_STYLES[Math.min(idx - 1, MOVE_ARROW_STYLES.length - 1)].color;
      label.textContent = idx === 1 ? "Beste Idee" : `Alternative ${idx}`;

      const scoreSpan = document.createElement('span');
      scoreSpan.style.fontVariantNumeric = 'tabular-nums';
      scoreSpan.textContent = `Bewertung ${this.formatScore(data.whiteScore || data.score)}`;

      header.appendChild(label);
      header.appendChild(scoreSpan);

      if (data.depth) {
        const depthSpan = document.createElement('span');
        depthSpan.style.marginLeft = '8px';
        depthSpan.style.fontSize = '11px';
        depthSpan.style.color = '#93a5c8';
        depthSpan.textContent = `Rechentiefe ${data.depth}`;
        header.appendChild(depthSpan);
      }

      const moves = document.createElement('div');
      moves.className = 'moves';
      const sanMoves = plan?.san || this.pvToSanList(data.pv, data.fen).slice(0, 2);
      const collapsedMoves = sanMoves.length > 0 ? sanMoves[0] : '(kein legaler Zug)';
      const completeMoves = sanMoves.length > 0 ? sanMoves.join(" ") : collapsedMoves;
      moves.textContent = isExpanded ? completeMoves : collapsedMoves;

      const reason = this.suggestionCoachReasons.get(idx);
      row.setAttribute(
        'aria-label',
        `${idx === 1 ? "Beste Idee" : `Alternative ${idx}`} erklären und am Brett zeigen: ${sanMoves.join(' ') || 'keine legalen Züge'}`,
      );
      row.title = isPrimary
        ? 'Hovern für die Coach-Erklärung, klicken zum Fixieren.'
        : 'Hovern für die Coach-Erklärung, klicken zum Aufklappen.';

      row.appendChild(header);
      row.appendChild(moves);
      const popover = this.createSuggestionCoachPopover({
        plan,
        explanation: reason || plan?.explanation,
        variantLabel: plan?.tactical ? "Die Pointe" : "Kurze Hauptidee",
      });
      if (popover) {
        popover.id = `suggestion-coach-${idx}`;
        row.setAttribute("aria-describedby", popover.id);
        row.appendChild(popover);
      }
      if (plan) {
        this.bindCoachPlanPreview(
          row,
          () => this.startSuggestionPreview(data, row, plan),
          isPrimary
            ? {}
            : {
              onToggleExpanded: (expanded) => {
                if (expanded) this.expandedSuggestionRanks.add(idx);
                else this.expandedSuggestionRanks.delete(idx);
                moves.textContent = expanded ? completeMoves : collapsedMoves;
              },
            },
        );
      }
      body.appendChild(row);
    });
    this.scheduleSuggestionCoachReasons(lines);
  }

  renderLastPerspectiveMoveAssessment(body, { explanation = null } = {}) {
    const move = this.getLastPerspectiveMoveReview();
    body.innerHTML = "";
    if (!move) {
      body.style.color = "#93a5c8";
      body.textContent = "Dein letzter Zug wird gerade bewertet …";
      return;
    }
    const assessment = describeMoveAssessment(move);
    if (!assessment) {
      body.textContent = "Für deinen letzten Zug liegt noch keine sichere Bewertung vor.";
      return;
    }

    const verified = verifiedMoveReview(move);
    const presentation = moveQualityPresentation({
      quality: verified?.quality,
      playedUci: verified?.playedUci,
      bestUci: verified?.bestUci,
      lossCp: verified?.lossCp,
    });
    const plan = buildCoachVisualPlan({
      fen: verified?.fenBefore,
      pv: verified?.bestPvUci,
      rank: 1,
    });
    const exactBest = Boolean(
      verified?.playedUci
      && verified.playedUci === verified.bestUci,
    );
    const equivalent = !exactBest
      && Number.isFinite(verified?.lossCp)
      && verified.lossCp <= 15;
    body.style.color = "#fff";
    const row = document.createElement("div");
    row.className = `perspective-move-assessment is-${presentation.tone}`;
    row.tabIndex = 0;
    const header = document.createElement("div");
    header.className = "perspective-move-assessment-header";
    const moveLabel = document.createElement("span");
    moveLabel.textContent = `Dein Zug · ${move.san || "unbekannt"}`;
    const quality = document.createElement("strong");
    quality.textContent = `${presentation.symbol} ${presentation.label}`;
    header.append(moveLabel, quality);

    const reason = document.createElement("p");
    const comparison = exactBest
      ? "Dein Zug entspricht der ersten Wahl."
      : equivalent
        ? `Dein Zug ist praktisch gleichwertig mit ${verified.bestSan}.`
        : verified?.bestSan
          ? `Besser war ${verified.bestSan}.`
          : "";
    reason.textContent = [assessment.lead, assessment.reason, comparison]
      .filter(Boolean)
      .join(" ");
    row.append(header, reason);

    const coachClaim = compactMoveExplanationClaims(explanation, { maximum: 4 })
      .find((claim) => (
        !["assessment", "opening", "variation", "alternative"]
          .includes(claim?.claimKind)
      ));
    const popover = this.createSuggestionCoachPopover({
      plan,
      explanation: coachClaim?.text || plan?.explanation,
      variantLabel: exactBest || equivalent
        ? "So trägt die Idee"
        : `Bessere Alternative: ${verified?.bestSan || ""}`,
    });
    if (popover) {
      popover.id = "last-move-coach-explanation";
      row.setAttribute("aria-describedby", popover.id);
      row.appendChild(popover);
    }
    if (plan && verified?.fenBefore) {
      this.bindCoachPlanPreview(
        row,
        () => this.startCoachPlanPreview({
          fen: verified.fenBefore,
          plan,
          row,
          label: exactBest || equivalent
            ? `Dein Zug ${verified.san}`
            : `Besser: ${verified.bestSan}`,
        }),
      );
    }
    body.appendChild(row);
  }

  getAnalysisPerspective() {
    return this.analysisPerspective === "b" ? "b" : "w";
  }

  setAnalysisPerspective(
    color,
    { updateBoard = true, syncDraft = true, markDirty = true } = {},
  ) {
    const next = color === "b" ? "b" : "w";
    const changed = this.analysisPerspective !== next;
    this.analysisPerspective = next;
    if (syncDraft && this.gameSaveDraft) {
      const draftChanged = this.gameSaveDraft.playerColor !== next;
      this.gameSaveDraft.playerColor = next;
      if (draftChanged && markDirty) {
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
      }
      if (this.saveGameInputs?.playerColor) {
        this.saveGameInputs.playerColor.value = next;
      }
    }
    if (updateBoard && this.appMode === "analysis" && this.board?.orientation) {
      const orientation = next === "b" ? "black" : "white";
      if (this.board.orientation() !== orientation) this.board.orientation(orientation);
      this.moveArrows?.setOrientation(orientation);
      this.resetBoardKeyboardCursor();
      this.scheduleBoardResize();
    }
    this.updateBoardContext();
    if (!changed) return;
    if (this.appMode === "analysis") this.renderSuggestions();
  }

  verifiedReviewAtPath(report, path, ply) {
    const node = path?.[ply];
    const parent = path?.[ply - 1];
    const expectedUci = node?.move
      ? `${node.move.from || ""}${node.move.to || ""}${node.move.promotion || ""}`
        .toLowerCase()
      : "";
    if (!report?.moves || !node?.fen || !parent?.fen || !expectedUci) return null;

    const candidates = report.moves.filter((entry) => entry?.ply === ply);
    for (const candidate of candidates) {
      const verified = verifiedMoveReview(candidate);
      if (
        !verified
        || verified.playedUci !== expectedUci
        || verified.fenBefore !== parent.fen
      ) continue;
      const resultingFrame = buildPvFrames(parent.fen, [expectedUci], 1)[0];
      if (
        !resultingFrame
        || resultingFrame.fen !== node.fen
        || (verified.fenAfter && verified.fenAfter !== node.fen)
      ) continue;
      return verified;
    }
    return null;
  }

  getLastPerspectiveMoveReview() {
    const perspective = this.getAnalysisPerspective();
    if (this.game.turn() === perspective) return null;
    const path = this.getCurrentPath();
    const ply = path.length - 1;
    if (ply < 1 || path[ply]?.move?.color !== perspective) return null;
    const reports = [
      this.liveAccuracyReport,
      this.gameReviewReport,
      this.savedGameReview,
    ];
    for (const report of reports) {
      const verified = this.verifiedReviewAtPath(report, path, ply);
      if (verified?.color === perspective) return verified;
    }
    return null;
  }

  getLatestVerifiedMoveReview() {
    const path = this.getCurrentPath();
    const ply = path.length - 1;
    if (ply < 1) return null;
    const reports = [
      this.liveAccuracyReport,
      this.gameReviewReport,
      this.savedGameReview,
    ];
    for (const report of reports) {
      const verified = this.verifiedReviewAtPath(report, path, ply);
      if (verified) return verified;
    }
    return null;
  }

  resetSuggestionCoachState({ abortChat = false } = {}) {
    this.suggestionCoachController?.abort();
    this.suggestionCoachController = null;
    if (this.suggestionCoachTimer) {
      window.clearTimeout(this.suggestionCoachTimer);
      this.suggestionCoachTimer = null;
    }
    this.suggestionCoachKey = "";
    this.suggestionCoachReasons = new Map();
    this.suggestionCoachExplanation = null;
    this.suggestionCoachPositionEvidence = null;
    this.suggestionCoachBusy = false;
    this.suggestionExplanationExpanded = false;
    if (abortChat) {
      this.chatRequestController?.abort();
      this.chatRequestController = null;
      this.setChatBusy(false);
    }
  }

  resetCoachGameContext({ clearMessages = true } = {}) {
    this.coachGameGeneration += 1;
    this.resetSuggestionCoachState({ abortChat: true });
    this.playCoachController?.abort();
    this.playCoachController = null;
    this.moveExplanationControllers.forEach((controller) => controller.abort());
    this.moveExplanationControllers.clear();
    this.reviewJourneyCoachController?.abort();
    this.reviewJourneyCoachController = null;
    this.latestComputerExplanation = null;
    this.computerExplanationExpanded = false;
    if (clearMessages) {
      this.chatMessages = [];
      this.renderChat();
    }
  }

  refreshCoachContextAfterProfileChange() {
    if (this.destroyed) return;
    this.resetSuggestionCoachState({ abortChat: true });
    if (this.appMode !== "analysis") return;
    const lines = this.suggestionState?.lines
      ? Array.from(this.suggestionState.lines.entries())
        .sort(([left], [right]) => left - right)
        .slice(0, Math.max(1, this.suggestionCount))
      : [];
    if (lines.length > 0) this.scheduleSuggestionCoachReasons(lines);
    this.scheduleLatestMoveExplanation();
  }

  scheduleLatestMoveExplanation() {
    if (this.appMode !== "analysis" || this.coachConfigured === false) return;
    const move = this.getLatestVerifiedMoveReview();
    if (!move) return;
    const engineContext = this.buildMoveCoachEngineContext(move);
    const currentPath = this.getCurrentPath();
    const openingContext = this.buildOpeningCoachContext(
      currentPath.slice(0, Math.min(currentPath.length, move.ply + 1)),
    );
    const bundle = this.buildLocalMoveExplanationBundle(engineContext, openingContext);
    if (!bundle) return;
    const explanationNode = currentPath[move.ply];
    const explanationParent = currentPath[move.ply - 1];
    const positionFenBefore = explanationParent?.fen
      || move.fenBefore
      || bundle.positionEvidence?.input?.fenBefore
      || "";
    const positionFenAfter = explanationNode?.fen || move.fenAfter || "";
    const pathSignature = movePathSignature(currentPath, move.ply);
    const messageKey = [
      "move",
      this.activeGameId,
      move.ply,
      move.playedUci || move.san || "",
      positionFenBefore,
      positionFenAfter,
      pathSignature,
      bundle.key,
    ].join(":");
    this.latestComputerExplanation = {
      key: messageKey,
      ply: move.ply,
      moveSan: move.san,
      playedUci: move.playedUci || "",
      positionFenBefore,
      positionFenAfter,
      pathSignature,
      explanation: bundle.explanation,
      positionEvidence: bundle.positionEvidence,
      source: this.moveExplanationCache.has(bundle.key) ? "client-cache" : "local",
      gameGeneration: this.coachGameGeneration,
    };
    this.computerExplanationExpanded = false;
    this.renderSuggestions();
    if (
      this.moveExplanationCache.has(bundle.key)
      || this.moveExplanationControllers.has(bundle.key)
    ) return;
    const generation = this.coachGameGeneration;
    const gameId = this.activeGameId;
    const controller = new AbortController();
    this.moveExplanationControllers.set(bundle.key, controller);
    this.requestGroundedMoveExplanation({
      engineContext,
      openingContext,
      history: this.game.history(),
      clientKey: bundle.key,
      signal: controller.signal,
    }).then((result) => {
      if (
        !result?.explanation
        || this.destroyed
        || generation !== this.coachGameGeneration
        || gameId !== this.activeGameId
        || this.latestComputerExplanation?.key !== messageKey
      ) return;
      this.latestComputerExplanation = {
        ...this.latestComputerExplanation,
        explanation: result.explanation,
        source: result.source,
      };
      this.renderSuggestions();
    }).catch((error) => {
      if (error?.name !== "AbortError") {
        console.warn("[Coach] Vertiefte Zugerklärung nicht verfügbar:", error?.message || error);
      }
    }).finally(() => {
      if (this.moveExplanationControllers.get(bundle.key) === controller) {
        this.moveExplanationControllers.delete(bundle.key);
      }
    });
  }

  buildAnalysisCoachEngineContext() {
    return this.game.turn() === this.getAnalysisPerspective()
      ? this.buildPositionCoachEngineContext()
      : this.buildMoveCoachEngineContext(this.getLastPerspectiveMoveReview());
  }

  scheduleSuggestionCoachReasons(lines) {
    if (
      this.appMode !== "analysis"
      || this.coachConfigured === false
      || !Array.isArray(lines)
      || lines.length === 0
      || (this.suggestionState?.depth || 0) < Math.min(10, this.suggestionState?.targetDepth || 10)
    ) return;
    const opening = this.buildOpeningCoachContext();
    const learner = this.getCoachLearnerProfile();
    const key = JSON.stringify({
      fen: this.suggestionState?.fen || "",
      searchId: this.suggestionState?.searchId || "",
      learner: {
        version: learner?.version || 0,
        level: learner?.level || "",
        estimatedRating: learner?.estimatedRating || null,
      },
      opening: {
        current: opening?.displayName || "",
        suggested: opening?.suggestedOpening?.displayName || "",
      },
      lines: lines.map(([rank, data]) => ({
        rank,
        depth: data?.depth || 0,
        score: data?.whiteScore || data?.score || null,
        pv: Array.isArray(data?.pv) ? data.pv.slice(0, 8) : [],
      })),
    });
    if (!key || key === this.suggestionCoachKey) return;
    if (this.suggestionCoachTimer) window.clearTimeout(this.suggestionCoachTimer);
    this.suggestionCoachController?.abort();
    this.suggestionCoachKey = key;
    this.suggestionCoachReasons = new Map();
    this.suggestionCoachExplanation = null;
    this.suggestionCoachPositionEvidence = null;
    this.suggestionExplanationExpanded = false;
    this.suggestionCoachBusy = true;
    this.suggestionCoachTimer = window.setTimeout(() => {
      this.suggestionCoachTimer = null;
      this.requestSuggestionCoachReasons(lines, key);
    }, 550);
    if (!this.previewState) this.renderSuggestions();
  }

  async requestSuggestionCoachReasons(lines, key) {
    if (!key || key !== this.suggestionCoachKey) return;
    this.suggestionCoachController?.abort();
    const controller = new AbortController();
    this.suggestionCoachController = controller;
    this.suggestionCoachKey = key;
    this.suggestionCoachReasons = new Map();
    this.suggestionCoachExplanation = null;
    this.suggestionCoachPositionEvidence = null;
    this.suggestionExplanationExpanded = false;
    this.suggestionCoachBusy = true;
    const requestFen = this.suggestionState?.fen || "";
    const requestSearchId = this.suggestionState?.searchId || "";
    const generation = this.coachGameGeneration;
    const engineContext = this.buildPositionCoachEngineContext();
    const openingContext = this.buildOpeningCoachContext();
    const localBundle = this.buildLocalMoveExplanationBundle(
      engineContext,
      openingContext,
    );
    const shortReason = (explanation) => (
      compactMoveExplanationClaims(explanation, { maximum: 4 })
        .filter((claim) => (
          !["assessment", "opening", "variation", "alternative"]
            .includes(claim?.claimKind)
        ))
        .slice(0, 1)
        .map((claim) => claim?.text)
        .filter(Boolean)
        .join(" ")
    );
    const fallbackReasons = new Map(lines.map(([rank, data]) => {
      const san = this.pvToSanList(data?.pv, data?.fen)[0] || "";
      return [rank, groundedSuggestionReason({
        rank,
        san,
        uci: data?.pv?.[0] || "",
      })];
    }));
    if (localBundle?.explanation) {
      this.suggestionCoachExplanation = localBundle.explanation;
      this.suggestionCoachPositionEvidence = localBundle.positionEvidence;
      fallbackReasons.set(1, shortReason(localBundle.explanation));
    }
    this.suggestionCoachReasons = fallbackReasons;
    this.renderSuggestions();
    try {
      const result = await this.requestGroundedMoveExplanation({
        engineContext,
        openingContext,
        history: this.game.history(),
        clientKey: localBundle?.key || "",
        signal: controller.signal,
      });
      if (
        result?.explanation
        && this.suggestionCoachKey === key
        && generation === this.coachGameGeneration
        && requestFen === this.suggestionState?.fen
        && requestSearchId === this.suggestionState?.searchId
      ) {
        this.suggestionCoachExplanation = result.explanation;
        fallbackReasons.set(1, shortReason(result.explanation));
        this.suggestionCoachReasons = fallbackReasons;
      }
    } catch (error) {
      if (
        error?.name !== "AbortError"
        && this.suggestionCoachKey === key
        && generation === this.coachGameGeneration
        && requestFen === this.suggestionState?.fen
      ) {
        this.suggestionCoachReasons = fallbackReasons;
      }
    } finally {
      if (
        this.suggestionCoachKey === key
        && this.suggestionCoachController === controller
      ) {
        this.suggestionCoachBusy = false;
        this.suggestionCoachController = null;
        if (!this.previewState) this.renderSuggestions();
      }
    }
  }

  renderMoveArrows() {
    if (!this.moveArrows) return;
    if (this.reviewJourney) return;
    if (
      this.appMode === "play"
      ||
      this.suggestionCount === 0
      || this.game.turn() !== this.getAnalysisPerspective()
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

  startSuggestionPreview(data, row, suppliedPlan = null) {
    if (
      this.appMode === "play"
      ||
      this.reviewRunning
      || !data
      || data.fen !== this.analysisFen
      || data.fen !== this.game.fen()
      || data.searchId !== this.suggestionState?.searchId
    ) return;
    const plan = suppliedPlan || buildCoachVisualPlan({
      fen: data.fen,
      pv: data.pv,
      rank: data.multipv || 1,
    });
    if (!plan) return;
    this.startCoachPlanPreview({
      fen: data.fen,
      plan,
      row,
      label: plan.rank === 1 ? "Beste Idee" : `Alternative ${plan.rank}`,
    });
  }

  startCoachPlanPreview({
    fen,
    plan,
    row,
    label = "Coach-Idee",
  } = {}) {
    if (
      this.destroyed
      || this.reviewRunning
      || !fen
      || !plan?.frames?.length
      || !plan?.uci?.length
    ) return;
    if (this.previewState?.row === row) return;
    this.stopAllBoardPreviews({ restore: false, deferRender: true });

    const token = ++this.previewToken;
    const boardSurface = document.getElementById('board-surface');
    if (!this.previewBadge && boardSurface) {
      this.previewBadge = document.createElement('div');
      this.previewBadge.className = 'board-preview-badge';
      boardSurface.appendChild(this.previewBadge);
    }
    const frames = plan.frames;
    this.previewState = {
      token,
      row,
      frames,
      index: -1,
      kind: "coach-plan",
      plan,
    };
    row?.classList.add('is-previewing');
    this.moveArrows?.setAnnotations(plan.annotations);
    this.board.position(fen, false);
    if (this.previewBadge) {
      this.previewBadge.hidden = false;
      this.previewBadge.textContent = plan.tactical
        ? `${label} · ${plan.motif}`
        : `${label} · ${plan.headline}`;
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reducedMotion) {
      const last = frames[frames.length - 1];
      this.board.position(last.fen, false);
      this.moveArrows?.setAnnotations(
        plan.persistentAnnotations || {
          arrows: [],
          highlights: [
            { square: last.from, role: "origin" },
            { square: last.to, role: "destination" },
          ],
        },
      );
      if (this.previewBadge) {
        this.previewBadge.textContent = `${label} · ${plan.headline}`;
      }
      return;
    }

    const showFrame = (index) => {
      if (!this.previewState || this.previewState.token !== token) return;
      const frame = frames[index];
      if (!frame) return;
      this.previewState.index = index;
      this.board.position(frame.fen, true);
      const next = frames[index + 1];
      const frameAnnotations = plan.frameAnnotations?.[index] || {
        arrows: [],
        highlights: [],
      };
      const persistentAnnotations = (
        !plan.tactical || index === frames.length - 1
      )
        ? plan.persistentAnnotations || { arrows: [], highlights: [] }
        : { arrows: [], highlights: [] };
      this.moveArrows?.setAnnotations({
        arrows: [
          ...frameAnnotations.arrows.filter(
            (arrow) => arrow.role !== "primary",
          ),
          ...persistentAnnotations.arrows.filter(
            (arrow) => arrow.role !== "primary",
          ),
          ...(next
            ? [{ rank: 1, move: next.uci, impact: 1, role: "primary" }]
            : []),
        ],
        highlights: [
          ...persistentAnnotations.highlights,
          ...frameAnnotations.highlights,
        ],
      });
      if (this.previewBadge) {
        this.previewBadge.textContent =
          `${label} · ${index + 1}/${frames.length} · ${frame.san}`;
      }
      if (index + 1 < frames.length) {
        this.previewTimer = window.setTimeout(() => showFrame(index + 1), 720);
      }
    };
    this.previewTimer = window.setTimeout(() => showFrame(0), 520);
  }

  stopSuggestionPreview(row = null, { deferRender = false, restore = true } = {}) {
    if (!this.previewState) return;
    if (row && this.previewState.row !== row) return;
    this.previewToken += 1;
    if (this.previewTimer) window.clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.previewState.row?.classList.remove('is-previewing');
    this.previewState.row?.setAttribute?.("aria-pressed", "false");
    this.previewState = null;
    if (!this.destroyed && restore) {
      this.board?.position?.(this.game.fen(), false);
      this.moveArrows?.setVisible(true);
      this.renderMoveArrows();
    }
    if (this.previewBadge) this.previewBadge.hidden = true;
    if (this.suggestionsDirtyDuringPreview && !deferRender) {
      this.suggestionsDirtyDuringPreview = false;
      requestAnimationFrame(() => {
        if (
          !this.previewState
          && !this.moveListPreviewState
          && !this.destroyed
        ) this.renderSuggestions();
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
    this.stopAllBoardPreviews({ restore: false, deferRender: true });
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

  stopMoveListPreview(
    element = null,
    { restore = true, deferRender = false } = {},
  ) {
    if (!this.moveListPreviewState) return;
    if (element && this.moveListPreviewState.element !== element) return;
    this.moveListPreviewState.element?.classList.remove("is-previewing");
    this.moveListPreviewState = null;
    if (!this.destroyed && restore) {
      this.board?.position?.(this.game.fen(), false);
      this.moveArrows?.setVisible(true);
      this.renderMoveArrows();
    }
    if (this.previewBadge) this.previewBadge.hidden = true;
    if (
      this.suggestionsDirtyDuringPreview
      && !this.previewState
      && !deferRender
    ) {
      this.suggestionsDirtyDuringPreview = false;
      requestAnimationFrame(() => {
        if (
          !this.previewState
          && !this.moveListPreviewState
          && !this.destroyed
        ) this.renderSuggestions();
      });
    }
  }

  stopAllBoardPreviews({ restore = true, deferRender = false } = {}) {
    const hadPreview = Boolean(this.previewState || this.moveListPreviewState);
    const hadDeferredSuggestionRender = this.suggestionsDirtyDuringPreview;
    this.stopSuggestionPreview(null, { deferRender: true, restore: false });
    this.stopMoveListPreview(null, { restore: false, deferRender: true });
    if (hadPreview && restore && !this.destroyed) {
      this.board?.position?.(this.game.fen(), false);
      this.moveArrows?.setVisible(true);
      this.renderMoveArrows();
    }
    if (this.previewBadge) this.previewBadge.hidden = true;
    if (hadDeferredSuggestionRender) {
      this.suggestionsDirtyDuringPreview = true;
      if (!deferRender) {
        this.suggestionsDirtyDuringPreview = false;
        requestAnimationFrame(() => {
          if (
            !this.previewState
            && !this.moveListPreviewState
            && !this.destroyed
          ) this.renderSuggestions();
        });
      }
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
      playerColor: this.appMode === "play" && this.playSession.active
        ? this.playSession.playerColor
        : this.gameSaveDraft?.playerColor || this.analysisPerspective,
    });
    this.updateAccuracyDisplay();
    this.renderMoveList();
  }

  updateAccuracyDisplay() {
    const ownOnly = this.appMode === "play" && this.playSession.active;
    if (this.playFeedbackEl) {
      this.playFeedbackEl.hidden = !ownOnly || !this.playSession.liveFeedback;
    }
  }

  openEngineSettings() {
    const dialog = this.engineSettingsDialog;
    if (!dialog || dialog.open) return;
    const [depthInput, threadsInput, hashInput, suggestionsInput] = this.engineInputs || [];
    if (depthInput) depthInput.value = String(this.engine?.depth ?? 15);
    if (threadsInput) threadsInput.value = String(this.engine?.threads ?? 1);
    if (hashInput) hashInput.value = String(this.engine?.hashMB ?? 128);
    if (suggestionsInput) suggestionsInput.value = String(this.suggestionCount);
    this.stopAllBoardPreviews();
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
      this.modePrimaryAction?.focus();
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
    status.textContent = `Stellung ${Math.min(current, total)} von ${total} wird geprüft`;
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

    this.stopAllBoardPreviews();
    this.engine?.cancelSearch?.();
    this.reviewCancelled = false;
    this.reviewRunning = true;
    this.markGameDirty();
    if (this.modePrimaryAction) this.modePrimaryAction.disabled = true;
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
      this.attachLocalMoveExplanations(report, path);
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

  attachLocalMoveExplanations(report, path) {
    if (!Array.isArray(report?.moves) || !Array.isArray(path)) return report;
    report.moves.forEach((storedMove) => {
      const move = verifiedMoveReview(storedMove);
      if (!move) return;
      const engineContext = this.buildMoveCoachEngineContext(move);
      const openingContext = this.buildOpeningCoachContext(
        path.slice(0, Math.min(path.length, move.ply + 1)),
      );
      const bundle = this.buildLocalMoveExplanationBundle(
        engineContext,
        openingContext,
      );
      if (bundle?.explanation) {
        storedMove.coachExplanation = bundle.explanation;
        storedMove.coachExplanationKey = bundle.key;
      }
    });
    return report;
  }

  async requestCoachGameFeedback(report, path, { signal = null } = {}) {
    if (!signal) {
      this.reviewCoachController?.abort();
      this.reviewCoachController = new AbortController();
    }
    const payload = {
      message: 'Formuliere fünf kurze Abschnitte: Spielverlauf, durch Stockfish belegte Hauptmotive, besonders starke Entscheidungen, wichtigste Verbesserung und konkreter Trainingsfokus. Beziehe jede konkrete Zug- oder Motivaussage ausschließlich auf die gelieferten Stockfish-PVs. Wenn die Daten kein gemeinsames Motiv belegen, sage das offen.',
      engineContext: this.buildGameReviewCoachEngineContext(report),
      openingContext: this.buildOpeningCoachContext(path),
      learnerProfile: this.getCoachLearnerProfile(),
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
    leadTitle.textContent = 'Gesamtbild deiner Partie';
    leadCopy.appendChild(leadTitle);
    const coverage = document.createElement('span');
    coverage.textContent = `${report.analyzedMoves}/${report.totalMoves} Züge zuverlässig geprüft`;
    leadCopy.appendChild(coverage);
    lead.appendChild(leadCopy);
    this.feedbackBodyEl.appendChild(lead);

    if (report.criticalMoments?.length > 0) {
      const journeyCta = document.createElement("div");
      journeyCta.className = "review-journey-cta";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = "Deine Partie als Präsentation";
      const detail = document.createElement("span");
      detail.textContent = `${report.criticalMoments.length} Schlüsselmomente am Brett – mit Coach-Erklärung und Pfeiltasten.`;
      copy.append(title, detail);
      const start = document.createElement("button");
      start.type = "button";
      start.className = "primary-action-button";
      start.textContent = "Präsentation starten";
      start.addEventListener("click", () => this.startReviewJourney(report));
      journeyCta.append(copy, start);
      this.feedbackBodyEl.appendChild(journeyCta);
    }

    if (report.criticalMoments?.length > 0) {
      const criticalHeading = document.createElement("h3");
      criticalHeading.textContent = `Deine ${report.criticalMoments.length} entscheidenden Momente`;
      this.feedbackBodyEl.appendChild(criticalHeading);
      const list = document.createElement("div");
      list.className = "critical-list";
      report.criticalMoments.forEach((move) => {
        const item = document.createElement("div");
        item.className = "critical-move";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `${move.moveNumber}${move.color === "b" ? "…" : "."} ${move.san}`;
        const description = document.createElement("span");
        const quality = MOVE_QUALITY[move.quality]?.label || move.quality;
        description.textContent = `${quality}${move.bestSan ? ` · Stärkere Idee: ${move.bestSan}` : " · Diesen Moment noch einmal prüfen"}`;
        copy.append(title, description);
        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "secondary-button";
        jump.textContent = "Am Brett ansehen";
        jump.addEventListener("click", () => this.startReviewJourney(report, move.ply));
        item.append(copy, jump);
        list.appendChild(item);
      });
      this.feedbackBodyEl.appendChild(list);
    }

    const learning = buildLearningSummary(report);
    const learningSection = document.createElement("section");
    learningSection.className = "learning-summary";
    learningSection.setAttribute("aria-labelledby", "learning-summary-title");
    const learningHeading = document.createElement("div");
    learningHeading.className = "learning-summary-heading";
    const learningEyebrow = document.createElement("p");
    learningEyebrow.className = "eyebrow";
    learningEyebrow.textContent = "Dein nächster Trainingsschritt";
    const learningTitle = document.createElement("h3");
    learningTitle.id = "learning-summary-title";
    learningTitle.textContent = "Was du aus dieser Partie mitnehmen kannst";
    learningHeading.append(learningEyebrow, learningTitle);
    learningSection.appendChild(learningHeading);
    const learningGrid = document.createElement("div");
    learningGrid.className = "learning-summary-grid";
    [
      ["Stärkste Phase", learning.strongestPhase, learning.strongestPhaseDetail, "strength"],
      ["Wichtigster Moment", "Hier lohnt sich ein zweiter Blick", learning.biggestLesson, "moment"],
      ["Wiederkehrendes Muster", "Vorsichtige Einordnung", learning.recurringPattern, "pattern"],
      ["Konkretes Lernziel", learning.learningGoal, "Nutze dieses Ziel in deiner nächsten Partie.", "goal"],
      ["Empfohlene Übung", learning.exercise, "Kurz, konkret und direkt aus dieser Analyse abgeleitet.", "exercise"],
    ].forEach(([label, title, detail, tone]) => {
      const item = document.createElement("article");
      item.className = `learning-summary-item is-${tone}`;
      const itemLabel = document.createElement("span");
      itemLabel.textContent = label;
      const itemTitle = document.createElement("strong");
      itemTitle.textContent = title;
      const itemDetail = document.createElement("p");
      itemDetail.textContent = detail;
      item.append(itemLabel, itemTitle, itemDetail);
      learningGrid.appendChild(item);
    });
    learningSection.appendChild(learningGrid);
    if (learning.confidence === "low") {
      const note = document.createElement("p");
      note.className = "learning-confidence";
      note.textContent = "Hinweis: Die Aussage ist vorsichtig formuliert, weil nur wenige bewertete Züge vorliegen.";
      learningSection.appendChild(note);
    }
    this.feedbackBodyEl.appendChild(learningSection);

    const coachHeading = document.createElement('h3');
    coachHeading.textContent = 'Persönliches Abschlussfeedback';
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

    const technicalDetails = document.createElement("details");
    technicalDetails.className = "review-technical-details";
    const technicalSummary = document.createElement("summary");
    technicalSummary.textContent = "Technische Auswertung anzeigen";
    technicalDetails.appendChild(technicalSummary);

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
    technicalDetails.appendChild(metrics);

    const qualityHeading = document.createElement('h3');
    qualityHeading.textContent = 'Zugqualität';
    technicalDetails.appendChild(qualityHeading);
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
    technicalDetails.appendChild(qualities);
    this.feedbackBodyEl.appendChild(technicalDetails);

    const currentReportPath = this.getCurrentPath();
    if (report.moves?.length > 0) {
      const movesHeading = document.createElement("h3");
      movesHeading.textContent = "Zug für Zug";
      this.feedbackBodyEl.appendChild(movesHeading);
      const moveExplanations = document.createElement("div");
      moveExplanations.className = "review-move-explanations";
      report.moves.forEach((storedMove) => {
        const move = this.verifiedReviewAtPath(
          { moves: [storedMove] },
          currentReportPath,
          storedMove?.ply,
        );
        if (!move) return;
        const moveNode = currentReportPath[move.ply];
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
        const groundedSummary = move.coachExplanation?.summary
          ?.map((claim) => claim?.text)
          .filter(Boolean)
          .join(" ");
        reason.textContent = groundedSummary || explainMoveQuality(move);
        item.append(top, reason);
        item.addEventListener("click", () => {
          this.feedbackDialog.close();
          this.jumpToFen(moveNode.fen, moveNode);
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
      report.criticalMoments.forEach((storedMove) => {
        const move = this.verifiedReviewAtPath(
          { moves: [storedMove] },
          currentReportPath,
          storedMove?.ply,
        );
        if (!move) return;
        const item = document.createElement('div');
        item.className = 'critical-move';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${move.moveNumber}${move.color === 'b' ? '…' : '.'} ${move.san}`;
        const description = document.createElement('span');
        const quality = MOVE_QUALITY[move.quality]?.label || move.quality;
        description.textContent = `${quality}${move.bestSan ? ` · Stärkere Idee: ${move.bestSan}` : " · Diesen Moment noch einmal prüfen"}`;
        copy.append(title, description);
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'secondary-button';
        jump.textContent = 'Im Review zeigen';
        jump.addEventListener('click', () => {
          this.startReviewJourney(report, move.ply);
        });
        item.append(copy, jump);
        list.appendChild(item);
      });
      this.feedbackBodyEl.appendChild(list);
    }

  }

  startReviewJourney(report, startingPly = null) {
    const currentPath = this.getCurrentPath();
    const moments = [...(report?.criticalMoments || [])]
      .map((move) => this.verifiedReviewAtPath(
        { moves: [move] },
        currentPath,
        move?.ply,
      ))
      .filter(Boolean)
      .sort((left, right) => left.ply - right.ply);
    if (moments.length === 0) {
      this.showToast("In dieser Partie gibt es keine klaren Schlüsselmomente.");
      return;
    }
    this.feedbackDialog?.close();
    this.stopAllBoardPreviews({ deferRender: true });
    this.setAppMode("analysis", { force: true, silent: true });
    const requestedIndex = Number.isInteger(startingPly)
      ? moments.findIndex((move) => move.ply === startingPly)
      : 0;
    this.reviewJourney = {
      report,
      moments,
      index: requestedIndex >= 0 ? requestedIndex : 0,
      restoreFen: this.currentNode?.fen || this.game.fen(),
      path: currentPath,
    };
    this.reviewJourneyEl.hidden = false;
    this.analysisColumn?.classList.add("is-review-journey");
    this.renderReviewJourneyMoment();
    this.reviewJourneyEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  navigateReviewJourney(direction) {
    if (!this.reviewJourney) return;
    const next = Math.max(
      0,
      Math.min(
        this.reviewJourney.moments.length - 1,
        this.reviewJourney.index + (direction < 0 ? -1 : 1),
      ),
    );
    if (next === this.reviewJourney.index && direction > 0) {
      this.stopReviewJourney();
      return;
    }
    this.reviewJourney.index = next;
    this.renderReviewJourneyMoment();
  }

  renderReviewJourneyMoment() {
    const journey = this.reviewJourney;
    const move = verifiedMoveReview(journey?.moments?.[journey.index]);
    if (!move) {
      this.reviewJourneyCoachEl.textContent =
        "Dieser Eintrag enthält keinen Zug, der in der zugehörigen Stellung legal ist.";
      return;
    }
    const quality = MOVE_QUALITY[move.quality] || MOVE_QUALITY.good;
    const position = move.fenBefore || move.fenAfter;
    this.stopAllBoardPreviews({ restore: false });
    this.animateBoardPosition(position);
    this.clearAnalysisHighlights();
    this.applyAnalysisHighlights(move);
    const arrow = move.bestUci || move.playedUci;
    this.moveArrows?.setMoves(arrow ? [{ rank: 1, move: arrow, impact: 1 }] : []);

    this.reviewJourneyProgressEl.textContent =
      `Schlüsselmoment ${journey.index + 1} von ${journey.moments.length}`;
    this.reviewJourneyTitleEl.textContent =
      `${move.moveNumber}${move.color === "b" ? "…" : "."} ${move.san}`;
    this.reviewJourneyMoveEl.className = `review-journey-move quality-${quality.tone}`;
    this.reviewJourneyMoveEl.textContent = move.quality === "best" || move.quality === "excellent"
      ? `${quality.label} · Die Stellung bleibt unter Kontrolle`
      : `${quality.label} · Hier verändert sich die Partie deutlich`;
    const coachIntro = move.quality === "best" || move.quality === "excellent"
      ? "Das war stark, weil"
      : move.quality === "good"
        ? "Das war solide, weil"
        : "Hier kippte etwas, weil";
    const bestMove = move.bestSan && move.bestSan !== move.san
      ? ` Der blaue Pfeil zeigt die stärkere Idee mit ${move.bestSan}.`
      : "";
    if (move.coachExplanation) {
      this.reviewJourneyCoachEl.replaceChildren();
      renderChatMarkup(
        this.reviewJourneyCoachEl,
        moveExplanationToMarkdown(move.coachExplanation),
      );
    } else {
      this.reviewJourneyCoachEl.textContent =
        `${coachIntro} ${(move.explanation || explainMoveQuality(move)).replace(/^[A-ZÄÖÜ]/, (letter) => letter.toLowerCase())}${bestMove}`;
    }
    this.reviewJourneyPrevEl.disabled = journey.index === 0;
    this.reviewJourneyNextEl.textContent = journey.index === journey.moments.length - 1
      ? "Review abschließen"
      : "Nächster Moment →";
    this.requestReviewJourneyCoach(move, position);
  }

  async requestReviewJourneyCoach(move, fen) {
    const journey = this.reviewJourney;
    if (!journey || this.coachConfigured === false) return;
    const generation = this.coachGameGeneration;
    const gameId = this.activeGameId;
    const momentKey = reviewJourneyMomentKey(journey, move);
    journey.coachTexts ||= new Map();
    if (journey.coachTexts.has(momentKey)) {
      this.reviewJourneyCoachEl.replaceChildren();
      renderChatMarkup(this.reviewJourneyCoachEl, journey.coachTexts.get(momentKey));
      return;
    }
    this.reviewJourneyCoachController?.abort();
    const controller = new AbortController();
    this.reviewJourneyCoachController = controller;
    try {
      const engineContext = this.buildMoveCoachEngineContext(move);
      const movePath = Array.isArray(journey.path)
        ? journey.path.slice(0, Math.min(journey.path.length, move.ply + 1))
        : [];
      const openingContext = this.buildOpeningCoachContext(movePath);
      const bundle = this.buildLocalMoveExplanationBundle(
        engineContext,
        openingContext,
      );
      const result = await this.requestGroundedMoveExplanation({
        engineContext,
        openingContext,
        history: movePath.slice(1).map((node) => node.move?.san).filter(Boolean),
        clientKey: bundle?.key || "",
        signal: controller.signal,
      });
      const reply = moveExplanationToMarkdown(result?.explanation, { deep: true });
      if (
        !reply
        || this.reviewJourney !== journey
        || generation !== this.coachGameGeneration
        || gameId !== this.activeGameId
        || this.reviewJourneyCoachController !== controller
      ) return;
      journey.coachTexts.set(momentKey, reply);
      const current = journey.moments[journey.index];
      if (reviewJourneyMomentKey(journey, current) === momentKey) {
        this.reviewJourneyCoachEl.replaceChildren();
        renderChatMarkup(this.reviewJourneyCoachEl, reply);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        // Die lokale Coach-Erklärung bleibt als schneller, robuster Fallback sichtbar.
      }
    } finally {
      if (this.reviewJourneyCoachController === controller) {
        this.reviewJourneyCoachController = null;
      }
    }
  }

  applyAnalysisHighlights(move) {
    const mark = (square, className) => {
      if (!square) return;
      this.boardSurface?.querySelector(`.square-${square}`)?.classList.add(className);
    };
    const played = String(move?.playedUci || "");
    const best = String(move?.bestUci || "");
    mark(best.slice(0, 2), "analysis-key-piece");
    mark(best.slice(2, 4), "analysis-key-target");
    if (played && played !== best) {
      mark(played.slice(0, 2), "analysis-played-piece");
      mark(played.slice(2, 4), "analysis-danger-square");
    }
  }

  clearAnalysisHighlights() {
    this.boardSurface?.querySelectorAll(
      ".analysis-key-piece, .analysis-key-target, .analysis-played-piece, .analysis-danger-square",
    ).forEach((square) => square.classList.remove(
      "analysis-key-piece",
      "analysis-key-target",
      "analysis-played-piece",
      "analysis-danger-square",
    ));
  }

  stopReviewJourney({ silent = false } = {}) {
    if (!this.reviewJourney) return;
    const restoreFen = this.reviewJourney.restoreFen;
    this.reviewJourneyCoachController?.abort();
    this.reviewJourneyCoachController = null;
    this.reviewJourney = null;
    if (this.reviewJourneyEl) this.reviewJourneyEl.hidden = true;
    this.analysisColumn?.classList.remove("is-review-journey");
    this.clearAnalysisHighlights();
    if (restoreFen) this.board.position(restoreFen, false);
    this.renderMoveArrows();
    if (!silent) this.showToast("Geführte Review abgeschlossen.");
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
        if (key === "opening") {
          this.openingManualOverride = true;
          this.openingAutoValue = "";
        }
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
        this.updateBoardContext();
      });
      input.addEventListener('change', () => {
        this.gameSaveDraft[key] = input.value;
        if (key === "opening") {
          this.openingManualOverride = true;
          this.openingAutoValue = "";
        }
        this.gameSaveDraftDirty = true;
        this.markGameDirty();
        this.updateSaveGameButton();
        this.updateBoardContext();
        if (key === "playerColor" && (input.value === "w" || input.value === "b")) {
          this.setAnalysisPerspective(input.value, {
            syncDraft: false,
            markDirty: false,
          });
        }
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
    this.stopAllBoardPreviews();
    if (!this.gameSaveDraft.opening) {
      this.gameSaveDraft.opening = (
        openingMetadataName(this.openingRecordLifecycle)
        || openingMetadataName(this.openingLifecycle)
        || ""
      );
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
    this.lichessImportButton.textContent = "Importieren & analysieren";
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
    this.refreshCoachContextAfterProfileChange();
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
      this.lichessFetchedGames = [];
      this.refreshCoachContextAfterProfileChange();
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
      this.refreshCoachContextAfterProfileChange();
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
      checkbox.checked = false;
      checkbox.disabled = Boolean(disabledReason);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.lichessImportResultsEl
            .querySelectorAll('input[type="checkbox"]:checked:not(:disabled)')
            .forEach((input) => {
              if (input !== checkbox) input.checked = false;
            });
        }
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
    this.lichessImportButton.disabled = true;
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
    let records = [];
    try {
      nextState = mergeAccountStates(this.accountState, latestState);
      records = selectedGames.map((game) => (
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
    this.refreshCoachContextAfterProfileChange();
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
      this.refreshCoachContextAfterProfileChange();
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
    this.stopAllBoardPreviews();
    this.renderAccountDialog();
    this.accountDialog.showModal();
  }

  openPlayerStory(games, stats = buildPlayerProfile(games || [])) {
    this.playerStoryDialog?.remove();
    const analyzed = (games || []).filter((game) => game?.review?.analyzedMoves > 0);
    if (analyzed.length === 0) {
      this.showToast("Analysiere zuerst mindestens eine gespeicherte Partie.");
      return;
    }
    const ownAccuracy = (game) => {
      const color = game.metadata?.playerColor;
      return color === "w"
        ? game.review?.whiteAccuracy
        : color === "b" ? game.review?.blackAccuracy : game.review?.overallAccuracy;
    };
    const strongest = [...analyzed]
      .sort((left, right) => (ownAccuracy(right) || 0) - (ownAccuracy(left) || 0))[0];
    const learning = [...analyzed]
      .sort((left, right) => (ownAccuracy(left) || 100) - (ownAccuracy(right) || 100))[0];
    const seriousErrors = (stats.ownMistakes || 0) + (stats.ownBlunders || 0);
    const type = Number.isFinite(stats.ownAccuracy) && stats.ownAccuracy >= 88
      ? "Hohe Engine-Übereinstimmung"
      : seriousErrors <= Math.max(2, stats.analyzedGames)
        ? "Stabile Engine-Werte"
        : "Klare Lernmomente";
    const strength = Number.isFinite(stats.whiteAccuracy) && Number.isFinite(stats.blackAccuracy)
      ? stats.whiteAccuracy >= stats.blackAccuracy
        ? "Deine gemessene Genauigkeit ist mit Weiß höher als mit Schwarz."
        : "Deine gemessene Genauigkeit ist mit Schwarz höher als mit Weiß."
      : "Für einen Farbvergleich liegen noch nicht genügend getrennte Engine-Werte vor.";
    const growth = seriousErrors > 0
      ? `Dein größter messbarer Hebel sind die ${seriousErrors} von Stockfish als Fehler oder Patzer klassifizierten Momente. Spiele dort die gespeicherten Hauptvarianten nach.`
      : "Die analysierten Partien enthalten derzeit kaum deutliche Engine-Einbrüche.";

    const dialog = document.createElement("dialog");
    dialog.className = "modal-dialog player-story-dialog";
    this.playerStoryDialog = dialog;
    const heading = document.createElement("div");
    heading.className = "dialog-heading";
    const headingCopy = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "player-story-eyebrow";
    eyebrow.textContent = "Deine Geschichte aus allen analysierten Partien";
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = type;
    headingCopy.append(eyebrow, title);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Spieler-DNA schließen");
    close.addEventListener("click", () => dialog.close());
    heading.append(headingCopy, close);

    const story = document.createElement("div");
    story.className = "player-story-copy";
    const lead = document.createElement("p");
    lead.textContent = `Aus ${stats.analyzedGames} analysierten ${stats.analyzedGames === 1 ? "Partie" : "Partien"} ergibt sich ein rein datenbasiertes Bild. ${strength}`;
    const opening = document.createElement("p");
    opening.textContent = stats.favoriteOpening?.name
      ? `${stats.favoriteOpening.name} ist deine vertrauteste Eröffnungswelt. Dort lohnt es sich, typische Ideen statt langer Varianten zu lernen.`
      : "Deine Eröffnungsidentität ist noch offen. Ein paar weitere gespeicherte Partien machen dieses Muster sichtbar.";
    const focus = document.createElement("p");
    focus.textContent = growth;
    story.append(lead, opening, focus);

    const chapters = document.createElement("div");
    chapters.className = "player-story-chapters";
    const addExample = (label, game, copy) => {
      if (!game) return;
      const card = document.createElement("article");
      const badge = document.createElement("span");
      badge.textContent = label;
      const name = document.createElement("strong");
      name.textContent = game.title;
      const detail = document.createElement("p");
      detail.textContent = copy;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary-button";
      open.textContent = "Als Review ansehen";
      open.addEventListener("click", () => {
        dialog.close();
        this.accountDialog?.close();
        if (this.openSavedGame(game)) {
          requestAnimationFrame(() => this.startReviewJourney(game.review));
        }
      });
      card.append(badge, name, detail, open);
      chapters.appendChild(card);
    };
    addExample(
      "Das kannst du schon",
      strongest,
      `Mit ${Number(ownAccuracy(strongest) || 0).toFixed(1).replace(".", ",")} % Genauigkeit zeigt diese Partie deine beste Kontrolle.`,
    );
    if (learning?.id !== strongest?.id) {
      addExample(
        "Hier steckt dein nächster Sprung",
        learning,
        "Diese Partie enthält besonders wertvolle Momente für deinen Sicherheitscheck vor dem Zug.",
      );
    }
    dialog.append(heading, story, chapters);
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
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
    const learnerProfile = this.getLearnerProfile();
    const analyzedGameIds = new Set(playerStats.analyzedGameIds);
    const pendingAnalysisGames = games.filter((game) => !analyzedGameIds.has(game.id));
    const analyzeSavedGame = (game) => {
      if (!game || !this.openSavedGame(game)) return;
      requestAnimationFrame(() => this.startFullGameReview());
    };
    const formatPercent = (value) => (
      Number.isFinite(value) ? `${value.toFixed(1).replace('.', ',')} %` : '—'
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
    const playerStoryButton = document.createElement("button");
    playerStoryButton.type = "button";
    playerStoryButton.className = "primary-action-button player-story-button";
    playerStoryButton.textContent = "Meine Spieler-DNA";
    playerStoryButton.disabled = playerStats.analyzedGames === 0;
    playerStoryButton.addEventListener("click", () => this.openPlayerStory(games, playerStats));
    profileHeading.append(profileHeadingCopy, playerStoryButton);
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
    appendMetric(
      'Coach-Niveau',
      learnerProfile.levelLabel,
      learnerProfile.usedDefault
        ? 'Startwert 1200, bis Partieratings vorliegen'
        : `automatisch aus ${learnerProfile.evidence.count} Rating-Hinweisen · ca. ${learnerProfile.rating}`,
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
        ? 'Bis zu zwei Partien werden gleichzeitig ausgewertet. Du kannst weiterarbeiten.'
        : 'Die nächsten Partien werden vorbereitet …';
      progressCard.append(progressTop, progress, active);
      this.accountBodyEl.appendChild(progressCard);
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
    const seriousErrors = (playerStats.ownMistakes || 0) + (playerStats.ownBlunders || 0);
    const playerType = Number.isFinite(playerStats.ownAccuracy) && playerStats.ownAccuracy >= 88
      ? "Präziser Kontrolleur"
      : seriousErrors <= Math.max(2, playerStats.analyzedGames)
        ? "Solider Stratege"
        : "Mutiger Kämpfer";
    appendFact(
      "Dein Spielertyp",
      playerType,
      playerType === "Mutiger Kämpfer"
        ? "Du gehst Chancen ein – der nächste Schritt ist ein ruhiger Sicherheitscheck."
        : "Du baust Stellungen verlässlich auf und hältst deinen Plan zusammen.",
    );
    appendFact(
      "Deine Stärke",
      strongerColor === "Noch offen" ? "Stabile Grundideen" : `Spiel mit ${strongerColor}`,
      `Weiß ${formatPercent(playerStats.whiteAccuracy)} · Schwarz ${formatPercent(playerStats.blackAccuracy)}`,
    );
    appendFact(
      "Deine Komfortzone",
      playerStats.favoriteOpening?.name || playerStats.mostCommonTimeFormat?.name || "Noch nicht erkennbar",
      playerStats.favoriteOpening
        ? `Diese Eröffnung spielst du am häufigsten (${gamesLabel(playerStats.favoriteOpening.games)}).`
        : "Mit mehr gespeicherten Partien wird dein Muster klarer.",
    );
    appendFact(
      "Dein Trainingshebel",
      seriousErrors > 0 ? "Gefahren vor dem Zug prüfen" : "Komplexere Stellungen suchen",
      seriousErrors > 0
        ? `${seriousErrors} kritische Momente: erst Drohung, Schach und Schlagzug prüfen.`
        : "Deine Basis ist sauber – jetzt darf das Training anspruchsvoller werden.",
    );
    appendFact(
      "Deine aktuelle Form",
      formatPercent(playerStats.currentForm.scoreRate),
      playerStats.currentForm.sequence.length
        ? playerStats.currentForm.sequence
          .map((result) => ({ W: "S", D: "R", L: "N" }[result] || "–"))
          .join(" · ")
        : "Noch keine abgeschlossenen Partien",
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
        const ownAccuracy = game.metadata?.playerColor === "w"
          ? game.review.whiteAccuracy
          : game.metadata?.playerColor === "b"
            ? game.review.blackAccuracy
            : game.review.overallAccuracy;
        coachSummary.textContent = ownAccuracy >= 88
          ? "Hohe Stockfish-Übereinstimmung."
          : ownAccuracy >= 75
            ? "Solide Engine-Werte · kritische Momente vergleichen."
            : "Mehrere Engine-Abweichungen · Hauptvarianten nachspielen.";
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
      } else {
        const review = document.createElement("button");
        review.type = "button";
        review.className = "secondary-button";
        review.textContent = "Review";
        review.addEventListener("click", () => {
          if (!this.openSavedGame(game)) return;
          requestAnimationFrame(() => this.startReviewJourney(game.review));
        });
        itemActions.appendChild(review);
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
    this.attachLocalMoveExplanations(report, path);
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
      review: compactReviewForStorage(report),
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
      const completed = this.batchReviewProgress.completed;
      const failed = this.batchReviewProgress.failed;
      this.batchReviewSummary = null;
      this.updateBatchReviewUi();
      this.showToast(
        failed
          ? `${completed} Partien analysiert · ${failed} konnten nicht abgeschlossen werden.`
          : `Gesamtanalyse fertig: ${completed} Partien ausgewertet.`,
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
    draft.whitePlayer = String(
      this.whitePlayerInput?.value || draft.whitePlayer || "",
    ).trim().slice(0, 80);
    draft.blackPlayer = String(
      this.blackPlayerInput?.value || draft.blackPlayer || "",
    ).trim().slice(0, 80);
    if (draft.playerColor === "w" && draft.blackPlayer) {
      draft.opponent = draft.blackPlayer;
    } else if (draft.playerColor === "b" && draft.whitePlayer) {
      draft.opponent = draft.whitePlayer;
    }
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
        review: compactReviewForStorage(completeReview),
        metadata: {
          playerColor: draft.playerColor,
          playedAt: draft.playedAt,
          whitePlayer: draft.whitePlayer,
          blackPlayer: draft.blackPlayer,
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
    this.refreshCoachContextAfterProfileChange();
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
    this.stopReviewJourney({ silent: true });
    this.cancelPlaySession();
    this.appMode = "analysis";
    this.engine?.setMultiPV?.(this.suggestionCount === 0 ? 1 : this.suggestionCount);
    this.cancelFullGameReview();
    this.stopAllBoardPreviews();
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
      this.resetCoachGameContext({ clearMessages: true });
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
      const savedOpening = this.gameSaveDraft.opening || "";
      const savedAutomaticOpening = this.openingBook
        ? openingMetadataName(
          deriveOpeningLifecycle(this.getMainlinePath(), this.openingBook),
        )
        : "";
      this.openingManualOverride = Boolean(
        savedOpening && savedOpening !== savedAutomaticOpening,
      );
      this.openingAutoValue = this.openingManualOverride
        ? ""
        : savedAutomaticOpening;
      this.openingLifecycle = null;
      this.openingRecordLifecycle = null;
      this.gameSaveDraftDirty = false;
      this.gameReviewReport = record.review || null;
      this.savedGameReview = record.review || null;
      this.liveAccuracyReport = record.review || null;
      if (this.gameReviewReport) {
        this.attachLocalMoveExplanations(
          this.gameReviewReport,
          pathToNode(node),
        );
      }
      this.setAnalysisPerspective(
        this.gameSaveDraft.playerColor || "w",
        { markDirty: false },
      );
      this.board.position(node.fen, false);
      this.renderMoveList();
      this.updateGameStatus();
      this.updateAccuracyDisplay();
      this.updateSaveGameButton();
      this.updateModeUi();
      this.refreshOpeningRecognition();
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

  async initializeOpeningBook() {
    try {
      this.openingBook = await loadOpeningBook();
      if (this.destroyed) return;
      this.refreshOpeningRecognition();
      this.refreshCoachContextAfterProfileChange();
    } catch (error) {
      if (this.destroyed) return;
      this.openingBookError = error?.message || "Lokale Eröffnungsdaten nicht verfügbar.";
      this.updateBoardContext();
    }
  }

  refreshOpeningRecognition() {
    if (!this.openingBook) return this.openingRecognition;
    const currentPath = this.getCurrentPath();
    this.openingLifecycle = deriveOpeningLifecycle(currentPath, this.openingBook);
    this.openingRecognition = this.openingLifecycle.current;

    const mainlinePath = this.getMainlinePath();
    this.openingRecordLifecycle = deriveOpeningLifecycle(
      mainlinePath.length > 1 ? mainlinePath : currentPath,
      this.openingBook,
    );
    const automaticOpening = (
      openingMetadataName(this.openingRecordLifecycle)
      || openingMetadataName(this.openingLifecycle)
      || ""
    );
    if (
      automaticOpening
      && !this.openingManualOverride
      && this.gameSaveDraft
      && (
        !this.gameSaveDraft.opening
        || this.gameSaveDraft.opening === this.openingAutoValue
      )
    ) {
      this.gameSaveDraft.opening = automaticOpening;
      this.openingAutoValue = automaticOpening;
      if (
        this.saveGameInputs?.opening
        && document.activeElement !== this.saveGameInputs.opening
      ) {
        this.saveGameInputs.opening.value = automaticOpening;
      }
    }
    this.updateBoardContext();
    return this.openingRecognition;
  }

  updateBoardContext() {
    const session = this.appMode === "play" && this.playSession?.active
      ? {
        ...this.playSession,
        opponent: engineOpponentLabel(this.playSession.level),
      }
      : null;
    const opening = this.openingManualOverride
      ? this.gameSaveDraft?.opening || ""
      : (
        openingMetadataName(this.openingRecordLifecycle)
        || openingMetadataName(this.openingLifecycle)
        || this.gameSaveDraft?.opening
        || ""
      );
    const model = gameLibraryModel({
      draft: this.gameSaveDraft,
      profile: this.accountState?.profile,
      session,
      opening,
      result: this.getGameResult(),
    });
    if (this.whitePlayerInput && document.activeElement !== this.whitePlayerInput) {
      this.whitePlayerInput.value = model.white;
    }
    if (this.blackPlayerInput && document.activeElement !== this.blackPlayerInput) {
      this.blackPlayerInput.value = model.black;
    }
    if (this.playedAtDisplayEl) this.playedAtDisplayEl.textContent = model.date;
    if (this.resultDisplayEl) this.resultDisplayEl.textContent = model.result;
    if (this.detectedOpeningEl) {
      this.detectedOpeningEl.textContent = this.openingBookError
        ? "Erkennung nicht verfügbar"
        : model.opening;
      this.detectedOpeningEl.title = this.detectedOpeningEl.textContent;
    }
  }

  buildOpeningCoachContext(path = null) {
    const selectedPath = Array.isArray(path) ? path : this.getCurrentPath();
    const lifecycle = this.openingBook
      ? deriveOpeningLifecycle(selectedPath, this.openingBook)
      : null;
    const current = openingCoachContext(
      lifecycle?.current || this.openingRecognition,
    );
    return {
      ...current,
      announcement: openingAnnouncementContext(lifecycle?.currentEvent),
    };
  }

  getLearnerProfile() {
    return buildLearnerProfile({
      accountState: this.accountState,
      lichessAccount: this.lichessConnection?.user,
      lichessGames: this.lichessFetchedGames,
    });
  }

  getCoachLearnerProfile() {
    return learnerProfileForCoach(this.getLearnerProfile());
  }

  loadMoveExplanationCache() {
    this.moveExplanationCache.clear();
    try {
      this.browserStorage?.removeItem?.("chess-coach.move-explanations.v2");
      this.browserStorage?.removeItem?.(this.moveExplanationStorageKey);
    } catch {
      // Gesperrter Browser-Speicher darf den Coach nicht blockieren.
    }
  }

  saveMoveExplanationCache() {
    // Persistierte Coach-Texte sind keine vertrauenswürdige Faktenquelle.
    // Der verifizierte Server-Cache bleibt erhalten; im Browser gilt nur die
    // aktuelle, laufende Sitzung.
  }

  rememberMoveExplanation(key, explanation) {
    if (!key || !explanation || !Array.isArray(explanation.summary)) return;
    this.moveExplanationCache.delete(key);
    this.moveExplanationCache.set(key, explanation);
    while (this.moveExplanationCache.size > 120) {
      this.moveExplanationCache.delete(this.moveExplanationCache.keys().next().value);
    }
    this.saveMoveExplanationCache();
  }

  buildLocalMoveExplanationBundle(engineContext, openingContext = null) {
    if (!engineContext?.fen) return null;
    const playedUci = engineContext.kind === "move_review"
      ? engineContext.moveReview?.playedMove?.uci
      : engineContext.bestMove?.uci;
    if (!playedUci) return null;
    const lines = Array.isArray(engineContext.lines)
      ? engineContext.lines.map((line) => ({
        rank: line.rank,
        pv: line.pv?.uci || [],
      }))
      : [];
    if (lines.length === 0 && engineContext.primaryVariation?.uci?.length > 0) {
      lines.push({ rank: 1, pv: engineContext.primaryVariation.uci });
    }
    const positionEvidence = buildPositionEvidence({
      fenBefore: engineContext.fen,
      playedUci,
      lines,
      pvLimit: 20,
    });
    if (
      !positionEvidence.valid
      || !positionEvidence.verifiedLines.some((line) => line?.legal && line?.complete)
    ) return null;
    const learnerProfile = this.getCoachLearnerProfile();
    const effectiveOpeningContext = openingContext || this.buildOpeningCoachContext();
    const explanation = buildLocalMoveExplanation({
      positionEvidence,
      engineContext,
      openingContext: effectiveOpeningContext,
      learnerProfile,
    });
    if (!explanation) return null;
    const key = moveExplanationCacheKey({
      fen: engineContext.fen,
      subjectUci: playedUci,
      engineDepth: engineContext.depth,
      learnerProfile,
      openingContext: effectiveOpeningContext,
      engineContext,
      positionEvidence,
    });
    return {
      key,
      explanation: this.moveExplanationCache.get(key) || explanation,
      localExplanation: explanation,
      positionEvidence,
      learnerProfile,
      openingContext: effectiveOpeningContext,
    };
  }

  async requestGroundedMoveExplanation({
    engineContext,
    openingContext = null,
    history = null,
    clientKey = "",
    signal = null,
  }) {
    const bundle = this.buildLocalMoveExplanationBundle(engineContext, openingContext);
    if (!bundle) return null;
    const key = clientKey || bundle.key;
    if (this.moveExplanationCache.has(key)) {
      return {
        explanation: this.moveExplanationCache.get(key),
        source: "client-cache",
        clientKey: key,
      };
    }
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "move_explanation",
        message: `Erkläre den legal geprüften Zug ${bundle.explanation.subjectSan} Zug für Zug.`,
        engineContext,
        openingContext: bundle.openingContext,
        learnerProfile: bundle.learnerProfile,
        history: Array.isArray(history) ? history : this.game.history(),
        conversation: [],
      }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload?.explanation) return null;
    if (payload.source === "ai" || payload.source === "cache") {
      this.rememberMoveExplanation(key, payload.explanation);
    }
    return {
      ...payload,
      clientKey: key,
    };
  }

  createChatPanel(container) {
    const panel = document.createElement('details');
    panel.id = 'coach-chat';
    panel.className = 'card chat-card coach-card';
    panel.open = true;
    panel.setAttribute("aria-labelledby", "coach-chat-title");

    const header = document.createElement("summary");
    header.className = "coach-card-header coach-chat-summary";
    const avatar = document.createElement("span");
    avatar.className = "coach-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "♞";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Dein Coach";
    const title = document.createElement('h2');
    title.id = "coach-chat-title";
    title.className = 'card-title';
    title.textContent = 'Fragen zum Brett';
    const subtitle = document.createElement("p");
    subtitle.textContent = "Frag nach dem Plan, einer Gefahr oder einer einfacheren Erklärung.";
    heading.append(eyebrow, title, subtitle);
    header.append(avatar, heading);
    panel.appendChild(header);

    this.chatBodyEl = document.createElement('div');
    this.chatBodyEl.className = 'chat-body';
    this.chatBodyEl.setAttribute("aria-live", "polite");
    this.chatBodyEl.setAttribute("aria-label", "Gespräch mit dem Schachcoach");
    panel.appendChild(this.chatBodyEl);

    this.chatStatusEl = document.createElement('div');
    this.chatStatusEl.className = 'chat-status muted';
    panel.appendChild(this.chatStatusEl);

    const prompts = document.createElement("div");
    prompts.className = "coach-prompts";
    this.coachPromptButtons = [];
    [
      "Was ist hier der Plan?",
      "Welche Gefahr übersehe ich?",
      "Erkläre es einfacher",
    ].forEach((prompt) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "coach-prompt-button";
      button.textContent = prompt;
      button.addEventListener("click", () => this.sendChatMessage(prompt));
      this.coachPromptButtons.push(button);
      prompts.appendChild(button);
    });
    panel.appendChild(prompts);

    const form = document.createElement('div');
    form.className = "coach-form";

    this.chatInputEl = document.createElement('textarea');
    this.chatInputEl.rows = 2;
    this.chatInputEl.placeholder = 'Frag nach einem Plan, einer Gefahr oder einer einfacheren Erklärung …';
    this.chatInputEl.setAttribute("aria-label", "Frage an den Schachcoach");
    form.appendChild(this.chatInputEl);

    this.chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleChatSubmit();
      }
    });

    this.chatSendBtn = document.createElement('button');
    this.chatSendBtn.className = "primary-action-button";
    this.chatSendBtn.textContent = 'Coach fragen';
    this.chatSendBtn.addEventListener('click', () => this.handleChatSubmit());
    form.appendChild(this.chatSendBtn);

    panel.appendChild(form);
    container.appendChild(panel);

    this.coachPromptsEl = prompts;
    this.chatMessages = [];
    this.setAnalysisPerspective(
      this.gameSaveDraft?.playerColor || this.analysisPerspective,
      { markDirty: false },
    );
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

  appendChatMessage(role, content, metadata = {}) {
    this.chatMessages.push({
      role,
      content,
      gameGeneration: this.coachGameGeneration,
      positionFen: this.game?.fen?.() || "",
      ...metadata,
    });
    if (this.chatMessages.length > MAX_CHAT_MESSAGES) {
      this.chatMessages.splice(
        0,
        this.chatMessages.length - MAX_CHAT_MESSAGES,
      );
    }
    this.renderChat({ forceBottom: true });
  }

  renderChat({ preserveScroll = false, forceBottom = false } = {}) {
    if (!this.chatBodyEl) return;
    const priorScrollTop = this.chatBodyEl.scrollTop;
    const priorScrollHeight = this.chatBodyEl.scrollHeight;
    const wasNearBottom = (
      priorScrollHeight === 0
      || priorScrollHeight - priorScrollTop - this.chatBodyEl.clientHeight < 72
    );
    this.chatBodyEl.innerHTML = '';
    this.chatMessages.forEach((msg) => {
      const bubble = document.createElement('div');
      bubble.className = `coach-message is-${msg.role}`;
      const visibleContent = msg.explanation
        ? moveExplanationToMarkdown(msg.explanation, { deep: msg.expanded === true })
        : msg.content;
      renderChatMarkup(bubble, visibleContent);
      if (msg.explanation?.deepDive?.length > 0) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "coach-explanation-toggle";
        toggle.textContent = msg.expanded
          ? "Weniger anzeigen"
          : "Ausführlicher erklären";
        toggle.setAttribute("aria-expanded", msg.expanded ? "true" : "false");
        toggle.addEventListener("click", () => {
          msg.expanded = !msg.expanded;
          this.renderChat({ preserveScroll: true });
        });
        bubble.appendChild(toggle);
      }
      this.chatBodyEl.appendChild(bubble);
    });
    if (this.coachPromptsEl) {
      this.coachPromptsEl.hidden = this.chatMessages.length > 0;
    }
    if (preserveScroll) {
      this.chatBodyEl.scrollTop = Math.max(
        0,
        priorScrollTop + this.chatBodyEl.scrollHeight - priorScrollHeight,
      );
    } else if (forceBottom || wasNearBottom) {
      this.chatBodyEl.scrollTop = this.chatBodyEl.scrollHeight;
    } else {
      this.chatBodyEl.scrollTop = priorScrollTop;
    }
  }

  async sendChatMessage(text) {
    if (this.chatBusy) return;
    const conversation = this.chatMessages
      .filter((message) => (
        !message.automatic
        && message.gameGeneration === this.coachGameGeneration
      ))
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    this.appendChatMessage('user', text);
    this.setChatBusy(true);
    this.chatRequestController?.abort();
    const controller = new AbortController();
    this.chatRequestController = controller;
    const requestFen = this.game.fen();
    const generation = this.coachGameGeneration;
    const requestPathSignature = movePathSignature(this.getCurrentPath());
    const requestStillCurrent = () => (
      generation === this.coachGameGeneration
      && requestFen === this.game.fen()
      && requestPathSignature === movePathSignature(this.getCurrentPath())
    );
    const payload = {
      message: text,
      engineContext: this.buildAnalysisCoachEngineContext(),
      openingContext: this.buildOpeningCoachContext(),
      learnerProfile: this.getCoachLearnerProfile(),
      history: this.game.history(),
      conversation,
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data?.reply || data?.choices?.[0]?.message?.content || 'Keine Antwort erhalten.';
      if (!requestStillCurrent()) return;
      this.appendChatMessage('assistant', reply.trim());
    } catch (err) {
      if (err?.name === "AbortError" || !requestStillCurrent()) return;
      console.error('[Chat] request failed', err);
      this.appendChatMessage(
        'assistant',
        err?.message || 'Entschuldigung, der Coach ist momentan nicht erreichbar.',
      );
    } finally {
      if (this.chatRequestController === controller) {
        this.chatRequestController = null;
        this.setChatBusy(false);
      }
    }
  }

  setChatBusy(state) {
    this.chatBusy = state;
    if (this.chatSendBtn) this.chatSendBtn.disabled = !!state;
    if (this.chatInputEl) this.chatInputEl.disabled = !!state;
    this.coachPromptButtons?.forEach((button) => {
      button.disabled = Boolean(state);
    });
    if (this.chatStatusEl) {
      this.chatStatusEl.textContent = state ? 'Der Coach formuliert eine einfache Antwort …' : '';
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

  coachEvaluation(score, fallbackCp = null) {
    if (
      score
      && (score.unit === "cp" || score.unit === "mate")
      && Number.isFinite(score.value)
    ) {
      return {
        unit: score.unit,
        value: Math.round(score.value),
        perspective: "white",
      };
    }
    if (Number.isFinite(fallbackCp)) {
      return {
        unit: "cp",
        value: Math.round(fallbackCp),
        perspective: "white",
      };
    }
    return null;
  }

  buildPositionCoachEngineContext() {
    const state = this.suggestionState;
    if (!state?.lines) return null;
    const lines = Array.from(state.lines.entries())
      .sort(([left], [right]) => left - right)
      .map(([rank, data]) => {
        const pvUci = Array.isArray(data?.pv) ? data.pv.slice(0, 20) : [];
        const pvSan = this.pvToSanList(pvUci, data?.fen || state.fen).slice(0, 20);
        return {
          rank,
          depth: data?.depth || 0,
          evaluation: this.coachEvaluation(data?.whiteScore || data?.score),
          bestMove: pvUci[0]
            ? { uci: pvUci[0], san: pvSan[0] || "" }
            : null,
          pv: { uci: pvUci, san: pvSan },
        };
      })
      .filter((line) => line.pv.uci.length > 0);
    const primary = lines.find((line) => line.rank === 1) || lines[0];
    if (!primary) return null;
    const fen = state.fen || this.analysisFen;
    const exactBest = legalUciMove(
      fen,
      state.bestMoveUci || primary.bestMove?.uci || "",
    );
    const exactBestUci = exactBest?.uci || primary.bestMove?.uci || "";
    return {
      source: "stockfish",
      kind: "position",
      fen,
      depth: primary.depth,
      evaluation: primary.evaluation,
      bestMove: exactBestUci
        ? {
          uci: exactBestUci,
          san: exactBest?.san || uciToSan(fen, exactBestUci),
        }
        : primary.bestMove,
      primaryVariation: primary.pv,
      lines,
    };
  }

  buildMoveCoachEngineContext(move) {
    const verified = verifiedMoveReview(move);
    if (!verified) return null;
    const pvUci = verified.bestPvUci;
    const pvSan = verified.bestPvSan;
    const bestMove = verified.bestUci
      ? { uci: verified.bestUci, san: verified.bestSan }
      : null;
    const moveReview = {
      playedMove: {
        uci: verified.playedUci,
        san: verified.san,
      },
      bestMove,
      depth: verified.engineDepth || 0,
      evaluationBefore: this.coachEvaluation(verified.evaluationBefore, verified.beforeCp),
      evaluationAfter: this.coachEvaluation(verified.evaluationAfter, verified.afterCp),
      evaluationDeltaCp: Number.isFinite(verified.evaluationDeltaCp)
        ? verified.evaluationDeltaCp
        : Number.isFinite(verified.afterCp) && Number.isFinite(verified.beforeCp)
          ? Math.round(verified.afterCp - verified.beforeCp)
          : null,
      classification: MOVE_QUALITY[verified.quality]?.label || verified.quality || "",
      quality: verified.quality || "",
      accuracy: Number.isFinite(verified.accuracy) ? verified.accuracy : null,
      lossCp: Number.isFinite(verified.lossCp) ? verified.lossCp : null,
      pv: { uci: pvUci, san: pvSan },
    };
    const playedContinuationUci = Array.isArray(verified.playedContinuationUci)
      ? verified.playedContinuationUci
      : [];
    const playedContinuationSan = Array.isArray(verified.playedContinuationSan)
      ? verified.playedContinuationSan
      : [];
    const lines = [];
    if (pvUci.length > 0) {
      lines.push({
        rank: 1,
        depth: moveReview.depth,
        evaluation: moveReview.evaluationBefore,
        bestMove,
        pv: moveReview.pv,
      });
    }
    if (
      playedContinuationUci.length > 1
      && playedContinuationUci.join(" ") !== pvUci.join(" ")
    ) {
      lines.push({
        rank: 2,
        depth: moveReview.depth,
        evaluation: moveReview.evaluationAfter,
        bestMove: moveReview.playedMove,
        pv: {
          uci: playedContinuationUci,
          san: playedContinuationSan,
        },
      });
    }
    return {
      source: "stockfish",
      kind: "move_review",
      fen: verified.fenBefore || "",
      depth: moveReview.depth,
      evaluation: moveReview.evaluationBefore,
      bestMove,
      primaryVariation: moveReview.pv,
      lines,
      moveReview,
    };
  }

  buildGameReviewCoachEngineContext(report) {
    const moments = Array.isArray(report?.criticalMoments)
      ? report.criticalMoments.slice(0, 8)
      : [];
    return {
      source: "stockfish",
      kind: "game_review",
      fen: moments[0]?.fenBefore || "",
      depth: report?.depth || 0,
      evaluation: null,
      bestMove: null,
      primaryVariation: { uci: [], san: [] },
      lines: [],
      reviewMoments: moments.map((move) => {
        const context = this.buildMoveCoachEngineContext(move);
        return {
          label: `${move.moveNumber}${move.color === "b" ? "…" : "."} ${move.san}`,
          fen: move.fenBefore || "",
          ...context?.moveReview,
        };
      }),
    };
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

  jumpToFen(fen, exactNode = null) {
    if (this.reviewRunning || this.appMode === "play") return;
    this.stopAllBoardPreviews();
    if (!fen) return;
    let node = exactNode;
    if (node?.fen === fen) {
      const visited = new Set();
      let root = node;
      while (root?.parent && !visited.has(root)) {
        visited.add(root);
        root = root.parent;
      }
      if (root !== this.moveTree || visited.has(root)) node = null;
    } else {
      node = null;
    }
    node ||= findNodeByFen(this.moveTree, fen);
    if (!node) return;
    const sourceFen = this.currentNode?.fen || this.game.fen();
    this.currentNode = node;
    this.game.load(node.fen);
    this.gameReviewReport = null;
    this.markGameDirty();
    this.animateBoardPosition(node.fen, { fromFen: sourceFen });
    this.renderMoveList();
    this.updateGameStatus();
    this.refreshLiveAccuracy();
    this.refreshOpeningRecognition();
    this.evaluateCurrentPosition();
  }

  getMainlineNodes() {
    const arr = [];
    let n = this.moveTree.mainline;
    while (n && n.move) { arr.push(n); n = n.mainline; }
    return arr;
  }

  getMainlinePath() {
    return [this.moveTree, ...this.getMainlineNodes()].filter(Boolean);
  }

  buildMoveAnnotations() {
    const annotations = new Map();
    const path = this.getCurrentPath();
    const report = this.gameReviewReport || this.liveAccuracyReport || this.savedGameReview;

    if (Array.isArray(report?.moves)) {
      report.moves.forEach((storedMove) => {
        const move = verifiedMoveReview(storedMove);
        if (!move) return;
        const node = path[move?.ply];
        if (!node?.move) return;
        const quality = MOVE_QUALITY[move.quality];
        annotations.set(node, {
          ...move,
          label: quality?.label || "",
          explanation: explainMoveQuality(move),
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
      const analysisHeight = this.boardStack?.offsetHeight || this.boardEl?.offsetHeight;
      if (analysisHeight) {
        this.boardContainer?.style.setProperty("--analysis-height", `${analysisHeight}px`);
      }
      this.updateBoardKeyboardHighlights();
      this.syncAnalysisColumnHeight();
    });
  }

  syncAnalysisColumnHeight() {
    if (!this.analysisColumn || !this.boardStack) return;
    if (window.innerWidth <= 1100) {
      this.analysisColumn.style.removeProperty("height");
      return;
    }
    const boardStackHeight = Math.ceil(this.boardStack.getBoundingClientRect().height);
    if (boardStackHeight > 0) {
      this.analysisColumn.style.height = `${boardStackHeight}px`;
    }
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
    this.updateBoardContext();
    this.updateFeedbackAvailability();
    this.renderPlayPanel();
  }

  resetGame({ skipDiscardPrompt = false } = {}) {
    if (!skipDiscardPrompt && !this.confirmDiscardUnsavedGame('eine neue Partie beginnen')) {
      return false;
    }
    this.stopReviewJourney({ silent: true });
    this.cancelPlaySession();
    this.cancelFullGameReview();
    this.reviewCoachController?.abort();
    this.reviewJourneyCoachController?.abort();
    this.stopAllBoardPreviews();
    this.resetCoachGameContext({ clearMessages: true });
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
    this.openingLifecycle = null;
    this.openingRecordLifecycle = null;
    this.openingAutoValue = "";
    this.openingManualOverride = false;
    this.gameSaveDraftDirty = false;
    this.gameReviewReport = null;
    this.savedGameReview = null;
    this.liveAccuracyReport = null;
    this.setAnalysisPerspective("w", { markDirty: false });
    this.board.start();
    this.resetBoardKeyboardCursor();
    this.renderMoveList();
    this.updateGameStatus();
    this.updateAccuracyDisplay();
    this.updateSaveGameButton();
    this.updateModeUi();
    this.refreshOpeningRecognition();
    this.evaluateCurrentPosition();
    return true;
  }

  updateFeedbackAvailability() {
    this.updateSaveGameButton();
  }

  handleEngineReady() {
    if (this.destroyed) return;
    this.engineReady = true;
    if (this.playStartButton) this.playStartButton.disabled = false;
    if (this.playSetupSubmitButton) this.playSetupSubmitButton.disabled = false;
    if (this.playEngineBadgeEl) this.playEngineBadgeEl.textContent = "Bereit";
    this.renderPlayPanel();
  }

  handleEngineError(error) {
    console.error("[ChessApp] Engine nicht verfügbar", error);
    this.stopAllBoardPreviews();
    this.engineFailed = true;
    this.engineReady = false;
    this.engine = null;
    if (this.playSession.active) this.cancelPlaySession();
    if (this.playStartButton) this.playStartButton.disabled = true;
    if (this.playSetupSubmitButton) this.playSetupSubmitButton.disabled = true;
    if (this.playEngineBadgeEl) this.playEngineBadgeEl.textContent = "Schachcomputer nicht verfügbar";
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
    this.stopAllBoardPreviews({ restore: false, deferRender: true });
    this.destroyed = true;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.boardKeyboardFrame) cancelAnimationFrame(this.boardKeyboardFrame);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.successAnimationTimer) window.clearTimeout(this.successAnimationTimer);
    this.chatRequestController?.abort();
    this.playCoachController?.abort();
    this.suggestionCoachController?.abort();
    if (this.suggestionCoachTimer) window.clearTimeout(this.suggestionCoachTimer);
    this.moveExplanationControllers.forEach((controller) => controller.abort());
    this.moveExplanationControllers.clear();
    this.coachGameGeneration += 1;
    this.reviewCoachController?.abort();
    this.batchReviewCancelled = true;
    this.batchCoachControllers?.forEach((controller) => controller.abort());
    this.batchReviewEngines?.forEach((engine) => {
      try { engine.quit?.(); } catch {}
    });
    try { this.detachKeys?.(); } catch {}
    try { this.boardKeyboardObserver?.disconnect?.(); } catch {}
    try { this.boardStackResizeObserver?.disconnect?.(); } catch {}
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
    if (this._onDocumentPreviewPointerDown) {
      document.removeEventListener(
        "pointerdown",
        this._onDocumentPreviewPointerDown,
        true,
      );
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
    this.playerStoryDialog?.remove();
    this.saveGameDialog?.remove();
    this.playSetupDialog?.remove();
    this.accountDialog?.remove();
    this.lichessImportDialog?.remove();
    this.toastEl?.remove();
  }
  
}
