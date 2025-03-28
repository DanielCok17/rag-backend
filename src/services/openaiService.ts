import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { ChatMessage } from '../types/chat';
import { SYSTEM_PROMPTS, MODEL_CONFIG, ERROR_MESSAGES } from '../config/prompts';
import { monitoringService } from './monitoringService';
import { openAIClient } from '../utils/langsmith';

dotenv.config();

class OpenAIService {
    private static instance: OpenAIService;
    private readonly model: string;

    private constructor() {
        this.model = process.env.OPENAI_MODEL || MODEL_CONFIG.DEFAULT_MODEL;
    }

    public static getInstance(): OpenAIService {
        if (!OpenAIService.instance) {
            OpenAIService.instance = new OpenAIService();
        }
        return OpenAIService.instance;
    }

    public async generateResponse(
        prompt: string,
        systemPrompt: string,
        conversationId: string
    ): Promise<string> {
        try {
            const response = await openAIClient.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 2000
            });

            return response.choices[0].message.content || 'Žiadna odpoveď nebola vygenerovaná';
        } catch (error) {
            console.error('Error generating response:', error);
            throw error;
        }
    }
}

export default OpenAIService; 