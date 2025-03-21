import { Request, Response } from 'express';
import QdrantClientSingleton from '../db/qdrantClient';

export const testQdrantConnection = async (req: Request, res: Response) => {
    try {
        const client = QdrantClientSingleton.getInstance();
        
        // Ensure collection exists with proper configuration
        await QdrantClientSingleton.ensureCollection(true); // Recreate collection to ensure proper configuration
        
        // Get collection info
        const collectionInfo = await client.getCollection(QdrantClientSingleton.COLLECTION_NAME);
        
        // Get collection statistics
        const stats = await client.getCollection(QdrantClientSingleton.COLLECTION_NAME);
        
        // Perform a simple search with a test vector (random vector for testing)
        const testVector = Array(3072).fill(0).map(() => Math.random() * 2 - 1);
        const searchResult = await client.search(QdrantClientSingleton.COLLECTION_NAME, {
            vector: testVector,
            limit: 1
        });

        res.json({
            status: 'success',
            message: 'Qdrant connection is working',
            collectionInfo: {
                name: QdrantClientSingleton.COLLECTION_NAME,
                pointsCount: stats.points_count,
                vectorsConfig: stats.config.params.vectors
            },
            searchTest: {
                result: searchResult[0] ? {
                    score: searchResult[0].score,
                    id: searchResult[0].id
                } : null
            }
        });
    } catch (error) {
        console.error('Qdrant test failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to test Qdrant connection',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}; 