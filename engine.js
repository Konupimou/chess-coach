// engine.js — pure UCI engine wrapper (no DOM/UI here)

export function parseInfoLine(line) {
  if (typeof line !== "string" || !line.startsWith("info ")) return null;

  const out = { depth: undefined, score: undefined, pv: [], multipv: 1 };
  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);

  if (depthMatch) out.depth = Number.parseInt(depthMatch[1], 10);
  if (multiPvMatch) out.multipv = Number.parseInt(multiPvMatch[1], 10);
  if (scoreMatch) {
    const unit = scoreMatch[1];
    const value = Number.parseInt(scoreMatch[2], 10);
    const pawns = unit === "mate" ? (value > 0 ? 100 : -100) : value / 100;
    out.score = { unit, value, pawns };
  }

  const pvIndex = line.indexOf(" pv ");
  if (pvIndex >= 0) {
    const pv = line.slice(pvIndex + 4).trim();
    if (pv) out.pv = pv.split(/\s+/);
  }
  return out;
}

export function scoreFromWhitePerspective(score, fen) {
  if (!score || typeof score.pawns !== "number") return score;
  const sideToMove = typeof fen === "string" ? fen.split(" ")[1] : "w";
  const sign = sideToMove === "b" ? -1 : 1;
  return {
    ...score,
    value: typeof score.value === "number" ? score.value * sign : score.value,
    pawns: score.pawns * sign,
  };
}

export function parseBestMoveLine(line) {
  if (typeof line !== "string") return null;
  const match = line.match(
    /^bestmove\s+(\(none\)|[a-h][1-8][a-h][1-8][qrbn]?)(?:\s+ponder\s+([a-h][1-8][a-h][1-8][qrbn]?))?/i,
  );
  if (!match) return null;
  return {
    move: match[1] === "(none)" ? null : match[1].toLowerCase(),
    ponder: match[2] ? match[2].toLowerCase() : null,
  };
}

export class Engine {
  constructor({
    onEvaluation,
    onInfo,
    onBestMove,
    onReady,
    onError,
    depth = 15,
    threads,
    hashMB,
    evalFile = null,
    multiPV = 1,
  } = {}) {
    this.onEvaluation = typeof onEvaluation === 'function' ? onEvaluation : () => {};
    this.onInfo = typeof onInfo === 'function' ? onInfo : null;
    this.onBestMove = typeof onBestMove === "function" ? onBestMove : null;
    this.onReady = typeof onReady === "function" ? onReady : null;
    this.onError = typeof onError === "function" ? onError : () => {};

    // Depth
    this.depth = Number.isInteger(depth) ? depth : 15;

    const hasSharedArrayBuffer = typeof SharedArrayBuffer === 'function';
    const isCOI = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
    const hasWasm = typeof WebAssembly === 'object';
    const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
    const multiThreadUserAgent = /\b(Chrome|Chromium|Edg|Firefox)\b/i.test(ua);
    const allowMultiThread = hasSharedArrayBuffer && isCOI && typeof Atomics === 'object' && multiThreadUserAgent;

    // Threads: use logical cores, cap to 16 (browser-stable upper bound)
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    const defaultThreads = Math.max(1, Math.min(cores, 16));
    this.threads = Number.isInteger(threads) && threads > 0 ? Math.min(threads, 16) : defaultThreads;
    if (!allowMultiThread && this.threads !== 1) this.threads = 1;

    // Hash: clamp to avoid OOM in browsers
    this.minHashMB = 16;
    this.maxHashMB = 512;
    const clampHash = (mb) => Math.max(this.minHashMB, Math.min(mb, this.maxHashMB));
    const requestedHash = Number.isInteger(hashMB) && hashMB > 0 ? hashMB : 128;
    this.hashMB = clampHash(requestedHash);

    this.evalFile = evalFile;

    this.sf = null;
    this.isReady = false;
    this.handshakeStarted = false;
    this._optionsApplied = false;

    this.pendingFen = null;
    this.pendingDepth = this.depth;

    this.lastFen = null;
    this.currentTargetDepth = this.depth;
    this.latestPrimaryInfo = null;
    this.handshakeTimer = null;
    this.multiThreadEnabled = allowMultiThread;
    this.disableMultiThread = false;
    this.currentCandidate = null;
    this.multiPV = Math.max(1, Math.min(parseInt(multiPV, 10) || 1, 5));
    this.analysisMode = true;
    this.limitStrength = false;
    this.targetElo = 2800;
    this.searchSequence = 0;
    this.activeSearch = null;
    this.pendingSearch = null;
    this.searching = false;
    this.stopping = false;
    this.optionsDirty = false;
    this.disposed = false;

    // Prefer multi-threaded NNUE when cross-origin isolation allows it.
    this.workerCandidates = [
      {
        path: "/libs/stockfish/stockfish-18-lite.js",
        name: "Stockfish 18 Lite (multi-thread)",
        supported: () => allowMultiThread && hasWasm,
        requiresMultiThread: true
      },
      {
        path: "/libs/stockfish/stockfish-18-lite-single.js",
        name: "Stockfish 18 Lite (single-thread)",
        supported: () => hasWasm,
        requiresMultiThread: false
      },
      {
        path: "/libs/stockfish/stockfish-18-asm.js",
        name: "Stockfish 18 (asm.js fallback)",
        supported: () => true,
        requiresMultiThread: false
      }
    ];
    this.workerIndex = 0;
    this.activeWorkerPath = null;

    this._initWorker();
  }

