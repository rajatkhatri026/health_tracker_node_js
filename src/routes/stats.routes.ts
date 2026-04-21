import { Router } from 'express';
import { getPlatformStats } from '../controllers/stats.controller';

const router = Router();

router.get('/', getPlatformStats);

export default router;
