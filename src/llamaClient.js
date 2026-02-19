/**
 * llama-server HTTP client for vision model inference.
 * Uses /v1/chat/completions (OpenAI-compatible) for vision requests,
 * and /completion for text-only requests.
 * Pattern from crag/rag-server/src/llm/llama_client.py + openai_client.py.
 */

export class LlamaClient {
    /**
     * @param {object} opts
     * @param {string} opts.baseUrl - llama-server base URL (e.g. http://192.168.50.107:8080)
     * @param {string} [opts.model] - Model name
     * @param {number} [opts.maxTokens] - Max tokens to generate
     * @param {number} [opts.temperature] - Sampling temperature
     * @param {number} [opts.timeoutMs] - Request timeout in milliseconds
     * @param {number} [opts.maxRetries] - Number of retry attempts
     * @param {number} [opts.retryBackoffS] - Backoff factor in seconds
     */
    constructor({
        baseUrl = 'http://192.168.50.107:8080',
        model = 'qwen3vl-8b-instruct',
        maxTokens = 512,
        temperature = 0.1,
        timeoutMs = 120_000,
        maxRetries = 2,
        retryBackoffS = 1.25,
    } = {}) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.model = model;
        this.maxTokens = maxTokens;
        this.temperature = temperature;
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
        this.retryBackoffS = retryBackoffS;
    }

    /**
     * Send a chat completion request with an image.
     * Uses /v1/chat/completions with OpenAI-compatible multimodal format.
     *
     * @param {string} prompt - The text prompt
     * @param {object} [opts]
     * @param {string} [opts.imageBase64] - Raw base64 PNG (no data: prefix)
     * @param {string} [opts.systemPrompt] - Optional system message
     * @param {number} [opts.maxTokens]
     * @param {number} [opts.temperature]
     * @returns {Promise<string>} The completion text
     */
    async complete(prompt, { imageBase64, systemPrompt, maxTokens, temperature } = {}) {
        // Build message content — multimodal if image provided
        let userContent;
        if (imageBase64) {
            userContent = [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
                { type: 'text', text: prompt },
            ];
        } else {
            userContent = prompt;
        }

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: userContent });

        const payload = {
            model: this.model,
            messages,
            max_tokens: maxTokens ?? this.maxTokens,
            temperature: temperature ?? this.temperature,
            stream: false,
        };

        let lastError = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), this.timeoutMs);

                const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (!resp.ok) {
                    throw new Error(`llama-server returned ${resp.status}: ${await resp.text()}`);
                }

                const data = await resp.json();
                const content = data.choices?.[0]?.message?.content || '';
                return stripCodeFences(content.trim());
            } catch (err) {
                lastError = err;
                if (attempt < this.maxRetries) {
                    await sleep(this.retryBackoffS * (attempt + 1) * 1000);
                }
            }
        }
        throw lastError;
    }

    /**
     * Verify llama-server is reachable via /health endpoint.
     * @returns {Promise<void>}
     */
    async checkConnection() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10_000);

            const resp = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
            clearTimeout(timer);

            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }
        } catch (err) {
            throw new Error(
                `Cannot connect to llama-server at ${this.baseUrl}. ` +
                `Ensure llama-server is running with a vision model loaded. ` +
                `Use --skip-images to bypass image analysis. (${err.message})`
            );
        }
    }
}

/**
 * Strip markdown code fences that VLMs sometimes wrap around JSON.
 */
function stripCodeFences(s) {
    s = (s || '').trim();
    if (s.startsWith('```')) {
        const parts = s.split('```');
        if (parts.length >= 3) {
            s = parts[1];
            // Drop a leading language label (json, text, etc.)
            const head = s.trimStart();
            if (/^(json|markdown|text)/i.test(head)) {
                s = s.includes('\n') ? s.split('\n').slice(1).join('\n') : '';
            }
        }
    }
    return s.trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
