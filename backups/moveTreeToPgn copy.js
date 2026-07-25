export function moveTreeToPgn(node, includeVariations = true) {
  function helper(n, isRoot = true, moveNum = 1, inVariation = false) {
    let pgn = "";
    let cur = isRoot ? n.mainline : n;
    let currentMoveNum = moveNum;

    // pendingBlackVariations nur für die aktuelle "Zugfolge"
    let pendingBlackVariations = [];

    while (cur && cur.move) {
      if (cur.move.color === "w") {
        pgn += `${currentMoveNum}. `;
        pgn += `${cur.move.san}`;

        // Nach Weiß-Zug: weiße Varianten direkt, schwarze Varianten merken
        if (includeVariations && cur.variations.length > 0) {
          for (let v of cur.variations) {
            if (v.move.color === "w") {
              // Weiße Varianten SOFORT ausgeben
              pgn += ` (${helper(v, false, currentMoveNum, true)})`;
            }
            if (v.move.color === "b") {
              // Schwarze Varianten merken
              pendingBlackVariations.push(v);
            }
          }
        }
      } else {
        // Schwarz-Zug (mit Nummer in Variante)
        if (inVariation && (pgn === "" || pgn.endsWith("("))) {
          pgn += `${currentMoveNum}... `;
        }
        pgn += `${cur.move.san}`;

        // Nach Schwarz-Zug: jetzt ALLE schwarzen Varianten anfügen
        if (includeVariations) {
          // (schwarze Varianten aus vorherigem Weiß-Zug)
          for (let v of pendingBlackVariations) {
            pgn += ` (${helper(v, false, currentMoveNum + 1, true)})`;
          }
          pendingBlackVariations = []; // wichtig!
          // (und zusätzliche Varianten, die jetzt erst nach Schwarz entstehen)
          if (cur.variations.length > 0) {
            for (let v of cur.variations) {
              if (v.move.color === "b") {
                pgn += ` (${helper(v, false, currentMoveNum + 1, true)})`;
              }
            }
          }
        }
        currentMoveNum++;
      }

      // Leerzeichen, wenn noch Zug folgt
      if (cur.mainline && cur.mainline.move) {
        pgn += " ";
      }

      cur = cur.mainline;
    }

    return pgn;
  }

  const moves = helper(node, true, 1, false).trim();

  let pgnString = moves;
  if (!moves.match(/(1-0|0-1|1\/2-1\/2|\*)$/)) {
    pgnString += " *";
  }
  return pgnString;
}