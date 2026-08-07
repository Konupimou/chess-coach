"use client";

import { useEffect, useMemo, useState } from "react";
import { coachTrainingPositionAfterMove } from "../../coachTrainingBoard.js";
import styles from "./training-review.module.css";

const EDITABLE_FIELDS = [
  "moveIdea",
  "verdict",
  "opponentReply",
  "concreteConsequence",
  "alternative",
  "comparison",
  "takeaway",
];

const FIELD_LABELS = {
  moveIdea: "Was macht der Zug – und warum?",
  verdict: "Bewertung",
  opponentReply: "Stärkste Antwort",
  concreteConsequence: "Konkrete Folge",
  alternative: "Alternative",
  comparison: "Unterschied",
  takeaway: "Merksatz",
};

function pieceAsset(piece) {
  if (!piece) return "";
  const color = piece === piece.toUpperCase() ? "w" : "b";
  return `/libs/img/rhosgfx/${color}${piece.toUpperCase()}.svg`;
}

function reviewStatus(candidate) {
  return ["approved", "rejected"].includes(candidate?.review?.decision)
    ? candidate.review.decision
    : "pending";
}

function targetText(candidate) {
  return Object.fromEntries(EDITABLE_FIELDS.flatMap((field) => {
    const claim = candidate?.target?.[field];
    if (!claim) return [];
    const reviewed = candidate?.review?.textEdits?.[field];
    return [[field, typeof reviewed === "string" ? reviewed : claim.text || ""]];
  }));
}

function boardSquares(fen) {
  const board = [];
  String(fen || "").split(" ")[0]?.split("/").forEach((rank, rankIndex) => {
    let file = 0;
    for (const token of rank) {
      if (/\d/u.test(token)) {
        for (let empty = 0; empty < Number(token); empty += 1) {
          board.push({ square: `${"abcdefgh"[file]}${8 - rankIndex}`, piece: "" });
          file += 1;
        }
      } else {
        board.push({ square: `${"abcdefgh"[file]}${8 - rankIndex}`, piece: token });
        file += 1;
      }
    }
  });
  return board;
}

