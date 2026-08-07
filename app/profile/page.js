import ProfileClient from "./profile-client.js";

export const metadata = {
  title: "Spielerprofil | Schachanalyse",
  description: "Dein persönliches Spielerprofil aus deinen gespeicherten Schachpartien.",
};

export default function ProfilePage() {
  return (
    <div className="page profile-page">
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <div className="logo" aria-hidden="true">♞</div>
            <div>
              <h1>Spielerprofil</h1>
              <p>Deine Entwicklung aus allen gespeicherten Partien.</p>
            </div>
          </div>
          <a className="secondary-button profile-back-link" href="/">Zur Analyse</a>
        </div>
      </header>
      <main className="profile-page-main">
        <ProfileClient />
      </main>
    </div>
  );
}
