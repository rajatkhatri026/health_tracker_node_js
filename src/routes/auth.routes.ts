import { Router } from 'express';
import { register, login, refresh, getMe, phoneAuth, sendEmailVerification, verifyEmail } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/phone', phoneAuth);
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.get('/me', authMiddleware, getMe);
router.post('/send-verification', authMiddleware, sendEmailVerification);
router.get('/verify-email', verifyEmail);

export default router;
