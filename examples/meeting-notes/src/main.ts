import { Plugin, register } from "@noteral/sdk";

function today() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function template() {
  return [
    `**Date:** ${today()}`,
    "",
    "### Attendees",
    "- ",
    "",
    "### Agenda",
    "1. ",
    "",
    "### Decisions",
    "",
    "### Action items",
    "- [ ] Owner — action — due date",
  ].join("\n");
}

class MeetingNotes extends Plugin {
  onload() {
    this.addCommand({
      id: "insert-meeting-notes",
      title: "Insert meeting notes template",
      run: async () => {
        await this.app.editor.insertMarkdown({ markdown: `## Meeting notes\n\n${template()}` });
        await this.notify("Meeting notes template inserted", "success");
      },
    });
    this.addCommand({
      id: "new-meeting-page",
      title: "New meeting page",
      run: async () => {
        const title = `Meeting — ${new Date().toISOString().slice(0, 10)}`;
        await this.app.pages.create({ title, markdown: template(), open: true });
      },
    });
  }
}

register(MeetingNotes);
