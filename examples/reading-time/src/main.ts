import { Plugin, register } from "@noteral/sdk";
import type { EditorSnapshot } from "@noteral/sdk";

interface Settings extends Record<string, unknown> {
  wordsPerMinute: number;
}

class ReadingTime extends Plugin {
  private wpm = 220;
  private last: EditorSnapshot | null = null;

  async onload() {
    const saved = await this.loadData<Settings>();
    if (typeof saved.wordsPerMinute === "number") this.wpm = saved.wordsPerMinute;

    this.registerEvent("document:changed", (snapshot) => this.render(snapshot));
    this.registerEvent("page:opened", async () => this.render(await this.app.editor.snapshot()));
    this.addCommand({ id: "set-speed", title: "Reading Time: set reading speed", run: () => this.askSpeed() });
    this.onPanelAction("reading-stats", (action) => (action === "speed" ? this.askSpeed() : undefined));

    this.render(await this.app.editor.snapshot());
  }

  private async askSpeed() {
    const value = await this.app.ui.prompt({ title: "Reading speed", message: "Words per minute", value: String(this.wpm) });
    const next = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(next) || next < 50 || next > 1000) return;
    this.wpm = next;
    await this.saveData<Settings>({ wordsPerMinute: next });
    this.render(this.last);
  }

  private render(snapshot: EditorSnapshot | null) {
    this.last = snapshot;
    if (!snapshot) {
      void this.setStatus("reading-time", "");
      void this.setPanel("reading-stats", "");
      return;
    }
    const minutes = Math.max(1, Math.round(snapshot.wordCount / this.wpm));
    const words = snapshot.wordCount === 1 ? "1 word" : `${snapshot.wordCount.toLocaleString()} words`;
    void this.setStatus("reading-time", `${words} · ${minutes} min`, { title: `Estimated at ${this.wpm} words per minute` });
    void this.setPanel("reading-stats", {
      markdown: [
        `**${minutes} min** read at ${this.wpm} wpm`,
        "",
        `- ${words}`,
        `- ${snapshot.blockCount} blocks`,
        `- ${snapshot.outline.length} headings`,
      ].join("\n"),
      actions: [{ id: "speed", label: "Change speed" }],
    });
  }
}

register(ReadingTime);
