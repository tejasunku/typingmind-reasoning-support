# 🧠 typingmind-reasoning-support

Many reasoning-capable models — including **OpenAI OSS**, **MiniMax M2**, and others — currently underperform in TypingMind when tool calls are involved.
The root cause: TypingMind does not preserve the `reasoning_details` field between requests.
This field is critical for continuity — without it, models “forget” mid-reasoning steps and often fail partial tool invocations.

This lightweight extension fixes that.

---

## ✨ What it does

This extension automatically:

1. **Intercepts all LLM responses** in TypingMind that contain `reasoning_details`.
2. **Caches** those reasoning segments locally.
3. **Restores** them on subsequent turns by injecting the correct `reasoning_details` back into the next request.

It works transparently for both **streaming** and **non-streaming** completions.

---

## 🧩 How it identifies reasoning continuity

Each response is uniquely cached and matched back to the correct assistant message through a safe two-step process:

1. **Response ID match**
   When possible, the model’s `response.id` (from the streamed JSON events) is bound to the assistant message that originated it.
   Subsequent requests use this ID to recover and re-inject the correct `reasoning_details`.

2. **Content-level fallback**
   If a conversation branch is forked or a message ID changes, the extension falls back to a hash of the message’s **content + tool calls** to ensure stable mapping.

---

### ✅ Safeguards

* **Message chain starts:** reasoning continuity begins purely from content — safe and deterministic.
* **Ongoing conversations:** reasoning data is preserved automatically across steps.
* **Forked conversations:** if a user rewinds and edits a previous turn, mismatched reasoning data is ignored safely.

### ⚠️ Limitations

This does **not** preserve reasoning continuity across:

* Different browsers or devices
* Reloaded TypingMind sessions (cache is in-memory only)
* Edited or truncated message histories that no longer match ID or content hashes

These constraints are deliberate to prevent reasoning corruption.

---

## ⚙️ Configuration

At the top of `script.js`, you’ll find an array like:

```js
const ALLOWED_ENDPOINTS = [
  "https://openrouter.ai/api/v1",
  "https://api.minimax.chat/v1",
];
```

Only requests sent to these endpoints will be patched to preserve reasoning continuity.
You can **add, remove, or change** entries to match your own setup — for example, if you self-host OpenRouter or use a custom proxy.

---

## 🧪 Installation

No manifest or bundling required — it’s a single-file TypingMind extension.

1. **Fork this repository** and adjust the endpoint list if needed.

2. Commit your edits, then choose one of the two supported hosting methods:

   ### Option 1 — via jsDelivr (recommended)

   ```
   https://cdn.jsdelivr.net/gh/<your-username>/typingmind-reasoning-support@main/script.js
   ```

   ### Option 2 — via GitHub Gist

   Create a Gist containing your `script.js`, then use its `.js` URL:

   ```
   https://gist.github.com/<your-gist-id>.js
   ```

3. In TypingMind:

   * Open **Settings → Extensions → Add Extension**
   * Paste the URL of your hosted script
   * Click **Install**, then refresh the page

When loaded successfully, you’ll see this in the console:

```
✅ Reasoning Continuity Extension active
```

---

## 🧱 Implementation details

The script works by:

* Hooking into TypingMind’s internal Webpack stream parser (which processes the `response.*` events).
* Capturing `reasoning_details` deltas as they arrive.
* Injecting them back into the next outgoing request payload before the network call is sent.

Both **streamed** and **non-streamed** responses are supported via unified caching logic.

---

## 🧰 Developer Tips

You can enable debug output to inspect how the reasoning continuity cache behaves.
Simply open your browser console and type:

```js
window.debugReasoning = true;
```

This enables detailed logs showing:

* When reasoning chunks are captured (`reasoning_details` deltas)
* When reasoning data is restored and merged into the next request
* When cache entries are created, matched, or pruned

Disable logging again by running:

```js
window.debugReasoning = false;
```

This feature is purely local and has no network or privacy implications — it’s only for development visibility.

---

## 🤝 Attribution

Built by [**Teja Sunku**](https://github.com/tejasunku) and ChatGPT 5 to improve TypingMind’s support for reasoning-capable models.
If you find it useful, please consider leaving a ⭐ on the repo.

GitHub:
👉 [https://github.com/tejasunku/typingmind-reasoning-support](https://github.com/tejasunku/typingmind-reasoning-support)
