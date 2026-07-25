import ChessCoachClient from "./chess-coach-client.js";

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#board">Zum Schachbrett springen</a>
      <div className="page">
        <header className="site-header">
          <div className="header-inner">
            <div className="brand">
              <div className="logo" aria-hidden="true">♞</div>
              <div>
                <p className="eyebrow">Dein persönlicher Schachcoach</p>
                <h1>Chess Coach</h1>
                <p>Spiele gegen Stockfish oder untersuche deine Partien Zug für Zug.</p>
              </div>
            </div>
            <div id="account-slot" className="account-slot" />
          </div>
        </header>

        <main className="workbench">
          <nav className="mode-navigation" aria-label="Chess-Coach-Bereich">
            <button
              id="play-mode-button"
              className="mode-navigation-button is-active"
              type="button"
              aria-current="page"
            >
              <span aria-hidden="true">♟</span>
              <span>
                <strong>Spielen</strong>
                <small>Gegen die Engine mit Live-Feedback</small>
              </span>
            </button>
            <button
              id="analysis-mode-button"
              className="mode-navigation-button"
              type="button"
            >
              <span aria-hidden="true">⌁</span>
              <span>
                <strong>Analyse</strong>
                <small>Stellungen, Varianten und Partiefeedback</small>
              </span>
            </button>
          </nav>
          <section id="app" className="board-stage" aria-label="Schachanalyse">
            <div id="board-container" className="board-wrapper">
              <div
                id="board"
                role="group"
                tabIndex={0}
                aria-label="Interaktives Schachbrett"
                aria-describedby="board-keyboard-instructions"
              />
            </div>
          </section>
          <section className="move-list-section" aria-labelledby="move-list-title">
            <div className="section-heading">
              <div>
                <p id="move-list-eyebrow" className="eyebrow">Partieverlauf</p>
                <h2 id="move-list-title">Zugliste</h2>
              </div>
              <p id="keyboard-hint" className="keyboard-hint">← → navigieren · ↑ ↓ Variante wechseln</p>
            </div>
            <div id="move-list" />
          </section>
        </main>
      </div>
      <ChessCoachClient />
    </>
  );
}