  setDepth(newDepth) {
    const d = parseInt(newDepth, 10);
    if (!Number.isNaN(d) && d > 0 && d <= 99) this.depth = d;
  }
  setThreads(n) {
    const t = parseInt(n, 10);
    if (Number.isNaN(t) || t <= 0) return;
    const maxAllowed = this._maxAllowedThreads();
    const clamped = Math.max(1, Math.min(t, maxAllowed));
    if (clamped === this.threads) return;
    this.threads = clamped;
    this._notifyThreadsChange();
    this._markOptionsDirty();
  }
  setHashMB(mb) {
    const h = parseInt(mb, 10);
    if (Number.isNaN(h) || h <= 0) return;
    const clamped = Math.max(this.minHashMB, Math.min(h, this.maxHashMB));
    if (clamped === this.hashMB) return;
    this.hashMB = clamped;
    this._notifyHashChange();
    this._markOptionsDirty();
  }
  setMultiPV(value) {
    const v = parseInt(value, 10);
    if (Number.isNaN(v) || v <= 0) return;
    const clamped = Math.max(1, Math.min(v, 5));
    if (clamped === this.multiPV) return;
    this.multiPV = clamped;
    this._markOptionsDirty();
  }

  setAnalysisStrength() {
    if (this.analysisMode && !this.limitStrength) return;
    this.analysisMode = true;
    this.limitStrength = false;
    this._markOptionsDirty();
  }

  setPlayingStrength(elo) {
    const parsed = Number.parseInt(elo, 10);
    const targetElo = Number.isInteger(parsed)
      ? Math.max(1320, Math.min(parsed, 3190))
      : 1700;
    if (!this.analysisMode && this.limitStrength && targetElo === this.targetElo) return;
    this.analysisMode = false;
    this.limitStrength = true;
    this.targetElo = targetElo;
    this._markOptionsDirty();
  }

  _markOptionsDirty() {
    this.optionsDirty = true;
    if (this.isReady && !this.searching) this._applyDirtyOptions();
  }

  _applyDirtyOptions() {
    if (!this.optionsDirty || !this.sf || !this.isReady || this.searching) return;
    this.sf.postMessage(`setoption name Threads value ${this.threads}`);
    this.sf.postMessage(`setoption name Hash value ${this.hashMB}`);
    this.sf.postMessage(`setoption name MultiPV value ${this.multiPV}`);
    this.sf.postMessage(`setoption name UCI_AnalyseMode value ${this.analysisMode ? "true" : "false"}`);
    this.sf.postMessage(`setoption name UCI_LimitStrength value ${this.limitStrength ? "true" : "false"}`);
    if (this.limitStrength) {
      this.sf.postMessage(`setoption name UCI_Elo value ${this.targetElo}`);
    }
    this.optionsDirty = false;
  }

