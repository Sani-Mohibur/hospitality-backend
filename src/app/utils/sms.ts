import config from '../config';
import logger from './logger';

export type TSmsChannel = 'SMS' | 'WHATSAPP';

// Sends a text message. With SMS_PROVIDER=log (default) messages are only logged,
// so development and tests never send real texts.
export const sendSms = async (to: string, body: string, channel: TSmsChannel = 'SMS') => {
  if (config.sms.provider !== 'twilio') {
    logger.info({ to, channel, body }, 'SMS (log provider)');
    return { provider: 'log', id: `log_${Date.now()}` };
  }
  const { twilio_account_sid: sid, twilio_auth_token: token, twilio_from: from, twilio_whatsapp_from: waFrom } = config.sms;
  if (!sid || !token || !(channel === 'WHATSAPP' ? waFrom : from)) throw new Error('Twilio is not configured');
  const params = new URLSearchParams({
    To: channel === 'WHATSAPP' ? `whatsapp:${to}` : to,
    From: channel === 'WHATSAPP' ? `whatsapp:${waFrom}` : from!,
    Body: body,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio error: ${json.message || res.status}`);
  return { provider: 'twilio', id: json.sid };
};
