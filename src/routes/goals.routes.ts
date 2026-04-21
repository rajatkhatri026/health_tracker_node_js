import { Router } from 'express';
import { getGoals, createGoal, updateGoal, deleteGoal } from '../controllers/goals.controller';

const router = Router({ mergeParams: true });

router.get('/', getGoals);
router.post('/', createGoal);
router.put('/:goal_id', updateGoal);
router.delete('/:goal_id', deleteGoal);

export default router;