  _initWorker() {
    if (this.disposed) return;
    while (this.workerIndex < this.workerCandidates.length) {
      const candidate = this.workerCandidates[this.workerIndex];
      if (candidate.requiresMultiThread && this.disableMultiThread) {
        console.info(`[Engine] Skipping ${candidate.name} (multi-thread disabled).`);
        this.workerIndex += 1;
        continue;
      }
      if (!candidate.supported()) {
        console.info(`[Engine] Skipping Stockfish worker (unsupported environment): ${candidate.name}`);
        this.workerIndex += 1;
        continue;
      }
      const scriptUrl = candidate.path;
      try {
        const worker = new Worker(scriptUrl, { type: 'classic', name: 'stockfish' });
        worker.onmessage = (e) => {
          if (this.sf === worker && !this.disposed) this._handleMessage(e.data);
        };
        worker.onerror = (err) => {
          if (this.sf !== worker || this.disposed) return;
          worker.onerror = null;
          console.warn(`[Engine] Worker error from ${scriptUrl}`, err);
          this._fallbackWorker(err);
        };
        worker.onmessageerror = (err) => {
          if (this.sf !== worker || this.disposed) return;
          worker.onmessageerror = null;
          console.warn(`[Engine] Message error from ${scriptUrl}`, err);
          this._fallbackWorker(err);
        };
        this.sf = worker;
        this.activeWorkerPath = scriptUrl;
        this.currentCandidate = candidate;
        this.handshakeStarted = false;
        this._optionsApplied = false;
        this.isReady = false;
        this._ensureThreadLimit();
        console.info(`[Engine] Using ${candidate.name}: ${scriptUrl}`);
        this._startHandshake();
        return;
      } catch (err) {
        console.warn(`[Engine] Failed to initialise worker ${scriptUrl}`, err);
        this.workerIndex += 1;
      }
    }
    const error = new Error("Keine Stockfish-Variante konnte gestartet werden.");
    console.error("[Engine]", error.message);
    queueMicrotask(() => this.onError(error));
  }

  _fallbackWorker(reason) {
    if (this.disposed) return;
    this._clearHandshakeTimeout();
    const current = this.workerCandidates[this.workerIndex];
    const resumeSearch = this.pendingSearch || this.activeSearch;
    const resumeFen = resumeSearch?.fen || this.pendingFen || this.lastFen;
    const resumeDepth = resumeSearch?.depth || this.pendingDepth || this.currentTargetDepth || this.depth;
    if (this.sf) {
      try { this.sf.terminate(); } catch (_) {}
    }
    this.sf = null;
    this.activeWorkerPath = null;
    this.currentCandidate = null;
    this.handshakeStarted = false;
    this.isReady = false;
    this._optionsApplied = false;
    this.searching = false;
    this.stopping = false;
    this.activeSearch = null;
    this.pendingSearch = null;
    if (resumeSearch) this.pendingSearch = resumeSearch;

    const reasonMsg = reason && (reason.message || reason.type || String(reason));
    const isOOM = typeof reasonMsg === 'string' && /abort\(oom\)|out of memory/i.test(reasonMsg);
    if (isOOM) {
      const reduced = Math.max(this.minHashMB, Math.floor(this.hashMB / 2));
      if (reduced < this.hashMB) {
        console.warn(`[Engine] OOM detected while running ${current?.name || 'worker'}. Reducing hash from ${this.hashMB}MB to ${reduced}MB.`);
        this.hashMB = reduced;
        this._notifyHashChange();
        this.pendingFen = resumeFen;
        this.pendingDepth = resumeDepth;
        this._initWorker();
        return;
      }
    }

    if (current && current.requiresMultiThread) {
      this.disableMultiThread = true;
      this._ensureThreadLimit();
    }
    if (this.workerIndex >= this.workerCandidates.length - 1) {
      console.error('[Engine] Exhausted all Stockfish worker fallbacks.');
      this.onError(new Error("Alle Stockfish-Varianten sind beim Start fehlgeschlagen."));
      return;
    }
    this.workerIndex += 1;
    this.handshakeStarted = false;
    this.isReady = false;
    this.pendingFen = resumeFen;
    this.pendingDepth = resumeDepth;
    this._initWorker();
  }

