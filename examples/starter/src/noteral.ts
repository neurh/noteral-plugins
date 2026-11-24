// The SDK is provided by Noteral at runtime as `window.Noteral`, so this file is
// all a standalone plugin repo needs to build. The `import type` is erased by
// esbuild; it only gives you types when `@noteral/sdk` resolves (see README).
import type { NoteralGlobal } from "@noteral/sdk";

const Noteral = (globalThis as unknown as { Noteral: NoteralGlobal }).Noteral;

export const { Plugin, register, app, NoteralError, call } = Noteral;
