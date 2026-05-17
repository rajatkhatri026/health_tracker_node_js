import { Router } from 'express';
import { chat } from '../controllers/ai.controller';

const router = Router({ mergeParams: true });

router.post('/chat', chat);

export default router;
