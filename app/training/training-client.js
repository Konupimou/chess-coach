"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { getConceptById } from "../../chessKnowledge/index.js";
import { CURATED_TRAINING_EXERCISES } from "../../trainingExercises.js";
import {
  completeTrainingExercise,
  loadTrainingProgress,
  saveTrainingProgress,
  trainingStorageKey,
} from "../../trainingProgress.js";
import { getTrainingQueue } from "../../trainingQueue.js";
import {
  createExerciseAttempt,
  recordTrainingMove,
  revealNextHint,
  revealTrainingSolution,
  sessionSummary,
} from "../../trainingSession.js";
import { buildConceptStats, buildTrainingStats } from "../../trainingStats.js";
import {
  legalMoveFromUci,
  moveToUci,
  validateTrainingMove,
} from "../../trainingValidation.js";
import styles from "./training.module.css";

const SESSION_SIZES = [5, 10, 20];
const DIFFICULTY_LABELS = {
  beginner: "Einsteiger",
  intermediate: "Mittel",
  advanced: "Fortgeschritten",
};
const CATEGORY_LABELS = {
  tactical: "Taktik",
  positional: "Positionsspiel",
  endgame: "Endspiel",
};

function conceptLabel(id) {
  return getConceptById(id)?.name?.de || id;
}

