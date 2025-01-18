// import moment
import { Subscription } from "@supabase/supabase-js";
import FileSystemSync from "file_system_sync";
import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import SupabaseSync from "supabase_sync";
import {
  DEFAULT_SETTINGS,
  GoldfishNotesSettings,
  GoldfishNotesSettingsTab,
} from "./settings";

import { openInputModal, throwError } from "./utils";
import { toISOStringWithTimezone } from "utils/date";
import { convertHtmlToMarkdown } from "./utils/parser";

export interface ObsidianNote {
  file: TFile;
  frontmatter: any;
  content: string;
}

export interface Note {
  uuid: string;
  title?: string;
  content?: string;
  original_transcript?: string;
  audio_url?: string;
  created_at?: string;
  modified_at?: string;
  deleted_at: string;
}

export default class GoldfishNotesPlugin extends Plugin {
  settings: GoldfishNotesSettings;
  supabaseAuthSubscription: Subscription | undefined;
  fileSystemSync: FileSystemSync;
  supabaseSync: SupabaseSync;
  tokenRefreshTimer: NodeJS.Timer;

  async onload() {
    await this.loadSettings();
    // This forces goldfish notes to sync with obsidian
    this.addCommand({
      id: "sync-goldfish-notes",
      name: "Sync Notes with Goldfish Notes",
      callback: async () => {
        const isSuccess = await this.syncGoldfishNotes();
        if (isSuccess) {
          new Notice("Goldfish Notes Sync Success");
        }
      },
    });

    // this.addCommand({
    //   id: "create-empty-fleeting-note",
    //   name: "Create Empty Fleeting Note",
    //   callback: async () => {
    //     try {
    //       await this.createEmptyFleetingNote();
    //     } catch (e) {
    //       console.error(e);
    //       new Notice("Failed to create a Fleeting Note :(");
    //     }
    //   },
    // });

    this.addCommand({
      id: "insert-notes-containing",
      name: "Insert All Notes Containing Specific Text",
      callback: async () => {
        openInputModal({
          title: "Insert All Notes Containing:",
          inputs: [
            {
              label: "Text",
              value: "text",
            },
          ],
          submitText: "Search",
          onSubmit: async (result) => {
            this.embedNotesWithText(result.text);
            return true;
          },
        });
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new GoldfishNotesSettingsTab(this.app, this));

    // listen for auth state changes
    const { data } = await SupabaseSync.onAuthStateChange(
      (e: string) => this.reloginOnSignout(e, this.settings),
    );
    const refreshInterval = 60 * 60 * 1000 * 2; // 1 hour
    this.tokenRefreshTimer = setInterval(() => {
      this.checkAndRefreshToken();
    }, refreshInterval);

    this.supabaseAuthSubscription = data.subscription;

    // init filesystem sync
    this.fileSystemSync = new FileSystemSync(this.app.vault, this.settings);

    /// init supabase sync
    this.supabaseSync = new SupabaseSync(this.settings);

    // syncs on startup
    // Files might not be loaded yet
    this.app.workspace.onLayoutReady(async () => {
      await this.fileSystemSync.init();
      if (this.settings.sync_on_startup) {
        this.autoSync();
      }
    });
  }

  disableAutoSync() {
    if (this.settings.sync_interval) {
      clearInterval(this.settings.sync_interval);
    }
  }

  async checkAndRefreshToken() {
    const session = await SupabaseSync.getSession();
    const threshold = 24 * 60 * 60; // 1 day
    const currentTime = Math.round(Date.now() / 1000);
    if (!session || session.expires_at - currentTime < threshold) {
      this.reloginOnSignout("SIGNED_OUT", this.settings);
    }
  }

  async reloginOnSignout(event: string, settings: GoldfishNotesSettings) {
    if (event == "SIGNED_OUT") {
      const sessionRestored = await SupabaseSync.restoreSession();
      if (sessionRestored) {
        return;
      }
      if (settings.email && settings.password) {
        try {
          await SupabaseSync.loginSupabase(
            settings.email,
            settings.password,
          );
        } catch (e) {
          this.signOutUser();
        }
      } else {
        this.signOutUser();
      }
    }
  }

  isUserSignedIn() {
    return this.settings.supabaseId;
  }

  signOutUser() {
    this.settings.supabaseId = undefined;
    this.settings.email = undefined;
    this.settings.password = undefined;
    this.saveSettings();
  }

  autoSync(syncIntervalMin: number = 30) {
    const syncIntervalMs = syncIntervalMin * 60 * 1000;
    this.disableAutoSync();
    this.syncGoldfishNotes();
    this.settings.sync_interval = setInterval(
      this.syncGoldfishNotes.bind(this),
      syncIntervalMs,
    );
  }

  onunload() {
    this.disableAutoSync();
    this.supabaseAuthSubscription?.unsubscribe();
    this.supabaseSync.removeAllChannels();
    clearInterval(this.tokenRefreshTimer);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData(),
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async embedNotesWithText(text: string) {
    let sameSourceNotes: ObsidianNote[] = [];
    try {
      sameSourceNotes = await this.getNotesWithText(text);
      if (sameSourceNotes.length === 0) {
        new Notice(`No notes with text "${text}" found`);
        return;
      }
      const template = "![[${linkText}]]\n\n";
      const sameSourceNoteString = this.embedNotesToString(
        sameSourceNotes,
        this.app.workspace.getActiveFile().path,
        template,
      );
      this.appendStringToActiveFile(sameSourceNoteString);
      new Notice(`Notes with text "${text}" inserted`);
    } catch (e) {
      if (typeof e === "string") {
        new Notice(e);
      } else {
        console.error(e);
        new Notice(`Failed to embed notes with text: "${text}"`);
      }
    }
  }

  // syncs changes between obsidian and goldfish notes
  async syncGoldfishNotes() {
    if (!this.isUserSignedIn()) {
      new Notice("No login credentials found");
      return false;
    }
    try {
      // pull goldfish notes
      let notes = await this.supabaseSync.getAllNotes();
      notes.forEach((note: Note) => {
        if (note.content) {
          note.content = convertHtmlToMarkdown(note.content);
        }
        if (note.original_transcript) {
          note.original_transcript = convertHtmlToMarkdown(note.original_transcript);
        }
      });

      if (this.settings.download_audio_files) {
        notes.forEach((note: Note) => {
          if (note.audio_url) {
            this.fileSystemSync.downloadSource(note, this.settings.attachments_folder);
          }
        });
      }

      const deleteAfterSync = this.settings.sync_type == "one-way-delete";
      await this.fileSystemSync.upsertNotesToMarkdownFiles(notes, deleteAfterSync);
      if (deleteAfterSync) {
        await this.deleteGoldfishNotes(notes);
      }
      this.settings.last_sync_time = new Date();

      return true;
    } catch (e) {
      if (typeof e === "string") {
        new Notice(e);
      } else {
        console.error(e);
        new Notice("Goldfish Notes sync failed - please check settings");
      }
    }
    return false;
  }

  async appendStringToActiveFile(content: string) {
    const active_view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = active_view.editor;
    const doc = editor.getDoc();
    doc.replaceSelection(content);
  }

  async pushGoldfishNotes() {
    try {
      var modifiedNotes = await this.getUpdatedLocalNotes();
      var formattedNotes = await Promise.all(
        modifiedNotes.map(FileSystemSync.parseObsidianNote),
      );
      if (formattedNotes.length > 0) {
        await this.supabaseSync.updateNotes(formattedNotes);
        this.settings.last_sync_time = new Date();
      }
    } catch (e) {
      throwError(
        e,
        "Failed to push notes from Obsidian to Goldfish Notes",
      );
    }
  }

  async deleteGoldfishNotes(notes: Note[]) {
    try {
      const notesToDelete = notes.map((note) => note.uuid);
      if (notesToDelete.length > 0) {
        await this.supabaseSync.deleteNotes(notesToDelete);
      }
    } catch (e) {
      throwError(e, "Failed to delete notes from Goldfish Notes");
    }
  }

  async createEmptyFleetingNote() {
    const note = await this.supabaseSync.createEmptyNote();
    await this.fileSystemSync.upsertNotesToMarkdownFiles([note]);
    const obsNote = this.fileSystemSync.existingNoteMap.get(note.uuid);
    this.app.workspace.activeLeaf.openFile(obsNote.file);
  }

  // returns a list of files that have been modified since the last sync
  async getUpdatedLocalNotes() {
    var existingNotes = await this.fileSystemSync.getAllNotes();
    var modifiedNotes = existingNotes.filter((note) => {
      const { file, frontmatter } = note;
      const isContentModified = new Date(file.stat.mtime) >
        new Date(this.settings.last_sync_time);
      const isTitleChanged = frontmatter.title &&
        frontmatter.title !== file.basename;
      return isContentModified || isTitleChanged;
    });
    return modifiedNotes;
  }

  embedNotesToString(
    notes: Array<ObsidianNote>,
    sourcePath: string,
    template: string,
  ) {
    let embedNotesString = "";
    notes.forEach((note) => {
      const linkText = this.app.metadataCache.fileToLinktext(
        note.file,
        sourcePath,
      );
      embedNotesString += template.replace("${linkText}", linkText);
    });
    return embedNotesString;
  }

  async getNotesWithText(text: string) {
    var existingNotes = await this.fileSystemSync.getAllNotes();
    const textInMetaData = (note: ObsidianNote) => {
      let hasSource = false;
      if (note.frontmatter) {
        Object.values(note.frontmatter).forEach(
          (fm: string | number | boolean) => {
            if (fm.toString().includes(text)) {
              hasSource = true;
            }
          },
        );
      }
      return hasSource;
    };

    const hasTextInContent = (note: ObsidianNote) => {
      return note.content?.includes(text);
    };

    const notesWithSameSource = existingNotes.filter((note) => {
      return textInMetaData(note) || hasTextInContent(note);
    });
    return notesWithSameSource;
  }

  getAllLinks() {
    const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const allLinksSet = new Set();
    for (const [file, links] of Object.entries(resolvedLinks)) {
      const addLinkToSet = (link: string) => {
        const cleanedLink = link.split("/").at(-1).replace(/\.md$/, "");
        allLinksSet.add(cleanedLink);
      };
      addLinkToSet(file);
      Object.keys(links).forEach(addLinkToSet);
      Object.keys(unresolvedLinks[file]).forEach(addLinkToSet);
    }
    return [...allLinksSet];
  }
}
