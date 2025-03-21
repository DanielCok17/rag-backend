import { Router } from 'express';
import { testQdrantConnection } from '../controllers/testController';

const router = Router();

router.get('/test-qdrant', testQdrantConnection);

export default router; 