function percentage(value) {
  return `${Math.round((Number(value) || 0) * 100)} %`;
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function tomorrowKey(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dateKey(tomorrow);
}

export default function TrainingClient() {
  const boardHostRef = useRef(null);
  const boardRef = useRef(null);
  const gameRef = useRef(null);
  const selectedSquareRef = useRef("");
  const lockedRef = useRef(false);
  const moveHandlerRef = useRef(null);
  const continuationTimersRef = useRef([]);
  const progressRef = useRef(null);
  const storageRef = useRef({ key: "", storage: null });

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(null);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [sessionResults, setSessionResults] = useState([]);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [view, setView] = useState("training");
  const [continuationPlaying, setContinuationPlaying] = useState(false);
  const [settings, setSettings] = useState({
    size: 10,
    category: "",
    difficulty: "",
    dueOnly: false,
  });

  const exercise = queue[index] || null;
  const stats = useMemo(() => buildTrainingStats(progress || { results: [] }), [progress]);
  const summary = useMemo(() => sessionSummary(sessionResults), [sessionResults]);
  const sessionConcepts = useMemo(() => (
    buildConceptStats(sessionResults)
      .sort((left, right) => left.accuracy - right.accuracy)
      .slice(0, 3)
  ), [sessionResults]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let identity = null;
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        const account = response.ok ? await response.json() : null;
        identity = account?.authenticated ? account.user : null;
      } catch {
        identity = null;
      }
      if (cancelled) return;
      const key = trainingStorageKey(identity);
      const userId = identity?.email || "local-user";
      const nextProgress = loadTrainingProgress(window.localStorage, key, userId);
      storageRef.current = { key, storage: window.localStorage };
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      startSession(nextProgress, settings);
      setReady(true);
    };
    load();
    return () => { cancelled = true; };
    // The first session deliberately uses the defaults from the initial render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const startSession = (baseProgress = progressRef.current, nextSettings = settings) => {
    clearContinuationTimers();
    const nextQueue = getTrainingQueue({
      exercises: CURATED_TRAINING_EXERCISES,
      progress: baseProgress,
      limit: nextSettings.size,
      filters: {
        category: nextSettings.category || undefined,
        difficulty: nextSettings.difficulty || undefined,
        dueOnly: nextSettings.dueOnly,
      },
    });
    setQueue(nextQueue);
    setIndex(0);
    setSessionResults([]);
    setSessionComplete(false);
    setFeedback(null);
    setPromotion(null);
    setContinuationPlaying(false);
    setAttempt(nextQueue[0] ? createExerciseAttempt(nextQueue[0]) : null);
    setView("training");
  };

  const persistCompletion = (currentExercise, finalAttempt) => {
    const now = new Date();
    const timedAttempt = {
      ...finalAttempt,
      timeSpentSeconds: Math.max(
        0,
        Math.round((now.getTime() - Date.parse(finalAttempt.startedAt || now.toISOString())) / 1_000),
      ),
    };
    const completion = completeTrainingExercise(
      progressRef.current,
      currentExercise,
      timedAttempt,
      now,
    );
    progressRef.current = completion.progress;
    setProgress(completion.progress);
    setSessionResults((current) => [...current, completion.result]);
    const { storage, key } = storageRef.current;
    saveTrainingProgress(storage, key, completion.progress);
    return completion.result;
  };

  const handleValidatedMove = (validation) => {
    if (!exercise || !attempt || attempt.solved || attempt.solutionShown) return;
    if (!validation.legal) {
      setFeedback({ type: "illegal", title: "Dieser Zug ist nicht legal.", body: "Die Stellung bleibt unverändert." });
      return;
    }
    const nextAttempt = recordTrainingMove(attempt, validation);
    setAttempt(nextAttempt);
    if (validation.correct) {
      lockedRef.current = true;
      setFeedback({
        type: "correct",
        title: `Richtig · ${validation.move.san}`,
        body: exercise.explanation.short,
      });
      persistCompletion(exercise, nextAttempt);
    } else {
      setFeedback({
        type: "incorrect",
        title: "Noch nicht.",
        body: nextAttempt.attempts === 1
          ? "Die Idee stimmt noch nicht. Prüfe zuerst Schachs, Schlagzüge und direkte Drohungen."
          : "Versuche eine andere Fortsetzung oder nutze den nächsten Hinweis.",
      });
    }
  };
  moveHandlerRef.current = handleValidatedMove;

  useEffect(() => {
    if (!exercise || !boardHostRef.current || typeof window.Chessboard !== "function") return undefined;
    clearContinuationTimers();
    const game = new Chess(exercise.fen);
    gameRef.current = game;
    lockedRef.current = false;
    selectedSquareRef.current = "";
    const orientation = exercise.sideToMove === "black" ? "black" : "white";

    const clearSelected = () => {
      boardHostRef.current
        ?.querySelectorAll(`.${styles.selectedSquare}`)
        .forEach((element) => element.classList.remove(styles.selectedSquare));
      selectedSquareRef.current = "";
    };

    const markSelected = (square) => {
      clearSelected();
      selectedSquareRef.current = square;
      boardHostRef.current
        ?.querySelector(`.square-${square}`)
        ?.classList.add(styles.selectedSquare);
    };

    const submit = (from, to, promotionPiece = "") => {
      if (lockedRef.current) return "snapback";
      const legalPromotions = game.moves({ square: from, verbose: true })
        .filter((move) => move.to === to && move.promotion);
      if (!promotionPiece && legalPromotions.length) {
        setPromotion({ from, to, color: game.turn() });
        clearSelected();
        return "snapback";
      }
      const uci = `${from}${to}${promotionPiece}`;
      const validation = validateTrainingMove(exercise, uci);
      moveHandlerRef.current?.(validation);
      clearSelected();
      if (!validation.legal || !validation.correct) return "snapback";
      game.load(validation.resultingFen);
      window.setTimeout(() => boardRef.current?.position(game.fen(), false), 0);
      return undefined;
    };

    const board = window.Chessboard("training-board", {
      position: exercise.fen,
      draggable: true,
      orientation,
      pieceTheme: "/libs/img/rhosgfx/{piece}.svg",
      moveSpeed: 260,
      appearSpeed: 180,
      snapSpeed: 100,
      snapbackSpeed: 180,
      onDragStart: (source, piece) => {
        if (lockedRef.current) return false;
        const boardPiece = game.get(source);
        return Boolean(boardPiece && boardPiece.color === game.turn() && piece[0].toLowerCase() === game.turn());
      },
      onDrop: (source, target) => submit(source, target),
      onSnapEnd: () => board.position(game.fen(), false),
    });
    boardRef.current = board;
    board.resize();

    const clickHandler = (event) => {
      if (lockedRef.current) return;
      const squareElement = event.target.closest?.("[data-square]")
        || event.target.closest?.("[class*='square-']");
      const classSquare = [...(squareElement?.classList || [])]
        .map((className) => className.match(/^square-([a-h][1-8])$/)?.[1])
        .find(Boolean);
      const square = squareElement?.dataset?.square || classSquare;
      if (!square) return;
      const selected = selectedSquareRef.current;
      if (!selected) {
        const piece = game.get(square);
        if (piece?.color === game.turn()) markSelected(square);
        return;
      }
      if (selected === square) {
        clearSelected();
        return;
      }
      const piece = game.get(square);
      if (piece?.color === game.turn()) {
        markSelected(square);
        return;
      }
      submit(selected, square);
    };
    boardHostRef.current.addEventListener("click", clickHandler);

    const resize = () => board.resize();
    window.addEventListener("resize", resize);
    return () => {
      clearContinuationTimers();
      boardHostRef.current?.removeEventListener("click", clickHandler);
      window.removeEventListener("resize", resize);
      try { board.destroy(); } catch {}
      if (boardRef.current === board) boardRef.current = null;
    };
  }, [exercise?.id]);

  const clearContinuationTimers = () => {
    continuationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    continuationTimersRef.current = [];
  };

  const choosePromotion = (piece) => {
    if (!promotion || !exercise) return;
    setPromotion(null);
    const validation = validateTrainingMove(
      exercise,
      `${promotion.from}${promotion.to}${piece}`,
    );
    moveHandlerRef.current?.(validation);
    if (validation.correct && validation.resultingFen) {
      gameRef.current?.load(validation.resultingFen);
      boardRef.current?.position(validation.resultingFen, false);
    }
  };

  const useHint = () => {
    if (!exercise || !attempt || attempt.solved || attempt.solutionShown) return;
    setAttempt(revealNextHint(attempt, exercise));
    setFeedback(null);
  };

  const showSolution = () => {
    if (!exercise || !attempt || attempt.solved || attempt.solutionShown) return;
    const nextAttempt = revealTrainingSolution(attempt);
    setAttempt(nextAttempt);
    lockedRef.current = true;
    const solutionGame = new Chess(exercise.fen);
    legalMoveFromUci(solutionGame, exercise.solution.bestMoveUci);
    gameRef.current = solutionGame;
    boardRef.current?.position(solutionGame.fen(), true);
    setFeedback({
      type: "solution",
      title: `Lösung · ${exercise.solution.bestMoveSan}`,
      body: exercise.explanation.short,
    });
    persistCompletion(exercise, nextAttempt);
  };

  const playContinuation = () => {
    if (!exercise?.solution.continuation.length || continuationPlaying) return;
    clearContinuationTimers();
    const game = new Chess(exercise.fen);
    legalMoveFromUci(game, exercise.solution.bestMoveUci);
    boardRef.current?.position(game.fen(), false);
    gameRef.current = game;
    setContinuationPlaying(true);
    exercise.solution.continuation.forEach((uci, moveIndex) => {
      const timer = window.setTimeout(() => {
        legalMoveFromUci(game, uci);
        boardRef.current?.position(game.fen(), true);
        if (moveIndex === exercise.solution.continuation.length - 1) {
          setContinuationPlaying(false);
        }
      }, 600 * (moveIndex + 1));
      continuationTimersRef.current.push(timer);
    });
  };

  const nextExercise = () => {
    clearContinuationTimers();
    if (index >= queue.length - 1) {
      setSessionComplete(true);
      setAttempt(null);
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setAttempt(createExerciseAttempt(queue[nextIndex]));
    setFeedback(null);
    setPromotion(null);
    setContinuationPlaying(false);
  };

  const dueTomorrow = useMemo(() => (
    Object.values(progress?.schedule || {}).filter((entry) => (
      dateKey(entry.nextReviewAt) === tomorrowKey()
    )).length
  ), [progress]);

  if (!ready) {
    return <div className={styles.loading}>Training wird vorbereitet …</div>;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <a className={styles.logo} href="/" aria-label="Zur Analyse">♞</a>
          <div>
            <span className={styles.eyebrow}>Persönlicher Schachcoach</span>
            <h1>Training</h1>
          </div>
        </div>
        <nav className={styles.navigation} aria-label="Hauptnavigation">
          <a href="/">Analyse</a>
          <button type="button" data-active={view === "training"} onClick={() => setView("training")}>Training</button>
          <button type="button" data-active={view === "stats"} onClick={() => setView("stats")}>Statistik</button>
          <a href="/profile">Profil</a>
        </nav>
        <div className={styles.headerProgress} aria-label="Trainingsfortschritt">
          <strong>{sessionComplete ? queue.length : Math.min(index + 1, queue.length)}</strong>
          <span>/ {queue.length || settings.size}</span>
          <div><span style={{ width: `${queue.length ? ((sessionComplete ? queue.length : index) / queue.length) * 100 : 0}%` }} /></div>
        </div>
      </header>

      {view === "stats" ? (
        <StatsView stats={stats} progress={progress} onTrain={() => setView("training")} />
      ) : sessionComplete ? (
        <CompletionView
          summary={summary}
          weakConcepts={sessionConcepts}
          dueTomorrow={dueTomorrow}
          settings={settings}
          setSettings={setSettings}
          onRestart={() => startSession(progressRef.current, settings)}
        />
      ) : queue.length === 0 ? (
        <EmptyQueue settings={settings} setSettings={setSettings} onRestart={() => startSession(progressRef.current, settings)} />
      ) : (
        <main className={styles.workspace}>
          <section className={styles.boardColumn} aria-label="Trainingsbrett">
            <div className={styles.boardFrame} ref={boardHostRef}>
              <div id="training-board" className={styles.board} role="group" aria-label="Interaktives Trainingsbrett" />
              <div className={styles.turnBadge}>{exercise.sideToMove === "white" ? "Weiß" : "Schwarz"} am Zug</div>
            </div>
            <div className={styles.positionFooter}>
              <span>{CATEGORY_LABELS[exercise.category]}</span>
              <span>{DIFFICULTY_LABELS[exercise.difficulty]}</span>
              <button type="button" onClick={() => boardRef.current?.flip()}>Brett drehen</button>
            </div>
          </section>

          <aside className={styles.coachPanel} aria-live="polite">
            <div className={styles.exerciseMeta}>
              <span>Aufgabe {index + 1} von {queue.length}</span>
              <span>{attempt?.attempts || 0} {attempt?.attempts === 1 ? "Versuch" : "Versuche"}</span>
            </div>

            <section className={styles.prompt}>
              <span className={styles.eyebrow}>{exercise.sideToMove === "white" ? "Weiß" : "Schwarz"} am Zug</span>
              <h2>Finde den besten Zug.</h2>
              <p>Ziehe direkt auf dem Brett. Die Antwort wird nach den Schachregeln geprüft.</p>
            </section>

            {attempt?.hintLevel > 0 && (
              <section className={styles.hints} aria-label="Hinweise">
                {exercise.hints.slice(0, attempt.hintLevel).map((hint, hintIndex) => (
                  <div key={hint}><span>{hintIndex + 1}</span><p>{hint}</p></div>
                ))}
              </section>
            )}

            {feedback && (
              <section className={styles.feedback} data-type={feedback.type}>
                <div className={styles.feedbackIcon} aria-hidden="true">
                  {feedback.type === "correct" ? "✓" : feedback.type === "solution" ? "→" : "×"}
                </div>
                <div><strong>{feedback.title}</strong><p>{feedback.body}</p></div>
              </section>
            )}

            {(attempt?.solved || attempt?.solutionShown) ? (
              <SolutionCard exercise={exercise} onPlay={playContinuation} playing={continuationPlaying} />
            ) : (
              <div className={styles.actions}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={useHint}
                  disabled={attempt?.hintLevel >= exercise.hints.length}
                >
                  Hinweis {Math.min((attempt?.hintLevel || 0) + 1, exercise.hints.length)}
                </button>
                {(attempt?.attempts >= 2 || attempt?.hintLevel >= 2) && (
                  <button className={styles.textButton} type="button" onClick={showSolution}>Lösung zeigen</button>
                )}
              </div>
            )}

            {(attempt?.solved || attempt?.solutionShown) && (
              <button className={styles.primaryButton} type="button" onClick={nextExercise}>
                {index === queue.length - 1 ? "Runde abschließen" : "Nächste Aufgabe"}
              </button>
            )}

            <details className={styles.settings}>
              <summary>Runde anpassen</summary>
              <SessionSettings settings={settings} setSettings={setSettings} />
              <button className={styles.secondaryButton} type="button" onClick={() => startSession(progressRef.current, settings)}>Neue Runde starten</button>
            </details>
          </aside>
        </main>
      )}

      {promotion && (
        <div className={styles.promotionBackdrop} role="presentation">
          <section className={styles.promotionDialog} role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <h2 id="promotion-title">Figur wählen</h2>
            <div>
              {["q", "r", "b", "n"].map((piece) => (
                <button key={piece} type="button" onClick={() => choosePromotion(piece)}>
                  <img src={`/libs/img/rhosgfx/${promotion.color}${piece.toUpperCase()}.svg`} alt={{ q: "Dame", r: "Turm", b: "Läufer", n: "Springer" }[piece]} />
                </button>
              ))}
            </div>
            <button className={styles.textButton} type="button" onClick={() => setPromotion(null)}>Abbrechen</button>
          </section>
        </div>
      )}
    </div>
  );
}

