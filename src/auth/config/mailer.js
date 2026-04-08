
import nodemailer from "nodemailer";
import { authConfig } from "./auth.config.js";

export const transporter = nodemailer.createTransport({
  host: authConfig.host,        // e.g. smtp.gmail.com
  port: authConfig.mailport || 587,
  secure:authConfig.mailport == 465,                      // true for 465, false for 587
  auth: {
    user: authConfig.mail,
    pass: authConfig.pass,
  },
});
export const sendOtpEmail = async ({ to, code, expiresInMinutes }) => {
  try {
    const info = await transporter.sendMail({
      from: `"CampusChat" <${authConfig.mail}>`,
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

    console.log("Email sent:", info.messageId);
  } catch (error) {
    console.error("Email failed:", error);
    throw new Error("Failed to send OTP email");
  }
};