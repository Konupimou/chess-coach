import TrainingClient from "./training-client.js";
import { headers } from "next/headers";

const title = "Persönliches Training | Schachanalyse";
const description = "Interaktive Schachaufgaben mit Hinweisen, Erklärungen und Wiederholungsplan.";

export async function generateMetadata() {
  const requestHeaders = await headers();
  const requestedHost = (
    requestHeaders.get("x-forwarded-host")
    || requestHeaders.get("host")
    || "localhost:3000"
  ).split(",")[0].trim();
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(requestedHost)
    ? requestedHost
    : "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = ["http", "https"].includes(forwardedProtocol)
    ? forwardedProtocol
    : safeHost.startsWith("localhost") ? "http" : "https";
  const image = `${protocol}://${safeHost}/training-og.png`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "Training – Finde den besten Zug." }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function TrainingPage() {
  return <TrainingClient />;
}
