//src/auth/config/resend.js

import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async ({ to, code, expiresInMinutes }) => {
  await resend.emails.send({
    from:    `"${process.env.APP_NAME ?? "App"}" <onboarding@resend.dev>`, // use your verified domain in prod
    to,
    subject: "Your verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Verify your email</h2>
        <p>Your one-time code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;padding:16px 0">${code}</div>
        <p style="color:#666">Expires in ${expiresInMinutes} minutes. Do not share this code.</p>
      </div>
    `,
  });
};