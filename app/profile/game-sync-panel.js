"use client";

import { useEffect, useMemo, useState } from "react";
import { createAnalysisBatch } from "../../gameSync/analysisQueue.js";
import {
  loadGameLibrary,
  persistAnalysisBatch,
  persistGameLibrary,
} from "../../gameSync/browserStore.js";
import {
  accountKey,
  createGameLibrary,
  mergeSyncBatch,
  periodQuery,
  previewGameQuery,
} from "../../gameSync/library.js";

const PROVIDERS = Object.freeze([
  { id: "chesscom", label: "Chess.com" },
  { id: "lichess", label: "Lichess" },
]);
const TIME_CONTROLS = Object.freeze([
  { id: "bullet", label: "Bullet" },
  { id: "blitz", label: "Blitz" },
  { id: "rapid", label: "Rapid" },
  { id: "classical", label: "Classical" },
]);

function toggle(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function GameSyncPanel() {
  const [library, setLibrary] = useState(null);
  const [usernames, setUsernames] = useState({ chesscom: "", lichess: "" });
  const [busyProvider, setBusyProvider] = useState("");
  const [message, setMessage] = useState("");
  const [sources, setSources] = useState(PROVIDERS.map((provider) => provider.id));
  const [timeControls, setTimeControls] = useState(["rapid"]);
  const [period, setPeriod] = useState("last-100");
  const [ratedOnly, setRatedOnly] = useState(true);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    loadGameLibrary()
      .then((loaded) => {
        setLibrary(loaded);
        const next = { chesscom: "", lichess: "" };
        for (const account of Object.values(loaded.accounts || {})) {
          if (next[account.provider] !== undefined) next[account.provider] = account.username;
        }
        setUsernames(next);
      })
      .catch((error) => {
        setLibrary(createGameLibrary());
        setMessage(error?.message || "Die synchronisierte Bibliothek konnte nicht geladen werden.");
      });
  }, []);

  const query = useMemo(() => ({
    providers: sources,
    timeControls,
    rated: ratedOnly ? true : null,
    ...(period === "custom"
      ? { from: customFrom || null, to: customTo || null }
      : periodQuery(period)),
  }), [sources, timeControls, ratedOnly, period, customFrom, customTo]);

  const preview = useMemo(() => {
    if (!library || sources.length === 0 || timeControls.length === 0) {
      return { count: 0, byProvider: {}, byTimeControl: {}, gameIds: [] };
    }
    return previewGameQuery(library.games, query);
  }, [library, query, sources.length, timeControls.length]);

  const providerCounts = useMemo(() => Object.fromEntries(PROVIDERS.map(({ id }) => [
    id,
    (library?.games || []).filter((game) => game.provider === id).length,
  ])), [library]);
  const timeControlCounts = useMemo(() => Object.fromEntries(TIME_CONTROLS.map(({ id }) => [
    id,
    (library?.games || []).filter((game) => game.timeControl?.category === id).length,
  ])), [library]);

  const syncProvider = async (provider) => {
    const username = usernames[provider].trim();
    if (!username || busyProvider || !library) return;
    setBusyProvider(provider);
    setMessage(`${provider === "chesscom" ? "Chess.com" : "Lichess"} wird synchronisiert …`);
    let current = library;
    let cursor = current.accounts?.[accountKey(provider, username)]?.cursor || null;
    let imported = 0;
    let duplicates = 0;
    let malformed = 0;
    try {
      for (let page = 0; page < 100; page += 1) {
        const response = await fetch(`/api/game-sync/${provider}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, cursor }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Die Partien konnten nicht geladen werden.");
        const merged = mergeSyncBatch(current, {
          provider,
          username: payload.username || username,
          games: payload.games,
          cursor: payload.cursor,
          errors: payload.errors,
        });
        current = merged.library;
        cursor = payload.cursor;
        imported += merged.imported;
        duplicates += merged.duplicates;
        malformed += merged.errors.length;
        const changedIds = new Set((payload.games || []).map((game) => game.id));
        await persistGameLibrary(current, current.games.filter((game) => changedIds.has(game.id)));
        setLibrary(current);
        setMessage(`${imported} neu importiert · ${current.games.length} insgesamt …`);
        if (!payload.hasMore) break;
        if (page === 99) throw new Error("Der Verlauf ist sehr groß. Starte die Synchronisierung erneut, um fortzufahren.");
      }
      setMessage(`${imported} neu importiert${duplicates ? ` · ${duplicates} Duplikate` : ""}${malformed ? ` · ${malformed} übersprungen` : ""}.`);
    } catch (error) {
      setMessage(error?.message || "Die Synchronisierung ist fehlgeschlagen.");
    } finally {
      setBusyProvider("");
    }
  };

  const queueAnalysis = async () => {
    if (!library || preview.count === 0) return;
    const created = createAnalysisBatch(library, query);
    const changedIds = new Set(created.batch.jobs.map((job) => job.gameId));
    try {
      await persistGameLibrary(
        created.library,
        created.library.games.filter((game) => changedIds.has(game.id)),
      );
      await persistAnalysisBatch(created.batch);
      setLibrary(created.library);
      setMessage(`${created.batch.jobs.length} Partien vorgemerkt · ${created.batch.reusedCount} aktuelle Analysen wiederverwendet.`);
    } catch (error) {
      setMessage(error?.message || "Die Analyse-Warteschlange konnte nicht gespeichert werden.");
    }
  };

  if (!library) return <section className="profile-page-card"><p>Partiebibliothek wird geladen …</p></section>;

  return (
    <section className="profile-page-card game-sync-panel">
      <div className="account-section-title profile-section-title">
        <div>
          <strong>Vollständige Spieleranalyse</strong>
          <span>Partien synchronisieren, filtern und getrennt zur Analyse vormerken.</span>
        </div>
      </div>

      <div className="game-sync-accounts">
        {PROVIDERS.map((provider) => (
          <div className="game-sync-account" key={provider.id}>
            <label htmlFor={`sync-${provider.id}`}>{provider.label}</label>
            <input
              id={`sync-${provider.id}`}
              value={usernames[provider.id]}
              placeholder="Benutzername"
              onChange={(event) => setUsernames({ ...usernames, [provider.id]: event.target.value })}
            />
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(busyProvider) || !usernames[provider.id].trim()}
              onClick={() => syncProvider(provider.id)}
            >
              {busyProvider === provider.id ? "Synchronisiert …" : "Verbinden / Sync"}
            </button>
            <small>{providerCounts[provider.id]} Partien gespeichert</small>
          </div>
        ))}
      </div>

      <div className="game-sync-filters">
        <fieldset>
          <legend>Quellen</legend>
          {PROVIDERS.map((provider) => (
            <label key={provider.id}>
              <input type="checkbox" checked={sources.includes(provider.id)} onChange={() => setSources(toggle(sources, provider.id))} />
              {provider.label} <span>{providerCounts[provider.id]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Zeitkontrollen</legend>
          {TIME_CONTROLS.map((control) => (
            <label key={control.id}>
              <input type="checkbox" checked={timeControls.includes(control.id)} onChange={() => setTimeControls(toggle(timeControls, control.id))} />
              {control.label} <span>{timeControlCounts[control.id]}</span>
            </label>
          ))}
        </fieldset>
        <div className="game-sync-period">
          <label htmlFor="sync-period">Zeitraum</label>
          <select id="sync-period" value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="last-20">Letzte 20 Partien</option>
            <option value="last-50">Letzte 50 Partien</option>
            <option value="last-100">Letzte 100 Partien</option>
            <option value="last-200">Letzte 200 Partien</option>
            <option value="30-days">Letzte 30 Tage</option>
            <option value="3-months">Letzte 3 Monate</option>
            <option value="6-months">Letzte 6 Monate</option>
            <option value="1-year">Letztes Jahr</option>
            <option value="all">Alle Partien</option>
            <option value="custom">Eigener Zeitraum</option>
          </select>
          {period === "custom" && (
            <div className="game-sync-dates">
              <input aria-label="Von" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              <input aria-label="Bis" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </div>
          )}
          <label className="game-sync-rated">
            <input type="checkbox" checked={ratedOnly} onChange={(event) => setRatedOnly(event.target.checked)} />
            Nur gewertete Partien
          </label>
        </div>
      </div>

      <div className="game-sync-preview" aria-live="polite">
        <div><strong>{preview.count}</strong><span>Partien ausgewählt</span></div>
        <button className="primary-action-button" type="button" disabled={preview.count === 0 || Boolean(busyProvider)} onClick={queueAnalysis}>
          Partien analysieren
        </button>
      </div>
      {message && <p className="game-sync-message" role="status">{message}</p>}
    </section>
  );
}
