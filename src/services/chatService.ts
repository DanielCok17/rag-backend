import { retrievalService } from './retrievalService';
import { storageService } from './storageService';
import { ChatMessage, Conversation } from '../types/chat';
import OpenAIService from './openaiService';
import { monitoringService } from './monitoringService';

const SYSTEM_PROMPTS = {
    LEGAL: `Ste právny AI asistent. Vaše odpovede by mali byť:
1. Presné a založené na právnych princípoch
2. Jasné a dobre štruktúrované
3. Profesionálne v tóne
4. Zamerané na konkrétnu otázku
5. Obsahovať relevantné právne citácie, keď je to vhodné`
};

class ChatService {
    private openAIService: OpenAIService;

    constructor() {
        this.openAIService = OpenAIService.getInstance();
    }

    /**
     * Handles the main chat workflow: processes user questions, classifies them, and generates responses.
     * @param userId - The ID of the user initiating the chat.
     * @param question - The user's question.
     * @param conversationId - Optional ID of an existing conversation.
     * @returns The generated response.
     */
    async handleChat(userId: string, question: string, conversationId?: string): Promise<string> {
        console.log('\n🚀 ===== Začínam spracovanie otázky =====');
        console.log('📝 Otázka:', question);
        console.log('🔑 Socket ID:', userId);
        console.log('ID konverzácie:', conversationId || 'Nová konverzácia');

        // Load or create a conversation
        let conversation: Conversation = conversationId
            ? await storageService.getConversation(conversationId)
            : await storageService.createConversation(userId);

        let finalAnswer: string;
        const responseId = monitoringService.startResponseTracking(conversation.id);

        // Loop to handle corrections
        while (true) {
            // First, get the classification and reasoning
            const { classification, reasoning } = await this.classifyQuestionWithOpenAI(question, conversation.history);
            
            console.log('\n🤖 Začínam OpenAI klasifikáciu...');
            console.log('📊 ===== VÝSLEDKY KLASIFIKÁCIE =====');
            console.log('📌 Typ:', classification);
            console.log('🔍 Analýza:', reasoning);
            console.log('🛣️ Cesta spracovania:', this.getProcessingPath(classification));
            console.log('=====================================');

            // Process the question based on its type
            switch (classification) {
                case 'specific_document':
                    console.log('\n🔍 ===== POUŽÍVAM RAG: VYHĽADÁVANIE KONKRÉTNEHO DOKUMENTU =====');
                    console.log('📚 Vyhľadávam relevantné sekcie v právnych dokumentoch...');
                    finalAnswer = await retrievalService.getSpecificDocument(question, conversation.id);
                    console.log('✅ RAG spracovanie dokončené');
                    console.log('==============================================');
                    break;
                case 'legal_analysis':
                    console.log('\n🔍 ===== POUŽÍVAM RAG: PRÁVNA ANALÝZA =====');
                    console.log('📚 Získavam relevantný právny kontext...');
                    finalAnswer = await this.handleLegalAnalysis(question, conversation.history, conversation.id);
                    console.log('✅ RAG spracovanie dokončené');
                    console.log('==============================================');
                    break;
                case 'general':
                    console.log('\n⚠️ BEZ RAG: Používam priamu OpenAI odpoveď');
                    console.log('ℹ️ Otázka nevyžaduje kontext právnych dokumentov');
                    finalAnswer = await this.generateDirectAnswer(question, conversation.history);
                    break;
                case 'continuation':
                    console.log('\n🔄 Spracovanie pokračovania');
                    console.log('📝 Používam históriu konverzácie pre kontext');
                    finalAnswer = await this.handleContinuation(question, conversation.history);
                    break;
                case 'special_command':
                    console.log('\n⚙️ Spracovanie špeciálneho príkazu');
                    finalAnswer = await this.handleSpecialCommand(question, conversation.history);
                    break;
                default:
                    console.log('\n⚠️ Neznámy typ otázky, používam všeobecný handler');
                    console.log('ℹ️ Používam priamu OpenAI odpoveď bez RAG');
                    finalAnswer = await this.generateDirectAnswer(question, conversation.history);
            }

            console.log('=== Koniec spracovania ===\n');

            // Save the question and answer to the conversation history
            await storageService.saveMessage(conversation.id, {
                role: 'user',
                content: question
            });
            await storageService.saveMessage(conversation.id, {
                role: 'assistant',
                content: finalAnswer
            });

            // Check if the user is correcting a previous question
            if (this.isCorrection(question)) {
                console.log('Detekovaná požiadavka na opravu, spracovávam znova...');
                question = this.extractCorrectedQuestion(question);
                continue; // Reclassify the corrected question
            }
            break; // Exit if no correction is needed
        }

        // Get total metrics for this response
        const metrics = monitoringService.getMetrics(conversation.id);
        const totalCosts = monitoringService.getTotalCosts(conversation.id);

        console.log('\n📊 ===== METRIKY ODPOVEDE =====');
        console.log(`⏱️ Celkový čas: ${totalCosts.totalDuration}ms`);
        console.log(`💰 Celkové náklady: $${(totalCosts.totalPromptCost + totalCosts.totalResponseCost).toFixed(4)}`);
        console.log(`📝 Počet promptov: ${metrics.prompts.length}`);
        console.log(`💬 Počet odpovedí: ${metrics.responses.length}`);
        console.log('================================\n');

        monitoringService.endResponseTracking(
            conversation.id,
            responseId,
            metrics.prompts.reduce((sum, p) => sum + p.tokens.prompt + p.tokens.completion, 0),
            totalCosts.totalPromptCost + totalCosts.totalResponseCost
        );

        console.log('📤 Odosielam odpoveď klientovi...');
        console.log('✅ ===== SPRACOVANIE OTÁZKY DOKONČENÉ =====');
        return finalAnswer;
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
}

export const chatService = new ChatService();