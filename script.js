// Clean up first
if (window.__reasoningExtensionActive) {
    if (window.__originalFetch) window.fetch = window.__originalFetch;
    delete window.__reasoningExtensionActive;
}

window.__originalFetch = window.fetch;
window.__reasoningExtensionActive = true;

(() => {
    console.log("🧠 Debug Streaming Extension active");
    const DEBUG_MODE = true;
    
    const ENDPOINTS_WITH_REASONING = [
        "https://openrouter.ai/api/v1/chat/completions",
        "https://api.minimax.chat/v1/text/chatcompletion",
        "https://llm.chutes.ai/v1/chat/completions",
        "https://nano-gpt.com/api/v1/chat/completions",
        "https://nano-gpt.com/api/v1legacy/chat/completions"
    ];

    const reasoningCache = new Map();
    const CACHE_TTL = 60 * 60 * 1000; // 1 hour

    const getMessageKey = (message) => {
        const content = message.content || "";
        const toolCallIds = message.tool_calls?.map(t => t.id).join('|') || "";
        return content + "|||" + toolCallIds;
    };

    const hasExtraFields = (message) => {
        const baseFields = new Set(['role', 'content', 'tool_calls']);
        return Object.keys(message).some(key => !baseFields.has(key));
    };

    window.fetch = async (...args) => {
        let [url, options] = args;
        DEBUG_MODE && console.log("🔄 Fetch called for:", url);

        // OUTGOING: Inject cached reasoning
        if (options?.body && ENDPOINTS_WITH_REASONING.some(ep => url.includes(ep))) {
            try {
                const parsed = JSON.parse(options.body);
                
                if (parsed?.messages) {
                    DEBUG_MODE && console.log("📤 Outgoing messages:", parsed.messages.length);
                    
                    let injectionCount = 0;
                    
                    parsed.messages.forEach((message) => {
                        if (message.role === 'assistant') {
                            const messageKey = getMessageKey(message);
                            
                            DEBUG_MODE && console.log("📚 Cache keys available:", Array.from(reasoningCache.keys()));
                            
                            if (reasoningCache.has(messageKey)) {
                                const { cachedAt, data } = reasoningCache.get(messageKey);
                                
                                if (Date.now() - cachedAt > CACHE_TTL) {
                                    DEBUG_MODE && console.log("♻️ Expired cache entry:", messageKey);
                                    reasoningCache.delete(messageKey);
                                    return;
                                }
                                
                                if (hasExtraFields(data)) {
                                    DEBUG_MODE && console.log("✅ MATCH FOUND! Injecting extra fields");
                                    const { tool_calls, tool_call_id, ...safeData } = data;
                                    Object.assign(message, safeData);
                                    injectionCount++;
                                }
                            }
                        }
                    });
                    
                    if (injectionCount > 0) {
                        DEBUG_MODE && console.log(`🎯 Total injections: ${injectionCount}`);
                        options.body = JSON.stringify(parsed);
                    } else {
                        DEBUG_MODE && console.log("❌ No injections performed");
                    }
                }
            } catch (err) {
                console.warn("Injection error:", err);
            }
        }
        
        const resp = await window.__originalFetch(url, options);
        
        if (ENDPOINTS_WITH_REASONING.some(ep => url.includes(ep))) {
            const contentType = resp.headers.get("content-type") || '';
            
            if (contentType.includes("event-stream")) {
                DEBUG_MODE && console.log("🌀 Handling streaming response");
                return handleStreamResponse(resp);
            } else {
                handleJsonResponse(resp);
            }
        }
        
        return resp;
    };

    async function handleStreamResponse(resp) {
        const reader = resp.body.getReader();
        const toolCallBuilders = new Map();
        let fullMessage = {};
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                const decoder = new TextDecoder();
                let buffer = "";
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";

                    for (const chunk of chunks) {
                        if (!chunk.startsWith("data:")) continue;
                        
                        try {
                            const colonIndex = chunk.indexOf(':');
                            if (colonIndex === -1) {
                                controller.enqueue(encoder.encode(chunk + "\n\n"));
                                continue;
                            }
                            
                            const payload = chunk.slice(colonIndex + 1).trim();
                            const originalData = chunk + "\n\n";
                            
                            if (payload === "[DONE]") {
                                controller.enqueue(encoder.encode(originalData));
                                continue;
                            }
                            
                            const json = JSON.parse(payload);
                            const delta = json.choices?.[0]?.delta || {};
                            
                            Object.entries(delta).forEach(([field, value]) => {
                                if (!fullMessage[field]) {
                                    fullMessage[field] = value;
                                } else {
                                    if (typeof fullMessage[field] === 'string' && typeof value === 'string') {
                                        fullMessage[field] += value;
                                    } else if (Array.isArray(fullMessage[field]) && Array.isArray(value)) {
                                        fullMessage[field].push(...value);
                                    } else if (typeof fullMessage[field] === 'object' && typeof value === 'object') {
                                        fullMessage[field] = { ...fullMessage[field], ...value };
                                    } else {
                                        fullMessage[field] = value;
                                    }
                                }
                            });
                            
                            if (delta.tool_calls) {
                                delta.tool_calls.forEach(toolDelta => {
                                    const index = toolDelta.index;
                                    let builder = toolCallBuilders.get(index) || {
                                        index,
                                        id: '',
                                        type: '',
                                        function: { name: '', arguments: '' }
                                    };
                                    
                                    if (toolDelta.id) builder.id += toolDelta.id;
                                    
                                    if (toolDelta.type && !builder.type) {
                                        builder.type = toolDelta.type;
                                    }
                                    
                                    if (toolDelta.function) {
                                        if (toolDelta.function.name && !builder.function.name) {
                                            builder.function.name = toolDelta.function.name;
                                        }
                                        
                                        if (toolDelta.function.arguments) {
                                            builder.function.arguments += toolDelta.function.arguments;
                                        }
                                    }
                                    
                                    toolCallBuilders.set(index, builder);
                                });
                            }
                            
                            controller.enqueue(encoder.encode(originalData));
                        } catch (err) {
                            DEBUG_MODE && console.error("Stream parse error:", err);
                            controller.enqueue(encoder.encode(chunk + "\n\n"));
                        }
                    }
                }

                if (toolCallBuilders.size > 0) {
                    fullMessage.tool_calls = Array.from(toolCallBuilders.values())
                        .sort((a, b) => a.index - b.index)
                        .map(builder => ({
                            id: builder.id,
                            type: builder.type || 'function',
                            function: {
                                name: builder.function.name,
                                arguments: builder.function.arguments
                            }
                        }));
                }

                if (hasExtraFields(fullMessage)) {
                    cacheMessageData(fullMessage);
                }

                controller.close();
            }
        });

        return new Response(stream, { headers: resp.headers });
    }

    async function handleJsonResponse(resp) {
        try {
            const clone = resp.clone();
            const json = await clone.json();
            const message = json?.choices?.[0]?.message;
            
            if (message) {
                if (hasExtraFields(message)) {
                    DEBUG_MODE && console.log("📦 Non-stream message with extra fields");
                    cacheMessageData(message);
                } else {
                    DEBUG_MODE && console.log("📦 No extra fields - skipping cache");
                }
            }
        } catch (err) {
            DEBUG_MODE && console.log("❌ Non-stream parse error:", err);
        }
    }

    function cacheMessageData(message) {
        if (!hasExtraFields(message)) {
            DEBUG_MODE && console.log("🚫 Not caching - no extra fields");
            return;
        }

        const messageKey = getMessageKey(message);
        reasoningCache.set(messageKey, {
            data: structuredClone(message),
            cachedAt: Date.now()
        });
        DEBUG_MODE && console.log("💾 Cached message data with extra fields");
    }
})();
