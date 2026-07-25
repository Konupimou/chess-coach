// MoveListView.js
// Nummerierte, klickbare Zugliste UNTER dem Brett – inkl. Variantenzeilen.
// Hauptlinie: drei Spalten (# | Weiß | Schwarz)
// Varianten: eigene Zeilen direkt unter der passenden Hauptlinien-Zeile.
//  - Nach Weiß-Hauptzug: alle weißen Alternativen des Elternknotens
//  - Nach Schwarz-Hauptzug: alle schwarzen Alternativen des Elternknotens
// Jede SAN ist anklickbar (data-fen springt in die Stellung)

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character],
  );
}

export class MoveListView {
  constructor({
    afterElementId = "board",
    onJump = () => {},
    onPreview = () => {},
    onPreviewEnd = () => {},
  } = {}) {
    this.onJump = onJump;
    this.onPreview = onPreview;
    this.onPreviewEnd = onPreviewEnd;
    this.collapsed = new Set(); // remembers which move numbers are collapsed
    this._lastRoot = null;
    this._lastCurrent = null;

    const boardEl = document.getElementById(afterElementId);
    let listEl = document.getElementById("move-list");
    if (!listEl) {
      listEl = document.createElement("div");
      listEl.id = "move-list";
      listEl.style.maxWidth = "480px";
      listEl.style.margin = "12px auto 0";
      boardEl.insertAdjacentElement("afterend", listEl);
    }
    this.container = listEl;

    // Minimal-Styles (einmalig)
    if (!document.getElementById("move-list-styles")) {
      const style = document.createElement("style");
      style.id = "move-list-styles";
      style.textContent = `
        #move-list table { width: 100%; border-collapse: collapse; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
        #move-list th, #move-list td { padding: 6px 8px; text-align: center; vertical-align: top; }
        #move-list td[data-fen] { cursor: pointer; }
        #move-list .variant-row td { font-style: italic; text-align: left; padding: 6px 10px; }
        #move-list .variant-badge { display: inline-block; font-size: 11px; border-radius: 10px; padding: 0 6px; margin-right: 6px; }
        #move-list .variant-move { margin-right: 6px; }
        #move-list td.move-num { cursor: pointer; user-select: none; width: 46px; }
        #move-list td.move-num .arrow { display: inline-block; width: 1em; }
      `;
      document.head.appendChild(style);
    }

    // Delegation: Klicks auf Zellen / SAN-Spans
    this.container.addEventListener("click", (e) => {
      // Toggle collapse on move number click
      const numCell = e.target.closest('.move-num');
      if (numCell) {
        const n = numCell.getAttribute('data-movenum');
        if (n) {
          if (this.collapsed.has(n)) this.collapsed.delete(n); else this.collapsed.add(n);
          this.render(this._lastRoot, this._lastCurrent, {
            annotations: this._annotations,
            showExplanations: this._showExplanations,
          });
        }
        return;
      }
      // Jump to FEN on SAN click
      const hit = e.target.closest("[data-fen]");
      if (!hit) return;
      const fen = hit.getAttribute("data-fen");
      if (fen) this.onJump(fen);
    });

    const moveHit = (event) => event.target?.closest?.("[data-fen]") || null;
    const entersHit = (hit, relatedTarget) => (
      hit && !(relatedTarget instanceof Node && hit.contains(relatedTarget))
    );
    this.container.addEventListener("pointerover", (event) => {
      const hit = moveHit(event);
      if (!entersHit(hit, event.relatedTarget)) return;
      const fen = hit.getAttribute("data-fen");
      if (fen) this.onPreview(fen, hit);
    });
    this.container.addEventListener("pointerout", (event) => {
      const hit = moveHit(event);
      if (!entersHit(hit, event.relatedTarget)) return;
      const fen = hit.getAttribute("data-fen");
      if (fen) this.onPreviewEnd(fen, hit);
    });
    this.container.addEventListener("focusin", (event) => {
      const hit = moveHit(event);
      const fen = hit?.getAttribute("data-fen");
      if (fen) this.onPreview(fen, hit);
    });
    this.container.addEventListener("focusout", (event) => {
      const hit = moveHit(event);
      if (!entersHit(hit, event.relatedTarget)) return;
      const fen = hit.getAttribute("data-fen");
      if (fen) this.onPreviewEnd(fen, hit);
    });
  }

  // Baue die Hauptlinie als Array von Nodes (ohne Root)
  getMainlineNodes(root) {
    const arr = [];
    let n = root.mainline;
    while (n && n.move) { arr.push(n); n = n.mainline; }
    return arr;
  }

  // Check if a node has sibling alternatives of the same color
  hasAlternatives(node) {
    if (!node || !node.parent || !Array.isArray(node.parent.variations)) return false;
    const color = node.move?.color;
    if (color !== 'w' && color !== 'b') return false;
    return node.parent.variations.some(v => v !== node && v.move && v.move.color === color);
  }

