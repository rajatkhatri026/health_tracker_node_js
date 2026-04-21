import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export const sendVerificationEmail = async (to: string, token: string, userId: string) => {
  const link = `http://localhost:8080/auth/verify-email?token=${token}&userId=${userId}`;

  await transporter.sendMail({
    from: `"HealthTracker" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Verify your email — HealthTracker',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#1D1D35;">Verify your email</h2>
        <p style="color:#666;line-height:1.6;">Click the button below to verify your email address. This link expires in 24 hours.</p>
        <a href="${link}" style="display:inline-block;margin-top:24px;padding:14px 32px;background:#92A3FD;color:#fff;border-radius:50px;text-decoration:none;font-weight:600;">
          Verify Email
        </a>
        <p style="margin-top:24px;color:#ADB5BD;font-size:12px;">If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });
};
