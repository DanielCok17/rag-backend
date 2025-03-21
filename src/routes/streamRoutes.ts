import express, { RequestHandler } from 'express';
import { startStreaming } from '../controllers/streamController';

const router = express.Router();

// Handle streaming requests
router.post('/', startStreaming as RequestHandler);

export default router; 