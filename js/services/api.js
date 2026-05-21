/**
 * API Service
 * Calling third-party services through backend API proxy to protect API key security
 */

import { logger } from '../utils/logger.js';

// Used to store AbortController of ongoing requests
const runningRequests = new Map();

// ---Basic route inference logic---
// Automatically get the mount point of the current plugin, eliminating hardcoded paths
// By parsing the URL of the current script, extract the directory name after extensions/
let apiBaseUrl = null;

function getDynamicApiBase() {
    if (apiBaseUrl) return apiBaseUrl;

    try {
        const scriptUrl = import.meta.url;
        const url = new URL(scriptUrl);
        const pathParts = url.pathname.split('/');

        // Strategy 1: Find the /js/ directory segment and take the previous segment as the plugin name (most universal)
        const jsIdx = pathParts.indexOf('js');
        if (jsIdx > 0) {
            const nodeDir = pathParts[jsIdx - 1];
            apiBaseUrl = `/${nodeDir}/api`;
        }
        // Strategy 2: Fall back to searching for the extensions keyword (ComfyUI standard structure)
        else {
            const extIdx = pathParts.indexOf('extensions');
            if (extIdx !== -1 && pathParts.length > extIdx + 1) {
                const nodeDir = pathParts[extIdx + 1];
                apiBaseUrl = `/${nodeDir}/api`;
            } else {
                // Strategy 3: Hardcoded fallback
                apiBaseUrl = '/prompt-assistant/api';
            }
        }
    } catch (e) {
        apiBaseUrl = '/prompt-assistant/api';
    }
    return apiBaseUrl;
}

class APIService {
    /**
     * Get dynamic API base path
     * Expose the module-level getDynamicApiBase function for external calls
     */
    static getDynamicApiBase() {
        return getDynamicApiBase();
    }

    /**
     * Construct the complete API URL
     */
    static getApiUrl(path) {
        // Get dynamic base route (e.g. /comfyui_prompt_assistant/api)
        const baseApi = getDynamicApiBase();

        // Ensure path does not contain duplicate prefixes and is correctly formatted
        let subPath = path.startsWith('/') ? path : `/${path}`;

        // If path already contains baseApi, do not add it again
        const fullPath = subPath.startsWith(baseApi) ? subPath : `${baseApi}${subPath}`;

        const url = `${window.location.origin}${fullPath}`;
        // logger.debug(`Construct API URL: ${url}`);
        return url;
    }

    /**
     * Parse JSON array like [{"id":0,"text":"..."}, ...]
     * Returns Map<id, text>
     */
    static _extractIndexedTranslations(text) {
        const arr = APIService._extractJsonArray(text);
        if (!Array.isArray(arr)) return null;
        const map = new Map();
        for (const item of arr) {
            if (!item || typeof item !== 'object') return null;
            if (!('id' in item) || !('text' in item)) return null;
            map.set(Number(item.id), String(item.text ?? ''));
        }
        return map;
    }

    /**
     * Structured batch translation (pure frontend wrapper, single LLM request)
     * Requires the model to strictly return a JSON array, one-to-one correspondence with input texts
     */
    static async llmBatchTranslate(texts, from = 'auto', to = 'zh', request_id = null) {
        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('Text array to be translated cannot be empty');
            }

            // Construct structured instruction, use index, require strict JSON object array output
            const indexed = texts.map((t, i) => ({ id: i, text: t }));
            // Enhanced prompt: explicitly prohibit Markdown table format, prohibit adding '|' prefix
            const sysHint = `You are a professional translation API. Please translate the text field content in the input JSON array from ${from} to ${to}.
            Rules:
            1. Keep the JSON structure unchanged, return an array containing id and text.
            2. It is strictly forbidden to use Markdown table format, and it is strictly forbidden to add '|' symbol before the translation.
            3. For parameter names, variable names (such as snake_case format), try to translate them into Chinese meaning as much as possible (e.g., pose_images -> pose images), unless it is a proper noun (e.g., CLIP, VAE).
            4. Keep the array length consistent with the input.
            5. Output JSON directly, do not include Markdown code block markers (like \`\`\`json).`;

            const payload = { segments: indexed };
            const prompt = [
                sysHint,
                'Input: ' + JSON.stringify(payload)
            ].join('\n');

            // Reuse single text interface
            const res = await this.llmTranslate(prompt, from, to, request_id);
            if (!res || !res.success) {
                return { success: false, error: res?.error || 'Batch translation failed' };
            }

