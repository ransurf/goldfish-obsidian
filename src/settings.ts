import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  TextAreaComponent,
} from "obsidian";
import GoldfishNotesPlugin from "./main";
import { openInputModal, isValidTitle } from "utils";
import SupabaseSync from "supabase_sync";
import grayMatter from "gray-matter";
import { FolderSuggest } from "./settings/FolderSuggester";
import { createTextWithLinks } from "./text";

export interface GoldfishNotesSettings {
  auto_generate_title: boolean;
  synced_notes_folder: string;
  attachments_folder: string;
  note_template: string;
  sync_type: string;
  notes_filter: string;
  sync_on_startup: boolean;
  download_audio_files: boolean;
  last_sync_time: Date;
  sync_obsidian_links: boolean;
  sync_obsidian_links_title: string;
  supabaseId: string | undefined;
  email: string | undefined;
  password: string | undefined;
  sync_interval: NodeJS.Timer | undefined;
  date_format: string;
  title_template: string;
}

export const DEFAULT_SETTINGS: GoldfishNotesSettings = {
  auto_generate_title: true,
  synced_notes_folder: "GoldfishNotes",
  attachments_folder: "Attachments",
  note_template: `---
# Required fields
uuid: "\${uuid}"
# Optional fields
title: "\${title}"
created: "\${created_date}"
modified: "\${last_modified_date}"
---

## Cleaned

\${cleaned}

## Original

\${original}`
  ,
  sync_on_startup: false,
  download_audio_files: false,
  last_sync_time: new Date(0),
  sync_type: "one-way-overwrite",
  sync_obsidian_links: false,
  sync_obsidian_links_title: "Links from Obsidian",
  notes_filter: "",
  email: undefined,
  password: undefined,
  supabaseId: undefined,
  sync_interval: undefined,
  date_format: "YYYY-MM-DDTHH:mm:ssZ",
  title_template: "${title}",
};
export class GoldfishNotesSettingsTab extends PluginSettingTab {
  plugin: GoldfishNotesPlugin;

