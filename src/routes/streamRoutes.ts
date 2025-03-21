import express, { RequestHandler } from 'express';
import { startStreaming } from '../controllers/streamController';

const router = express.Router();

router.post('/stream', startStreaming as RequestHandler);

export default router; 