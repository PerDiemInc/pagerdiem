// QR codes as inline SVG, for the "Phone app" sign-in code on the Team page.
import qrcode from './vendor/qrcode.js';

const QUIET_ZONE = 4; // modules of blank border scanners need around the code

/**
 * Black modules on a white square, whatever the page theme: phone cameras read dark-on-light
 * codes reliably and inverted ones often not at all.
 */
export function qrSvg(text, { label = 'Phone app sign-in code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}
