import { retrievalService } from './retrievalService';
import { storageService } from './storageService';
import { ChatMessage, Conversation } from '../types/chat';
import OpenAIService from './openaiService';
import { monitoringService } from './monitoringService';
import { SYSTEM_PROMPTS, RETRIEVAL_PROMPTS } from '../config/prompts';

interface ConversationState {
    currentCase?: {
        caseId: string;
        court: string;
        caseNumber: string;
        domain: string;
    };
    isFollowUpQuestion: boolean;
    previousQuestions: string[];
    lastResponse: string;
    timestamp: number;
    history: ChatMessage[];
    openAIContext: {
        messages: ChatMessage[];
        lastTokenCount: number;
        lastUpdateTime: number;
        summary: string;
        keyPoints: string[];
        lastAnalysis?: {
            mainTopics: string[];
            keyLegalConcepts: string[];
            importantDecisions: string[];
            relevantLaws: string[];
            conversationFlow: string;
            timestamp: number;
        };
    };
}

interface RetryConfig {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs: number;
}

interface RateLimitConfig {
    maxRequestsPerMinute: number;
    maxTokensPerRequest: number;
    maxConcurrentRequests: number;
}

interface RequestValidation {
    isValid: boolean;
    errors: string[];
}

class ChatService {
    private static instance: ChatService;
    private openAIService: OpenAIService;
    private conversationStates: Map<string, ConversationState>;
    private requestCounts: Map<string, { count: number; timestamp: number }>;
    private activeRequests: number;
    private readonly MAX_HISTORY_LENGTH = 10;
    private readonly MAX_TOKENS_PER_MESSAGE = 4000;
    private readonly MAX_TOTAL_TOKENS = 8000;
    private readonly STATE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
    private readonly OPENAI_CONTEXT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_SUMMARY_TOKENS = 1000;
    private readonly MAX_KEY_POINTS = 5;
    private readonly retryConfig: RetryConfig = {
        maxRetries: 3,
        backoffMs: 1000,
        maxBackoffMs: 5000
    };
    private readonly rateLimitConfig: RateLimitConfig = {
        maxRequestsPerMinute: 60,
        maxTokensPerRequest: 4000,
        maxConcurrentRequests: 10
    };

    private constructor() {
        this.openAIService = OpenAIService.getInstance();
        this.conversationStates = new Map();
        this.requestCounts = new Map();
        this.activeRequests = 0;
    }

    public static getInstance(): ChatService {
        if (!ChatService.instance) {
            ChatService.instance = new ChatService();
        }
        return ChatService.instance;
    }

    private getOrCreateState(userId: string): ConversationState {
        let state = this.conversationStates.get(userId);
        
        if (!state) {
            state = {
                currentCase: undefined,
                isFollowUpQuestion: false,
                previousQuestions: [],
                lastResponse: '',
                timestamp: Date.now(),
                history: [],
                openAIContext: {
                    messages: [],
                    lastTokenCount: 0,
                    lastUpdateTime: Date.now(),
                    summary: '',
                    keyPoints: []
                }
            };
            this.conversationStates.set(userId, state);
        }

        // Clean up expired states
        if (Date.now() - state.timestamp > this.STATE_EXPIRY_MS) {
            state = {
                currentCase: undefined,
                isFollowUpQuestion: false,
                previousQuestions: [],
                lastResponse: '',
                timestamp: Date.now(),
                history: [],
                openAIContext: {
                    messages: [],
                    lastTokenCount: 0,
                    lastUpdateTime: Date.now(),
                    summary: '',
                    keyPoints: []
                }
            };
            this.conversationStates.set(userId, state);
        }

        return state;
    }

