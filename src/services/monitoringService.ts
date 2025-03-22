import { ChatMessage } from '../types/chat';

interface PromptMetrics {
    startTime: number;
    endTime: number;
    duration: number;
    tokens: {
        prompt: number;
        completion: number;
    };
    cost: number;
}

interface ResponseMetrics {
    startTime: number;
    endTime: number;
    duration: number;
    totalTokens: number;
    totalCost: number;
}

class MonitoringService {
    private static instance: MonitoringService;
    private promptMetrics: Map<string, PromptMetrics[]>;
    private responseMetrics: Map<string, ResponseMetrics[]>;
    private readonly TOKEN_COSTS = {
        'gpt-4-turbo-preview': {
            input: 0.01,    // $0.01 per 1K tokens
            output: 0.03    // $0.03 per 1K tokens
        },
        'text-embedding-3-large': {
            input: 0.0001   // $0.0001 per 1K tokens
        }
    };

    private constructor() {
        this.promptMetrics = new Map();
        this.responseMetrics = new Map();
    }

    public static getInstance(): MonitoringService {
        if (!MonitoringService.instance) {
            MonitoringService.instance = new MonitoringService();
        }
        return MonitoringService.instance;
    }

    public startPromptTracking(conversationId: string): string {
        const promptId = `prompt_${Date.now()}`;
        const metrics: PromptMetrics = {
            startTime: Date.now(),
            endTime: 0,
            duration: 0,
            tokens: {
                prompt: 0,
                completion: 0
            },
            cost: 0
        };

        if (!this.promptMetrics.has(conversationId)) {
            this.promptMetrics.set(conversationId, []);
        }
        this.promptMetrics.get(conversationId)?.push(metrics);

        return promptId;
    }

    public endPromptTracking(conversationId: string, promptId: string, tokens: { prompt: number; completion: number }, model: string): void {
        const metrics = this.promptMetrics.get(conversationId)?.find(m => m.startTime.toString() === promptId.split('_')[1]);
        if (metrics) {
            metrics.endTime = Date.now();
            metrics.duration = metrics.endTime - metrics.startTime;
            metrics.tokens = tokens;
            metrics.cost = this.calculateCost(tokens, model);
        }
    }

    public startResponseTracking(conversationId: string): string {
        const responseId = `response_${Date.now()}`;
        const metrics: ResponseMetrics = {
            startTime: Date.now(),
            endTime: 0,
            duration: 0,
            totalTokens: 0,
            totalCost: 0
        };

        if (!this.responseMetrics.has(conversationId)) {
            this.responseMetrics.set(conversationId, []);
        }
        this.responseMetrics.get(conversationId)?.push(metrics);

        return responseId;
    }

    public endResponseTracking(conversationId: string, responseId: string, totalTokens: number, totalCost: number): void {
        const metrics = this.responseMetrics.get(conversationId)?.find(m => m.startTime.toString() === responseId.split('_')[1]);
        if (metrics) {
            metrics.endTime = Date.now();
            metrics.duration = metrics.endTime - metrics.startTime;
            metrics.totalTokens = totalTokens;
            metrics.totalCost = totalCost;
        }
    }

    private getModelCosts(model: string): { input: number; output?: number } | null {
        return this.TOKEN_COSTS[model as keyof typeof this.TOKEN_COSTS] || null;
    }

    private calculateCost(tokens: { prompt: number; completion: number }, model: string): number {
        try {
            const costs = this.getModelCosts(model);
            if (!costs) {
                console.warn(`Nenašli sa náklady pre model ${model}, používam východzie hodnoty`);
                return 0;
            }

            // Calculate costs based on token usage
            const promptCost = (tokens.prompt / 1000) * costs.input;
            const completionCost = (tokens.completion / 1000) * (costs.output ?? costs.input);

            return promptCost + completionCost;
        } catch (error) {
            console.error('Chyba pri výpočte nákladov:', error);
            return 0;
        }
    }

    public getMetrics(conversationId: string): {
        prompts: PromptMetrics[];
        responses: ResponseMetrics[];
    } {
        return {
            prompts: this.promptMetrics.get(conversationId) || [],
            responses: this.responseMetrics.get(conversationId) || []
        };
    }

    public getTotalCosts(conversationId: string): {
        totalPromptCost: number;
        totalResponseCost: number;
        totalDuration: number;
    } {
        const prompts = this.promptMetrics.get(conversationId) || [];
        const responses = this.responseMetrics.get(conversationId) || [];

        const totalPromptCost = prompts.reduce((sum, p) => sum + p.cost, 0);
        const totalResponseCost = responses.reduce((sum, r) => sum + r.totalCost, 0);
        const totalDuration = responses.reduce((sum, r) => sum + r.duration, 0);

        return {
            totalPromptCost,
            totalResponseCost,
            totalDuration
        };
    }
}

export const monitoringService = MonitoringService.getInstance(); 