// The phone app's JSON API (/api/app/*): one file of route definitions per resource.
import { registerRoutes } from '../route.js';
import auth from './auth.js';
import device from './device.js';
import home from './home.js';
import incidents from './incidents.js';
import schedule from './schedule.js';
import team from './team.js';

export function registerAppApi({ router, ...deps }) {
  registerRoutes(router, [...auth, ...device, ...home, ...incidents, ...schedule, ...team], deps);
}
