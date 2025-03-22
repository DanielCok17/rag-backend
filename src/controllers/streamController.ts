import { Request, Response } from 'express';
import { WebSocket } from 'ws';
import OpenAIService from '../services/openaiService';
import { chatService } from '../services/chatService';
import { retrievalService } from '../services/retrievalService';

const openAIService = OpenAIService.getInstance();

export const startStreaming = (req: Request, res: Response) => {
    res.status(200).json({ message: 'Streaming endpoint ready' });
};

export const handleQuestion = async (socket: WebSocket & { socketId?: string }, question: string) => {
    try {
        const conversationId = socket.socketId || 'test123';
        console.log('Processing question for socket', conversationId + ':', question);

        // Get conversation history from chat service
        const history = await chatService.getConversationHistory(conversationId);
        console.log('Retrieved conversation history:', history.length, 'messages');

        // Add current question to history
        const updatedHistory = [...history, { role: 'user' as const, content: question }];
        
        // Update state with new history
        await chatService.updateConversationHistory(conversationId, updatedHistory);

        // Format history for logging
        const formattedHistory = updatedHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
        console.log('\n📝 Current Conversation History:');
        console.log(formattedHistory);
        console.log('=====================================\n');

        // Classify the question with full history
        const { classification } = await chatService.classifyQuestionWithOpenAI(question, updatedHistory);
        console.log('\n📊 ===== CLASSIFICATION RESULTS =====');
        console.log('📌 Type:', classification);
        console.log('🛣️ Processing Path:', chatService.getProcessingPath(classification));
        console.log('=====================================\n');

        let response: string;

        switch (classification) {
            case 'specific_document':
                console.log('\n🔍 ===== USING RAG: SPECIFIC DOCUMENT SEARCH =====');
                console.log('📚 Searching for relevant sections in legal documents...');
                response = await retrievalService.getSpecificDocument(question, conversationId);
                console.log('✅ RAG Processing Complete');
                console.log('==============================================\n');
                break;
            case 'legal_analysis':
                console.log('\n🔍 ===== USING RAG: LEGAL ANALYSIS =====');
                console.log('📚 Retrieving relevant legal context...');
                response = await chatService.handleLegalAnalysis(question, updatedHistory, conversationId);
                console.log('✅ RAG Processing Complete');
                console.log('=====================================\n');
                break;
            case 'general':
                console.log('\n⚠️ ===== NO RAG: DIRECT OPENAI RESPONSE =====');
                console.log('ℹ️ Question does not require legal document context');
                response = await chatService.generateDirectAnswer(question, updatedHistory);
                console.log('=====================================\n');
                break;
            case 'continuation':
                console.log('\n🔄 ===== PROCESSING CONTINUATION =====');
                console.log('📝 Using conversation history for context');
                response = await chatService.handleContinuation(question, updatedHistory);
                console.log('=====================================\n');
                break;
            case 'special_command':
                console.log('\n⚙️ ===== PROCESSING SPECIAL COMMAND =====');
                response = await chatService.handleSpecialCommand(question, updatedHistory);
                console.log('=====================================\n');
                break;
            default:
                console.log('\n⚠️ ===== UNKNOWN TYPE: FALLING BACK =====');
                console.log('ℹ️ Using direct OpenAI response without RAG');
                response = await chatService.generateDirectAnswer(question, updatedHistory);
                console.log('=====================================\n');
        }

        // Add assistant's response to history
        const finalHistory = [...updatedHistory, { role: 'assistant' as const, content: response }];
        
        // Update state with final history
        await chatService.updateConversationHistory(conversationId, finalHistory);

        // Log the final history
        const finalFormattedHistory = finalHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
        console.log('\n📝 Final Conversation History:');
        console.log(finalFormattedHistory);
        console.log('=====================================\n');

        // Stream the response
        console.log('📤 Sending response to client...');
        socket.send(JSON.stringify({
            type: 'chunk',
            content: response
        }));

        // Send completion message
        socket.send(JSON.stringify({
            type: 'complete',
            message: 'Question processing completed'
        }));

        console.log('✅ ===== QUESTION PROCESSING COMPLETE =====\n');
    } catch (error) {
        console.error('❌ Error processing question:', error);
        socket.send(JSON.stringify({
            type: 'error',
            message: 'An error occurred while processing your question'
        }));
    }
}; 