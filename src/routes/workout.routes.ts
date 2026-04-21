import { Router } from 'express';
import { getWorkouts, createWorkout, createWorkoutsBulk, updateWorkout, completeWorkout, deleteWorkout, deleteWorkoutsBulk, getWorkoutStats } from '../controllers/workout.controller';

const router = Router({ mergeParams: true });

router.get('/', getWorkouts);
router.post('/', createWorkout);
router.post('/bulk', createWorkoutsBulk);
router.get('/stats', getWorkoutStats);
router.patch('/:workout_id', updateWorkout);
router.patch('/:workout_id/complete', completeWorkout);
router.delete('/bulk', deleteWorkoutsBulk);
router.delete('/:workout_id', deleteWorkout);

export default router;
