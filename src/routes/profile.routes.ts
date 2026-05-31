import { Router } from 'express';
import { getProfile, updateProfile, savePushToken, getAvatar, uploadAvatar, deleteAvatar, exportData, exportWeeklyReport } from '../controllers/profile.controller';

const router = Router({ mergeParams: true });

router.get('/', getProfile);
router.put('/', updateProfile);
router.put('/push-token', savePushToken);
router.get('/avatar', getAvatar);
router.put('/avatar', uploadAvatar);
router.delete('/avatar', deleteAvatar);
router.get('/export', exportData);
router.get('/weekly-report', exportWeeklyReport);

export default router;