            const content = (res.data && (res.data.translated || res.data.expanded || res.data.content)) || res.translated || res.content || '';
            // Parse as index map
            let mapped = APIService._extractIndexedTranslations(content);
            if (!mapped) {
                // Fallback: try to parse as pure string array and align by order
                const arr = APIService._extractJsonArray(content);
                if (Array.isArray(arr) && arr.length === texts.length) {
                    mapped = new Map(arr.map((v, i) => [i, v]));
                }
            }

            if (!mapped) {
                return { success: false, error: 'Failed to parse batch translation result: no valid JSON detected' };
            }

            // If there are missing items, make a single call for missing indices to avoid complete failure
            const translations = new Array(texts.length).fill("");
            const missingIdx = [];
            for (let i = 0; i < texts.length; i++) {
                if (mapped.has(i)) {
                    translations[i] = mapped.get(i);
                } else {
                    missingIdx.push(i);
                }
            }

            if (missingIdx.length > 0) {
                for (const i of missingIdx) {
                    const single = await this.llmTranslate(texts[i], from, to, request_id);
                    if (single && single.success) {
                        translations[i] = (single.data && single.data.translated) || '';
                    } else {
                        translations[i] = '';
                    }
                }
            }

            return { success: true, data: { translations } };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Parallel chunked batch translation (optimized version)
     * Chunk the text array and initiate multiple translation requests in parallel, significantly improving translation speed
     * 
     * @param {string[]} texts - Text array to be translated
     * @param {string} from - Source language
     * @param {string} to - Target language
     * @param {Object} options - Configuration options
     * @param {number} options.chunkSize - Number of texts per chunk (default 5)
     * @param {number} options.concurrency - Maximum concurrency (default 3)
     * @param {Function} options.onProgress - Progress callback (completedChunks, totalChunks)
     * @returns {Promise<{success: boolean, data?: {translations: string[]}, error?: string}>}
     */
    static async llmParallelBatchTranslate(texts, from = 'auto', to = 'zh', options = {}) {
        const { chunkSize = 5, concurrency = 3, onProgress = null } = options;

        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('Text array to be translated cannot be empty');
            }

            // 1. Chunk
            const chunks = [];
            for (let i = 0; i < texts.length; i += chunkSize) {
                chunks.push({
                    startIndex: i,
                    texts: texts.slice(i, i + chunkSize)
                });
            }

            logger.log(`[APIService] Parallel chunked translation | Total texts:${texts.length} | Chunks:${chunks.length} | Per chunk:${chunkSize} | Concurrency:${concurrency}`);

            // 2. Create result array
            const allTranslations = new Array(texts.length).fill('');
            let completedChunks = 0;
            let hasError = false;
            let lastError = null;

            // 3. Concurrency control function
            const translateChunk = async (chunk) => {
                try {
                    const result = await this.llmBatchTranslate(chunk.texts, from, to);

                    if (result.success && result.data && result.data.translations) {
                        // Fill translation results into corresponding positions
                        result.data.translations.forEach((translation, idx) => {
                            allTranslations[chunk.startIndex + idx] = translation || '';
                        });
                    } else {
                        // Single chunk failure, record but do not interrupt
                        hasError = true;
                        lastError = result.error || 'Translation failed';
                        logger.warn(`[APIService] Chunk translation failed | Start index:${chunk.startIndex} | Error:${lastError}`);
                    }
                } catch (err) {
                    hasError = true;
                    lastError = err.message;
                    logger.error(`[APIService] Chunk translation exception | Start index:${chunk.startIndex} | Error:${err.message}`);
                } finally {
                    completedChunks++;
                    if (onProgress) {
                        onProgress(completedChunks, chunks.length);
                    }
                }
            };

            // 4. Batch concurrent execution (control maximum concurrency)
            for (let i = 0; i < chunks.length; i += concurrency) {
                const batch = chunks.slice(i, i + concurrency);
                await Promise.all(batch.map(chunk => translateChunk(chunk)));
            }

            // 5. Check results
            const successCount = allTranslations.filter(t => t && t.trim()).length;
            logger.log(`[APIService] Parallel translation completed | Success:${successCount}/${texts.length}`);

            // Return success even with partial failures (have some translation results)
            if (successCount === 0 && texts.length > 0) {
                return { success: false, error: lastError || 'All texts translation failed' };
            }

