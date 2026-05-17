import { Router } from 'express';
import {
  getNotifications,
  getUnreadCount,
  createNotification,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
} from '../controllers/notifications.controller';

const router = Router({ mergeParams: true });

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/', createNotification);
router.patch('/read-all', markAllRead);
router.patch('/:notif_id/read', markRead);
router.delete('/', clearAll);
router.delete('/:notif_id', deleteNotification);

export default router;
