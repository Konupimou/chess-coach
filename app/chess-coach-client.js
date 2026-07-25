"use client";

import { useEffect, useState } from "react";
import { ChessApp } from "../app.js";

export default function ChessCoachClient() {
  const [startupError, setStartupError] = useState("");

  useEffect(() => {
    let instance;
    try {
      instance = new ChessApp();
    } catch (error) {
      console.error("[Chess Coach] Start fehlgeschlagen", error);
      setStartupError("Das Analysebrett konnte nicht geladen werden. Bitte lade die Seite neu.");
    }
    return () => instance?.destroy();
  }, []);

  if (!startupError) return null;
  return (
    <div className="startup-error" role="alert">
      {startupError}
    </div>
  );
}
