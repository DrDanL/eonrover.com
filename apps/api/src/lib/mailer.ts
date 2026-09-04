import nodemailer from 'nodemailer';
import { getApiConfig } from '../config';

const config = getApiConfig();

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  requireTLS: config.smtp.requireTls,
  disableFileAccess: true,
  disableUrlAccess: true,
});

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    html,
    disableFileAccess: true,
    disableUrlAccess: true,
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
