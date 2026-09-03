import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
});

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await transport.sendMail({
    from: process.env.MAIL_FROM || 'no-reply@eonrover.com',
    to,
    subject,
    html,
  });
}

export function verificationEmailHtml(link: string): string {
  return `<h1>Welcome to Eon Rover</h1><p>Confirm your account to begin colonising the Eon Reach.</p>
  <p><a href="${link}">Verify my email</a></p><p>This link expires in 24 hours.</p>`;
}

export function passwordResetEmailHtml(link: string): string {
  return `<h1>Reset your Eon Rover password</h1>
  <p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`;
}
