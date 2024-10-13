import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';

export class GPT {
    constructor(model_name, url, embedding_model = "text-embedding-ada-002") {
        this.model_name = model_name || "gpt-3.5-turbo";
        this.embedding_model = embedding_model;

        // Check if the model is an o1 model
        this.isO1Model = this.model_name.startsWith('o1-');
        
        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        this.openai = new OpenAIApi(config);
        console.log('Using o1 model:', this.isO1Model);
        console.log('Using the GPT model:', this.model_name);
        console.log('Using the embedding model:', this.embedding_model);
    }

    async sendRequest(messages) {
        // Keep the filtered messages
        const filteredMessages = messages.filter(msg => msg.role !== 'system');
        
        let res = null;
        try {
            console.log('Awaiting openai api response...')
            let completion = await this.openai.chat.completions.create({
                model: this.model_name,
                messages: filteredMessages,
                // Removed the 'stop' parameter
            });
            if (completion.choices[0].finish_reason == 'length')
                throw new Error('Context length exceeded'); 
            console.log('Received.')
            res = completion.choices[0].message.content;
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && messages.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(messages.slice(1));
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async embed(text) {
        const embedding = await this.openai.embeddings.create({
            model: this.embedding_model,
            input: text,
            encoding_format: "float",
        });
        return embedding.data[0].embedding;
    }
}



