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
- **Load models** asks the provider for its model list and shows it as a list in the provider editor. Click a model to make it the default. Its pencil opens **model options**: display name, context window, max reply tokens, temperature, whether it reads images and PDFs (*Auto* guesses from the model id), which thinking levels the picker offers, and whether it shows in the model picker. *Reset* goes back to the detected values. You can also add any model id by hand.

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

The approval card names the action in plain words, shows its arguments as fields (with the raw JSON one click away), and is drawn in red for destructive calls. **Allow**, **Always in this chat** and **Decline** are all one click; **Esc** declines. While a card is waiting, the reply's header says *Waiting for you*.

## How a reply reads

Work and answer are kept apart:

- **Timeline.** Thinking, tool calls and agents appear as steps in one compact timeline at the top of the reply, each one sliding in as it starts. Runs of the same tool are folded ("Read 5 pages", "Searched notes 3 times"). The header shows a live label and timer while the assistant works, then collapses to *Worked for 42s · 9 steps · 2 agents · 11 sources*. Click it to reopen. Long runs show the latest six steps with an *earlier steps* toggle, and each step opens to show its arguments and result.
- **Thinking.** A live thinking step streams the last lines of the model's reasoning with its own timer. Before the first token there is a small thinking loader.
- **Answer.** The final text is rendered on its own as Markdown (tables, code, links), below the timeline.
- **Changes.** If the reply changed anything (pages created, blocks rewritten, styles set, plugins installed), a *Changes* list follows the answer, with links to the pages it touched.
- **Sources.** Every web page the assistant searched or read is listed as a source card (pages it actually read come first), with the site and title. Search steps show the hosts as chips.

### When a request fails

- **Automatic retry.** If a stream fails for a passing reason (connection lost or timed out, provider rate-limited, overloaded or returning a 5xx, or a stream that ends empty), the same request is sent again after *Seconds between retries*, up to *Retry failed requests* times. The reply shows the countdown ("Connection lost — retrying in 8s (retry 1 of 3)") with **Retry now**; **Stop** cancels the wait. Stopping, bad requests (400/401/403/404, invalid keys, context too long, blocked content) and the output limit are never retried. Sub-agents and compaction summaries retry the same way.
- **Retry.** When a reply failed or was stopped after finishing some steps, **Retry** continues from the last step: finished tool calls and the text and thinking before them are kept, the failed step (and any calls that never ran) is dropped, and the model picks up from there. **Start over** (or **Regenerate**, when there is nothing to keep) runs the reply again from your message. `/retry` continues when it can.

## Sub-agents

For broad research the assistant can start **sub-agents** with `agents.run({ title, task })`. Each agent is a separate, read-only run of the same model with its own short context: it can read and search your pages and databases and use the web, but it can't change anything, open UI or ask you questions. Several agents run at the same time (up to *Run at once*, default 4), and each appears in the timeline as a card with its title, timer, current activity and progress. When they finish, the assistant combines their reports into one answer. Agents are limited to 12 steps each.

## Editing what's already there

The assistant changes existing things with small find-and-replace edits instead of rewriting them:

- **Pages**: `pages.edit({ pageId, edits: [{ find, replace, all? }] })`. Only the blocks an edit touches are replaced in an open page; the rest keep their ids, and one undo reverts the edit.
- **Things it built**: `source.list` lists the HTML/CSS behind sidebar tabs, status widgets, block and page types, Home widgets and views, CSS snippets and component styles. `source.get` reads one (or a line range), and `source.edit` patches it.
- **Plugins**: `plugins.edit({ id, file: "code" | "styles", edits })` patches a plugin's code, tests it in the sandbox, bumps the patch version and reinstalls it after your approval.

Each `find` must match once (whitespace differences are tolerated). If any edit misses, nothing changes and the error points at the closest line.

**Databases** take rows in bulk: `databases.addRows` adds up to 500 rows in one transaction, and `databases.updateRows` changes up to 500 rows in one call.

