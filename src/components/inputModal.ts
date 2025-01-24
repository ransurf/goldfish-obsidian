import { App, Modal, Setting } from "obsidian";
import { createTextWithLinks } from "../text";

export interface ModalInputField {
  label: string;
  value: string;
  type?: string | undefined;
}

export interface Values {
  [key: string]: string;
}

export class InputModal extends Modal {
  values: Values;
  title: string;
  description?: string;
  inputs: ModalInputField[];
  submitText: string;
  onSubmit: (results: Values) => Promise<boolean>;

  constructor(
    app: App,
    props: {
      title: string;
      description?: string;
      inputs: ModalInputField[];
      submitText: string;
      onSubmit: (results: Values) => Promise<boolean>;
    },
  ) {
    super(app);
    const { title, description, inputs, submitText, onSubmit } = props;
    this.title = title;
    this.description = description;
    this.inputs = inputs;
    this.submitText = submitText;
    this.onSubmit = onSubmit;
    this.values = {};
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: this.title });

    if (this.description) {
      const descriptionEl = contentEl.createEl("p");
      createTextWithLinks(this.description, descriptionEl);
    }

    for (const input of this.inputs) {
      new Setting(contentEl).setName(input.label).addText((text) => {
        text.onChange((value) => {
          this.values[input.value] = value;
        });
        if (input.type) {
          text.inputEl.type = input.type;
        }
      });
    }

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText(this.submitText)
        .setCta()
        .onClick(async () => {
          const submitResult = await this.onSubmit(this.values);
          if (submitResult) {
            this.close();
          }
        })
    );
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}
