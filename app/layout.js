import Script from "next/script";
import "../style.css";

export const metadata = {
  title: "Chess Coach",
  description: "Analysiere Schachvarianten mit Stockfish und einem optionalen KI-Coach.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <head>
        <link rel="stylesheet" href="/libs/chessboard-1.0.0.min.css" />
      </head>
      <body>
        <Script src="/libs/jquery-3.6.0.min.js" strategy="beforeInteractive" />
        <Script src="/libs/chessboard-1.0.0.min.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
