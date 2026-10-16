# Vision

> Items marked **(guess)** are my inference, not something the owner said. Items marked
> **(decided)** were stated by the owner.

## One line

Show agent developers what their agent did, flag what's wrong, and make debugging it fast.

## Who it's for **(decided)**

**The agent developer** is the main user: someone building or operating an AI agent who needs
to understand why it did what it did. Not a manager reading dashboards, not an SRE watching a
fleet.

## The problem

An agent run is a long tree of LLM calls, tool calls, retries, and sub-agents, each with big
blobs of prompt and output. Reading it as raw JSON or logs is slow, and the important thing
(a failed tool call, a loop, a runaway cost, a hallucinated argument) is buried. Existing
viewers are bundled inside heavy platforms, so you can't embed a good trace view in your own
product, or open a trace file locally without signing up. **(guess)**

## What tracey is **(decided)**

Two things from the same code:

1. **A modular UI library**, split into small packages under the `@ggx/` npm scope, usable
   together or one at a time.
2. **A standalone app** built on that library, available on four surfaces:
   website (excalidraw-like), VS Code extension (excalidraw-vscode-like), CLI, and desktop
   app for macOS/Linux/Windows (netron-like). See [surfaces.md](surfaces.md).

The owner likes **the elegance of netron** and **the usability of excalidraw**: open it, drop
something in, it just works, and it's pleasant.

| Inspiration | What we borrow |
|---|---|
| netron | Elegant graph + properties panel; opens a local file; desktop app and website from one codebase. |
| excalidraw | Instant load, zero friction, no account, great defaults; also ships as VS Code extension. |
| diffchecker | Paste two things, instantly see what differs (run vs run, step vs step). |
| jsonviewer.stack.hu | Effortless exploration of big nested JSON. Most trace payloads are JSON. |

## Who/what we support **(decided)**

Four groups of agent developers, in the order we expect to serve them:

1. **Already tracing** with OpenInference, Dynatrace, ddtrace/Datadog, Langfuse, LangSmith,
   or another tool. We read their exports.
2. **Have an agent but no tracing**: LangGraph, DeepAgents, Strands, OpenAI Agents SDK,
   Claude Agent SDK, etc. We give them the shortest path to a trace.
3. **Curious what a coding-agent harness is doing**: Claude Code, Codex, Zed, VS Code
   Copilot, etc. We read their session logs and transcripts.
4. **Debugging third-party applications** they don't control: Vapi, Salesforce, GitHub
   Copilot, etc. We read whatever the product exports, or what can be captured at the
   network edge.

Details: [user-flows.md](user-flows.md), [format-detection.md](format-detection.md).

## Goals

1. **Visualise** a run as a timeline (waterfall) and a graph, with sub-agents and parallel
   branches readable at a glance.
2. **Raise concerns quickly.** A findings layer flags errors, retries, loops, latency and
   cost outliers, truncated or empty outputs, swallowed tool errors. Findings are pure
   functions, extensible. **(guess)**
3. **Help debug.** Inspect any step, search, diff two steps or runs, jump from a finding to
   the step. Give clear instructions for what to do next.
4. **Be extremely fast** **(decided)**: fast to load, fast to parse, snappy to interact.
   Performance is the top engineering priority and has budgets. See
   [architecture.md](architecture.md).
5. **Be modular.** Each part publishable and reusable on its own.
6. **Be lightweight.** Small bundles, few dependencies, quick cold start on every surface.
7. **Detect the source automatically**: tell the user where a trace came from and how sure
   we are. **(decided)**

## Non-goals

- Not a backend, collector, or storage layer. No hosted ingestion server. The one exception is
  `tracey listen`: a local-only, in-memory receiver in the CLI/desktop app for live viewing.
- Not an SDK for instrumenting agents. (We may publish copy-paste snippets that write a
  trace file; see user flows.)
- Not an evaluation, prompt-management, or monitoring platform. Fleet dashboards are out of
  scope; tracey is about one run (or two, for diffs) at a time. **(guess)**
- Not tied to one vendor or agent framework.

## Anti-goals (a failure even if it technically works)

- Feels sluggish on a big trace, or slow to start.
- Looks like a generic enterprise dashboard instead of something crafted.
- Requires an account or server, or sends trace data anywhere. Traces hold prompts and user
  data; everything runs locally by default.
- Pulls in a heavy framework or many dependencies so one package can't be reused alone.
- Shows everything and flags nothing.
- Four surfaces that drift apart: they must share the same core and UI.

## Open questions

- Which sources are v1? (Suggested: OpenInference, OTel GenAI, Claude Code transcripts, plus
  two no-tracing frameworks.)
- What should the CLI render in a terminal vs hand off to the browser/desktop app?
- Licence for the `@ggx/` packages (open source: which one?).
