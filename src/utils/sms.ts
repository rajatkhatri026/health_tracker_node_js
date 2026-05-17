const provider = (process.env.SMS_PROVIDER ?? 'mock').toLowerCase();

async function sendViaTwilio(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error ${res.status}: ${text}`);
  }
}

async function sendViaFast2Sms(to: string, body: string): Promise<void> {
  const apiKey = process.env.FAST2SMS_API_KEY!;
  // Fast2SMS expects the number without country code for Indian numbers
  const mobile = to.replace(/^\+91/, '');

  const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      route: 'q',
      message: body,
      language: 'english',
      flash: 0,
      numbers: mobile,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fast2SMS error ${res.status}: ${text}`);
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  switch (provider) {
    case 'twilio':
      await sendViaTwilio(to, body);
      break;

    case 'fast2sms':
      await sendViaFast2Sms(to, body);
      break;

    case 'mock':
    default:
      console.log(`[SMS MOCK] OTP sent to [REDACTED]`);
      break;
  }
}