  annotationFor(node) {
    return node && this._annotations instanceof Map
      ? this._annotations.get(node) || null
      : null;
  }

  qualityClass(node) {
    const quality = this.annotationFor(node)?.quality;
    return ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"].includes(quality)
      ? `move-quality-${quality}`
      : "";
  }

  moveCell(node, currentNode) {
    if (!node) return "<td></td>";
    const annotation = this.annotationFor(node);
    const classes = [
      "move-cell",
      node === currentNode ? "current-move" : "",
      this.qualityClass(node),
    ].filter(Boolean);
    const explanation = typeof annotation?.explanation === "string"
      ? annotation.explanation
      : "";
    const quality = typeof annotation?.label === "string" ? annotation.label : "";
    const title = [quality, explanation].filter(Boolean).join(" · ");
    const detail = this._showExplanations
      ? `<small class="move-explanation${annotation?.quality ? "" : " is-pending"}">${escapeHtml(explanation || "Bewertung wird berechnet …")}</small>`
      : "";
    return [
      `<td class="${classes.join(" ")}" data-fen="${escapeHtml(node.fen)}"`,
      title ? ` title="${escapeHtml(title)}"` : "",
      ">",
      `<span class="move-san">${escapeHtml(node.move.san)}</span>`,
      detail,
      "</td>",
    ].join("");
  }

  variantMove(node) {
    const annotation = this.annotationFor(node);
    const classes = [
      "variant-move",
      node === this._lastCurrent ? "current-move" : "",
      this.qualityClass(node),
    ].filter(Boolean);
    const title = [
      annotation?.label,
      annotation?.explanation,
    ].filter((value) => typeof value === "string" && value).join(" · ");
    return [
      `<span class="${classes.join(" ")}" data-fen="${escapeHtml(node.fen)}"`,
      title ? ` title="${escapeHtml(title)}"` : "",
      `>${escapeHtml(node.move.san)}</span>`,
    ].join("");
  }

  // Recursive: build clickable PGN snippet for a variation including sub-variations
  _variantSnippetFrom(node, startMoveNum, suppressParentOnce = null) {
    let html = "(";
    let cur = node;
    let moveNum = startMoveNum;
    let first = true;
    let suppressionConsumed = false;

    while (cur && cur.move) {
      const color = cur.move.color; // 'w' or 'b'

      // numbering
      if (first) {
        html += color === "w" ? `${moveNum}. ` : `${moveNum}... `;
        first = false;
      } else if (color === "w") {
        html += ` ${moveNum}. `;
      } else {
        html += " ";
      }

      // current SAN (clickable)
      html += this.variantMove(cur);

      // sub-variations at this ply (same-color siblings)
      const parent = cur.parent;
      const skipHere = suppressParentOnce && !suppressionConsumed && parent === suppressParentOnce;
      if (!skipHere && parent && Array.isArray(parent.variations) && parent.variations.length > 0) {
        const alts = parent.variations.filter(v => v !== cur && v.move && v.move.color === color);
        for (const alt of alts) {
          // recursive sub-variant; suppress siblings once at the same parent to avoid infinite re-attachment
          html += " " + this._variantSnippetFrom(alt, moveNum, parent);
        }
      }
      if (skipHere) suppressionConsumed = true;

      if (color === "b") moveNum++;
      cur = cur.mainline;
    }

    html += ")";
    return html;
  }

  // Simple (flat) snippet along a variant's mainline (no nested sub-variants)
  simpleVariantSnippet(node, startMoveNum) {
    let html = "(";
    let cur = node;
    let moveNum = startMoveNum;
    let first = true;
    while (cur && cur.move) {
      const color = cur.move.color;
      if (first) {
        html += color === "w" ? `${moveNum}. ` : `${moveNum}... `;
        first = false;
      } else if (color === "w") {
        html += ` ${moveNum}. `;
      } else {
        html += " ";
      }
      html += this.variantMove(cur);
      if (color === "b") moveNum++;
      cur = cur.mainline;
    }
    html += ")";
    return html;
  }

