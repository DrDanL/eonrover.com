export type MailCall = [to: string, subject: string, html: string];

export function verificationTokenFromMail(calls: MailCall[], recipient: string): string {
  const call = [...calls]
    .reverse()
    .find(([to, subject]) => to === recipient && subject === 'Verify your Eon Rover account');
  if (!call) throw new Error(`No verification email was sent to ${recipient}`);

  const href = call[2].match(/href="([^"]+)"/)?.[1];
  const token = href ? new URL(href).searchParams.get('token') : null;
  if (!token) throw new Error(`The verification email for ${recipient} did not contain a token`);
  return token;
}