    private async optimizeOpenAIContext(state: ConversationState): Promise<ChatMessage[]> {
        const now = Date.now();
        let messages = [...state.openAIContext.messages];

        // If context is expired, start fresh but keep the last few messages
        if (now - state.openAIContext.lastUpdateTime > this.OPENAI_CONTEXT_EXPIRY_MS) {
            // Keep the last few messages for continuity
            messages = state.history.slice(-3);
            state.openAIContext.lastTokenCount = 0;
            state.openAIContext.summary = '';
            state.openAIContext.keyPoints = [];
        }

        // Add system message if not present
        if (!messages.some(m => m.role === 'system')) {
            messages.unshift({
                role: 'system',
                content: SYSTEM_PROMPTS.LEGAL
            });
        }

        // Get recent history
        const recentHistory = state.history.slice(-this.MAX_HISTORY_LENGTH);

        // If we have a summary, add it as context
        if (state.openAIContext.summary) {
            messages.push({
                role: 'system',
                content: `Previous conversation summary: ${state.openAIContext.summary}`
            });
        }

        // Add key points if available
        if (state.openAIContext.keyPoints.length > 0) {
            messages.push({
                role: 'system',
                content: `Key points from previous conversation:\n${state.openAIContext.keyPoints.join('\n')}`
            });
        }

        // Add recent messages, ensuring we don't duplicate messages
        const existingMessageContents = new Set(messages.map(m => m.content));
        recentHistory.forEach(msg => {
            if (!existingMessageContents.has(msg.content)) {
                messages.push(msg);
                existingMessageContents.add(msg.content);
            }
        });

        // Estimate token count
        const estimatedTokens = this.estimateTokenCount(messages);

        // If we exceed token limit, summarize older messages
        if (estimatedTokens > this.MAX_TOTAL_TOKENS) {
            const systemMessage = messages.find(m => m.role === 'system');
            messages = [systemMessage!];

            // Keep the most recent messages that fit
            for (let i = recentHistory.length - 1; i >= 0; i--) {
                const msg = recentHistory[i];
                const newTokenCount = this.estimateTokenCount([...messages, msg]);
                
                if (newTokenCount <= this.MAX_TOTAL_TOKENS) {
                    messages.push(msg);
                } else {
                    break;
                }
            }

            // Generate new summary of older messages
            await this.updateConversationSummary(state, recentHistory);
        }

        // Update context state
        state.openAIContext.messages = messages;
        state.openAIContext.lastTokenCount = this.estimateTokenCount(messages);
        state.openAIContext.lastUpdateTime = now;

        // Log the optimized context
        console.log('\n🤖 Optimized Context Details:');
        console.log(`Total messages: ${messages.length}`);
        console.log(`System messages: ${messages.filter(m => m.role === 'system').length}`);
        console.log(`User messages: ${messages.filter(m => m.role === 'user').length}`);
        console.log(`Assistant messages: ${messages.filter(m => m.role === 'assistant').length}`);
        console.log(`Estimated tokens: ${state.openAIContext.lastTokenCount}`);
        console.log('=====================================\n');

        return messages;
    }

