import { Router } from 'express';
import { getProfile, updateProfile, exportData } from '../controllers/profile.controller';

const router = Router({ mergeParams: true });

router.get('/', getProfile);
router.put('/', updateProfile);
router.get('/export', exportData);

export default router;
