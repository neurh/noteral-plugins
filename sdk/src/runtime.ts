/**
 * The code that runs inside every plugin frame. The app injects it before the
 * plugin's own code (as `window.Noteral`), so a plugin bundle never ships its
 * own copy — `@noteral/sdk` only re-exports what lives here.
 *
 * It speaks protocol 2 to the host and still runs SDK 1.x plugins
 * (`Noteral.definePlugin(setup)`) unchanged.
 */
import type { NoteralApp, NoteralEventMap, NoteralEventName } from "./api.generated";
import type {
  EditorSnapshot,
  PanelAction,
  PluginManifest,
  StatusOptions,
} from "./types";

export const SDK_VERSION = "2.0.0";

type Json = Record<string, unknown>;
type Disposer = () => void;

/** An error returned by the app. `code` says why. */
export class NoteralError extends Error {
  readonly code: "unknown_method" | "not_allowed" | "permission" | "invalid_params" | "cancelled" | "failed" | "timeout";
  constructor(message: string, code: NoteralError["code"] = "failed") {
    super(message);
    this.name = "NoteralError";
    this.code = code;
  }
}

// ── transport ───────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 60_000;
let protocol: 1 | 2 = 2;
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();

function post(message: Json) {
  window.parent.postMessage({ __noteral: protocol, ...message }, "*");
}

