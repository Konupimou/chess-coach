"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNT_STORAGE_PREFIX,
  createAccountState,
  loadAccountState,
  saveAccountState,
  storageKeyForIdentity,
} from "../../gameStorage.js";
import { buildPlayerProfile } from "../../playerProfile.js";
import GameSyncPanel from "./game-sync-panel.js";

function newestAccountKey(storage) {
  const fallback = storageKeyForIdentity(null);
  let newest = { key: fallback, timestamp: -1 };
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(`${ACCOUNT_STORAGE_PREFIX}:`)) continue;
    try {
      const value = JSON.parse(storage.getItem(key));
      const timestamp = Date.parse(value?.updatedAt || "") || 0;
      if (timestamp >= newest.timestamp) newest = { key, timestamp };
    } catch {
      // Ungültige oder alte Einträge werden ignoriert.
    }
  }
  return newest.key;
}

const percent = (value) => Number.isFinite(value)
  ? `${value.toFixed(1).replace(".", ",")} %`
  : "—";

export default function ProfileClient() {
  const [accountKey, setAccountKey] = useState("");
  const [account, setAccount] = useState(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const key = newestAccountKey(window.localStorage);
    const nextAccount = loadAccountState(window.localStorage, key);
    setAccountKey(key);
    setAccount(nextAccount);
    setName(nextAccount.profile?.name === "Schachspieler" ? "" : nextAccount.profile?.name || "");
  }, []);

  const stats = useMemo(() => buildPlayerProfile(account?.games || []), [account]);

  if (!account) {
    return <p className="profile-page-loading">Profil wird geladen …</p>;
  }

  const games = account.games || [];
  const seriousErrors = (stats.ownMistakes || 0) + (stats.ownBlunders || 0);
  const strongerColor = Number.isFinite(stats.whiteAccuracy) && Number.isFinite(stats.blackAccuracy)
    ? stats.whiteAccuracy === stats.blackAccuracy
      ? "Ausgeglichen"
      : stats.whiteAccuracy > stats.blackAccuracy ? "Weiß" : "Schwarz"
    : "Noch offen";
  const playerType = Number.isFinite(stats.ownAccuracy) && stats.ownAccuracy >= 88
    ? "Präziser Kontrolleur"
    : seriousErrors <= Math.max(2, stats.analyzedGames)
      ? "Solider Stratege"
      : "Mutiger Kämpfer";

  const saveName = () => {
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) return;
    const nextAccount = {
      ...account,
      profile: { ...account.profile, name: cleanName },
    };
    saveAccountState(window.localStorage, accountKey, nextAccount);
    setAccount(nextAccount);
  };

  return (
    <div className="profile-page-content">
      <section className="profile-page-card profile-identity-card">
        <div className="account-profile-card">
          <strong>{account.profile?.name || createAccountState().profile.name}</strong>
          <span>{account.profile?.source === "sites" ? account.profile.email : "Lokales Profil auf diesem Gerät"}</span>
        </div>
        {account.profile?.source !== "sites" && (
          <div className="local-profile-form">
            <label htmlFor="profile-page-name">Anzeigename</label>
            <input
              id="profile-page-name"
              value={name}
              placeholder="Dein Name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && saveName()}
            />
            <button className="secondary-button" type="button" onClick={saveName}>Name speichern</button>
          </div>
        )}
      </section>

      <GameSyncPanel />

      <section className="profile-page-card">
        <div className="account-section-title profile-section-title">
          <div>
            <strong>Dein Überblick</strong>
            <span>{stats.totalGames} gespeichert · {stats.analyzedGames} analysiert</span>
          </div>
        </div>
        <dl className="profile-overview">
          <Metric label="Deine Genauigkeit" value={percent(stats.ownAccuracy)} detail="gewichtet nach deinen analysierten Zügen" />
          <Metric label="Bilanz" value={`${stats.results.wins} S · ${stats.results.draws} R · ${stats.results.losses} N`} detail={`${stats.results.unknown} noch ohne Ergebnis`} />
          <Metric label="Punktquote" value={percent(stats.results.scoreRate)} detail="Siege plus halbe Remispunkte" />
          <Metric label="Analyseabdeckung" value={`${stats.analyzedGames} / ${stats.totalGames}`} detail="nur gespeicherte Partien" />
        </dl>
      </section>

      <section className="profile-page-card">
        <div className="account-subsection-title">Deine Key Facts</div>
        <div className="profile-facts">
          <Fact label="Dein Spielertyp" value={playerType} detail="Ermittelt aus Genauigkeit und kritischen Momenten." />
          <Fact label="Deine Stärke" value={strongerColor === "Noch offen" ? "Stabile Grundideen" : `Spiel mit ${strongerColor}`} detail={`Weiß ${percent(stats.whiteAccuracy)} · Schwarz ${percent(stats.blackAccuracy)}`} />
          <Fact label="Deine Komfortzone" value={stats.favoriteOpening?.name || stats.mostCommonTimeFormat?.name || "Noch nicht erkennbar"} detail="Mit mehr Partien wird dein Muster klarer." />
          <Fact label="Dein Trainingshebel" value={seriousErrors > 0 ? "Gefahren vor dem Zug prüfen" : "Komplexere Stellungen suchen"} detail={seriousErrors > 0 ? `${seriousErrors} kritische Momente erkannt.` : "Deine Basis ist sauber."} />
        </div>
      </section>

      {stats.openingStats.length > 0 && (
        <section className="profile-page-card">
          <div className="account-subsection-title">Eröffnungsrepertoire</div>
          <div className="opening-profile-list">
            {stats.openingStats.slice(0, 6).map((opening) => (
              <div key={opening.name}>
                <strong>{opening.name}</strong>
                <span>{opening.games} Partien · {percent(opening.scoreRate)} Punktquote · {percent(opening.ownAccuracy)} Genauigkeit</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="profile-page-card">
        <div className="account-section-title">Gespeicherte Partien</div>
        {games.length === 0 ? (
          <p className="muted">Noch keine gespeicherten Partien. Speichere eine Analyse, damit dein Profil wächst.</p>
        ) : (
          <div className="profile-game-list">
            {games.map((game) => (
              <article key={game.id}>
                <div>
                  <strong>{game.title}</strong>
                  <span>{game.metadata?.opening || "Eröffnung nicht angegeben"}</span>
                </div>
                <span>{game.result === "*" ? "Ohne Ergebnis" : game.result}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, detail }) {
  return <div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>;
}

function Fact({ label, value, detail }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
