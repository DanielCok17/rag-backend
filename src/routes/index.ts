import { Router } from 'express';
import testRoutes from './testRoutes';
import streamRoutes from './streamRoutes';

const router = Router();

// API Routes
router.use('/test', testRoutes);
router.use('/stream', streamRoutes);

export default router; 