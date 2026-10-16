# Debugging an app I don't control

> Draft, untested. **(verify)** everything; Salesforce is not yet researched.

You have no source and no SDK. Three routes, best first.

## 1. Use the product's own export

| Product | Route |
|---|---|
| **Vapi** | Get the call object (transcript, messages, artifacts) from the dashboard or API. Download the per-call pipeline logs (compressed JSONL; the URL is authenticated and redirects to a short-lived link). Make sure logging is enabled on the assistant before the call. **(verify)** |
| **Salesforce Agentforce** | Not yet researched. Look for session tracing / audit exports. **(research before writing)** |
| **GitHub Copilot (cloud coding agent)** | Session logs are viewable on GitHub; no export route found. Try saving the page or use route 2. **(verify)** |

Drop the export in. tracey shows a **coverage note** for what the export lacks (for example
no timings, no tool inputs). Findings that need missing data are skipped.

## 2. Capture the traffic (HAR or proxy)

If the app calls an LLM API from a browser or a machine you control:

- **Browser:** DevTools → Network → save as **HAR**, then drop it in. tracey looks for
  OpenAI/Anthropic/Gemini-style requests and rebuilds the conversation.
- **Any app:** run a local proxy (for example mitmproxy) and save the capture. **(verify
  which capture formats tracey will accept)**

This works for anything that calls an LLM over HTTP you can see. It does not work for
traffic you can't intercept (server to server inside the vendor).

## 3. Webhooks and log drains

If the product can post call events to a URL, point it at something you control that writes
a file (even a tiny local script or a request bin), then drop the file in.

## It didn't work

- "No LLM traffic found" in a HAR: filter for the API host, and make sure "preserve log" and
  "disable cache" were on while you reproduced the problem.
- Missing tool calls: the vendor handles tools server-side and doesn't expose them.
  tracey tells you what it can't see.
