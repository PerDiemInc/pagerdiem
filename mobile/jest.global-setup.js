// Tests run as if the phone were on Pakistan time (UTC+5) while the team is in New York, so
// every time on screen is proven to use the team's timezone, not the phone's. Set here, before
// Jest starts its workers: a test file's own process.env doesn't reach Node's clock.
module.exports = () => {
  process.env.TZ = 'Asia/Karachi';
};