function Chessboard({ fen, moveUci }) {
  const displayedFen = coachTrainingPositionAfterMove(fen, moveUci);
  const squares = boardSquares(displayedFen);
  const from = moveUci?.slice(0, 2);
  const to = moveUci?.slice(2, 4);
  return (
    <div className={styles.board} role="img" aria-label={`Schachstellung nach ${moveUci || "dem Zug"}`}>
      {squares.map(({ square, piece }, index) => (
        <div
          className={`${styles.square} ${(Math.floor(index / 8) + index) % 2 ? styles.dark : styles.light} ${square === from ? styles.from : ""} ${square === to ? styles.to : ""}`}
          key={square}
        >
          {piece && (
            <img
              className={styles.pieceImage}
              src={pieceAsset(piece)}
              alt=""
              draggable="false"
            />
          )}
          {(square[0] === "a" || square[1] === "1") && (
            <span className={styles.coordinate}>{square}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Preview({ candidate, edits }) {
  const fields = EDITABLE_FIELDS.filter((field) => candidate?.target?.[field]);
  return (
    <div className={styles.previewText}>
      {fields.map((field) => (
        <div key={field}>
          {!["moveIdea", "verdict"].includes(field) && (
            <strong>{FIELD_LABELS[field]}: </strong>
          )}
          <span>{edits[field]}</span>
        </div>
      ))}
    </div>
  );
}

export default function TrainingReviewClient() {
  const [candidates, setCandidates] = useState([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [currentId, setCurrentId] = useState("");
  const [filter, setFilter] = useState("pending");
  const [query, setQuery] = useState("");
  const [edits, setEdits] = useState({});
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setReviewer(window.localStorage.getItem("coach-training-reviewer") || "");
    fetch("/api/training-review", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "Review-Daten konnten nicht geladen werden.");
        return value;
      })
      .then((value) => {
        setCandidates(value.candidates);
        setSummary(value.summary);
        const first = value.candidates.find((candidate) => reviewStatus(candidate) === "pending")
          || value.candidates[0];
        setCurrentId(first?.id || "");
      })
      .catch((error) => setMessage({ type: "error", text: error.message }))
      .finally(() => setLoading(false));
  }, []);

  const visibleCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
    return candidates.filter((candidate) => {
      if (filter !== "all" && reviewStatus(candidate) !== filter) return false;
      if (!normalizedQuery) return true;
      return [
        candidate.id,
        candidate.curation?.category,
        candidate.target?.subjectSan,
        candidate.payload?.learnerProfile?.rating,
      ].some((value) => String(value || "").toLocaleLowerCase("de-DE").includes(normalizedQuery));
    });
  }, [candidates, filter, query]);

  const current = candidates.find((candidate) => candidate.id === currentId) || null;

  useEffect(() => {
    if (!current) return;
    setEdits(targetText(current));
    setNotes(current.review?.notes || "");
    setMessage(null);
  }, [currentId, current]);

  useEffect(() => {
    if (visibleCandidates.length === 0) return;
    if (!visibleCandidates.some((candidate) => candidate.id === currentId)) {
      setCurrentId(visibleCandidates[0].id);
    }
  }, [visibleCandidates, currentId]);

  function moveToNext() {
    const currentIndex = visibleCandidates.findIndex((candidate) => candidate.id === currentId);
    const next = visibleCandidates[currentIndex + 1] || visibleCandidates[0];
    if (next) setCurrentId(next.id);
  }

  async function saveDecision(decision) {
    if (!current || saving) return;
    if (!reviewer.trim()) {
      setMessage({ type: "error", text: "Bitte trage zuerst dein Reviewer-Kürzel ein." });
      return;
    }
    setSaving(true);
    setMessage(null);
    window.localStorage.setItem("coach-training-reviewer", reviewer.trim());
    try {
      const response = await fetch("/api/training-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id,
          decision,
          reviewer: reviewer.trim(),
          notes,
          textEdits: edits,
        }),
      });
      const value = await response.json();
      if (!response.ok) {
        const details = Array.isArray(value.errors) ? ` ${value.errors.join(" ")}` : "";
        throw new Error(`${value.error || "Review konnte nicht gespeichert werden."}${details}`);
      }
      setCandidates((items) => items.map((candidate) => (
        candidate.id === current.id ? { ...candidate, review: value.review } : candidate
      )));
      setSummary(value.summary);
      setMessage({
        type: "success",
        text: decision === "approved"
          ? "Freigegeben und vollständig gegen die Schachbelege geprüft."
          : "Als ungeeignet markiert.",
      });
      const nextPending = candidates.find((candidate) => (
        candidate.id !== current.id && reviewStatus(candidate) === "pending"
      ));
      if (filter === "pending" && nextPending) setCurrentId(nextPending.id);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        saveDecision("approved");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (loading) {
    return <main className={styles.centerState}>Kandidaten werden geladen …</main>;
  }

  if (!current) {
    return (
      <main className={styles.centerState}>
        <h1>Keine Trainingskandidaten verfügbar</h1>
        <p>{message?.text || "Erzeuge zuerst den Kandidaten-Pool."}</p>
      </main>
    );
  }

  const context = current.payload?.engineContext || {};
  const review = reviewStatus(current);
  const fields = EDITABLE_FIELDS.filter((field) => current.target?.[field]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <a className={styles.logo} href="/" aria-label="Zur Schachanalyse">♞</a>
          <div>
            <a className={styles.backLink} href="/">Schachanalyse / Training</a>
            <h1>Coach Review</h1>
            <p>Erklärungen verbessern, Stockfish-Fakten bewahren.</p>
          </div>
        </div>
        <div className={styles.progress} aria-label="Review-Fortschritt">
          <span><strong>{summary.approved}</strong> freigegeben</span>
          <span><strong>{summary.pending}</strong> offen</span>
          <span><strong>{summary.rejected}</strong> abgelehnt</span>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressValue}
              style={{ width: `${summary.total ? ((summary.approved + summary.rejected) / summary.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <label className={styles.searchLabel}>
            Kandidaten durchsuchen
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Zug, Kategorie oder ID" />
          </label>
          <div className={styles.filters}>
            {[
              ["pending", "Offen"],
              ["approved", "Freigegeben"],
              ["rejected", "Abgelehnt"],
              ["all", "Alle"],
            ].map(([value, label]) => (
              <button key={value} type="button" data-active={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className={styles.candidateList}>
            {visibleCandidates.map((candidate) => (
              <button
                className={styles.candidate}
                data-active={candidate.id === currentId}
                data-status={reviewStatus(candidate)}
                key={candidate.id}
                onClick={() => setCurrentId(candidate.id)}
                type="button"
              >
                <span className={styles.candidateMove}>{candidate.target?.subjectSan}</span>
                <span>{candidate.payload?.learnerProfile?.rating} Elo</span>
                <small>{candidate.curation?.category || candidate.groupKey}</small>
              </button>
            ))}
            {visibleCandidates.length === 0 && <p className={styles.emptyList}>Keine Treffer.</p>}
          </div>
        </aside>

        <section className={styles.workspace}>
          <div className={styles.contextColumn}>
            <div className={styles.contextHeading}>
              <div>
                <span className={styles.eyebrow}>Trainingsfall</span>
                <h2>{current.target.subjectSan}</h2>
              </div>
              <span className={styles.status} data-status={review}>{review}</span>
            </div>
            <Chessboard fen={context.fen} moveUci={current.target.subjectUci} />
            <div className={styles.factGrid}>
              <div><span>Zielniveau</span><strong>{current.payload?.learnerProfile?.rating} Elo</strong></div>
              <div><span>Qualität</span><strong>{context.moveReview?.quality || "–"}</strong></div>
              <div><span>Verlust</span><strong>{context.moveReview?.lossCp ?? 0} cp</strong></div>
              <div><span>Bestzug</span><strong>{context.bestMove?.san || "–"}</strong></div>
            </div>
            <div className={styles.lineCard}>
              <span>Stockfish-Variante</span>
              <p>{context.primaryVariation?.san?.join(" ") || "Keine Variante"}</p>
            </div>
            <details className={styles.evidenceDetails}>
              <summary>Technische Belege ansehen</summary>
              <p>{current.id}</p>
              <p>FEN: {context.fen}</p>
            </details>
          </div>

          <div className={styles.editorColumn}>
            <div className={styles.editorIntro}>
              <div>
                <span className={styles.eyebrow}>Deine Aufgabe</span>
                <h2>Klarer, kürzer, hilfreicher</h2>
              </div>
              <p>Nenne erst die Wirkung und dann den konkreten Grund. Neue Züge, Felder oder Bewertungen werden automatisch abgelehnt.</p>
            </div>

            <div className={styles.fields}>
              {fields.map((field) => (
                <label className={styles.field} key={field}>
                  <span>
                    <strong>{FIELD_LABELS[field]}</strong>
                    <small>{current.target[field].evidenceIds?.length || 0} Belege gesperrt</small>
                  </span>
                  <textarea
                    value={edits[field] || ""}
                    onChange={(event) => setEdits((value) => ({ ...value, [field]: event.target.value }))}
                    rows={Math.max(2, Math.ceil((edits[field]?.length || 0) / 72))}
                  />
                </label>
              ))}
            </div>

            <section className={styles.preview} aria-labelledby="coach-preview-title">
              <span className={styles.eyebrow}>Vorschau</span>
              <h3 id="coach-preview-title">So hört es der Spieler</h3>
              <Preview candidate={current} edits={edits} />
            </section>

            <label className={styles.notes}>
              Interne Notiz (optional)
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Warum wurde der Text geändert oder abgelehnt?" />
            </label>

            {message && (
              <div className={styles.message} data-type={message.type} role="status">{message.text}</div>
            )}

            <div className={styles.reviewBar}>
              <label>
                Reviewer-Kürzel
                <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="z. B. PP" />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.skipButton} onClick={moveToNext}>Überspringen</button>
                <button type="button" className={styles.rejectButton} disabled={saving} onClick={() => saveDecision("rejected")}>Ablehnen</button>
                <button type="button" className={styles.approveButton} disabled={saving} onClick={() => saveDecision("approved")}>
                  {saving ? "Prüft …" : "Freigeben"}
                </button>
              </div>
            </div>
            <p className={styles.shortcut}>⌘/Strg + Enter freigeben</p>
          </div>
        </section>
      </div>
    </main>
  );
}
