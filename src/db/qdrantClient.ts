import { QdrantClient } from '@qdrant/js-client-rest';
import * as dotenv from 'dotenv';

dotenv.config();

interface QdrantConfig {
  host: string;
  port: string;
  collectionName: string;
}

interface CollectionInfo {
  name: string;
}

interface CollectionsList {
  collections: CollectionInfo[];
}

interface VectorConfig {
  size: number;
  distance: 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
}

class QdrantClientSingleton {
  private static instance: QdrantClient | null = null;

  public static readonly COLLECTION_NAME: string =
    process.env.QDRANT_COLLECTION || '500_chunk_size_10_overlap_court_judgements';

  private static readonly config: QdrantConfig = {
    host: process.env.QDRANT_HOST || 'localhost',
    port: process.env.QDRANT_PORT || '6333',
    collectionName: QdrantClientSingleton.COLLECTION_NAME
  };

  private static readonly baseUrl = `http://${QdrantClientSingleton.config.host}:${QdrantClientSingleton.config.port}`;

  private constructor() { }

  public static getInstance(): QdrantClient {
    if (!QdrantClientSingleton.instance) {
      QdrantClientSingleton.instance = new QdrantClient({
        url: QdrantClientSingleton.baseUrl,
        timeout: 30000,
      });
      console.log(`Qdrant client initialized at: ${QdrantClientSingleton.baseUrl}`);
    }
    return QdrantClientSingleton.instance;
  }

  public static async collectionExists(collectionName: string = this.COLLECTION_NAME): Promise<boolean> {
    try {
      const client = this.getInstance();
      const collections: CollectionsList = await client.getCollections();
      return collections.collections.some(coll => coll.name === collectionName);
    } catch (error) {
      console.error(`Error checking collection: ${error}`);
      throw error;
    }
  }

  public static async createCollection(
    collectionName: string = this.COLLECTION_NAME,
    size: number = 3072,
    distance: 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan' = 'Cosine'
  ): Promise<void> {
    try {
      const client = this.getInstance();
      await client.createCollection(collectionName, {
        vectors: {
          size: size,
          distance: distance
        }
      });
      console.log(`Collection '${collectionName}' created`);
    } catch (error) {
      console.error(`Error creating collection: ${error}`);
      throw error;
    }
  }

  public static async ensureCollection(recreate: boolean = false): Promise<void> {
    try {
      if (recreate) {
      } else if (!(await this.collectionExists())) {
        await this.createCollection();
      }
      console.log(`Collection '${this.COLLECTION_NAME}' ready`);
    } catch (error) {
      console.error(`Error ensuring collection: ${error}`);
      throw error;
    }
  }
}

// Usage in index.ts
async function bootstrap() {
  try {
    await QdrantClientSingleton.ensureCollection(false); // false = don't recreate if exists
    console.log('Application started successfully');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();

export default QdrantClientSingleton;