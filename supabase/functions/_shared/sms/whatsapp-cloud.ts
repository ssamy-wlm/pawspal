// WhatsApp Business Cloud API (Meta): sends the code with an approved "authentication" template.
// Use it first and fall back to SMS: SMS_PROVIDERS=whatsapp-cloud,generic-http
//
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's ID from Meta
//   WHATSAPP_ACCESS_TOKEN     a system-user token (a secret)
//   WHATSAPP_TEMPLATE_NAME    the approved authentication template, for example pawspal_otp
//   WHATSAPP_TEMPLATE_LANG    default ar
//   WHATSAPP_API_VERSION      default v21.0
import { ConfigError, type Env } from '../config.ts';
import { SmsError, type SmsDeps, type SmsMessage, type SmsProvider } from './types.ts';

export function whatsappCloudProvider(env: Env): SmsProvider {
  const phoneId = env.get('WHATSAPP_PHONE_NUMBER_ID');
  const token = env.get('WHATSAPP_ACCESS_TOKEN');
  const template = env.get('WHATSAPP_TEMPLATE_NAME');
  if (!phoneId || !token || !template) {
    throw new ConfigError('WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_TEMPLATE_NAME must be set');
  }
  const lang = env.get('WHATSAPP_TEMPLATE_LANG') ?? 'ar';
  const version = env.get('WHATSAPP_API_VERSION') ?? 'v21.0';
  if (!/^\d+$/.test(phoneId) || !/^v\d+\.\d+$/.test(version)) throw new ConfigError('WhatsApp settings look wrong');

  return {
    name: 'whatsapp-cloud',
    async send(msg: SmsMessage, deps: SmsDeps) {
      const body = {
        messaging_product: 'whatsapp',
        to: msg.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: lang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: msg.code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.code }] },
          ],
        },
      };
      let res: Response;
      try {
        res = await deps.fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw new SmsError('whatsapp-cloud', null);
      }
      if (!res.ok) throw new SmsError('whatsapp-cloud', res.status);
    },
  };
}
