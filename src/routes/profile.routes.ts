import { Router } from 'express';
import { getProfile, updateProfile, savePushToken, getAvatar, uploadAvatar, deleteAvatar, exportData } from '../controllers/profile.controller';

const router = Router({ mergeParams: true });

router.get('/', getProfile);
router.put('/', updateProfile);
router.put('/push-token', savePushToken);
router.get('/avatar', getAvatar);
router.put('/avatar', uploadAvatar);
router.delete('/avatar', deleteAvatar);
router.get('/export', exportData);

export default router;
