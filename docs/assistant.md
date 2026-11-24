# Assistant

The assistant is an AI chat in the right sidebar (**Ctrl/⌘ J**, or the chat icon in the top bar). It reads and edits your notes, searches and reads the web, and in Creator mode it changes the app itself: theme, layout, component styles, preferences, and new plugins. It uses the same App API as plugins, so anything the [SDK](sdk/api-reference.md) can do, the assistant can do, within the limits of its mode.

## Providers

Connect a model under **Assistant → Settings** (the sliders icon). You bring your own key, or run a model locally:

| Preset | Notes |
| --- | --- |
| Anthropic | Claude models via the Messages API |
| OpenAI | Chat Completions API |
| Google Gemini | AI Studio keys include a free tier |
| OpenRouter | Hundreds of models behind one key, including free `:free` models |
| Groq, Mistral, DeepSeek, xAI, Together AI | OpenAI-compatible endpoints |
| Ollama, LM Studio | Local, free, private; no key |
| Custom | Any OpenAI-compatible server (set the base URL, e.g. `http://localhost:8000/v1`) |

- Keys are stored only on this computer, in `<data dir>/ai/providers.json` (file mode `0600`). The UI only ever sees a hint (`sk-…a1b2`), never the key.
- Requests go from the app's backend straight to the provider. Noteral has no server in between.
- **Load models** asks the provider for its model list. You can also type any model id in the model picker.

## Modes

The three-way switch in the composer decides which tools the model gets. The model can't call a tool that isn't sent to it, and the host checks the tier again on every call.

| Mode | Tools | Use it for |
| --- | --- | --- |
| **Ask** | read-only: pages, blocks, selection, databases, search, backlinks, layout and appearance info, web search/fetch | questions, summaries, research |
| **Edit** | Ask + content: write and restructure pages, insert/replace blocks, create and fill databases, open and close pages | drafting, rewriting, reorganizing |
| **Creator** | Edit + app: theme tokens, component styles, custom CSS, layout, preferences, commands, workspaces, **create plugins** | making Noteral yours |

### Approvals

Under *Settings → Behaviour → Ask before*:

- **Destructive actions only** (default): moving pages to the trash, switching or creating workspaces, resetting the appearance, and installing a generated plugin wait for an approval card in the chat.
- **Every change**: every non-read call waits for approval. *Allow for this chat* skips the question for that tool until you start a new chat. Destructive actions always ask.

Press **Esc** or the stop button to stop at any point. Tools that haven't run are marked as not run, and nothing half-finished is retried.

### Creator mode and plugins

In Creator mode the assistant can build interface as well as change settings: right-sidebar tabs (stacked in split groups), status-bar widgets, custom editor blocks, custom page types in the tree, Home views with HTML widgets and custom CSS, database views, filters, sorts and properties. These are the same methods plugins use, described in [Extending the interface](plugins/ui.md).

When it writes a plugin with `plugins.create`, the assistant first runs it in a throwaway sandbox with `plugins.test`. If it throws or logs errors, the assistant reads the error, fixes the code and tests again. After installing, it checks the plugin's start-up health and reads `plugins.logs` when something fails. You see the name, permissions and size in an approval card. Approving installs it as **Made by assistant**.

### Layers: turning changes on and off

Every chat writes its appearance and interface changes into its own **layer** (`chat:<id>`): tokens, component styles, CSS snippets, sidebar tabs, status widgets, block and page types. *Plugins → Created* lists every layer with a summary. From there you can:

- turn a layer (or all of them) off and on without losing it,
- **Inspect** it: token swatches, each component style and CSS snippet (each can be toggled or removed), and what it added to the interface,
- copy it as JSON, or remove it.

Plugins the assistant made are listed on the same tab. `appearance.reset` (always confirmed) clears a layer or everything.

## The composer