            return { success: true, data: { translations: allTranslations } };

        } catch (error) {
            logger.error(`[APIService] Parallel batch translation failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract and parse the first JSON array from a string
     */
    static _extractJsonArray(text) {
        if (!text) return null;
        try {
            // Fast path: the entire text is a JSON array
            if (text.trim().startsWith('[')) {
                return JSON.parse(text.trim());
            }
        } catch (_) { /* ignore */ }

        // Handle prefixes/suffixes added by the model: find the first '[' and matching ']'
        const first = text.indexOf('[');
        const last = text.lastIndexOf(']');
        if (first === -1 || last === -1 || last <= first) return null;
        const candidate = text.slice(first, last + 1);
        try {
            return JSON.parse(candidate);
        } catch (e) {
            // Try to fix full-width quotes
            const normalized = candidate.replace(/[“”]/g, '"');
            try { return JSON.parse(normalized); } catch { return null; }
        }
    }

    /**
     * Generate a unique request ID
     */
    /**
     * Generate a unique request ID
     * Format: requestType_serviceType(optional)_NodeID_four-digit timestamp
     */
    static generateRequestId(type, serviceType = null, nodeId = '0') {
        const timestamp = Math.floor(Date.now() / 1000).toString().slice(-4);
        const parts = [type];
        if (serviceType) {
            parts.push(serviceType);
        }
        parts.push(nodeId);
        parts.push(timestamp);
        return parts.join('_');
    }

    /**
     * Cancel an ongoing request
     */
    static async cancelRequest(requestId) {
        if (!requestId) return { success: false, error: "Missing requestId" };

        const controller = runningRequests.get(requestId);

        if (controller) {
            // 1. Abort the frontend fetch request
            controller.abort();
            runningRequests.delete(requestId);
            logger.debug(`Frontend request aborted | ID: ${requestId}`);
        }

        // 2. Notify the backend to cancel the task
        try {
            const apiUrl = this.getApiUrl('request/cancel');
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ request_id: requestId })
            });
            const result = await response.json();
            logger.debug(`Backend task cancel request sent | ID: ${requestId} | Result: ${JSON.stringify(result)}`);
            return result;
        } catch (error) {
            logger.error(`Backend task cancel request failed | ID: ${requestId} | Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Baidu Translate API
     */
    static async baiduTranslate(text, from = 'auto', to = 'zh', request_id = null, is_auto = false) {
        // Generate request ID
        // Generate request ID
        if (!request_id) {
            request_id = this.generateRequestId('trans', 'baidu');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!text || text.trim() === '') {
                throw new Error('Text to be translated cannot be empty');
            }

            // Get API URL
            const apiUrl = this.getApiUrl('baidu/translate');

            // Call backend API
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    from,
                    to,
                    request_id,
                    is_auto
                }),
                signal // Pass signal
            });

            const result = await response.json();
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`Baidu translation request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            return {
                success: false,
                error: error.message
            };
        } finally {
            // Remove from Map after request completes
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * Batch translation
     */
    static async batchBaiduTranslate(texts, from = 'auto', to = 'zh') {
        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('Text array to be translated cannot be empty');
            }

            // Process each text's translation serially
            const results = [];
            for (const text of texts) {
                const result = await this.baiduTranslate(text, from, to);
                results.push(result);
            }

            return results;
        } catch (error) {
            logger.error(`Batch translation | Result: failed | Error:${error.message}`);
            return [];
        }
    }

    /**
     * LLM expand prompt
     */
    static async llmExpandPrompt(prompt, request_id = null) {
        // Generate request ID
        // Generate request ID
        if (!request_id) {
            request_id = this.generateRequestId('exp');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!prompt || prompt.trim() === '') {
                throw new Error('Please enter the prompt to optimize');
            }

            logger.debug(`Initiate LLM prompt expansion request | RequestID:${request_id} | Original:${prompt}`);

            // Call backend API
            const apiUrl = this.getApiUrl('llm/expand');
            logger.debug('LLM prompt expansion API URL:', apiUrl);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt,
                    request_id
                }),
                signal // Pass signal
            });

            const result = await response.json();
            logger.debug(`LLM prompt expansion request succeeded | RequestID:${request_id} | Result:${JSON.stringify(result)}`);

            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`LLM prompt expansion request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            logger.error(`LLM prompt expansion request failed | RequestID:${request_id || 'unknown'} | Error:${error.message}`);
            return {
                success: false,
                error: error.message
            };
        } finally {
            // Remove from Map after request completes
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * LLM translate text
     */
    static async llmTranslate(text, from = 'auto', to = 'zh', request_id = null, is_auto = false) {
        // Generate request ID
        // Generate request ID
        if (!request_id) {
            request_id = this.generateRequestId('trans', 'llm');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!text || text.trim() === '') {
                throw new Error('Please enter the content to translate');
            }

            // Call backend API
            const apiUrl = this.getApiUrl('llm/translate');

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    from,
                    to,
                    request_id,
                    is_auto
                }),
                signal // Pass signal
            });

            const result = await response.json();
            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`LLM translation request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            return {
                success: false,
                error: error.message
            };
        } finally {
            // Remove from Map after request completes
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * Call vision model to analyze image
     */
    static async llmAnalyzeImage(imageData, prompt, request_id = null) {
        // Generate request ID
        // Generate request ID
        if (!request_id) {
            request_id = this.generateRequestId('icap');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!imageData) {
                throw new Error('No valid image found');
            }

            logger.debug(`Initiate vision analysis request | RequestID:${request_id}`);

            // Construct API URL
            const apiUrl = this.getApiUrl('vlm/analyze');
            logger.debug('Vision analysis API URL:', apiUrl);

            // Construct request data
            const requestData = {
                image: imageData,
                prompt: prompt, // Add prompt
                request_id: request_id
            };

            // Send request
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData),
                signal // Pass signal
            });

            // Parse response
            const result = await response.json();
            logger.debug(`Vision analysis request completed | RequestID:${request_id}`);

            return result;
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`Vision analysis request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            logger.error(`Vision analysis request failed | RequestID:${request_id || 'unknown'} | Error:${error.message}`);
            return {
                success: false,
                error: error.message || 'Request failed'
            };
        } finally {
            // Remove from Map after request completes
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    // ---Streaming output API methods (SSE)---

    /**
     * Stream vision analysis of image
     * Receive analysis results token by token using SSE
     * @param {string} imageData - Base64 encoded image data
     * @param {string} prompt - Analysis prompt
     * @param {string} request_id - Request ID
     * @param {Function} onChunk - Callback function to receive each chunk
     * @returns {Promise<Object>} - Full analysis result
     */
    static async llmAnalyzeImageStream(imageData, prompt, request_id = null, onChunk = null) {
        if (!request_id) {
            request_id = this.generateRequestId('icap');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!imageData) {
                throw new Error('No valid image found');
            }

            logger.debug(`Initiate streaming vision analysis request | RequestID:${request_id}`);

            const apiUrl = this.getApiUrl('vlm/analyze/stream');
            const requestData = {
                image: imageData,
                prompt: prompt,
                request_id: request_id
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData),
                signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk && onChunk) {
                                onChunk(data.chunk);
                            }
                            if (data.done) {
                                finalResult = data.result;
                            }
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            if (parseError.message !== 'Unexpected end of JSON input') {
                                logger.warn(`Failed to parse SSE data: ${parseError.message}`);
                            }
                        }
                    }
                }
            }

            logger.debug(`Streaming vision analysis request completed | RequestID:${request_id}`);
            return finalResult;

        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`Streaming vision analysis request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            logger.error(`Streaming vision analysis request failed | RequestID:${request_id || 'unknown'} | Error:${error.message}`);
            return { success: false, error: error.message || 'Request failed' };
        } finally {
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * Stream LLM expand prompt
     * Receive expansion results token by token using SSE
     * @param {string} prompt - The prompt to expand
     * @param {string} request_id - Request ID
     * @param {Function} onChunk - Callback function to receive each chunk
     * @returns {Promise<Object>} - Full expansion result
     */
    static async llmExpandPromptStream(prompt, request_id = null, onChunk = null) {
        if (!request_id) {
            request_id = this.generateRequestId('exp');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!prompt || prompt.trim() === '') {
                throw new Error('Please enter the prompt to optimize');
            }

            logger.debug(`Initiate streaming LLM prompt expansion request | RequestID:${request_id}`);

            const apiUrl = this.getApiUrl('llm/expand/stream');

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, request_id }),
                signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk && onChunk) {
                                onChunk(data.chunk);
                            }
                            if (data.done) {
                                finalResult = data.result;
                            }
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            if (parseError.message !== 'Unexpected end of JSON input') {
                                logger.warn(`Failed to parse SSE data: ${parseError.message}`);
                            }
                        }
                    }
                }
            }

            logger.debug(`Streaming LLM prompt expansion request completed | RequestID:${request_id}`);
            return finalResult;

        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`Streaming LLM prompt expansion request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            logger.error(`Streaming LLM prompt expansion request failed | RequestID:${request_id || 'unknown'} | Error:${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * Stream LLM translation
     * Receive translation results token by token using SSE
     * Note: Only supports LLM translation service; Baidu translation does not support streaming
     * @param {string} text - Text to translate
     * @param {string} fromLang - Source language
     * @param {string} toLang - Target language
     * @param {string} request_id - Request ID
     * @param {Function} onChunk - Callback function to receive each chunk
     * @returns {Promise<Object>} - Full translation result
     */
    static async llmTranslateStream(text, fromLang, toLang, request_id = null, onChunk = null) {
        if (!request_id) {
            request_id = this.generateRequestId('trans');
        }

        const controller = new AbortController();
        const signal = controller.signal;
        runningRequests.set(request_id, controller);

        try {
            if (!text || text.trim() === '') {
                throw new Error('Please enter the content to translate');
            }

            logger.debug(`Initiate streaming LLM translation request | RequestID:${request_id} | ${fromLang}→${toLang}`);

            const apiUrl = this.getApiUrl('llm/translate/stream');

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    from: fromLang,
                    to: toLang,
                    request_id
                }),
                signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let finalResult = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.chunk && onChunk) {
                                onChunk(data.chunk);
                            }
                            if (data.done) {
                                finalResult = data.result;
                            }
                            if (data.error) {
                                throw new Error(data.error);
                            }
                        } catch (parseError) {
                            if (parseError.message !== 'Unexpected end of JSON input') {
                                logger.warn(`Failed to parse SSE data: ${parseError.message}`);
                            }
                        }
                    }
                }
            }

            logger.debug(`Streaming LLM translation request completed | RequestID:${request_id}`);
            return finalResult;

        } catch (error) {
            if (error.name === 'AbortError') {
                logger.debug(`Streaming LLM translation request aborted by user | ID: ${request_id}`);
                return { success: false, error: 'Request cancelled', cancelled: true };
            }
            logger.error(`Streaming LLM translation request failed | RequestID:${request_id || 'unknown'} | Error:${error.message}`);
            return { success: false, error: error.message };
        } finally {
            if (runningRequests.has(request_id)) {
                runningRequests.delete(request_id);
            }
        }
    }

    /**
     * Convert image to Base64
     */
    static async imageToBase64(img) {
        return new Promise((resolve, reject) => {
            try {
                if (!img) {
                    reject('Invalid image');
                    return;
                }

                // If it is already a base64 string, return directly
                if (typeof img === 'string' && img.startsWith('data:image')) {
                    resolve(img);
                    return;
                }

                // If it is a Blob object
                if (img instanceof Blob) {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(img);
                    return;
                }

                // If it is a URL
                if (typeof img === 'string' && (img.startsWith('http') || img.startsWith('/'))) {
                    const image = new Image();
                    image.crossOrigin = 'Anonymous';
                    image.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(image, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                    };
                    image.onerror = () => reject('Image loading failed');
                    image.src = img;
                    return;
                }

                // Handle ComfyUI image object
                if (img && typeof img === 'object' && img.src) {
                    // If the image object has a src attribute, use it
                    const image = new Image();
                    image.crossOrigin = 'Anonymous';
                    image.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(image, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                    };
                    image.onerror = (e) => {
                        console.error('Image loading failed:', e);
                        reject('Image loading failed');
                    };
                    image.src = img.src;
                    return;
                }

                // Handle HTMLImageElement or similar objects
                if (img && (img instanceof HTMLImageElement || (img.width && img.height && img.complete))) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                        return;
                    } catch (e) {
                        console.warn('Failed to convert image using canvas:', e);
                        // Continue trying other methods
                    }
                }

                // Handle ComfyUI special format (dataURL cached in node)
                if (img && img.dataURL) {
                    resolve(img.dataURL);
                    return;
                }

                // Handle ComfyUI special image data format
                if (img && img.data && img.width && img.height) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        const imageData = new ImageData(
                            new Uint8ClampedArray(img.data.buffer || img.data),
                            img.width,
                            img.height
                        );
                        ctx.putImageData(imageData, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg'));
                        return;
                    } catch (e) {
                        console.error('Failed to process image data:', e);
                    }
                }

                console.error('Unsupported image format', img);
                reject('Unsupported image format');
            } catch (error) {
                console.error('Error converting image:', error);
                reject(error);
            }
        });
    }
}

export { APIService };
