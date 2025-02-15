import { Note, ObsidianNote } from "main";
import {
  EventRef,
  parseYaml,
  requestUrl,
  TAbstractFile,
  TFile,
  Vault,
} from "obsidian";
import { GoldfishNotesSettings } from "settings";
import {
  convertObsidianPath,
  getDefaultNoteTitle,
  getFilledTemplate,
  pathJoin,
  throwError,
  escapeTitle,
} from "utils";
import SupabaseSync from "./supabase_sync";
import { Notice } from "obsidian";
import { invalidTitleChars } from "utils/regex";

class FileSystemSync {
  vault: Vault;
  settings: GoldfishNotesSettings;
  existingNoteMap: Map<String, ObsidianNote> = new Map<
    string,
    ObsidianNote
  >();
  modifyRef: EventRef;
  deleteRef: EventRef;

  constructor(vault: Vault, settings: GoldfishNotesSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  init = async () => {
    await this.getAllNotes().then((notes) => {
      notes.forEach((n) => this.existingNoteMap.set(n.frontmatter.uuid, n));
    });
  };

  dirPath = () => convertObsidianPath(this.settings.synced_notes_folder);

  upsertNotesToMarkdownFiles = async (notes: Array<Note>, addDeleted = false) => {
    try {
      // create folder on init (if doesnt exists)
      await this.vault.adapter.exists(this.settings.synced_notes_folder).then(
        (exists) => {
          if (!exists) {
            this.vault.createFolder(this.dirPath());
          }
        },
      );
      if (this.settings.attachments_folder) {
        await this.vault.adapter.exists(this.settings.attachments_folder).then(
          (exists) => {
            if (!exists) {
              this.vault.createFolder(
                convertObsidianPath(this.settings.attachments_folder),
              );
            }
          },
        );
      }
      for (var i = 0; i < notes.length; i++) {
        var note = notes[i];
        const path = this.getNotePath(note);
        try {
          var noteFile = this.existingNoteMap.get(note.uuid) || null;
          var mdContent = getFilledTemplate(
            this.settings.note_template,
            note,
            addDeleted,
            this.settings.date_format,
          );
          if (
            noteFile != null &&
            (await this.vault.adapter.exists(noteFile.file.path))
          ) {
            // check if file contents are the same
            var oldMdContent = await this.vault.read(noteFile.file);
            if (oldMdContent != mdContent) {
              // modify file if id exists in frontmatter
              await this.vault.modify(noteFile.file, mdContent);
            }
            // update file if sync option is overwrite or delete
          } else if (this.settings.sync_type !== 'one-way-new-only') {
            var delFile = this.vault.getAbstractFileByPath(path);
            if (delFile != null) {
              await this.vault.delete(delFile);
            }
            var createdFile = await this.vault.create(path, mdContent);
            var { frontmatter, content } = await this.parseNoteFile(
              createdFile,
            );
            this.existingNoteMap.set(note.uuid, {
              file: createdFile,
              frontmatter,
              content,
            });
          }
          // // download source
          // this.downloadSource(note, this.settings.attachments_folder);
        } catch (e) {
          throwError(
            e,
            `Failed to write note "${path}" to Obsidian.\n\n${e.message}`,
          );
        }
      }
    } catch (e) {
      throwError(e, "Failed to write notes to Obsidian");
    }
  };

  downloadSource = async (note: Note, folder: string): Promise<void> => {
    const audio_url = note.audio_url;
    try {
      if (!audio_url || !this.settings.attachments_folder) return;
      const filename = audio_url.split("/").pop();
      const path = pathJoin([folder, filename]);
      if (await this.vault.adapter.exists(path)) {
        console.log(`File "${path}" already exists`);
        return;
      }
      const fullAudioPath = `${this.settings.supabaseId}/${audio_url}`;
      const data = await SupabaseSync.fetchAudioFile(fullAudioPath);
      await this.vault.createBinary(path, await data.arrayBuffer());
    } catch (e) {

      const noteCreatedAt = new Date(note?.created_at);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      if (noteCreatedAt < sevenDaysAgo) {
        new Notice(`Failed to download audio file for note ${audio_url} since we delete audio files older than 7 days.`);
      } else {
        new Notice(`Failed to download audio file for note ${audio_url}.`);
      }
      console.error(e);
    }
  };

  getAllNotes = async () => {
    const noteList: Array<ObsidianNote> = [];
    try {
      var files = this.vault.getFiles();
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!this.fileInDir(file)) continue;
        var file_id: string;
        var { frontmatter, content } = await this.parseNoteFile(file);
        file_id = frontmatter.uuid || null;
        if (file_id !== null) {
          noteList.push({ file, frontmatter, content });
        }
      }
    } catch (e) {
      throwError(e, `Failed to get existing notes from obsidian`);
    }
    this.existingNoteMap.clear();
    noteList.forEach((n) => this.existingNoteMap.set(n.frontmatter.uuid, n));
    return noteList;
  };
  deleteNotes = async (notes: Note[]) => {
    try {
      await Promise.all(
        notes.map(async (note): Promise<null> => {
          const obsNote = this.existingNoteMap.get(note.uuid);
          if (obsNote) {
            await this.vault.delete(obsNote.file);
            this.existingNoteMap.delete(note.uuid);
          }
          return null;
        }),
      );
    } catch (e) {
      throwError(e, "Failed to delete notes from Goldfish Notes");
    }
  };


  static parseObsidianNote = (note: ObsidianNote): Note => {
    var { file, frontmatter, content } = note;
    return {
      uuid: frontmatter.uuid,
      title: frontmatter.title || undefined,
      content: content || undefined,
      deleted_at: frontmatter.deleted_at || undefined,
      modified_at: new Date(file.stat.mtime).toISOString(),
    };
  };

  // helpers
  getNotePath = (note: Note): string => {
    const noteFileName = getDefaultNoteTitle(note, this.settings);
    // update existing titles
    let path = convertObsidianPath(pathJoin([this.dirPath(), noteFileName]));
    if (!path.includes(".md")) {
      path = path + ".md";
    }

    let count = 0;
    while (this.vault.getAbstractFileByPath(path) != null) {
      count += 1;
      const sanitizedNoteFileName = noteFileName.replace(invalidTitleChars, '');
      path = convertObsidianPath(pathJoin([this.dirPath(), sanitizedNoteFileName]));
      path = path.replace(/( \([\d]+\))?\.([^/.]+)$/, ` (${count}).$2`);
    }
    return path;
  };
  fileInDir = (file: TAbstractFile): boolean => {
    return this.dirPath() === "/"
      ? !file.path.contains("/")
      : file.path.startsWith(this.dirPath());
  };
  convertFileToNote = async (file: TFile): Promise<ObsidianNote> => {
    const { frontmatter, content } = await this.parseNoteFile(file);
    return {
      file,
      frontmatter,
      content,
    };
  };

  parseNoteFile = async (
    file: TFile,
  ): Promise<{ frontmatter: any; content: string }> => {
    var frontmatter = {};
    var rawNoteContent = await this.vault.read(file);
    var content = rawNoteContent;
    try {
      var m = rawNoteContent.match(/^---\n([\s\S]*?)\n---\n/m);
      if (m) {
        frontmatter = parseYaml(m[1]);
        content = content.replace(m[0], "");
      }
    } catch (e) {
      console.error(e, `Failed to parse metadata for: "${file.path}"`);
    }
    return { frontmatter, content };
  };
  getFilenamesInFolder(folder: string): Set<string> {
    let existingTitlesInFolder: Set<string> = new Set();
    this.vault.getFiles().forEach((file) => {
      var fileInDir = folder === "/"
        ? !file.path.contains("/")
        : file.path.startsWith(folder);
      if (fileInDir) existingTitlesInFolder.add(file.name);
    });
    return existingTitlesInFolder;
  }
}

export default FileSystemSync;