function SolutionCard({ exercise, onPlay, playing }) {
  return (
    <section className={styles.solutionCard}>
      <div className={styles.motif}>
        <span>Motiv</span>
        <strong>{conceptLabel(exercise.primaryConcept)}</strong>
      </div>
      <div className={styles.solutionMove}>{exercise.solution.bestMoveSan}</div>
      <p>{exercise.explanation.detailed}</p>
      {exercise.explanation.takeaway && <blockquote>{exercise.explanation.takeaway}</blockquote>}
      {exercise.solution.continuationSan.length > 0 && (
        <div className={styles.continuation}>
          <div>
            <span>Kurze Variante</span>
            <strong>{[exercise.solution.bestMoveSan, ...exercise.solution.continuationSan].join("  ")}</strong>
          </div>
          <button type="button" onClick={onPlay} disabled={playing}>{playing ? "Spielt …" : "Abspielen"}</button>
        </div>
      )}
    </section>
  );
}

function SessionSettings({ settings, setSettings }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  return (
    <div className={styles.settingsGrid}>
      <label>
        Umfang
        <select value={settings.size} onChange={(event) => update("size", Number(event.target.value))}>
          {SESSION_SIZES.map((size) => <option key={size} value={size}>{size} Aufgaben</option>)}
        </select>
      </label>
      <label>
        Bereich
        <select value={settings.category} onChange={(event) => update("category", event.target.value)}>
          <option value="">Alle Bereiche</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        Schwierigkeit
        <select value={settings.difficulty} onChange={(event) => update("difficulty", event.target.value)}>
          <option value="">Alle Stufen</option>
          {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={settings.dueOnly} onChange={(event) => update("dueOnly", event.target.checked)} />
        Nur fällige Wiederholungen
      </label>
    </div>
  );
}

function CompletionView({ summary, weakConcepts, dueTomorrow, settings, setSettings, onRestart }) {
  return (
    <main className={styles.completion}>
      <span className={styles.completionMark}>✓</span>
      <span className={styles.eyebrow}>Runde abgeschlossen</span>
      <h2>{summary.total} Aufgaben trainiert</h2>
      <p>Jede Antwort fließt in deinen persönlichen Wiederholungsplan ein.</p>
      <div className={styles.summaryGrid}>
        <Metric value={summary.solvedFirstTry} label="sofort gelöst" />
        <Metric value={summary.solvedWithHelp} label="mit Hilfe gelöst" />
        <Metric value={summary.failed} label="noch offen" />
        <Metric value={percentage(summary.accuracy)} label="Erstversuch-Quote" />
      </div>
      <div className={styles.completionDetails}>
        <section>
          <span>Weiter trainieren</span>
          {weakConcepts.length ? weakConcepts.map((entry) => (
            <div key={entry.conceptId}><strong>{conceptLabel(entry.conceptId)}</strong><small>{percentage(entry.accuracy)}</small></div>
          )) : <p>Noch keine Schwäche erkennbar.</p>}
        </section>
        <section>
          <span>Nächste Wiederholungen</span>
          <strong>{dueTomorrow} {dueTomorrow === 1 ? "Aufgabe" : "Aufgaben"} morgen</strong>
          <p>Schwierig gelöste Aufgaben kommen früher zurück.</p>
        </section>
      </div>
      <details className={styles.completionSettings}>
        <summary>Nächste Runde anpassen</summary>
        <SessionSettings settings={settings} setSettings={setSettings} />
      </details>
      <button className={styles.primaryButton} type="button" onClick={onRestart}>Noch eine Runde</button>
    </main>
  );
}

function EmptyQueue({ settings, setSettings, onRestart }) {
  return (
    <main className={styles.completion}>
      <span className={styles.completionMark}>○</span>
      <h2>Für diesen Filter ist gerade nichts fällig.</h2>
      <p>Erweitere die Auswahl oder starte eine Runde mit neuen Aufgaben.</p>
      <SessionSettings settings={settings} setSettings={setSettings} />
      <button className={styles.primaryButton} type="button" onClick={onRestart}>Auswahl anwenden</button>
    </main>
  );
}

function StatsView({ stats, progress, onTrain }) {
  const schedule = Object.values(progress?.schedule || {});
  const now = Date.now();
  const due = schedule.filter((entry) => Date.parse(entry.nextReviewAt) <= now).length;
  return (
    <main className={styles.statsView}>
      <div className={styles.statsIntro}>
        <div><span className={styles.eyebrow}>Dein Lernverlauf</span><h2>Training, das sich anpasst.</h2></div>
        <button className={styles.primaryButton} type="button" onClick={onTrain}>Weiter trainieren</button>
      </div>
      <div className={styles.statsCards}>
        <Metric value={`${stats.solvedToday} / ${stats.trainedToday}`} label="heute gelöst" />
        <Metric value={percentage(stats.accuracy)} label="Erstversuch-Quote" />
        <Metric value={`${stats.currentStreak} ${stats.currentStreak === 1 ? "Tag" : "Tage"}`} label="aktuelle Serie" />
        <Metric value={due} label="jetzt fällig" />
      </div>
      <div className={styles.conceptColumns}>
        <ConceptList title="Mehr Aufmerksamkeit" entries={stats.weakest} empty="Löse zuerst einige Aufgaben." />
        <ConceptList title="Deine stärksten Motive" entries={stats.strongest} empty="Noch keine Daten vorhanden." />
      </div>
      <section className={styles.historyCard}>
        <div><span className={styles.eyebrow}>Gesamt</span><h3>{stats.total} abgeschlossene Aufgaben</h3></div>
        <div><strong>{stats.solved}</strong><span>gelöst</span></div>
        <div><strong>{percentage(stats.solveRate)}</strong><span>Lösungsquote</span></div>
      </section>
    </main>
  );
}

function ConceptList({ title, entries, empty }) {
  return (
    <section className={styles.conceptList}>
      <h3>{title}</h3>
      {entries.length ? entries.map((entry) => (
        <div key={entry.conceptId}>
          <span>{conceptLabel(entry.conceptId)}</span>
          <div><i style={{ width: percentage(entry.accuracy) }} /></div>
          <strong>{percentage(entry.accuracy)}</strong>
        </div>
      )) : <p>{empty}</p>}
    </section>
  );
}

function Metric({ value, label }) {
  return <div className={styles.metric}><strong>{value}</strong><span>{label}</span></div>;
}
