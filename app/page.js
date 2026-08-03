import ChessCoachClient from "./chess-coach-client.js";

export default function HomePage() {
  return (
    <>
      <a className="skip-link" href="#board">Zum Schachbrett springen</a>
      <div className="page analysis-only-page">
        <header className="site-header">
          <div className="header-inner">
            <div className="brand">
              <div className="logo" aria-hidden="true">♞</div>
              <div>
                <h1>Analyse</h1>
                <p>Verstehe die Stellung und deinen letzten Zug.</p>
              </div>
            </div>
            <div id="account-slot" className="account-slot" />
          </div>
        </header>

        <main className="workbench">
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
              <h2 id="move-list-title">Züge</h2>
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
