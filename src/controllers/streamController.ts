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
        console.log('\n🚀 ===== STARTING QUESTION PROCESSING =====');
        console.log('📝 Question:', question);
        console.log('🔑 Socket ID:', socket.socketId);
        console.log('=====================================\n');

        // Create a new conversation ID for this stream
        const conversationId = `stream_${Date.now()}`;

        // Get classification and reasoning from OpenAI
        console.log('🤖 Starting OpenAI Classification...');
        const { classification, reasoning } = await chatService.classifyQuestionWithOpenAI(question, []);
        
        console.log('\n📊 ===== CLASSIFICATION RESULTS =====');
        console.log('📌 Type:', classification);
        console.log('🔍 Analysis:', reasoning);
        console.log('🛣️ Processing Path:', chatService.getProcessingPath(classification));
        console.log('=====================================\n');

        // Send start message
        socket.send(JSON.stringify({
            type: 'start',
            message: 'Processing your question...'
        }));

        // Process based on classification
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
                response = await chatService.handleLegalAnalysis(question, [], conversationId);
                console.log('✅ RAG Processing Complete');
                console.log('=====================================\n');
                break;
            case 'general':
                console.log('\n⚠️ ===== NO RAG: DIRECT OPENAI RESPONSE =====');
                console.log('ℹ️ Question does not require legal document context');
                response = await chatService.generateDirectAnswer(question, []);
                console.log('=====================================\n');
                break;
            case 'continuation':
                console.log('\n🔄 ===== PROCESSING CONTINUATION =====');
                console.log('📝 Using conversation history for context');
                response = await chatService.handleContinuation(question, []);
                console.log('=====================================\n');
                break;
            case 'special_command':
                console.log('\n⚙️ ===== PROCESSING SPECIAL COMMAND =====');
                response = await chatService.handleSpecialCommand(question, []);
                console.log('=====================================\n');
                break;
            default:
                console.log('\n⚠️ ===== UNKNOWN TYPE: FALLING BACK =====');
                console.log('ℹ️ Using direct OpenAI response without RAG');
                response = await chatService.generateDirectAnswer(question, []);
                console.log('=====================================\n');
        }

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