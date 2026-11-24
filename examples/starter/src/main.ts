import { Plugin, register } from "./noteral";

class Starter extends Plugin {
  async onload() {
    // A command that exists only while the plugin runs (no manifest entry needed).
    this.addCommand({
      id: "say-hello",
      title: "Starter: say hello",
      run: async () => {
        const page = await this.app.editor.getActive();
        await this.notify(page ? `Hello from “${page.title}”` : "Hello from Home");
      },
    });

    // React to edits in the open page (needs editor.read).
    this.registerEvent("document:changed", (doc) => {
      void this.setStatus("blocks", `${doc.blockCount} blocks`);
    });

    // A sidebar panel with a button.
    await this.setPanel("hello", {
      markdown: "Edit `examples/starter/src/main.ts`, run `npm run plugins:build`, then reload the plugin.",
      actions: [{ id: "hello", label: "Say hello" }],
    });
    this.onPanelAction("hello", () => this.notify("Panel button pressed"));
  }

  onunload() {
    // Commands, events and panels are cleaned up automatically.
  }
}

register(Starter);
