// keyboard.js
// Simple left/right arrow key navigation helper

export function attachKeyboard({ onLeft, onRight, onUp, onDown } = {}) {
  const handler = (e) => {
    const target = e.target;
    const isEditable = target && (
      target.isContentEditable
      || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    );
    const modalOpen = typeof document !== "undefined" && document.querySelector("dialog[open]");
    if (isEditable || modalOpen || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === 'ArrowLeft' && onLeft) {
      e.preventDefault();
      onLeft();
    } else if (e.key === 'ArrowRight' && onRight) {
      e.preventDefault();
      onRight();
    } else if (e.key === 'ArrowUp' && onUp) {
      e.preventDefault();
      onUp();
    } else if (e.key === 'ArrowDown' && onDown) {
      e.preventDefault();
      onDown();
    }
  };
  window.addEventListener('keydown', handler);
  // return a detach function so you can remove it later if needed
  return () => window.removeEventListener('keydown', handler);
}
