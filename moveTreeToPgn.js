// moveTreeToPgn.js
// Mainline PGN with recursive sub-variations (white after white, black after black).
// Recursion-safe: avoids re-attaching the same sibling set at the first ply of a variation.

function lineFrom(node, startMoveNum, suppressParentOnce = null) {
  // Render a single branch following `mainline`, attaching sibling variations
  // at the correct ply. If `suppressParentOnce` equals the current node's parent,
  // we skip emitting siblings on the first move only (to avoid infinite sibling nesting).
  const parts = [];
  let cur = node;
  let moveNum = startMoveNum;
  let firstPly = true;
  let suppressedApplied = false;

  while (cur && cur.move) {
    const color = cur.move.color; // 'w' or 'b'

    // Numbering & SAN for the current move in this branch
    if (firstPly) {
      parts.push(color === "w" ? `${moveNum}. ${cur.move.san}` : `${moveNum}... ${cur.move.san}`);
      firstPly = false;
    } else {
      if (color === "w") parts.push(`${moveNum}. ${cur.move.san}`);
      else parts.push(cur.move.san);
    }

    // Determine whether we are allowed to emit siblings at THIS ply
    const parent = cur.parent;
    const skipSiblingsHere = suppressParentOnce && !suppressedApplied && parent === suppressParentOnce;

    if (!skipSiblingsHere && parent && Array.isArray(parent.variations) && parent.variations.length > 0) {
      // Alternatives are siblings of `cur` under `parent`; emit only same-color siblings
      const alts = parent.variations.filter(v => v !== cur && v.move && v.move.color === color);
      for (const alt of alts) {
        // For the first ply of a spawned variation, suppress the same-parent siblings once
        parts.push(`(${lineFrom(alt, moveNum, parent)})`);
      }
    }

    // Mark suppression as consumed after first move
    if (skipSiblingsHere) suppressedApplied = true;

    // Advance move number after a black move
    if (color === "b") moveNum++;
    cur = cur.mainline;
  }

  return parts.join(" ");
}

export function moveTreeToPgn(root) {
  if (!root) return "*";
  const start = root.mainline; // skip root container node
  if (!start) return "*";

  const fenParts = typeof root.fen === "string" ? root.fen.split(/\s+/) : [];
  const startMoveNum = Number.parseInt(fenParts[5], 10) || 1;
  let last = start;
  while (last.mainline?.move) last = last.mainline;

  let result = last.result;
  if (!["1-0", "0-1", "1/2-1/2"].includes(result)) {
    result = last.move?.san?.endsWith("#")
      ? (last.move.color === "w" ? "1-0" : "0-1")
      : "*";
  }

  return `${lineFrom(start, startMoveNum, null)} ${result}`.trim();
}
