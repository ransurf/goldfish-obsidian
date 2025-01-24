export function createTextWithLinks(text: string, containerEl: HTMLElement) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const textParts = text.split(urlRegex);

  textParts.forEach(part => {
    if (urlRegex.test(part)) {
      const linkEl = containerEl.createEl("a", { text: part, href: part });
      linkEl.setAttr("target", "_blank");
    } else {
      const lines = part.split('\n');
      lines.forEach((line, index) => {
        containerEl.appendText(line);
        if (index < lines.length - 1) {
          containerEl.createEl("br");
        }
      });
    }
  });
}
