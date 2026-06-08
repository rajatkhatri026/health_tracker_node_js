import 'dotenv/config';
import app from './app';
import prisma from './utils/prisma';
import { startCleanupJob } from './utils/cleanup';
import { startNotificationJobs } from './utils/notificationJobs';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  await prisma.$connect();
  console.log('Database connected');
  startCleanupJob();
  startNotificationJobs();

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
