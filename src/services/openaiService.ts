import { OpenAI } from 'openai';
import { ChatOpenAI } from '@langchain/openai';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import dotenv from 'dotenv';
import { ChatMessage } from '../types/chat';
import { SYSTEM_PROMPTS, MODEL_CONFIG, ERROR_MESSAGES } from '../config/prompts';
import { monitoringService } from './monitoringService';

dotenv.config();

class OpenAIService {
    private static instance: OpenAIService;
    private openai: OpenAI;
    private model: string;

    private constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.model = process.env.OPENAI_MODEL || MODEL_CONFIG.DEFAULT_MODEL;
    }

    public static getInstance(): OpenAIService {
        if (!OpenAIService.instance) {
            OpenAIService.instance = new OpenAIService();
        }
        return OpenAIService.instance;
    }

    private createMessages(question: string, systemPrompt: string = SYSTEM_PROMPTS.DEFAULT): ChatMessage[] {
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
        ];
    }

    public async streamResponse(
        question: string, 
        onChunk: (chunk: string) => void,
        systemPrompt: string = SYSTEM_PROMPTS.DEFAULT,
        conversationId: string
    ): Promise<void> {
        try {
            console.log('Začínam OpenAI stream pre otázku:', question);
            let fullResponse = '';
            
            const promptId = monitoringService.startPromptTracking(conversationId);
            const stream = await this.openai.chat.completions.create({
                model: this.model,
                messages: this.createMessages(question, systemPrompt),
                stream: true,
                temperature: MODEL_CONFIG.TEMPERATURE,
                max_tokens: MODEL_CONFIG.MAX_TOKENS
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    fullResponse += content;
                    onChunk(content);
                }
            }

            // Get token counts from the last chunk
            const lastChunk = await this.openai.chat.completions.create({
                model: this.model,
                messages: this.createMessages(question, systemPrompt),
                temperature: MODEL_CONFIG.TEMPERATURE,
                max_tokens: MODEL_CONFIG.MAX_TOKENS
            });

            const tokens = {
                prompt: lastChunk.usage?.prompt_tokens || 0,
                completion: lastChunk.usage?.completion_tokens || 0
            };

            monitoringService.endPromptTracking(conversationId, promptId, tokens, this.model);
            console.log('OpenAI stream dokončený');
        } catch (error) {
            console.error(ERROR_MESSAGES.STREAMING_ERROR, error);
            throw error;
        }
    }

    public async generateResponse(
        question: string,
        systemPrompt: string = SYSTEM_PROMPTS.DEFAULT,
        conversationId: string
    ): Promise<string> {
        try {
            const promptId = monitoringService.startPromptTracking(conversationId);
            
            const completion = await this.openai.chat.completions.create({
                model: this.model,
                messages: this.createMessages(question, systemPrompt),
                temperature: MODEL_CONFIG.TEMPERATURE,
                max_tokens: MODEL_CONFIG.MAX_TOKENS
            });

            const tokens = {
                prompt: completion.usage?.prompt_tokens || 0,
                completion: completion.usage?.completion_tokens || 0
            };

            monitoringService.endPromptTracking(conversationId, promptId, tokens, this.model);

            return completion.choices[0]?.message?.content || 'Žiadna odpoveď nebola vygenerovaná';
        } catch (error) {
            console.error(ERROR_MESSAGES.GENERATION_ERROR, error);
            throw error;
        }
    }
}

export default OpenAIService; 