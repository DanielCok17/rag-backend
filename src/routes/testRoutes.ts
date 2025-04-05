import express, { RequestHandler } from 'express';
import { testQdrantConnection } from '../controllers/testController';

const router = express.Router();

router.get('/qdrant', testQdrantConnection as RequestHandler);

export default router; 