  // Build rows for a variant and its sub-variants as extra table rows
  rowsForVariantRecursive(node, startMoveNum, sideLetter, depth = 0, indexLabel = "", suppressParentOnce = null, parentMoveNum = null, hidden = false) {
    const indent = `<span class="variant-indent" style="display:inline-block;width:${depth * 16}px"></span>`;
    const badge = `<span class="variant-badge${depth>0 ? ' nested' : ''}">${escapeHtml(sideLetter)}${escapeHtml(indexLabel)}</span>`;
    let rows = "";

    // Row for THIS variant (flat snippet only)
    const snippet = this.simpleVariantSnippet(node, startMoveNum);
    rows += `<tr class="variant-row" data-parent-movenum="${parentMoveNum ?? ''}" style="${hidden ? 'display:none;' : ''}"><td></td><td colspan="2">${indent}${badge}${snippet}</td></tr>`;

    // Now walk down this variant's mainline and emit its OWN sub-variants as extra rows
    let cur = node;
    let moveNum = startMoveNum;
    let suppressionConsumed = false;

    while (cur && cur.move) {
      const parent = cur.parent;
      const color = cur.move.color; // 'w' or 'b'
      const skipHere = suppressParentOnce && !suppressionConsumed && parent === suppressParentOnce;

      if (!skipHere && parent && Array.isArray(parent.variations) && parent.variations.length > 0) {
        const alts = parent.variations.filter(v => v !== cur && v.move && v.move.color === color);
        for (const alt of alts) {
          // recurse; nested variants do not carry index numbers
          rows += this.rowsForVariantRecursive(
            alt,
            moveNum,
            color === 'w' ? 'W' : 'S',
            depth + 1,
            "",
            parent,
            parentMoveNum,
            hidden
          );
        }
      }
      if (skipHere) suppressionConsumed = true;

      if (color === 'b') moveNum++;
      cur = cur.mainline;
    }

    return rows;
  }

  // Wrapper kept for existing calls
  variantSnippet(altNode, startMoveNum) {
    return this._variantSnippetFrom(altNode, startMoveNum, altNode.parent);
  }

  // Variante-Zeile(n) unter der passenden Hauptzeile erzeugen
  variantRowsForPly(nodeOfPly, moveNum) {
    const parent = nodeOfPly.parent;
    if (!parent || !Array.isArray(parent.variations) || parent.variations.length === 0) return "";

    const color = nodeOfPly.move?.color;
    if (color !== "w" && color !== "b") return "";

    const alts = parent.variations.filter(v => v !== nodeOfPly && v.move && v.move.color === color);
    if (alts.length === 0) return "";

    let out = "";
    const sideLetter = color === 'w' ? 'W' : 'S';
    const key = String(moveNum);
    const hide = this.collapsed.has(key);

    alts.forEach((alt, idx) => {
      out += this.rowsForVariantRecursive(
        alt,
        moveNum,
        sideLetter,
        0,
        String(idx + 1),
        parent,
        moveNum,
        hide
      );
    });

    return out;
  }

  render(root, currentNode, { annotations = null, showExplanations = false } = {}) {
    this._lastRoot = root;
    this._lastCurrent = currentNode;
    this._annotations = annotations instanceof Map ? annotations : new Map();
    this._showExplanations = Boolean(showExplanations);
    if (!this.container || !root) return;

    const nodes = this.getMainlineNodes(root);

    let html = '<table><thead><tr><th>#</th><th>Weiß</th><th>Schwarz</th></tr></thead><tbody>';
    const fenParts = typeof root.fen === "string" ? root.fen.split(/\s+/) : [];
    let moveNum = Number.parseInt(fenParts[5], 10) || 1;
    const rows = [];

    for (const node of nodes) {
      const color = node.move?.color;
      if (color === "w") {
        rows.push({ moveNum, white: node, black: null });
      } else if (color === "b") {
        let row = rows.at(-1);
        if (!row || row.moveNum !== moveNum || row.black) {
          row = { moveNum, white: null, black: null };
          rows.push(row);
        }
        row.black = node;
        moveNum += 1;
      }
    }

    for (const row of rows) {
      const { white, black } = row;
      moveNum = row.moveNum;
      const whiteCell = this.moveCell(white, currentNode);
      const blackCell = this.moveCell(black, currentNode);

      const hasVar = this.hasAlternatives(white) || this.hasAlternatives(black);
      if (hasVar) {
        const isCollapsed = this.collapsed.has(String(moveNum));
        const arrow = isCollapsed ? '▸' : '▾';
        html += `<tr class="main-row" data-movenum="${moveNum}"><td class="move-num" data-movenum="${moveNum}"><span class="arrow">${arrow}</span> ${moveNum}</td>${whiteCell}${blackCell}</tr>`;
      } else {
        // no variants: plain number, no arrow, not clickable
        html += `<tr class="main-row" data-movenum="${moveNum}"><td>${moveNum}</td>${whiteCell}${blackCell}</tr>`;
      }

      // Variantenzeilen:
      //  - nach Weiß-Zug: zeige weiße Alternativen (Geschwister in parent.variations)
      if (white) {
        html += this.variantRowsForPly(white, moveNum);
      }
      //  - nach Schwarz-Zug: zeige schwarze Alternativen
      if (black) {
        html += this.variantRowsForPly(black, moveNum);
      }
    }

    html += "</tbody></table>";
    this.container.innerHTML = html;
  }
}
