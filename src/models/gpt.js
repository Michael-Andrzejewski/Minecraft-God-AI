import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';

export class GPT {
    constructor(model_name, url) {
        if (!model_name) {
            console.warn('Model name is undefined. Defaulting to "gpt-3.5-turbo".');
            model_name = "gpt-3.5-turbo";
        }
        this.model_name = model_name;
        this.url = url || 'https://api.openai.com/v1';
        this.chat_endpoint = '/v1/chat/completions';
        this.embedding_endpoint = '/v1/embeddings';
        this.isO1Model = model_name.startsWith('o1-');
    }

    async sendRequest(messages, system_message) {
        let body = {
            model: this.model_name,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1000
        };

        if (this.isO1Model && system_message) {
            // For o1 models, prepend the system message to the first user message
            if (messages.length > 0 && messages[0].role === 'user') {
                messages[0].content = system_message + '\n\n' + messages[0].content;
            } else {
                messages.unshift({ role: 'user', content: system_message });
            }
        } else if (system_message) {
            // For other models, add the system message as usual
            messages.unshift({ role: 'system', content: system_message });
        }

        console.log('Awaiting openai api response...');
        const url = new URL(this.chat_endpoint, this.url);
        let method = 'POST';
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        headers.append('Authorization', 'Bearer ' + process.env.OPENAI_API_KEY);
        const request = new Request(url, { method, headers, body: JSON.stringify(body) });

        try {
            const res = await fetch(request);
            if (res.ok) {
                const data = await res.json();
                return data.choices[0].message.content;
            } else {
                throw new Error(`OpenAI Status: ${res.status}`);
            }
        } catch (err) {
            console.error('Failed to send OpenAI request.');
            console.error(err);
            return 'My brain disconnected, try again.';
        }
    }

    async embed(text) {
        let model = this.model_name || "text-embedding-ada-002";
        let body = {
            model: model,
            input: text,
            encoding_format: "float",
        };
        
        const url = new URL(this.embedding_endpoint, this.url);
        let method = 'POST';
        let headers = new Headers();
        headers.append('Content-Type', 'application/json');
        headers.append('Authorization', 'Bearer ' + process.env.OPENAI_API_KEY);
        const request = new Request(url, { method, headers, body: JSON.stringify(body) });

        try {
            const res = await fetch(request);
            if (res.ok) {
                const data = await res.json();
                return data.data[0].embedding;
            } else {
                throw new Error(`OpenAI Status: ${res.status}`);
            }
        } catch (err) {
            console.error('Failed to send OpenAI embedding request.');
            console.error(err);
            return null;
        }
    }
}



