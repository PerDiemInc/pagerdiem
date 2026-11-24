// Signing a phone in and out.
import { HttpError } from '../../http.js';
import { PLATFORMS, redeemPairingCode, verifierMatches } from '../../devices.js';
import { readPayload } from '../../auth.js';
import { REMOVED } from '../../actions.js';
import { appMe } from '../../app-api.js';
import { oneOf } from '../route.js';

const platform = oneOf(PLATFORMS, 'Unknown platform. Use ios or android.');

export default [
  {
    method: 'post', path: '/api/app/pair', auth: false,
    validate: { body: { platform } },
    handler: async (ctx, { db, rotation, devices, shifts }) => {
      const userId = await redeemPairingCode(db, String(ctx.body.code || ''), ctx.body.verifier);
      const user = userId ? await rotation.userById(userId) : null;
      if (!user) throw new HttpError(401, 'This code has expired or was already used. Make a new one on the Team page.');
      if (!user.active) throw new HttpError(401, REMOVED);
      const { device, token } = await devices.create(user.id, { platform: ctx.body.platform, name: ctx.body.deviceName });
      ctx.r.json({ token, me: appMe({ shifts, devices }, user, device) });
    },
  },
  {
    // Finish a Google sign-up started in the app: the same checks as the web's welcome page.
    method: 'post', path: '/api/app/signup', auth: false,
    validate: { body: { platform } },
    handler: async (ctx, { actions, devices, shifts }) => {
      const { pending, name, slack, phone, deviceName, verifier } = ctx.body;
      const identity = readPayload(String(pending || ''));
      if (!identity?.email || (identity.ch && !verifierMatches(identity.ch, verifier))) {
        throw new HttpError(401, 'This sign-up has expired. Sign in with Google again.');
      }
      const { user, error } = await actions.createMember({ name, email: identity.email, slack, whatsapp: phone, passwordHash: 'google' });
      if (error) throw new HttpError(400, error.message, error.field === 'whatsapp' ? 'phone' : error.field);
      const { device, token } = await devices.create(user.id, { platform: ctx.body.platform, name: deviceName });
      ctx.r.json({ token, me: appMe({ shifts, devices }, user, device) }, 201);
    },
  },
  {
    method: 'post', path: '/api/app/signout',
    handler: async (ctx, { devices }) => {
      await devices.revoke(ctx.device.id);
      ctx.r.empty();
    },
  },
];
