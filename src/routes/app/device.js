// This phone: who you are, its push token and wake-up checks, test calls, and your profile.
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { HttpError } from '../../http.js';
import { record } from '../../actions.js';
import { appMe } from '../../app-api.js';

const TEST_CALL_MS = 10 * 60_000;

export default [
  {
    method: 'get', path: '/api/app/me',
    handler: async (ctx, { shifts, devices }) => ctx.r.json(appMe({ shifts, devices }, ctx.user, ctx.device)),
  },
  {
    method: 'post', path: '/api/app/device',
    handler: async (ctx, { devices }) => {
      const device = await devices.update(ctx.device.id, { pushToken: ctx.body.pushToken, checks: ctx.body.checks });
      ctx.r.json(devices.toJson(device));
    },
  },
  {
    method: 'post', path: '/api/app/device/test-call',
    handler: async (ctx, { notify, testCalls }) => {
      if (!ctx.device.push_token) throw new HttpError(409, 'This phone has not registered for calls yet. Allow notifications first.');
      const now = new Date();
      for (const [id, t] of testCalls) if (now - t.at > TEST_CALL_MS) testCalls.delete(id);
      const callId = crypto.randomUUID();
      const result = await notify.callDevice(ctx.device, ctx.user, {
        payload: {
          type: 'test', callId, incidentId: '0', title: 'Test call from PagerDiem', reason: 'Answer it to finish the wake-up checks.',
          pagedBy: config.appName, attempt: 1, nextCallAt: '', server: config.publicUrl, sentAt: now.toISOString(),
        },
      });
      if (!result.ok) throw new HttpError(502, `Couldn't reach this phone: ${result.error?.message || 'push failed'}`);
      testCalls.set(callId, { deviceId: ctx.device.id, at: now });
      ctx.r.json({ callId });
    },
  },
  {
    method: 'post', path: '/api/app/device/test-call/answered',
    handler: async (ctx, { db, devices, testCalls }) => {
      const call = testCalls.get(String(ctx.body.callId || ''));
      if (!call || call.deviceId !== ctx.device.id || Date.now() - call.at > TEST_CALL_MS) {
        throw new HttpError(409, 'That test call has expired. Press "Ring me now" again.');
      }
      testCalls.delete(String(ctx.body.callId));
      await devices.markTested(ctx.device.id);
      await record(db, { user: ctx.user, via: 'app', icon: 'test', text: `${ctx.user.name} answered a test call` });
      ctx.r.json(devices.toJson(await devices.get(ctx.device.id)));
    },
  },
  {
    method: 'post', path: '/api/app/profile',
    handler: async (ctx, { actions, shifts, devices }) => {
      const { user, error } = await actions.updateProfile(ctx.user, { name: ctx.body.name, slack: ctx.body.slack, phone: ctx.body.phone });
      if (error) throw new HttpError(400, error.message, error.field);
      ctx.r.json(appMe({ shifts, devices }, user, ctx.device));
    },
  },
];
