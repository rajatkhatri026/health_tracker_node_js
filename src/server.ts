import 'dotenv/config';
import app from './app';
import prisma from './utils/prisma';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
// Bind to 0.0.0.0 so physical devices on the same Wi-Fi can reach the API.
// On localhost-only (127.0.0.1) the iPhone/Android device cannot connect
// even if you use the Mac's LAN IP in the URL.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  await prisma.$connect();
  console.log('Database connected');

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