    private async updateConversationSummary(state: ConversationState, recentHistory: ChatMessage[]): Promise<void> {
        try {
            console.log('\n📝 ===== Updating Conversation Summary =====');
            console.log('Recent history length:', recentHistory.length);

            // First, analyze the conversation to identify key themes and topics
            const analysisPrompt = `Analyze this legal conversation and identify key themes and topics:

${recentHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Provide a structured analysis in JSON format:
{
    "mainTopics": string[],
    "keyLegalConcepts": string[],
    "importantDecisions": string[],
    "relevantLaws": string[],
    "conversationFlow": string
}`;

            const analysisResponse = await this.openAIService.generateResponse(
                analysisPrompt,
                SYSTEM_PROMPTS.LEGAL,
                state.openAIContext.summary || ''
            );

            const analysis = JSON.parse(analysisResponse);
            console.log('\n📊 Conversation Analysis:');
            console.log('Main Topics:', analysis.mainTopics);
            console.log('Key Legal Concepts:', analysis.keyLegalConcepts);
            console.log('Important Decisions:', analysis.importantDecisions);
            console.log('Relevant Laws:', analysis.relevantLaws);
            console.log('Conversation Flow:', analysis.conversationFlow);

            // Generate a concise summary focusing on key points
            const summaryPrompt = `Based on this legal conversation analysis, create a concise summary:

Main Topics: ${analysis.mainTopics.join(', ')}
Key Legal Concepts: ${analysis.keyLegalConcepts.join(', ')}
Important Decisions: ${analysis.importantDecisions.join(', ')}
Relevant Laws: ${analysis.relevantLaws.join(', ')}
Conversation Flow: ${analysis.conversationFlow}

Provide:
1. A concise summary (max ${this.MAX_SUMMARY_TOKENS} tokens) that captures:
   - Main legal issues discussed
   - Key decisions or conclusions
   - Relevant laws or regulations
   - Important precedents or cases
2. ${this.MAX_KEY_POINTS} key points that:
   - Are actionable or important for future reference
   - Include specific legal references
   - Highlight critical decisions or conclusions
   - Note any pending or unresolved issues

Format the response as:
SUMMARY: [Your concise summary]
KEY_POINTS:
1. [First key point]
2. [Second key point]
...`;

            const summaryResponse = await this.openAIService.generateResponse(
                summaryPrompt,
                SYSTEM_PROMPTS.LEGAL,
                state.openAIContext.summary || ''
            );

            // Parse the response to separate summary and key points
            const [summary, ...keyPoints] = summaryResponse
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.replace(/^(SUMMARY:|KEY_POINTS:|[0-9]+\.\s*)/, '').trim());

            // Update the state with new summary and key points
            state.openAIContext.summary = summary;
            state.openAIContext.keyPoints = keyPoints.slice(0, this.MAX_KEY_POINTS);

            // Log the updated summary
            console.log('\n📝 Updated Summary:');
            console.log('Summary:', summary);
            console.log('\nKey Points:');
            state.openAIContext.keyPoints.forEach((point, index) => {
                console.log(`${index + 1}. ${point}`);
            });
            console.log('\n=====================================\n');

            // Store the analysis for future reference
            state.openAIContext.lastAnalysis = {
                mainTopics: analysis.mainTopics,
                keyLegalConcepts: analysis.keyLegalConcepts,
                importantDecisions: analysis.importantDecisions,
                relevantLaws: analysis.relevantLaws,
                conversationFlow: analysis.conversationFlow,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('Error updating conversation summary:', error);
            // Fallback to a simpler summary if analysis fails
            try {
                const fallbackPrompt = `Summarize this legal conversation briefly:

${recentHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Provide:
1. A brief summary of the main points
2. ${this.MAX_KEY_POINTS} key takeaways`;

                const fallbackResponse = await this.openAIService.generateResponse(
                    fallbackPrompt,
                    SYSTEM_PROMPTS.LEGAL,
                    state.openAIContext.summary || ''
                );

                const [summary, ...keyPoints] = fallbackResponse
                    .split('\n')
                    .filter(line => line.trim())
                    .map(line => line.replace(/^[0-9]+\.\s*/, '').trim());

                state.openAIContext.summary = summary;
                state.openAIContext.keyPoints = keyPoints.slice(0, this.MAX_KEY_POINTS);

                console.log('\n📝 Fallback Summary:');
                console.log('Summary:', summary);
                console.log('Key Points:', keyPoints);
                console.log('=====================================\n');
            } catch (fallbackError) {
                console.error('Error generating fallback summary:', fallbackError);
            }
        }
    }

    private estimateTokenCount(messages: ChatMessage[]): number {
        // Rough estimation: 1 token ≈ 4 characters
        return messages.reduce((acc, msg) => 
            acc + Math.ceil(msg.content.length / 4), 0);
    }

    private updateState(userId: string, updates: Partial<ConversationState>) {
        const state = this.getOrCreateState(userId);
        
        if (updates.currentCase) {
            state.currentCase = updates.currentCase;
        }
        if (updates.isFollowUpQuestion !== undefined) {
            state.isFollowUpQuestion = updates.isFollowUpQuestion;
        }
        if (updates.previousQuestions) {
            state.previousQuestions = updates.previousQuestions.slice(-this.MAX_HISTORY_LENGTH);
        }
        if (updates.lastResponse) {
            state.lastResponse = updates.lastResponse;
        }
        if (updates.history) {
            // Ensure we don't exceed MAX_HISTORY_LENGTH and maintain message order
            state.history = updates.history.slice(-this.MAX_HISTORY_LENGTH);
            console.log('\n📝 Updated conversation state history:');
            console.log(`Total messages: ${state.history.length}`);
            console.log('Messages:', state.history.map(msg => `${msg.role}: ${msg.content.substring(0, 50)}...`).join('\n'));
            console.log('=====================================\n');
        }
        
        state.timestamp = Date.now();
        this.conversationStates.set(userId, state);
    }

