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
export interface GoldfishNotesSettings {
  auto_generate_title: boolean;
  fleeting_notes_folder: string;
  attachments_folder: string;
  note_template: string;
  sync_type: string;
  notes_filter: string;
  sync_on_startup: boolean;
  last_sync_time: Date;
  sync_obsidian_links: boolean;
  sync_obsidian_links_title: string;
  supabaseId: string | undefined;
  email: string | undefined;
  password: string | undefined;
  encryption_key: string;
  sync_interval: NodeJS.Timer | undefined;
  date_format: string;
  title_template: string;
}

export const DEFAULT_SETTINGS: GoldfishNotesSettings = {
  auto_generate_title: true,
  fleeting_notes_folder: "GoldfishNotes",
  attachments_folder: "Attachments",
  note_template: `---
# Optional fields
title: "\${title}"
tags: \${tags}
created_date: "\${created_date}"
modified_date: "\${last_modified_date}"
---
## Cleaned
\${cleaned}

## Original
\${original}`
  ,
  sync_on_startup: false,
  last_sync_time: new Date(0),
  sync_type: "one-way-delete",
  sync_obsidian_links: false,
  sync_obsidian_links_title: "Links from Obsidian",
  notes_filter: "",
  email: undefined,
  password: undefined,
  supabaseId: undefined,
  encryption_key: "",
  sync_interval: undefined,
  date_format: "YYYY-MM-DD",
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
      if (!parsedNote?.data?.id) {
        error = "Note template 'id' field is required";
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
    openInputModal(
      "Login to Goldfish Notes",
      [
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
      "Login",
      async (data) => {
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
            accountSetting.setDesc(`You're currently signed in ${this.plugin.settings.email}`);
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
    );
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

    new Setting(containerEl)
      .setName("Encryption key")
      .setDesc("Encryption key used to encrypt notes")
      .addText((text) => {
        text.setPlaceholder("Enter encryption key")
          .setValue(this.plugin.settings.encryption_key)
          .onChange(async (value) => {
            this.plugin.settings.encryption_key = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    containerEl.createEl("h2", { text: "Sync Settings" });

    new Setting(containerEl)
      .setName("Notes folder location")
      .setDesc("Notes will be populated here")
      .addText((text) =>
        text
          .setPlaceholder("Enter the folder location")
          .setValue(this.plugin.settings.fleeting_notes_folder)
          .onChange(async (value) => {
            this.plugin.settings.fleeting_notes_folder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Attachments folder location")
      .setDesc("Attachments will be populated here")
      .addText((text) =>
        text
          .setPlaceholder("Enter the folder location")
          .setValue(this.plugin.settings.attachments_folder)
          .onChange(async (value: string) => {
            this.plugin.settings.attachments_folder = value;
            await this.plugin.saveSettings();
          })
      );

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
      .addDropdown((dropdown) =>
        dropdown
          .addOption("one-way", "One-way sync (Goldfish ⇒ Obsidian)")
          .addOption(
            "one-way-delete",
            "One-way sync (Goldfish ⇒ Obsidian) + Delete",
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
