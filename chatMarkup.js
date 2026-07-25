export function parseChatBoldMarkup(value) {
  const text = String(value ?? "");
  const segments = [];
  const pattern = /\*\*([\s\S]+?)\*\*/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ text: text.slice(cursor, match.index), strong: false });
    }
    segments.push({ text: match[1], strong: true });
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), strong: false });
  }

  return segments.length > 0 ? segments : [{ text, strong: false }];
}

export function renderChatMarkup(container, value) {
  const documentRef = container.ownerDocument || document;
  container.replaceChildren();

  for (const segment of parseChatBoldMarkup(value)) {
    if (segment.strong) {
      const strong = documentRef.createElement("strong");
      strong.textContent = segment.text;
      container.appendChild(strong);
    } else {
      container.appendChild(documentRef.createTextNode(segment.text));
    }
  }
}
