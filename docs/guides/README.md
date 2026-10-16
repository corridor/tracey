# Getting started guides

How to get a trace *into* tracey, for every kind of user. tracey is UI only, so these guides
cover getting a file out of your tool, then dropping it in.

> **Status: drafts, untested.** Steps come from search results and prior knowledge. Each
> guide must be run against the real tool and fixed before release. Items marked **(verify)**
> are the shakiest. Roadmap step 1.2 covers this.

Pick your situation:

| I... | Guide |
|---|---|
| already have tracing (OpenInference/Phoenix, Dynatrace, Datadog, Langfuse, LangSmith, any OpenTelemetry) | [already-tracing.md](already-tracing.md) |
| have an agent but no tracing (LangGraph, DeepAgents, Strands, OpenAI Agents, Claude Agent SDK, ...) | [no-tracing.md](no-tracing.md) |
| want to see what Claude Code, Codex, Zed, VS Code Copilot are doing | [harness-sessions.md](harness-sessions.md) |
| need to debug an app I don't control (Vapi, Salesforce, GitHub Copilot, ...) | [third-party-apps.md](third-party-apps.md) |

Once your file is in, every path leads to the same [debug playbook](../user-flows.md#the-debug-playbook-what-we-tell-users-to-do).

## The shape of every guide

1. What you need.
2. 3 to 5 steps to a file.
3. "Drop it in tracey": what you should see (detected as ..., how many spans).
4. If it didn't work: the usual causes.
