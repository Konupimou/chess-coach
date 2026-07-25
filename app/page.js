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
                <p className="eyebrow">Dein Analysebrett</p>
                <h1>Chess Coach</h1>
                <p>Varianten erkunden, mit Stockfish prüfen und Pläne verstehen.</p>
              </div>
            </div>
            <div id="account-slot" className="account-slot" />
          </div>
        </header>

        <main className="workbench">
          <section id="app" className="board-stage" aria-label="Schachanalyse">
            <div id="board-container" className="board-wrapper">
              <div id="board" aria-label="Interaktives Schachbrett" />
            </div>
          </section>
          <section className="move-list-section" aria-labelledby="move-list-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Variantenbaum</p>
                <h2 id="move-list-title">Zugliste</h2>
              </div>
              <p className="keyboard-hint">← → navigieren · ↑ ↓ Variante wechseln</p>
            </div>
            <div id="move-list" />
          </section>
        </main>
      </div>
      <ChessCoachClient />
    </>
  );
}
