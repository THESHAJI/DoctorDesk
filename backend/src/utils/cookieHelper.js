/**
 * Centralized Cookie Configuration
 * Ensures that cookie setting and clearing use identical flags:
 * - httpOnly: prevents client-side JavaScript access (XSS defense)
 * - secure: requires HTTPS in production
 * - sameSite: 'lax' protects against cross-site request forgery (CSRF)
 * - path: '/' ensures cookie applies across the entire API
 * - maxAge: dynamically synced with JWT_EXPIRES_IN (no hardcoded mismatch)
 *
 * IMPORTANT SEMANTIC NOTE:
 * jsonwebtoken uses the `ms` npm package internally to parse string
 * expiresIn values. We use the same `ms` package here to guarantee
 * cookie maxAge matches JWT lifetime exactly. Both produce milliseconds,
 * and jsonwebtoken converts ms→seconds for the `exp` claim.
 *
 * Bare numeric strings (e.g. '3600') are REJECTED because:
 *   - ms('3600') returns 3600 ms (3.6 seconds), which is almost
 *     certainly not the developer's intent.
 *   - jwt.sign({}, secret, { expiresIn: 3600 }) treats NUMBER 3600
 *     as seconds, but the env-var string '3600' goes through ms()
 *     and becomes 3.6 seconds. This semantic trap is dangerous.
 *   - Always use a unit suffix: '1h', '3600s', '7d', etc.
 *
 * Numeric type inputs are treated as SECONDS (matching jsonwebtoken's
 * behavior for number-type expiresIn) and converted to ms for the cookie.
 */

const ms = require('ms');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parse a duration value into milliseconds, using the same `ms` library
 * that jsonwebtoken uses internally. This guarantees cookie maxAge
 * matches JWT expiration exactly.
 *
 * Supported string formats: '7d', '2w', '24h', '2.5h', '60m', '3600s'
 * (any format the `ms` npm package accepts with a unit suffix).
 *
 * Bare numeric strings ('3600') are REJECTED (throws) — always use a
 * unit suffix to avoid the ms-vs-seconds ambiguity.
 *
 * Numeric type inputs are treated as seconds (matching jsonwebtoken's
 * behavior) and converted to milliseconds.
 *
 * @param {string|number} duration - Duration with unit suffix, or number (seconds)
 * @returns {number} Duration in milliseconds
 * @throws {Error} If the value is a bare numeric string or unrecognized format
 */
const parseDuration = (duration) => {
  // Number type: jsonwebtoken treats numeric expiresIn as seconds.
  // Convert to ms for cookie maxAge.
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `Invalid duration: ${duration}. Must be a positive finite number (seconds).`
      );
    }
    return duration * 1000;
  }

  if (!duration || typeof duration !== 'string') return SEVEN_DAYS_MS;

  const trimmed = duration.trim();

  // Reject bare numeric strings — they are ambiguous and dangerous.
  // ms('3600') returns 3600 ms (3.6 seconds), which is almost
  // certainly not what the developer intended.
  if (/^\d+$/.test(trimmed)) {
    throw new Error(
      `Ambiguous duration: '${trimmed}'. Bare numbers are unsafe ` +
      `because ms('3600') = 3600 ms (3.6 seconds), not 1 hour. ` +
      `Use a unit suffix: '${trimmed}s' for seconds, '${trimmed}ms' for milliseconds, ` +
      `or '1h', '7d', etc.`
    );
  }

  // Use the same ms library that jsonwebtoken uses internally.
  // This guarantees identical parsing semantics.
  const result = ms(trimmed);

  if (typeof result !== 'number' || !Number.isFinite(result) || result <= 0) {
    throw new Error(
      `Invalid duration format: '${trimmed}'. ` +
      `Use formats like '7d', '24h', '60m', '3600s', '2.5h', '1w'.`
    );
  }

  return result;
};

const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: parseDuration(process.env.JWT_EXPIRES_IN || '7d'),
});

const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});

module.exports = {
  parseDuration,
  getAuthCookieOptions,
  getClearCookieOptions,
};