- **@ mentions**: type `@` (or press the @ button) to attach the open page (listed first), other open tabs, any page, database or row, or the current selection. Mentioned content is sent with the message as context. You can also drag things onto the chat to mention them: pages from the tree, tabs, sidebar tabs, editor blocks (the six-dots handle), and database rows or cards.
- **/ commands**: `/new`, `/retry`, `/compact` (summarise the chat so far into a fresh one), `/model`, `/think <level>`, `/web`, `/history`, `/settings`, `/ask`, `/edit`, `/creator`, and prompt shortcuts such as `/summarize`, `/explain`, `/todos`, `/fix`, `/rewrite`, `/translate <language>`, `/outline`, `/table`, `/theme`, `/plugin`, `/widget`, `/home`.
- **Model and thinking**: the model button shows just the model name (the provider is in its tooltip and menu). The thinking chip next to it picks a level (Auto, Off, Low, Medium, High, Max) from the ones the model supports. It is sent as adaptive thinking + effort for current Claude models, a thinking budget for older Claude and Gemini 2.5, `thinkingLevel` for Gemini 3, and `reasoning_effort` for OpenAI reasoning models.
- **Context ring**: shows how much of the model's context window the chat uses, from the provider's own token count plus an estimate for anything added since. Click it for the numbers and a *Compact chat* button.
- **Questions**: with `ui.ask`, the assistant can stop and ask you to choose between options (or type an answer) inside the chat, and then continue.

## Web search and fetch

Both are free and need no API key:

- **`web.search`** queries DuckDuckGo (HTML, then Lite) and falls back to Wikipedia. It returns titles, URLs and snippets, and the chat shows the sources under the tool row.
- **`web.fetch`** downloads a page and extracts the readable text as Markdown (title, description, headings, lists, links), truncated to a character limit. JSON and plain text pass through.
- Both refuse localhost and private network addresses. Turn web access off with the globe button in the composer; the web tools are then not sent to the model at all.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Web access | on | Sends `web.search` / `web.fetch`. |
| Max steps | 24 | Tool-call rounds per reply before the assistant pauses and asks you to continue. |
| Max output tokens | 8192 | Per step. |
| Temperature | provider default | |
| Custom instructions | – | Appended to the system prompt in every mode. |

**Settings → Models** lists the selected model, any you've customised, and the provider's models. For each one you can set the context window (default: what the provider reports, or a known size, otherwise 200k) and which thinking levels the picker offers. **Detect sizes** asks the provider for its context windows.

Chats are saved as JSON in `<data dir>/ai/chats/` and listed under *History*.

## For developers

The assistant is built on the SDK spec, so it never needs its own copy of the API:

- `frontend/src/sdk-host/spec.ts` declares every method once: name, summary, JSON-schema params, return type, permission, `tier` (`read` | `content` | `app`), `callers` (`plugin`, `assistant`) and `confirm`.
- `frontend/src/assistant/tools.ts` turns the methods for a mode into tool definitions. The wire names replace `.` with `__` (`pages.create` → `pages__create`). It runs each call through `callMethod(..., { caller: "assistant" }, { tiers })`, the same path plugins use, without the permission layer but with the tier check.
- **Adding a method to `spec.ts` and `handlers.ts` makes it a plugin API and an assistant tool at once.** `assistant/protocol.test.ts` fails if a method has no handler, a handler has no spec, or a wire name breaks provider naming rules.
- `frontend/src/assistant/protocol.ts` builds request bodies and parses SSE for the three wire formats: OpenAI Chat Completions (also used by every OpenAI-compatible preset), Anthropic Messages (with prompt caching on the system prompt and tools), and Gemini `streamGenerateContent`. The Go side (`internal/ai`) only authenticates, streams raw SSE lines to the UI as `ai:stream` events, and supports cancellation, so adding a provider is mostly a parser change.
- The system prompt (`assistant/prompt.ts`) states the mode's rules, the workspace and open page, and in Creator mode a guide to the appearance tokens and the plugin shape.

### Agents writing code for Noteral

Point coding agents at [`docs/sdk/llms.txt`](sdk/llms.txt) (index plus every method, one line each) or [`docs/sdk/llms-full.txt`](sdk/llms-full.txt) (all guides and the full reference in one file). Both are generated by `npm run plugins:build` from the spec, so they always match the app.