**Databases in pages**: `databases.embed` adds a database to a page, either a link to an existing database or a new one created inside the page. When the assistant reads a page, an embedded database appears as a `<!-- database:<id> Title -->` line (custom blocks as `<!-- block:<id> kind -->`), so edits keep them in place. The assistant can also build chart and custom views, nested and/or filters, formula properties (checked before they are saved) and choose how rows open; see [Databases](plugins/ui.md#databases).

## Token efficiency

- **Tools on demand** (*Settings → Behaviour → Load tools on demand*, on by default). Each request sends a small core set of tools for the mode (reading, editing, databases, web, source) plus `tools.load`. The system prompt lists the rest as a one-line-per-namespace catalog, and the model loads what it needs ("home", "databases.addView"). Loaded tools stay for the rest of the chat. In Creator mode this sends roughly a quarter of the tool schema.
- **Lean history.** Long tool results from earlier turns are cut to their first 1,200 characters, with a note that the model can call the tool again. Images and PDFs are only resent for the last three messages. The saved chat keeps everything.
- **Prompt caching.** On Anthropic, the system prompt, tools and the conversation so far are marked cacheable, so each step re-reads them at the cache rate.
- **Auto-compact** (*Settings → Behaviour*, default **80%**). When a chat fills that share of the model's context window, the messages before your latest one are summarized in place. A divider (*Auto-compacted 14 messages*) marks where it happened and opens to show the summary. Only the summary and later messages are sent from then on. `/compact` or *Compact chat* does the same by hand. Set the switch off to disable it.

Independent read-only tool calls in one turn (several page reads, searches) also run in parallel; anything that changes the app runs one at a time, in order.

## Many chats at once

A reply keeps running when you switch to another chat or start a new one, so several chats can work at the same time. *History* marks chats that are working or waiting for you.

The **ledger** button in the panel header (a badge counts other running chats) opens:

- **Running**: every chat that is working, with buttons to open or stop it,
- **This chat**: steps, changes, agents and sources so far, time spent and tokens used,
- the agents it ran and the last changes it made.

The context ring in the composer opens a **context window** breakdown: a segmented bar for the system prompt, your messages, replies, tool results, mentions and the draft, how much is free, and *Compact chat*.

### Creator mode and plugins

In Creator mode the assistant can build interface as well as change settings: right-sidebar tabs (stacked in split groups), status-bar widgets, custom editor blocks, custom page types in the tree, Home views with HTML widgets and custom CSS, database views, filters, sorts and properties. These are the same methods plugins use, described in [Extending the interface](plugins/ui.md).

While it writes plugin code, the assistant looks things up with `plugins.docs`: sections of the [plugin guide](plugins/README.md) by topic, any method or namespace in the API reference (including plugin-only ones such as `storage`, suggesters and popovers, which it has no tools for) and the API's type definitions. The guide is built into the app from `docs/plugins/*.md` by `scripts/build-sdk.mjs`, so it always matches the SDK version.

When it writes a plugin with `plugins.create`, the assistant first runs it in a throwaway sandbox with `plugins.test`. If it throws or logs errors, the assistant reads the error, fixes the code and tests again. After installing, it checks the plugin's start-up health and reads `plugins.logs` when something fails. You see the name, permissions and size in an approval card. Approving installs it as **Made by assistant**.

### Layers: turning changes on and off

Every chat writes its appearance and interface changes into its own **layer** (`chat:<id>`): tokens, component styles, CSS snippets, sidebar tabs, status widgets, block and page types. *Plugins → Created* lists every layer with a summary. From there you can:

- turn a layer (or all of them) off and on without losing it,
- **Inspect** it: token swatches, each component style and CSS snippet (each can be toggled or removed), and what it added to the interface,
- copy it as JSON, or remove it.

Plugins the assistant made are listed on the same tab. `appearance.reset` (always confirmed) clears a layer or everything.

## The composer

- **@ mentions**: type `@` (or press the @ button) to attach the open page (listed first), other open tabs, any page, database or row, or the current selection. Mentioned content is sent with the message as context. You can also drag things onto the chat to mention them: pages from the tree, tabs, sidebar tabs, editor blocks (the six-dots handle), and database rows or cards.
- **Files**: the **+** button (or paste, or drag from your computer) attaches images, PDFs and text or code files, up to 8 per message. Images are downscaled to 1568 px. Text files are sent as text. Images and PDFs go to the model as native image/document parts. If the model can't read them (see its options), only their names are sent and the chip shows a warning.
- **/ commands**: `/new`, `/retry`, `/compact` (summarise the chat so far, in place), `/model`, `/think <level>`, `/web`, `/history`, `/settings`, `/ask`, `/edit`, `/creator`, and prompt shortcuts such as `/summarize`, `/explain`, `/todos`, `/fix`, `/rewrite`, `/translate <language>`, `/outline`, `/table`, `/theme`, `/plugin`, `/widget`, `/home`.
- **Model and thinking**: the model button shows just the model name (the provider is in its tooltip and menu). The thinking chip next to it picks a level (Auto, Off, Low, Medium, High, Max) from the ones the model supports. It is sent as adaptive thinking + effort for current Claude models, a thinking budget for older Claude and Gemini 2.5, `thinkingLevel` for Gemini 3, and `reasoning_effort` for OpenAI reasoning models.
- **Context ring**: shows how much of the model's context window the chat uses, from the provider's own token count plus an estimate for anything added since. Click it for the numbers and a *Compact chat* button.
- **Questions**: with `ui.ask`, the assistant can stop and ask you to choose between options (or type an answer) inside the chat, and then continue.

## Web search and fetch

Both are free and need no API key:

- **`web.search`** queries DuckDuckGo (HTML, then Lite) and falls back to Wikipedia. It returns titles, URLs and snippets, and the reply lists them as sources.
- **`web.fetch`** downloads a page and extracts the readable text as Markdown (title, description, headings, lists, links), truncated to a character limit. JSON and plain text pass through.
- Both refuse localhost and private network addresses. Turn web access off with the globe button in the composer; the web tools are then not sent to the model at all.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Web access | on | Sends `web.search` / `web.fetch`. |
| Sub-agents | on | Lets the assistant use `agents.run`. |
| Run at once | 4 | How many agents and parallel reads run together (1–8). |
| Max steps | 24 | Tool-call rounds per reply before the assistant pauses and asks you to continue. |
| Max output tokens | 8192 | Per step. |
| Temperature | provider default | |
| Auto-compact | 80% | Summarize older turns when the context is this full (50–95%, or off). |
| Retry failed requests (`retries`) | 3 | Automatic retries when a request fails for a passing reason (0–10, 0 = off). |
| Seconds between retries (`retryDelay`) | 10 | Wait before each automatic retry (1–120). |
| Load tools on demand | on | Core tools + `tools.load` instead of every tool on every request. |
| Custom instructions | – | Appended to the system prompt in every mode. |

Per-model options (context window, max reply, temperature, files, thinking levels, visibility) live in each provider's model list. See [Providers](#providers). A model's max reply and temperature override the global values.

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
