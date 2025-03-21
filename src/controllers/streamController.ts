import { Request, Response } from 'express';
import QdrantClientSingleton from '../db/qdrantClient';
import SocketService from '../services/socketService';

export const startStreaming = async (req: Request, res: Response) => {
    const { question } = req.body;
    const socketId = req.headers['x-socket-id'] as string;

    if (!socketId) {
        return res.status(400).json({ error: 'Socket ID is required' });
    }

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        const socketService = SocketService.getInstance();
        
        // Start the streaming process
        const client = QdrantClientSingleton.getInstance();
        
        // Search for relevant documents
        const searchResult = await client.search(QdrantClientSingleton.COLLECTION_NAME, {
            vector: Array(3072).fill(0), // Replace with actual embedding
            limit: 5
        });

        // Send the search results as chunks
        socketService.sendStreamChunk(socketId, JSON.stringify({
            type: 'search_results',
            data: searchResult
        }));

        // Here you would typically:
        // 1. Process the search results
        // 2. Generate a response using your LLM
        // 3. Stream the response chunks

        // For demonstration, let's send some mock chunks
        const mockResponse = "This is a mock streaming response...";
        for (let i = 0; i < mockResponse.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
            socketService.sendStreamChunk(socketId, mockResponse[i]);
        }

        // Send completion
        socketService.sendStreamComplete(socketId, {
            message: 'Streaming completed',
            timestamp: new Date().toISOString()
        });

        res.json({ message: 'Streaming started' });
    } catch (error) {
        console.error('Streaming error:', error);
        const socketService = SocketService.getInstance();
        socketService.sendError(socketId, error instanceof Error ? error.message : 'Unknown error occurred');
        res.status(500).json({ error: 'Failed to start streaming' });
    }
}; 