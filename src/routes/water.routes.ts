import { Router } from 'express';
import { getWater, upsertWater } from '../controllers/water.controller';

const router = Router({ mergeParams: true });

router.get('/', getWater);
router.put('/:date', upsertWater);

export default router;
