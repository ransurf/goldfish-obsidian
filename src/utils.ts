import { Note } from "./main";
var CryptoJS = require("crypto-js");
import { moment } from "obsidian";
import { InputModal, ModalInputField, Values } from "./components/inputModal";
import { GoldfishNotesSettings } from "./settings";
import { toISOStringWithTimezone } from "utils/date";

export function openInputModal(
  title: string,
  inputs: ModalInputField[],
  submitText: string,
  onSubmit: (results: Values) => Promise<boolean>,
) {
  new InputModal(this.app, { title, inputs, submitText, onSubmit }).open();
}

// helper functions
// https://stackoverflow.com/a/29855282/13659833

export function pathJoin(parts: Array<string>, sep: string = "/") {
  var separator = sep || "/";
  var replace = new RegExp(separator + "{1,}", "g");
  return parts.join(separator).replace(replace, separator);
}

export function throwError(e: any, errMessage: string) {
  if (typeof e === "string") {
    throw e;
  } else {
    console.error(e);
    throw errMessage;
  }
}

export const extractAllTags = (text: string): string[] => {
  let tags = [];
  let tagRegex = /(^|\B)#(?![0-9_]+\b)([a-zA-Z0-9_\/]{1,50})(\b|\r)/gm;
  //get all tags, and when adding a tag, remove # and add quotation marks, using matchall
  let matches = text.matchAll(tagRegex);
  for (const match of matches) {
    tags.push(`"${match[2]}"`);
  }
  return tags;
};

export const escapeTitle = (t: string | null) =>
  (t || "")
    .substring(0, 40)
    .replace(/[\n\r]/g, " ")
    .replace(/([\[\]\#\*\:\/\\\^\|\#\?])/g, "");

export const getDefaultNoteTitle = (
  note: Note,
  settings: GoldfishNotesSettings,
) => {
  const noteCopy = { ...note } as Note;
  const titleFromContent = escapeTitle(noteCopy.content)
  if (!noteCopy.title) {
    if (!settings.auto_generate_title || titleFromContent.length === 0) {
      noteCopy.title = noteCopy.uuid;
    } else {
      noteCopy.title = titleFromContent;
    }
  }
  const title = getFilledTemplate(settings.title_template, noteCopy, false, settings.date_format);
  return `${title.replace(/[\\/]/g, "")}.md`
};

// paths in obsidian are weird, need function to convert to proper path
export function convertObsidianPath(path: string) {
  path = path[0] === "/" ? path.replace("/", "") : path;
  path = path || "/";
  return path;
}

export const escapeForYaml = (text?: string) =>
  (text || "").replace(/"/g, '\\"').replace(/\n/g, " ").replace(
    /\\\\/g,
    "\\\\",
  );

// fills the template with the note data
export function getFilledTemplate(
  template: string,
  note: Note,
  addDeleted = false,
  dateFormat = "YYYY-MM-DD",
) {
  const metadataMatch = template.match(/^---\n([\s\S]*?)\n---\n/m);
  let content = note.content;
  let tags: string[] = [];
  if (template.includes("${tags}")) {
    tags = extractAllTags(note.content);
  }
  if (metadataMatch) {
    const escapedTitle = escapeForYaml(note.title);
    const escapedContent = escapeForYaml(content);
    const escapedOriginalTranscript = escapeForYaml(note.original_transcript);
    const escapedTags = `[${tags.join(", ")}]`;
    var newMetadata = metadataMatch[1]
      .replace(/\$\{title\}/gm, escapedTitle)
      .replace(/\$\{tags\}/gm, escapedTags)
      .replace(/\$\{cleaned\}/gm, escapedContent)
      .replace(/\$\{original\}/gm, escapedOriginalTranscript)
    if (addDeleted) {
      const deleted_match = newMetadata.match(/^deleted_at:.*$/);
      if (deleted_match) {
        newMetadata = newMetadata.replace(
          deleted_match[0],
          `deleted_at: ${toISOStringWithTimezone()}`,
        );
      }
    }
    newMetadata = `---\n${newMetadata}\n---\n`;
    template = template.replace(metadataMatch[0], newMetadata);
  }
  var newTemplate = template
    .replace(/\$\{id\}/gm, note.uuid)
    .replace(/\$\{title\}/gm, note.title)
    .replace(/\$\{datetime\}/gm, note.created_at)
    .replace(/\$\{tags\}/gm, `[${tags.join(", ")}]`)
    .replace(
      /\$\{created_date\}/gm,
      moment(note.created_at).local().format(dateFormat),
    )
    .replace(
      /\$\{last_modified_date\}/gm,
      moment(note.modified_at).local().format(dateFormat),
    )
    .replace(/\$\{cleaned\}/gm, content)
    .replace(/\$\{original\}/gm, note.original_transcript)

  return newTemplate;
}
