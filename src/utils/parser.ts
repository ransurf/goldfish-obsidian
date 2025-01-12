import TurndownService from "turndown";

export function convertHtmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    bulletListMarker: "-",
    blankReplacement: (content, node) => {
      if (node.nodeName === "LI") {
        return "";
      }
      // Remove extra spaces between list elements
      if (node.nodeName === "UL" || node.nodeName === "OL") {
        return "\n";
      }
      return "\n\n";
    },
  });

  turndownService.addRule("taskList", {
    filter: (node) => {
      return node.nodeName === "UL" && node.getAttribute("data-type") === "taskList";
    },
    replacement: (content, node) => {
      return content;
    },
  });

  turndownService.addRule("taskItem", {
    filter: (node) => {
      return node.nodeName === "LI" && node.getAttribute("data-type") === "taskItem";
    },
    replacement: (content, node) => {
      const isChecked = (node as Element).getAttribute("data-checked") === "true";
      const checkbox = isChecked ? "- [x]" : "- [ ]";
      const indentation = getNodeIndentation(node);
      const taskContent = content.replace(/\n/g, "").trim();
      return `${indentation}${checkbox} ${taskContent}\n`;
    },
  });

  turndownService.addRule("paragraphInsideListItem", {
    filter: (node, options) => {
      return node.nodeName === "P" && node.parentNode?.nodeName === "LI";
    },
    replacement: (content, node, options) => {
      return content;
    },
  });

  turndownService.addRule("paragraphInsideDiv", {
    filter: (node, options) => {
      return node.nodeName === "P" && node.parentNode?.nodeName === "DIV";
    },
    replacement: (content, node, options) => {
      return content;
    },
  });

  turndownService.addRule("div", {
    filter: (node, options) => {
      return node.nodeName === "DIV";
    },
    replacement: (content, node, options) => {
      return content;
    },
  });

  turndownService.addRule("trimListItem", {
    filter: "li",
    replacement: (content, node) => {
      const listItemContent = content.trim();
      const prefix = node.parentNode?.nodeName === "OL" ? "1. " : "- ";
      const indentation = getNodeIndentation(node);
      return `${indentation}${prefix}${listItemContent}\n`;
    },
  });

  return turndownService.turndown(html);
}

// Helper function to determine indentation based on nesting level
function getNodeIndentation(node: Node): string {
  const level = getNodeLevel(node);
  return '    '.repeat(level - 1);
}

// Function to get the level of nesting
function getNodeLevel(node: Node): number {
  let level = 0;
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeName === "UL" || parent.nodeName === "OL") {
      level++;
    }
    parent = parent.parentNode;
  }
  return level;
}
