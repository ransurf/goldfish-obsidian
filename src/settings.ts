import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  TextAreaComponent,
} from "obsidian";
import GoldfishNotesPlugin from "./main";
import { openInputModal } from "utils";
import SupabaseSync from "supabase_sync";
import grayMatter from "gray-matter";
import { FolderSuggest } from "./settings/FolderSuggester";

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
  sync_type: "one-way-delete",
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
      .setDesc("Synced notes will be added to this folder")
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
      .setDesc("Audio files will be downloaded in the attachments folder specified below. We only store the audio file for 7 days, so notes older than that will not have working links. To add it to the template, use the ${audio_file_embed} variable.")
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
                this.plugin.settings.note_template = `${yamlMatch[0]}${'\n\${audio_file_embed}\n'}${template.slice(yamlMatch[0].length)}`;
              } else {
                this.plugin.settings.note_template = `\${audio_file_embed}\n${template}`;
              }
              new Notice(`The embed has been added at the start of the note template. Feel free to customize it further.`);
            } else {
              // Remove ${audio_file_embed} from the note_template
              this.plugin.settings.note_template = this.plugin.settings.note_template.replace(/\${audio_file_embed}?/, '');
              new Notice(`The embed has been removed from the note template.`);
            }
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Attachments folder location")
      .setDesc("Attachments will be populated here")
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
      .setDesc("Sync will be performed on startup and every 30 minutes")
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

    new Setting(containerEl)
      .setName("Sync type")
      .setDesc("One-way sync + delete will delete notes in Goldfish Notes that are successfully imported into Obsidian.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("one-way", "One-way sync (Goldfish ⇒ Obsidian)")
          .addOption(
            "one-way-delete",
            "One-way sync + Delete",
          )
          // .addOption(
          //   "realtime-one-way",
          //   "Realtime One-way sync (FN ⇒ Obsidian)",
          // )
          // .addOption(
          //   "realtime-two-way",
          //   "Realtime Two-way sync (FN ⇔ Obsidian)",
          // )
          .setValue(this.plugin.settings.sync_type)
          .onChange(async (value) => {
            this.plugin.settings.sync_type = value;
            if (value.contains("two-way")) {
              noteTemplateComponent.inputEl.setAttr("disabled", true);
              this.plugin.settings.note_template =
                DEFAULT_SETTINGS.note_template;
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
        "By default the ${title} variable populates the title in order of: Note title > Note content (if auto-generate option is enabled) > Note ID",
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter title format")
          .setValue(this.plugin.settings.title_template)
          .onChange(async (value: string) => {
            this.plugin.settings.title_template = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Note Template")
      .setDesc("Only editable in one-way sync");
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
      .setDesc(
        "Affected variables: created_date, last_modified_date. For more formatting options, see: https://momentjs.com/docs/#/displaying/",
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter date format")
          .setValue(this.plugin.settings.date_format)
          .onChange(async (value) => {
            this.plugin.settings.date_format = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h2", { text: "Other Settings" });
    new Setting(containerEl)
      .setName("Auto-generate note title")
      .setDesc("When title is missing, will generate based on note content")
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
        "Notes will only be imported if the title/content includes the text",
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