  _startHandshake() {
    if (!this.sf || this.handshakeStarted) return;
    this.handshakeStarted = true;
    try {
      this.sf.postMessage('uci');
      this._armHandshakeTimeout();
    } catch (err) {
      console.warn('[Engine] Failed to start UCI handshake, trying fallback.', err);
      this._fallbackWorker(err);
    }
  }

  _clearHandshakeTimeout() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  _armHandshakeTimeout() {
    this._clearHandshakeTimeout();
    this.handshakeTimer = setTimeout(() => {
      console.warn('[Engine] Handshake timeout, attempting fallback.');
      this._fallbackWorker(new Error('handshake timeout'));
    }, 5000);
  }

  _notifyHashChange() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      window.dispatchEvent(new CustomEvent('engine-hash-changed', { detail: { hashMB: this.hashMB } }));
    } catch (_) {}
  }

  _notifyThreadsChange() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      window.dispatchEvent(new CustomEvent('engine-threads-changed', { detail: { threads: this.threads } }));
    } catch (_) {}
  }

  _maxAllowedThreads() {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    const allowMulti = this.multiThreadEnabled && !this.disableMultiThread && (!this.currentCandidate || this.currentCandidate.requiresMultiThread);
    return allowMulti ? Math.min(cores, 16) : 1;
  }

  _ensureThreadLimit() {
    const maxAllowed = this._maxAllowedThreads();
    if (this.threads > maxAllowed) {
      this.threads = maxAllowed;
      this._notifyThreadsChange();
    }
  }

  // emit always WHITE-centric (positive = better for White)
  _emitInfo(parsed, { final = false } = {}) {
    if (!final) return;
    const score = parsed?.whiteScore;
    if ((!parsed?.multipv || parsed.multipv === 1) && score && typeof score.pawns === "number") {
      try {
        this.onEvaluation(score.pawns, {
          fen: parsed.fen,
          searchId: parsed.searchId,
          final: true,
        });
      } catch {}
    }
  }

  _handleMessage(line) {
    if (typeof line !== 'string') return;

    if (line.includes('uciok')) {
      this._clearHandshakeTimeout();
      if (!this._optionsApplied) {
        this.sf.postMessage(`setoption name UCI_AnalyseMode value ${this.analysisMode ? "true" : "false"}`);
        this.sf.postMessage(`setoption name UCI_LimitStrength value ${this.limitStrength ? "true" : "false"}`);
        if (this.limitStrength) {
          this.sf.postMessage(`setoption name UCI_Elo value ${this.targetElo}`);
        }
        this.sf.postMessage(`setoption name Threads value ${this.threads}`);
        this.sf.postMessage(`setoption name Hash value ${this.hashMB}`);
        this.sf.postMessage(`setoption name MultiPV value ${this.multiPV}`);
        this.sf.postMessage('setoption name Ponder value false');
        this.sf.postMessage('setoption name Contempt value 0');
        this.sf.postMessage('setoption name Use NNUE value true');
        if (this.evalFile) this.sf.postMessage(`setoption name EvalFile value ${this.evalFile}`);
        this._optionsApplied = true;
      }
      this.sf.postMessage('isready');
      this._armHandshakeTimeout();
      return;
    }

    if (line.includes('readyok')) {
      this._clearHandshakeTimeout();
      this.isReady = true;
      if (this.onReady) {
        try {
          this.onReady({
            workerPath: this.activeWorkerPath,
            threads: this.threads,
          });
        } catch {}
      }
      if (this.pendingSearch) {
        const search = this.pendingSearch;
        this.pendingSearch = null;
        this.pendingFen = null;
        this.pendingDepth = this.depth;
        this._startSearch(search);
      } else if (this.pendingFen) {
        const fen = this.pendingFen;
        const depth = this.pendingDepth;
        this.pendingFen = null;
        this.pendingDepth = this.depth;
        this.evaluate(fen, depth);
      }
      return;
    }

    if (line.startsWith('info ')) {
      if (!this.activeSearch || this.stopping) return;
      const parsed = parseInfoLine(line);
      if (!parsed) return;
      parsed.fen = this.activeSearch.fen;
      parsed.searchId = this.activeSearch.id;
      parsed.whiteScore = scoreFromWhitePerspective(parsed.score, parsed.fen);
      if (this.onInfo) {
        try {
          this.onInfo(parsed);
        } catch (error) {
          console.error("[Engine] onInfo callback failed", error);
        }
      }
      if (!parsed.multipv || parsed.multipv === 1) this.latestPrimaryInfo = parsed;
      return;
    }

    if (line.startsWith('bestmove ')) {
      const completedSearch = this.activeSearch;
      const completedInfo = this.latestPrimaryInfo;
      const completedMove = parseBestMoveLine(line);
      const nextSearch = this.pendingSearch;
      const wasStopped = this.stopping;
      this.searching = false;
      this.stopping = false;
      this.activeSearch = null;
      this.pendingSearch = null;
      this.latestPrimaryInfo = null;

      if (nextSearch) {
        this._applyDirtyOptions();
        this._startSearch(nextSearch);
      } else if (completedInfo) {
        this._applyDirtyOptions();
        this._emitInfo(completedInfo, { final: true });
      } else {
        this._applyDirtyOptions();
      }
      if (
        !wasStopped
        && completedSearch
        && completedMove?.move
        && this.onBestMove
      ) {
        const payload = {
          ...completedMove,
          fen: completedSearch.fen,
          searchId: completedSearch.id,
          info: completedInfo,
          context: completedSearch.context,
        };
        queueMicrotask(() => {
          if (this.disposed) return;
          try {
            this.onBestMove(payload);
          } catch (error) {
            console.error("[Engine] onBestMove callback failed", error);
          }
        });
      }
      return;
    }
  }

  newGame() {
    if (!this.sf) return;
    this.sf.postMessage('stop');
    this.sf.postMessage('ucinewgame');
    this.isReady = false;
    this.sf.postMessage('isready');
  }
  clearHash() {
    if (!this.sf) return;
    this.sf.postMessage('setoption name Clear Hash');
  }

  _startSearch(search) {
    if (!this.sf || !this.isReady) return;
    this._applyDirtyOptions();
    this.activeSearch = search;
    this.searching = true;
    this.stopping = false;
    this.lastFen = search.fen;
    this.currentTargetDepth = search.depth;
    this.latestPrimaryInfo = null;
    this.sf.postMessage(`position fen ${search.fen}`);
    this.sf.postMessage(`go depth ${search.depth}`);
  }

  evaluate(fen, depth = this.depth, context = null) {
    if (!this.sf) return;
    const normalizedDepth = Number.isInteger(depth) ? depth : this.depth;
    const search = {
      id: ++this.searchSequence,
      fen,
      depth: normalizedDepth,
      context: context && typeof context === "object" ? { ...context } : context,
    };
    if (!this.isReady) {
      this.pendingSearch = search;
      this.pendingFen = fen;
      this.pendingDepth = normalizedDepth;
      this._startHandshake();
      return search.id;
    }

    if (this.searching) {
      this.pendingSearch = search;
      if (!this.stopping) {
        this.stopping = true;
        this.sf.postMessage("stop");
      }
      return search.id;
    }
    this._startSearch(search);
    return search.id;
  }

  cancelSearch() {
    this.pendingSearch = null;
    this.pendingFen = null;
    this.pendingDepth = this.depth;
    if (!this.sf || !this.searching || this.stopping) return;
    this.stopping = true;
    try {
      this.sf.postMessage("stop");
    } catch {}
  }

  quit() {
    this.disposed = true;
    this._clearHandshakeTimeout();
    try { this.sf && this.sf.postMessage('quit'); } catch {}
    try { this.sf && this.sf.terminate(); } catch {}
    this.sf = null;
    this.searching = false;
    this.stopping = false;
    this.activeSearch = null;
    this.pendingSearch = null;
  }
}