    private async classifyQuestionType(question: string, state: ConversationState): Promise<{
        isFollowUp: boolean;
        isNewCase: boolean;
        caseId?: string;
    }> {
        try {
            const prompt = `Analyze if this question is a follow-up to a previous case or a new case:

Previous state:
${state.currentCase ? `Current case: ${state.currentCase.court} - ${state.currentCase.caseNumber}` : 'No current case'}
Previous questions: ${state.previousQuestions.join(', ')}

Current question: ${question}

Respond in JSON format:
{
    "isFollowUp": boolean,
    "isNewCase": boolean,
    "caseId": string | null
}`;

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, '');
            return JSON.parse(response);
        } catch (error) {
            console.error('Error classifying question type:', error);
            return {
                isFollowUp: false,
                isNewCase: true,
                caseId: undefined
            };
        }
    }

    private async extractCaseInfo(response: string): Promise<{
        caseId?: string;
        court?: string;
        caseNumber?: string;
        domain?: string;
    }> {
        try {
            const prompt = `Extract case information from this response:

${response}

Respond in JSON format:
{
    "caseId": string | null,
    "court": string | null,
    "caseNumber": string | null,
    "domain": string | null
}`;

            const result = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, '');
            return JSON.parse(result);
        } catch (error) {
            console.error('Error extracting case info:', error);
            return {};
        }
    }

    private async retryWithBackoff<T>(
        operation: () => Promise<T>,
        errorMessage: string
    ): Promise<T> {
        let lastError: Error | null = null;
        let backoff = this.retryConfig.backoffMs;

        for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                console.error(`${errorMessage} (Attempt ${attempt}/${this.retryConfig.maxRetries}):`, error);
                
                if (attempt === this.retryConfig.maxRetries) {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, backoff));
                backoff = Math.min(backoff * 2, this.retryConfig.maxBackoffMs);
            }
        }

        throw lastError || new Error(errorMessage);
    }

    private async validateRequest(userId: string, question: string): Promise<RequestValidation> {
        const errors: string[] = [];

        // Check rate limits
        if (!this.checkRateLimit(userId)) {
            errors.push('Rate limit exceeded. Please wait before making more requests.');
        }

        // Check concurrent requests
        if (this.activeRequests >= this.rateLimitConfig.maxConcurrentRequests) {
            errors.push('Too many concurrent requests. Please try again later.');
        }

        // Validate question length
        if (question.length > 1000) {
            errors.push('Question is too long. Please keep it under 1000 characters.');
        }

        // Validate question content
        if (!question.trim()) {
            errors.push('Question cannot be empty.');
        }

        // Check for malicious content
        if (this.containsMaliciousContent(question)) {
            errors.push('Question contains potentially malicious content.');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    private checkRateLimit(userId: string): boolean {
        const now = Date.now();
        const userRequests = this.requestCounts.get(userId);

        if (!userRequests) {
            this.requestCounts.set(userId, { count: 1, timestamp: now });
            return true;
        }

        // Reset counter if a minute has passed
        if (now - userRequests.timestamp > 60000) {
            this.requestCounts.set(userId, { count: 1, timestamp: now });
            return true;
        }

        // Check if user has exceeded rate limit
        if (userRequests.count >= this.rateLimitConfig.maxRequestsPerMinute) {
            return false;
        }

        userRequests.count++;
        return true;
    }

    private containsMaliciousContent(text: string): boolean {
        // Basic check for potentially malicious content
        const suspiciousPatterns = [
            /<script>/i,
            /javascript:/i,
            /eval\(/i,
            /onload=/i,
            /onerror=/i,
            /onclick=/i,
            /data:/i,
            /vbscript:/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(text));
    }

    private async cleanupRateLimits(): Promise<void> {
        const now = Date.now();
        for (const [userId, data] of this.requestCounts.entries()) {
            if (now - data.timestamp > 60000) {
                this.requestCounts.delete(userId);
            }
        }
    }

    private formatConversationHistory(history: ChatMessage[]): string {
        const pairs: { question: string; answer: string }[] = [];
        let currentQuestion = '';
        let currentAnswer = '';

        history.forEach((message, index) => {
            if (message.role === 'user') {
                if (currentQuestion && currentAnswer) {
                    pairs.push({ question: currentQuestion, answer: currentAnswer });
                    currentAnswer = '';
                }
                currentQuestion = message.content;
            } else if (message.role === 'assistant') {
                currentAnswer = message.content;
            }
        });

        // Add the last pair if exists
        if (currentQuestion && currentAnswer) {
            pairs.push({ question: currentQuestion, answer: currentAnswer });
        }

        return pairs.map((pair, index) => 
            `=== Question ${index + 1} ===\nQ: ${pair.question}\nA: ${pair.answer}\n`
        ).join('\n');
    }

    /**
     * Handles the main chat workflow: processes user questions, classifies them, and generates responses.
     * @param userId - The ID of the user initiating the chat.
     * @param question - The user's question.
     * @param conversationId - Optional ID of an existing conversation.
     * @returns The generated response.
     */
    public async handleChat(userId: string, question: string, conversationId?: string): Promise<string> {
        // Clean up old rate limit data
        await this.cleanupRateLimits();

        // Validate request
        const validation = await this.validateRequest(userId, question);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(' '));
        }

        // Increment active requests
        this.activeRequests++;

        try {
            return await this.retryWithBackoff(
                async () => {
                    console.log('\n🚀 ===== Začínam spracovanie otázky =====');
                    console.log('📝 Otázka:', question);
                    console.log('🔑 Socket ID:', userId);
                    console.log('=====================================\n');

                    // Get conversation state and history
                    const state = this.getOrCreateState(userId);
                    const history = state.history || [];
                    console.log('📜 Conversation History:', history.length, 'messages');
                    
                    // Format and log the conversation history
                    const formattedHistory = this.formatConversationHistory(history);
                    console.log('\n📝 Formatted Conversation History:');
                    console.log(formattedHistory);
                    console.log('=====================================\n');

                    // Add current question to history
                    const updatedHistory = [...history, { role: 'user' as const, content: question }];
                    
                    // Update state with new history
                    this.updateState(userId, {
                        history: updatedHistory,
                        previousQuestions: [...state.previousQuestions, question]
                    });

                    // Optimize OpenAI context with full history
                    const optimizedContext = await this.optimizeOpenAIContext(state);
                    console.log('\n🤖 Optimized OpenAI Context:');
                    console.log(`Total messages: ${optimizedContext.length}`);
                    console.log(`Estimated tokens: ${state.openAIContext.lastTokenCount}`);
                    console.log('=====================================\n');

                    // Get response from retrieval service with full history
                    const response = await retrievalService.handleRagQuestion(question, optimizedContext, userId);
                    console.log('\n✅ RAG Processing Complete');
                    console.log('=====================================\n');

                    // Add assistant's response to history
                    const finalHistory = [...updatedHistory, { role: 'assistant' as const, content: response }];
                    
                    // Update state with final history
                    this.updateState(userId, {
                        history: finalHistory,
                        lastResponse: response
                    });

                    // Log the updated conversation history
                    const updatedFormattedHistory = this.formatConversationHistory(finalHistory);
                    console.log('\n📝 Updated Conversation History:');
                    console.log(updatedFormattedHistory);
                    console.log('=====================================\n');

                    // Update conversation summary with recent history
                    await this.updateConversationSummary(state, finalHistory);

                    console.log('📤 Sending response to client...');
                    console.log('✅ ===== QUESTION PROCESSING COMPLETE =====\n');

                    return response;
                },
                'Failed to process chat message'
            );
        } finally {
            // Decrement active requests
            this.activeRequests--;
        }
    }

    public async getConversationHistory(userId: string): Promise<ChatMessage[]> {
        try {
            const state = this.getOrCreateState(userId);
            return state.history || [];
        } catch (error) {
            console.error('Error getting conversation history:', error);
            return [];
        }
    }

    public async updateConversationHistory(userId: string, history: ChatMessage[]): Promise<void> {
        try {
            const state = this.getOrCreateState(userId);
            state.history = history.slice(-this.MAX_HISTORY_LENGTH);
            state.timestamp = Date.now();
            this.conversationStates.set(userId, state);
        } catch (error) {
            console.error('Error updating conversation history:', error);
        }
    }

    /**
     * Classifies the user's question into a specific type using OpenAI.
     * @param question - The user's input.
     * @param history - Previous messages in the conversation.
     * @returns The classified question type and reasoning.
     */
    public async classifyQuestionWithOpenAI(question: string, history: ChatMessage[]): Promise<{ classification: string; reasoning: string }> {
        try {
            console.log('\n=== OpenAI klasifikácia otázky ===');
            console.log('Otázka:', question);
            console.log('Dĺžka histórie:', history.length);

            const classificationPrompt = `Analyzujte túto právnu otázku a klasifikujte ju do jednej z týchto kategórií:
1. specific_document - Ak sa pýtate na konkrétny zákon, rozhodnutie alebo dokument (napr. "Čo hovorí §123 Zákona č. 40/1964?", "Čo hovorí Obchodný zákonník o...", "Ako je definované v Zákonníku práce...")
2. legal_analysis - Ak vyžaduje právnu analýzu alebo úvahu (napr. "Aké sú požiadavky na podanie patentu?", "Aké sú podmienky pre založenie s.r.o.?")
3. general - Ak ide o všeobecnú otázku o právnych konceptoch (napr. "Čo je to autorské právo?", "Čo je to obchodná spoločnosť?")
4. continuation - Ak pokračujete v predchádzajúcej téme (napr. "Povedz mi viac o tom", "Môžeš to vysvetliť podrobnejšie")
5. special_command - Ak ide o špeciálny príkaz (napr. "zhrň to", "exportuj konverzáciu")

Otázka: ${question}

Predchádzajúci kontext konverzácie:
${history.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Odpovedzte POUZE názvom kategórie, nič iné.`;

            console.log('\nKlasifikačný prompt:');
            console.log(classificationPrompt);

            const classification = await this.openAIService.generateResponse(classificationPrompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');

            // Get detailed reasoning for the classification
            const reasoningPrompt = `Analyzujte túto právnu otázku a poskytnite detailné vysvetlenie:
Otázka: ${question}

Prosím poskytnite:
1. Prečo je to právna otázka
2. Či vyžaduje RAG (Retrieval Augmented Generation)
3. Aké typy právnych dokumentov alebo kontextu by boli relevantné
4. Prečo bola klasifikovaná ako "${classification}"
5. Aké konkrétne aspekty otázky viedli k tejto klasifikácii

Formát odpovede:
PRÁVNA OTÁZKA: [Áno/Nie] - [Vysvetlenie]
RAG POTREBNÝ: [Áno/Nie] - [Vysvetlenie]
RELEVANTNÝ KONTEXT: [Typy dokumentov/kontextu potrebné]
KLASIFIKÁCIA: [Kategória] - [Vysvetlenie]
KĽÚČOVÉ FAKTORY: [Zoznam faktorov, ktoré viedli k klasifikácii]`;

            const reasoning = await this.openAIService.generateResponse(reasoningPrompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');

            return {
                classification: classification.trim().toLowerCase(),
                reasoning
            };
        } catch (error) {
            console.error('Chyba pri klasifikácii otázky:', error);
            throw error;
        }
    }

    public getProcessingPath(questionType: string): string {
        switch (questionType) {
            case 'specific_document':
                return 'retrievalService.getSpecificDocument() -> Direct document lookup with RAG';
            case 'legal_analysis':
                return 'handleLegalAnalysis() -> RAG-based analysis with document context';
            case 'general':
                return 'generateDirectAnswer() -> Direct OpenAI response without RAG';
            case 'continuation':
                return 'handleContinuation() -> Context-aware follow-up response';
            case 'special_command':
                return 'handleSpecialCommand() -> Special operation handler';
            default:
                return 'Unknown processing path';
        }
    }

    /**
     * Checks if the question requests a specific document (e.g., law or ruling).
     */
    private isSpecificDocumentRequest(question: string): boolean {
        // Check for specific law references
        const hasLawReference = /law no\.|ruling no\.|§|zákonník|zákon/i.test(question);
        
        // Check for court ruling references
        const hasRulingReference = /rozhodnutie|rozsudok|súd/i.test(question);
        
        // Check for legal document types
        const hasLegalDocType = /trest|penalties|sanctions|trestný|trestné/i.test(question);
        
        const isSpecific = hasLawReference || hasRulingReference || hasLegalDocType;
        
        console.log('Legal Document Check:');
        console.log('- Has Law Reference:', hasLawReference);
        console.log('- Has Ruling Reference:', hasRulingReference);
        console.log('- Has Legal Doc Type:', hasLegalDocType);
        console.log('Final Result:', isSpecific ? 'Yes - Using RAG' : 'No');
        
        return isSpecific;
    }

    /**
     * Handles legal analysis questions with subtypes (explanation, comparison, hypothesis).
     */
    public async handleLegalAnalysis(question: string, history: ChatMessage[], conversationId: string): Promise<string> {
        try {
            console.log('\n=== Začínam právnu analýzu ===');
            console.log('Otázka:', question);
            console.log('Dĺžka histórie:', history.length);

            const searchResults = await retrievalService.searchRelevantDocuments(question, conversationId);
            console.log(`Našiel som ${searchResults.length} relevantných dokumentov pre analýzu`);

            const context = retrievalService.formatSearchResults(searchResults);
            console.log('Dĺžka kontextu:', context.length);

            const prompt = `Na základe nasledujúceho právneho kontextu a otázky poskytnite detailnú právnu analýzu:
Kontext: ${context}

Otázka: ${question}

Prosím poskytnite:
1. Kľúčové právne zásady
2. Relevantné zákony a predpisy
3. Analýzu situácie
4. Potenciálne dôsledky
5. Súvisiace precedenty alebo prípady`;

            console.log('\nAnalytický prompt:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, conversationId);
            
            console.log('\n=== Vygenerovaná právna analýza ===');
            console.log(response);
            console.log('=== Koniec právnej analýzy ===\n');

            return response;
        } catch (error) {
            console.error('Chyba v právnej analýze:', error);
            throw error;
        }
    }

    /**
     * Generates a direct answer for general questions without RAG.
     */
    public async generateDirectAnswer(question: string, history: ChatMessage[]): Promise<string> {
        const prompt = `História: ${JSON.stringify(history)}\nOtázka: ${question}`;
        return await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');
    }

    /**
     * Handles follow-up questions by considering the conversation context.
     */
    public async handleContinuation(question: string, history: ChatMessage[]): Promise<string> {
        try {
            console.log('\n=== Začínam spracovanie pokračovania ===');
            console.log('Otázka:', question);
            console.log('Predchádzajúci kontext:', history[history.length - 1]?.content);

            const lastMessage = history[history.length - 1];
            const prompt = `Toto je pokračovanie predchádzajúcej otázky. Predchádzajúci kontext:
${lastMessage.content}

Aktuálna otázka: ${question}

Prosím poskytnite odpoveď, ktorá nadväzuje na predchádzajúci kontext.`;

            console.log('\nPrompt pre pokračovanie:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');
            
            console.log('\n=== Vygenerovaná odpoveď na pokračovanie ===');
            console.log(response);
            console.log('=== Koniec pokračovania ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri spracovaní pokračovania:', error);
            throw error;
        }
    }

    /**
     * Processes special commands like summarization or export.
     */
    public async handleSpecialCommand(question: string, history: ChatMessage[]): Promise<string> {
        try {
            console.log('\n=== Začínam spracovanie špeciálneho príkazu ===');
            console.log('Príkaz:', question);

            const prompt = `Spracujte tento špeciálny príkaz:
${question}

Prosím poskytnite vhodnú odpoveď na základe typu príkazu.`;

            console.log('\nPrompt pre špeciálny príkaz:');
            console.log(prompt);

            const response = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');
            
            console.log('\n=== Vygenerovaná odpoveď na špeciálny príkaz ===');
            console.log(response);
            console.log('=== Koniec špeciálneho príkazu ===\n');

            return response;
        } catch (error) {
            console.error('Chyba pri spracovaní špeciálneho príkazu:', error);
            throw error;
        }
    }

    /**
     * Detects if the question is a correction of a previous input.
     */
    private isCorrection(question: string): boolean {
        return /nie, myslel som|oprav/i.test(question);
    }

    /**
     * Extracts the corrected question from the user's input.
     */
    private extractCorrectedQuestion(question: string): string {
        const match = question.match(/myslel som (.+)$/i);
        return match ? match[1] : question;
    }

    /**
     * Checks if the question is general (non-legal).
     */
    private isGeneralQuestion(question: string): boolean {
        const isGeneral = !/zákon|rozhodnutie|právny|trest|súd|vysvetliť|porovnať/i.test(question);
        console.log('Kontrola všeobecnej otázky:', isGeneral ? 'Áno' : 'Nie');
        return isGeneral;
    }

    /**
     * Determines if the question is a continuation based on context.
     */
    private isContinuation(question: string, history: ChatMessage[]): boolean {
        const isContinuation = history.length > 0 && /ďalej|pokračovať|ohľadom/i.test(question);
        console.log('Kontrola pokračovania:', isContinuation ? 'Áno' : 'Nie');
        return isContinuation;
    }

    /**
     * Decides if RAG is needed for a continuation based on history.
     */
    private needsRagForContinuation(history: ChatMessage[]): boolean {
        return history.some(msg => /zákon|rozhodnutie|právny/i.test(msg.content));
    }

    /**
     * Placeholder for calling the Language Model (e.g., LangChain LLM).
     */
    private async callLLM(prompt: string): Promise<string> {
        // TODO: Implement LangChain LLM call
        return 'Mock response';
    }

    /**
     * Checks if the question is a special command (e.g., summarize, export).
     */
    private isSpecialCommand(question: string): boolean {
        const isSpecial = /zhrnúť|zhrnúť to|uložiť|exportovať/i.test(question);
        console.log('Kontrola špeciálneho príkazu:', isSpecial ? 'Áno' : 'Nie');
        return isSpecial;
    }

    /**
     * Creates a user message for the chat history.
     */
    private createUserMessage(content: string): ChatMessage {
        return {
            role: 'user',
            content: content
        };
    }

    /**
     * Creates an assistant message for the chat history.
     */
    private createAssistantMessage(content: string): ChatMessage {
        return {
            role: 'assistant',
            content: content
        };
    }

    public async handleMessage(message: string, conversationId: string): Promise<string> {
        try {
            const state = this.getOrCreateState(conversationId);
            
            // Classify the question type
            const classification = await this.classifyQuestionType(message, state);
            
            // Update state based on classification
            this.updateState(conversationId, {
                isFollowUpQuestion: classification.isFollowUp,
                previousQuestions: [...state.previousQuestions, message]
            });

            // If it's a new case, clear the current case
            if (classification.isNewCase) {
                this.updateState(conversationId, {
                    currentCase: undefined
                });
            }

            // Get response from retrieval service
            const response = await retrievalService.handleRagQuestion(message, [], conversationId);

            // Extract case information from response
            const caseInfo = await this.extractCaseInfo(response);
            
            // Update state with case information if available
            if (caseInfo.caseId && caseInfo.court && caseInfo.caseNumber) {
                this.updateState(conversationId, {
                    currentCase: {
                        caseId: caseInfo.caseId,
                        court: caseInfo.court,
                        caseNumber: caseInfo.caseNumber,
                        domain: caseInfo.domain || 'unknown'
                    },
                    lastResponse: response
                });
            }

            return response;
        } catch (error) {
            console.error('Error handling message:', error);
            throw error;
        }
    }

    public clearConversation(userId: string): void {
        this.conversationStates.delete(userId);
    }

    private async validateResponse(response: string): Promise<boolean> {
        try {
            const prompt = `Validate this legal response:
${response}

Check for:
1. Legal accuracy
2. Completeness
3. Relevance
4. Proper citations
5. Appropriate tone

Respond with "VALID" or "INVALID" followed by a brief reason.`;

            const validation = await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, '');
            return validation.trim().startsWith('VALID');
        } catch (error) {
            console.error('Error validating response:', error);
            return false;
        }
    }

    private async handleFailedResponse(question: string, history: ChatMessage[]): Promise<string> {
        try {
            const prompt = `The previous response failed. Please provide a fallback response for:
${question}

Previous context:
${history.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Provide a general legal response that:
1. Acknowledges the difficulty
2. Offers general guidance
3. Suggests alternative approaches
4. Maintains professional tone`;

            return await this.openAIService.generateResponse(prompt, SYSTEM_PROMPTS.LEGAL, history[0]?.content || 'new_conversation');
        } catch (error) {
            console.error('Error generating fallback response:', error);
            return 'I apologize, but I encountered an error processing your request. Please try rephrasing your question or try again later.';
        }
    }
}

export const chatService = ChatService.getInstance();