/** Calls any App API method by name, e.g. `call("editor.getMarkdown", {})`. */
export function call<T = unknown>(method: string, params: Json = {}): Promise<T> {
  const requestId = `req_${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new NoteralError(`Noteral did not answer ${method} in time.`, "timeout"));
    }, REQUEST_TIMEOUT);
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
    post({ type: "request", requestId, method, params });
  });
}

function makeApp(): NoteralApp {
  const namespaces = new Map<string, unknown>();
  return new Proxy({} as NoteralApp, {
    get(_target, namespace) {
      if (typeof namespace !== "string" || namespace === "then") return undefined;
      let proxy = namespaces.get(namespace);
      if (!proxy) {
        proxy = new Proxy({}, {
          get(_inner, method) {
            if (typeof method !== "string" || method === "then") return undefined;
            return (params?: Json) => call(`${namespace}.${method}`, params ?? {});
          },
        });
        namespaces.set(namespace, proxy);
      }
      return proxy;
    },
  });
}

/** The App API. Every method takes one params object and returns a promise. */
export const app: NoteralApp = makeApp();

// ── events and commands ─────────────────────────────────────────────────────

const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
const commandHandlers = new Map<string, () => unknown>();

function onEvent(event: string, handler: (data: unknown) => void): Disposer {
  let set = eventHandlers.get(event);
  if (!set) {
    set = new Set();
    eventHandlers.set(event, set);
    post({ type: "subscribe", event });
  }
  set.add(handler);
  return () => {
    const current = eventHandlers.get(event);
    if (!current?.delete(handler) || current.size) return;
    eventHandlers.delete(event);
    post({ type: "unsubscribe", event });
  };
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  post({ type: "error", message: message.slice(0, 400) });
}

// ── the Plugin base class ───────────────────────────────────────────────────

export interface CommandDefinition {
  /** Local id, unique within the plugin (letters, digits, `.`, `-`, `_`). */
  id: string;
  title: string;
  description?: string;
  /** Extra words the command palette matches on. */
  keywords?: string;
  run: () => unknown | Promise<unknown>;
}

export interface PanelContent {
  title?: string;
  markdown: string;
  actions?: PanelAction[];
}

/**
 * Extend this class and pass it to `register`. Everything added with the
 * `add*` / `register*` helpers is removed automatically on unload.
 */
export class Plugin {
  /** The App API (same object as the `app` export). */
  readonly app: NoteralApp = app;
  /** This plugin's manifest.json. */
  readonly manifest: PluginManifest;
  private disposers: Disposer[] = [];
  private panelHandlers = new Map<string, (actionId: string) => unknown>();
  private panelSubscription: Disposer | null = null;

  constructor(manifest: PluginManifest) {
    this.manifest = manifest;
  }

  /** Called once when the plugin starts. Set things up here. */
  onload(): void | Promise<void> {}

  /** Called before the plugin stops (disabled, updated or uninstalled). */
  onunload(): void | Promise<void> {}

  /** Runs `fn` on unload. */
  register(fn: Disposer): void {
    this.disposers.push(fn);
  }

  /**
   * Adds a command to the command palette. Commands declared in
   * manifest.json only need a handler: `addCommand({ id, title, run })` with
   * the same id works for both.
   */
  addCommand(command: CommandDefinition): void {
    const declared = this.manifest.contributes?.commands?.some((item) => item.id === command.id);
    commandHandlers.set(command.id, command.run);
    if (!declared) {
      void call("commands.register", {
        id: command.id,
        title: command.title,
        description: command.description,
        keywords: command.keywords,
      }).catch(reportError);
    }
    this.register(() => {
      commandHandlers.delete(command.id);
      if (!declared) void call("commands.unregister", { id: command.id }).catch(() => undefined);
    });
  }

  /** Subscribes to an app event until the plugin unloads. */
  registerEvent<E extends NoteralEventName>(event: E, handler: (data: NoteralEventMap[E]) => void): Disposer {
    const dispose = onEvent(event, handler as (data: unknown) => void);
    this.register(dispose);
    return dispose;
  }

  /** `setInterval` that is cleared on unload. */
  registerInterval(fn: () => void, ms: number): number {
    const id = window.setInterval(() => {
      try {
        fn();
      } catch (error) {
        reportError(error);
      }
    }, Math.max(250, ms));
    this.register(() => window.clearInterval(id));
    return id;
  }

  /** Shows text in a status-bar item (needs `ui.status`). Empty text hides it. */
  setStatus(itemId: string, text: string, options: StatusOptions = {}): Promise<void> {
    return call("ui.setStatus", { itemId, text, title: options.title });
  }

  /** Shows Markdown and buttons in an inspector panel (needs `ui.panel`). */
  setPanel(panelId: string, content: PanelContent | string): Promise<void> {
    const panel = typeof content === "string" ? { markdown: content } : content;
    return call("ui.setPanel", { panelId, title: panel.title, markdown: panel.markdown, actions: panel.actions ?? [] });
  }

  /** Runs `handler(actionId)` when a button in one of this plugin's panels is pressed. */
  onPanelAction(panelId: string, handler: (actionId: string) => unknown): void {
    this.panelHandlers.set(panelId, handler);
    if (!this.panelSubscription) {
      this.panelSubscription = this.registerEvent("panel:action", (data) => {
        const run = this.panelHandlers.get(data.panelId);
        if (run) Promise.resolve().then(() => run(data.actionId)).catch(reportError);
      });
    }
  }

  /**
   * Runs `handler(name, payload, view)` when one of this plugin's HTML views calls
   * `noteral.post(name, payload)`. Reply with `this.app.views.post({ name, payload, view })`.
   */
  onViewMessage(handler: (name: string, payload: unknown, view: string) => unknown): Disposer {
    return this.registerEvent("view:message", (data) => {
      Promise.resolve()
        .then(() => handler(data.name, data.payload, data.view))
        .catch(reportError);
    });
  }

  /** Adds CSS to the app (needs `ui.styles`). Removed on unload. */
  addStyles(css: string): Promise<void> {
    return call("ui.addStyles", { css });
  }

  /** Shows a toast. */
  notify(message: string, kind: "info" | "success" | "error" = "info"): Promise<void> {
    return call("ui.notify", { message, kind });
  }

  /** Reads this plugin's saved settings (needs `settings.read`). */
  loadData<T extends Json = Json>(): Promise<T> {
    return call<T>("settings.get", {});
  }

  /** Merges `patch` into this plugin's saved settings (needs `settings.write`). */
  saveData<T extends Json = Json>(patch: Partial<T>): Promise<T> {
    return call<T>("settings.set", { patch });
  }

  /** @internal */
  async __unload() {
    try {
      await this.onunload();
    } catch (error) {
      reportError(error);
    }
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        // keep unloading
      }
    }
  }
}

export type PluginClass = new (manifest: PluginManifest) => Plugin;

// ── SDK 1.x context (definePlugin) ──────────────────────────────────────────

type Setup = (context: LegacyContext) => void | Promise<void>;

/** The context object passed to `definePlugin` (SDK 1.x API, still supported). */
export interface LegacyContext {
  readonly manifest: PluginManifest;
  readonly app: NoteralApp;
  readonly commands: { on(commandId: string, handler: () => unknown): Disposer };
  readonly status: { set(itemId: string, text: string, title?: string): void };
  readonly panels: { set(panelId: string, text: string): void };
  readonly editor: { snapshot(): Promise<EditorSnapshot>; insertBlocks(blocks: unknown[]): Promise<void> };
  readonly blocks: { insert(blocks: unknown[]): Promise<void> };
  readonly pages: { list(): Promise<unknown[]>; get(pageId: string): Promise<unknown> };
  readonly workspaces: { list(): Promise<unknown[]>; current(): Promise<unknown> };
  readonly tabs: { list(): Promise<unknown[]>; open(pageId: string): Promise<void> };
  readonly navigation: { openPage(pageId: string): Promise<void> };
  readonly search: { query(text: string): Promise<unknown[]> };
  readonly assets: { pickImage(): Promise<string | null>; pickFile(): Promise<string | null> };
  readonly settings: { get(): Promise<Json>; set(patch: Json): Promise<Json> };
  readonly events: { on(event: string, handler: (data: unknown) => void): Disposer };
  readonly ui: { notify(message: string): void };
}

function legacyContext(manifest: PluginManifest): LegacyContext {
  const status = (itemId: string, text: string, title?: string) => {
    if (protocol === 1) post({ type: "status", itemId, text: String(text).slice(0, 160), title });
    else void call("ui.setStatus", { itemId, text: String(text).slice(0, 160), title }).catch(reportError);
  };
  const panel = (panelId: string, text: string) => {
    if (protocol === 1) post({ type: "panel", panelId, text: String(text).slice(0, 4000) });
    else void call("ui.setPanel", { panelId, markdown: String(text).slice(0, 4000) }).catch(reportError);
  };
  const insertBlocks = (blocks: unknown[]) => call<void>("editor.insertBlocks", { blocks });
  const openPage = (pageId: string) => call<void>("navigation.openPage", { pageId });
  return {
    manifest,
    app,
    commands: {
      on(commandId, handler) {
        commandHandlers.set(commandId, handler);
        return () => commandHandlers.delete(commandId);
      },
    },
    status: { set: status },
    panels: { set: panel },
    editor: { snapshot: () => call("editor.snapshot"), insertBlocks },
    blocks: { insert: insertBlocks },
    pages: { list: () => call("pages.list"), get: (pageId) => call("pages.get", { pageId }) },
    workspaces: { list: () => call("workspaces.list"), current: () => call("workspaces.current") },
    tabs: { list: () => call("tabs.list"), open: openPage },
    navigation: { openPage },
    search: { query: (text) => call("search.query", { query: text }) },
    assets: { pickImage: () => call("assets.pickImage"), pickFile: () => call("assets.pickFile") },
    settings: { get: () => call("settings.get"), set: (patch) => call("settings.set", { patch }) },
    events: { on: onEvent },
    ui: {
      notify(message) {
        void call("ui.notify", { message }).catch(() => undefined);
      },
    },
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────

let entry: { kind: "class"; value: PluginClass } | { kind: "setup"; value: Setup } | null = null;
let manifest: PluginManifest | null = null;
let instance: Plugin | null = null;
let started = false;

async function start() {
  if (started || !entry || !manifest) return;
  started = true;
  try {
    if (entry.kind === "class") {
      instance = new entry.value(manifest);
      await instance.onload();
    } else {
      await entry.value(legacyContext(manifest));
    }
    post({ type: "ready" });
  } catch (error) {
    reportError(error);
    // Still report ready so the host doesn't flag a start timeout on top.
    post({ type: "ready" });
  }
}

/** Registers the plugin class. Call once at the end of your main file. */
export function register<T extends PluginClass>(PluginType: T): T {
  if (entry) throw new Error("A plugin can only register once.");
  entry = { kind: "class", value: PluginType };
  void start();
  return PluginType;
}

/** SDK 1.x entry point. Prefer `register(class extends Plugin { ... })`. */
export function definePlugin(setup: Setup): void {
  if (entry) throw new Error("A plugin can only register once.");
  entry = { kind: "setup", value: setup };
  void start();
}

async function shutdown() {
  const current = instance;
  instance = null;
  if (current) await current.__unload();
  for (const item of pending.values()) {
    window.clearTimeout(item.timer);
    item.reject(new NoteralError("The plugin stopped.", "cancelled"));
  }
  pending.clear();
}

async function runCommand(commandId: string, requestId: string) {
  const handler = commandHandlers.get(commandId);
  try {
    if (!handler) throw new Error(`No handler for command "${commandId}".`);
    await handler();
    post({ type: "commandResult", requestId, ok: true });
  } catch (error) {
    post({ type: "commandResult", requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent) return;
  const data = event.data as Json | null;
  if (!data || (data.__noteral !== 1 && data.__noteral !== 2)) return;
  switch (data.type) {
    case "init":
      protocol = data.__noteral as 1 | 2;
      manifest = data.manifest as PluginManifest;
      void start();
      return;
    case "command":
      void runCommand(String(data.commandId), String(data.requestId));
      return;
    case "event": {
      const handlers = eventHandlers.get(String(data.event));
      if (!handlers) return;
      for (const handler of Array.from(handlers)) {
        try {
          handler(data.data);
        } catch (error) {
          reportError(error);
        }
      }
      return;
    }
    case "response": {
      const item = pending.get(String(data.requestId));
      if (!item) return;
      pending.delete(String(data.requestId));
      window.clearTimeout(item.timer);
      if (data.ok) item.resolve(data.result ?? undefined);
      else item.reject(new NoteralError(String(data.error ?? "Request failed"), (data.code as NoteralError["code"]) ?? "failed"));
      return;
    }
    case "shutdown":
      void shutdown();
      return;
  }
}

export interface NoteralGlobal {
  version: string;
  app: NoteralApp;
  Plugin: typeof Plugin;
  NoteralError: typeof NoteralError;
  register: typeof register;
  definePlugin: typeof definePlugin;
  call: typeof call;
}

if (typeof window !== "undefined" && !(window as unknown as { Noteral?: NoteralGlobal }).Noteral) {
  (window as unknown as { Noteral: NoteralGlobal }).Noteral = { version: SDK_VERSION, app, Plugin, NoteralError, register, definePlugin, call };
  window.addEventListener("message", onMessage);
  window.addEventListener("error", (event) => reportError(event.message || "Plugin script error"));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason ?? "Unhandled promise rejection"));
}
