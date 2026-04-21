import { Router } from 'express';
import { connectDevice, getConsents, createConsent } from '../controllers/devices.controller';

const router = Router({ mergeParams: true });

router.post('/connect', connectDevice);

export default router;

export const consentRouter = Router({ mergeParams: true });
consentRouter.get('/', getConsents);
consentRouter.post('/', createConsent);
