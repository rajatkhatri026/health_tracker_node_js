import { Router } from 'express';
import { getMetrics, createMetric, deleteMetric } from '../controllers/metrics.controller';

const router = Router({ mergeParams: true });

router.get('/', getMetrics);
router.post('/', createMetric);
router.delete('/:metric_id', deleteMetric);

export default router;