  constructor(app: App, plugin: GoldfishNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  processFrontmatter(val: string) {
    let error = "";
    let parsedNote;
    if (!val) {
      error = "Note template cannot be empty";
    }
    try {
      parsedNote = grayMatter(val);
      if (!parsedNote?.data?.uuid) {
        error = "Note template 'uuid' field is required";
      }
    } catch (_e) {
      error = "Note template incorrect format";
    }
    return error;
  }

  async manageAccount(accountSetting: any, btn: any) {
    if (this.plugin.isUserSignedIn()) {
      this.plugin.signOutUser();
      accountSetting.setDesc("Manage your Goldfish Notes Account");
      btn.setButtonText("Sign In").setCta();
      return;
    }
    openInputModal({
      title: "Login to Goldfish Notes",
      description: "Please use email and password.\nIf you don't have a password, please create one by signing up with the same email as your Google account using the mobile app or https://account.goldfishnotes.com",
      inputs: [
        {
          label: "Email",
          value: "email",
        },
        {
          label: "Password",
          value: "password",
          type: "password",
        },
      ],
      submitText: "Login",
      onSubmit: async (data) => {
        const { email, password } = data;

        if (!email || !password) {
          const errors = [];
          if (!email) {
            errors.push('Invalid email');
          }
          if (!password) {
            errors.push('Invalid password');
          }
          new Notice('Validation errors: ' + errors.join(', '));
          return false;
        }
        try {
          const supaRes = await SupabaseSync.loginSupabase(
            email,
            password,
          );
          const supaSuccess = supaRes === null || supaRes.error ? false : true;
          if (supaSuccess) {
            this.plugin.settings.supabaseId = supaRes.data.user.id;
            this.plugin.settings.email = email;
            this.plugin.settings.password = password;
            accountSetting.setDesc(`You're currently signed in as ${this.plugin.settings.email}`);
            btn.setButtonText("Sign Out").setCta();
          } else {
            new Notice(`Login failed - ${supaRes.error.message}`);
            return false;
          }

          this.plugin.saveSettings();
          return true;
        } catch (err) {
          new Notice(`Login failed - ${err}`);
          return false;
        }
      },
    });
  }

  display(): void {
    const { containerEl } = this;
    let noteTemplateComponent: TextAreaComponent;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Authentication" });

    const accountSetting = new Setting(containerEl)
      .setName("Account")
      .setDesc(this.plugin.settings.supabaseId ? `You're currently signed in ${this.plugin.settings.email}` : "Manage your Goldfish Notes Account")
      .addButton((btn: any) =>
        btn
          .setButtonText(
            this.plugin.settings.supabaseId ? "Sign Out" : "Sign In",
          )
          .setCta()
          .onClick(async () => await this.manageAccount(accountSetting, btn))
      );

    containerEl.createEl("h2", { text: "Sync Settings" });

    new Setting(containerEl)
      .setName("Notes folder location")
      .setDesc("Synced notes will be saved in the selected Obsidian folder.")
      .addSearch((cb) => {
        new FolderSuggest(this.app, cb.inputEl);
        cb.setPlaceholder("Example: folder1/folder2")
          .setValue(this.plugin.settings.synced_notes_folder)
          .onChange(async (new_folder) => {
            this.plugin.settings.synced_notes_folder = new_folder;
            await this.plugin.saveSettings();
          });
        // @ts-ignore
        cb.containerEl.addClass("folder_suggest_input");
      });

    new Setting(containerEl)
      .setName("Download audio files")
      .setDesc("Audio files are stored by Goldfish for 7 days. Newly synced Goldfish notes older than this will not have the audio file downloaded.")
      .addToggle((tog) =>
        tog
          .setValue(this.plugin.settings.download_audio_files)
          .onChange(async (val) => {
            this.plugin.settings.download_audio_files = val;
            if (val) {
              // Add ${audio_file_embed} to the start of the note_template
              const template = this.plugin.settings.note_template;
              const yamlMatch = template.match(/^---\n[\s\S]*?\n---\n?/);
              if (yamlMatch) {
                this.plugin.settings.note_template = `${yamlMatch[0]}${'\${audio_file_embed}\n'}${template.slice(yamlMatch[0].length)}`;
              } else {
                this.plugin.settings.note_template = `\${audio_file_embed}\n${template}`;
              }
              new Notice(`The embed has been added at the start of the note template. Feel free to customize it further.`);
            } else {
              // Remove ${audio_file_embed} from the note_template
              this.plugin.settings.note_template = this.plugin.settings.note_template.replace(/\${audio_file_embed}\n?/, '');
              new Notice(`The embed has been removed from the note template.`);
            }
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Attachments folder location")
      .setDesc("Goldfish note audio files will be saved in the selected Obsidian folder.")
      .addSearch((cb) => {
        new FolderSuggest(this.app, cb.inputEl);
        cb.setPlaceholder("Example: folder1/folder2")
          .setValue(this.plugin.settings.attachments_folder)
          .onChange(async (new_folder) => {
            this.plugin.settings.attachments_folder = new_folder;
            await this.plugin.saveSettings();
          });
        // @ts-ignore
        cb.containerEl.addClass("folder_suggest_input");
      });

    new Setting(containerEl)
      .setName("Sync notes automatically")
      .setDesc("Automatically sync notes from Goldfish to Obsidian on Obsidian startup, then automatically every 30 minutes. When unchecked, notes only sync when manually running “Goldfish Notes Sync: Sync Notes with Goldfish Notes” command from Command Palette.")
      .addToggle((tog) =>
        tog
          .setValue(this.plugin.settings.sync_on_startup)
          .onChange(async (val) => {
            this.plugin.settings.sync_on_startup = val;
            if (val) {
              this.plugin.autoSync();
            } else {
              this.plugin.disableAutoSync();
            }
            await this.plugin.saveSettings();
          })
      );

    const syncTypeDescription = document.createDocumentFragment();
    syncTypeDescription.append(
      'Notes sync is always one-way from Goldfish to Obsidian.',
      containerEl.createEl('br'),
      containerEl.createEl('br'),
      containerEl.createEl('strong', { text: 'Sync and overwrite:' }),
      ' New and updated notes in Goldfish will be synced to Obsidian. Synced notes edited in Obsidian will be overwritten by Goldfish versions on next sync unless moved out of synched notes folder.',
      containerEl.createEl('br'),
      containerEl.createEl('br'),
      containerEl.createEl('strong', { text: 'Sync new only:' }),
      ' Only new notes will be synced from Goldfish to Obsidian, but existing synced notes in Obsidian synced folder will not be modified.',
      containerEl.createEl('br'),
      containerEl.createEl('br'),
      containerEl.createEl('strong', { text: 'Sync and delete:' }),
      ' Notes synced from Goldfish to Obsidian will be deleted from Goldfish.'
    );

    new Setting(containerEl)
      .setName("Sync type")
      .setDesc(syncTypeDescription)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("one-way-overwrite", "Sync and overwrite")
          .addOption("one-way-new-only", "Sync new only")
          .addOption("one-way-delete", "Sync and delete")
          .setValue(this.plugin.settings.sync_type)
          .onChange(async (value) => {
            this.plugin.settings.sync_type = value;
            if (value.contains("two-way")) {
              noteTemplateComponent.inputEl.setAttr("disabled", true);
              this.plugin.settings.note_template = DEFAULT_SETTINGS.note_template;
              this.display();
            } else {
              noteTemplateComponent.inputEl.removeAttribute("disabled");
            }
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h2", { text: "Note Templating Options" });
    new Setting(containerEl)
      .setName("Title Template")
      .setDesc(
        "Customize how synced note titles are displayed in Obsidian. ${title} references the title synched from Goldfish. When a note doesn't have a title, it will resort to the note content (if auto-generate option is enabled), and lastly Note ID.",
      )
      .addText((text) => {
        const errorTitleTemplate = containerEl.createEl("div", {
          cls: "setting-item-description",
          text: "",
        });
        errorTitleTemplate.style.display = "none";

        text
          .setPlaceholder("Enter title format")
          .setValue(this.plugin.settings.title_template)
          .onChange(async (value: string) => {
            if (isValidTitle(value)) {
              errorTitleTemplate.style.display = "none";
              text.inputEl.removeClass("invalid-input");
              this.plugin.settings.title_template = value;
              await this.plugin.saveSettings();
            } else {
              errorTitleTemplate.style.display = "block";
              errorTitleTemplate.style.color = "red";
              errorTitleTemplate.style.paddingBottom = "12px";
              errorTitleTemplate.innerText = "Invalid characters in title template";
              text.inputEl.addClass("invalid-input");
            }
          });
      });

    new Setting(containerEl)
      .setName("Note Template")
      .setDesc("Customize how synced note content is displayed in Obsidian.");
    new Setting(containerEl)
      .setHeading()
      .addTextArea((t) => {
        noteTemplateComponent = t;
        const errorNoteTemplate = containerEl.createEl("div", {
          cls: "setting-item-description",
          text: "",
        });
        errorNoteTemplate.style.display = "none";

        t.setValue(this.plugin.settings.note_template).onChange(
          async (val: string) => {
            const error = this.processFrontmatter(val);
            if (error) {
              errorNoteTemplate.style.display = "block";
              errorNoteTemplate.style.color = "red";
              errorNoteTemplate.innerText = error;
              t.inputEl.style.borderColor = "red";
            } else {
              errorNoteTemplate.style.display = "none";
              t.inputEl.style.borderColor = "";
              this.plugin.settings.note_template = val;
              await this.plugin.saveSettings();
            }
          },
        );

        t.inputEl.setAttr("rows", 10);
        t.inputEl.addClass("note_template");
        if (this.plugin.settings.sync_type.contains("two-way")) {
          t.inputEl.setAttr("disabled", true);
        }
      })
      .addExtraButton((cb) => {
        cb.setIcon("sync")
          .setTooltip("Refresh template")
          .onClick(() => {
            this.plugin.settings.note_template = DEFAULT_SETTINGS.note_template;
            this.plugin.saveSettings();
            this.display();
          });
      });
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Change the way the date variables will be formatted.")
      .addText((text) => {
        const descEl = containerEl.createEl("div");
        createTextWithLinks(
          "For formatting options, see: https://momentjs.com/docs/#/displaying/",
          descEl
        );
        descEl.className = "muted-text";
        text
          .setPlaceholder("Enter date format")
          .setValue(this.plugin.settings.date_format)
          .onChange(async (value) => {
            this.plugin.settings.date_format = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h2", { text: "Other Settings" });
    new Setting(containerEl)
      .setName("Auto-generate note title")
      .setDesc("Generate a title based on note content if Goldfish note title is missing.")
      .addToggle((tog) =>
        tog
          .setValue(this.plugin.settings.auto_generate_title)
          .onChange(async (val) => {
            this.plugin.settings.auto_generate_title = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Notes filter text")
      .setDesc(
        "Notes from Goldfish will be synced to Obsidian if the title or content includes the specified text.",
      )
      .addText((text) =>
        text
          .setPlaceholder("ex. #work")
          .setValue(this.plugin.settings.notes_filter)
          .onChange(async (value) => {
            this.plugin.settings.notes_filter = value;
            await this.plugin.saveSettings();
          })
      );

  }
}
