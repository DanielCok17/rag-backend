import express from 'express';
import { testQdrantConnection } from '../controllers/testController';

const router = express.Router();

router.get('/qdrant', testQdrantConnection);

export default router; 