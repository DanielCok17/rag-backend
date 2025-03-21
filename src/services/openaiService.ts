import { OpenAI } from 'openai';
import { ChatOpenAI } from '@langchain/openai';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import dotenv from 'dotenv';
import { ChatMessage } from '../types/chat';
import { SYSTEM_PROMPTS, MODEL_CONFIG, ERROR_MESSAGES } from '../config/prompts';

dotenv.config();

class OpenAIService {
    private static instance: OpenAIService;
    private openai!: OpenAI;
    private model!: ChatOpenAI;
    private readonly apiKey: string;

    private constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || '';
        if (!this.apiKey) {
            throw new Error(ERROR_MESSAGES.API_KEY_MISSING);
        }

        this.initializeOpenAI();
    }

    private initializeOpenAI(): void {
        this.openai = new OpenAI({ apiKey: this.apiKey });
        this.model = new ChatOpenAI({
            openAIApiKey: this.apiKey,
            modelName: process.env.OPENAI_MODEL || MODEL_CONFIG.DEFAULT_MODEL,
            temperature: MODEL_CONFIG.TEMPERATURE,
            streaming: true,
        });
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
        systemPrompt: string = SYSTEM_PROMPTS.DEFAULT
    ): Promise<void> {
        try {
            console.log('Starting OpenAI stream for question:', question);
            let fullResponse = '';
            
            const stream = await this.openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || MODEL_CONFIG.DEFAULT_MODEL,
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
            console.log('OpenAI response:', fullResponse);
            console.log('OpenAI stream completed');
        } catch (error) {
            console.error(ERROR_MESSAGES.STREAMING_ERROR, error);
            throw error;
        }
    }

    public async generateResponse(
        question: string,
        systemPrompt: string = SYSTEM_PROMPTS.DEFAULT
    ): Promise<string> {
        try {
            const completion = await this.openai.chat.completions.create({
                model: process.env.OPENAI_MODEL || MODEL_CONFIG.DEFAULT_MODEL,
                messages: this.createMessages(question, systemPrompt),
                temperature: MODEL_CONFIG.TEMPERATURE,
                max_tokens: MODEL_CONFIG.MAX_TOKENS
            });

            return completion.choices[0]?.message?.content || 'No response generated';
        } catch (error) {
            console.error(ERROR_MESSAGES.GENERATION_ERROR, error);
            throw error;
        }
    }
}

export default OpenAIService; 