import { RequestHandler } from 'express';
import { QdrantClientSingleton } from '../db/qdrantClient';
import { loggerService } from '../services/loggerService';

export const testQdrantConnection: RequestHandler = async (req, res) => {
    try {
        const client = QdrantClientSingleton.getInstance();
        if (!client) {
            loggerService.error('Qdrant client not initialized');
            res.status(503).json({
                status: 'error',
                message: 'Qdrant service not available',
                error: 'Qdrant client not initialized'
            });
            return;
        }

        const collectionName = QdrantClientSingleton.getCollectionName();

        // Test collection info
        const collectionInfo = await client.getCollection(collectionName);
        console.log('Collection info:', collectionInfo);

        // Test collection stats
        const stats = await client.getCollection(collectionName);
        console.log('Collection stats:', stats);

        // Test search
        const searchResult = await client.search(collectionName, {
            vector: new Array(1536).fill(0),
            limit: 1,
            with_payload: true
        });
        console.log('Search result:', searchResult);

        res.json({
            status: 'success',
            message: 'Qdrant connection test successful',
            collection: {
                name: collectionName,
                info: collectionInfo,
                stats: stats,
                searchTest: searchResult
            }
        });
    } catch (error) {
        loggerService.error('Error testing Qdrant connection', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.status(500).json({
            status: 'error',
            message: 'Failed to test Qdrant connection',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 