/**
 * @noteral/sdk — write plugins for Noteral.
 *
 *   import { Plugin, register } from "@noteral/sdk";
 *
 *   class WordGoal extends Plugin {
 *     async onload() {
 *       this.registerEvent("document:changed", (doc) => this.setStatus("goal", `${doc.wordCount} / 500`));
 *     }
 *   }
 *   register(WordGoal);
 *
 * The runtime itself (./runtime.ts) is injected by the app into every plugin
 * frame as `window.Noteral`; this module only re-exports it with types, so
 * bundling it into a plugin costs a few bytes.
 *
 * Docs: docs/plugins/README.md · Reference: docs/sdk/api-reference.md
 */
import type * as Runtime from "./runtime";

export type * from "./types";
export type { NoteralApp, NoteralEventMap, NoteralEventName, Permission } from "./api.generated";
export type { CommandDefinition, LegacyContext, MenuContext, MenuItemDefinition, MenuSlot, NoteralGlobal, PanelContent, PluginClass, SettingField } from "./runtime";
/** SDK 1.x name for the `definePlugin` context. */
export type PluginContext = Runtime.LegacyContext;

function runtime(): Runtime.NoteralGlobal {
  const global = (globalThis as unknown as { Noteral?: Runtime.NoteralGlobal }).Noteral;
  if (!global) throw new Error("@noteral/sdk only runs inside a Noteral plugin frame.");
  return global;
}

const N = runtime();

/** Base class for plugins. Override `onload` and `onunload`. */
export const Plugin: typeof Runtime.Plugin = N.Plugin;
export type Plugin = Runtime.Plugin;

/** Error thrown by App API calls; check `error.code`. */
export const NoteralError: typeof Runtime.NoteralError = N.NoteralError;
export type NoteralError = Runtime.NoteralError;

/** Registers your plugin class. Call once, at the end of main.ts. */
export const register: typeof Runtime.register = N.register;
/** The App API, also available as `this.app` inside a plugin. */
export const app: typeof Runtime.app = N.app;
/** Calls an App API method by name. Prefer the typed `app.*` methods. */
export const call: typeof Runtime.call = N.call;
/** SDK 1.x entry point, still supported. */
export const definePlugin: typeof Runtime.definePlugin = N.definePlugin;
/** Version of the SDK runtime the app injected. */
export const version: string = N.version;
