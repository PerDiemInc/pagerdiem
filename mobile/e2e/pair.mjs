// A fresh pagerdiem://connect sign-in link for someone on the e2e server (codes last 10 minutes).
//   node e2e/pair.mjs ben            iOS simulator (localhost)
//   node e2e/pair.mjs ben android    Android emulator (10.0.2.2)
import { link } from './common.mjs';

console.log(await link(process.argv[2] ?? 'ben', process.argv[3]));
