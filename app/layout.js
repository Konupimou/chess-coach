import Script from "next/script";
import { headers } from "next/headers";
import "../style.css";

const description = "Analysiere Stellungen und Züge mit Stockfish und einem verständlichen Schachcoach.";

export async function generateMetadata() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const directHost = requestHeaders.get("host");
  const requestedHost = (forwardedHost || directHost || "localhost:3000")
    .split(",")[0]
    .trim();
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(requestedHost)
    ? requestedHost
    : "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : safeHost.startsWith("localhost")
      ? "http"
      : "https";
  const socialImage = `${protocol}://${safeHost}/og.png`;

  return {
    title: "Schachanalyse",
    description,
    openGraph: {
      title: "Schachanalyse",
      description,
      type: "website",
      images: [{
        url: socialImage,
        width: 1734,
        height: 907,
        alt: "Schachanalyse mit einem markierten Zug auf dem Brett",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Schachanalyse",
      description,
      images: [socialImage],
    },
  };
}

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
