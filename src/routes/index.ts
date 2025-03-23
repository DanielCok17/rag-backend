import { Router } from 'express';
import testRoutes from './testRoutes';
import streamRoutes from './streamRoutes';
import qdrantRoutes from './qdrantRoutes';

const router = Router();

// API Routes
router.use('/test', testRoutes);
router.use('/stream', streamRoutes);
router.use('/qdrant', qdrantRoutes);

export default router; 