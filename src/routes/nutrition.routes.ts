import { Router } from 'express';
import { searchFood, getGoalPlans } from '../controllers/nutrition.controller';

const router = Router();

router.get('/search', searchFood);
router.get('/plans', getGoalPlans);

export default router;
