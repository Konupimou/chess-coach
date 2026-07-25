// moveTree.js

// Baumknoten
export class MoveTreeNode {
  constructor({ move = null, fen = null, parent = null, result = null } = {}) {
    this.move = move;           // { san, color, ... } | null (Root)
    this.fen = fen || null;     // FEN der Stellung NACH diesem Zug (Root: Start-FEN)
    this.parent = parent || null;
    this.mainline = null;       // nächster „normaler“ Zug
    this.variations = [];       // Array alternativer Äste (Abzweigungen)
    this.result = result;        // Optionales Ergebnis nach diesem Zug
  }
}

// Füge einen Zug an currentNode an (Mainline oder als Variation)
export function addMoveToTree(currentNode, move, fen) {
  // Wenn es noch keine Mainline gibt → setze Mainline
  if (!currentNode.mainline) {
    const newNode = new MoveTreeNode({ move, fen, parent: currentNode });
    currentNode.mainline = newNode;
    return newNode;
  }

  // Falls der Mainline-Zug identisch (gleiche Stellung) ist → gehe dorthin
  if (currentNode.mainline.fen === fen) {
    return currentNode.mainline;
  }

  // Prüfe, ob es diese Alternative schon als Variation gibt
  for (const v of currentNode.variations) {
    if (v.fen === fen) {
      return v;
    }
  }

  // Neue Variation anlegen
  const newVar = new MoveTreeNode({ move, fen, parent: currentNode });
  currentNode.variations.push(newVar);
  return newVar;
}

// Rekursiv: Finde Node per FEN in Mainline + allen Varianten
export function findNodeByFen(root, fen) {
  if (!root) return null;
  if (root.fen === fen) return root;

  // Mainline hinab
  if (root.mainline) {
    const hit = findNodeByFen(root.mainline, fen);
    if (hit) return hit;
  }

  // Varianten durchsuchen
  if (Array.isArray(root.variations)) {
    for (const v of root.variations) {
      const hit = findNodeByFen(v, fen);
      if (hit) return hit;
    }
  }

  return null;
}
