import 'dotenv/config';
import app from './app';
import prisma from './utils/prisma';
import { startCleanupJob } from './utils/cleanup';
import { startNotificationJobs } from './utils/notificationJobs';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
// Bind to 0.0.0.0 so physical devices on the same Wi-Fi can reach the API.
// On localhost-only (127.0.0.1) the iPhone/Android device cannot connect
// even if you use the Mac's LAN IP in the URL.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  await prisma.$connect();
  console.log('Database connected');
  startCleanupJob();
  startNotificationJobs();

  app.listen(PORT, HOST, async () => {
    console.log(`Server running on http://${HOST}:${PORT}`);

    if (process.env.NGROK_ENABLED === 'true' && process.env.NGROK_AUTHTOKEN) {
      try {
        const ngrok = await import('@ngrok/ngrok');
        const listener = await ngrok.connect({
          addr: PORT,
          authtoken: process.env.NGROK_AUTHTOKEN,
          pooling_enabled: true,
        });
        console.log(`\nNgrok tunnel active: ${listener.url()}`);
        console.log(`Set in React Native .env: EXPO_PUBLIC_API_BASE_URL=${listener.url()}\n`);
      } catch (e) {
        console.error('Ngrok failed to start:', e);
      }
    }
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
