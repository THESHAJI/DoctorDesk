/**
 * Centralized Clinic Timezone Utility
 * Standardized on Asia/Kolkata (UTC+05:30)
 * Uses Intl.DateTimeFormat with formatToParts() and hourCycle: 'h23'
 * to prevent zero-hour (24 vs 00) and locale-string parsing bugs.
 */

const CLINIC_TIMEZONE = 'Asia/Kolkata';

/**
 * Extracts clinic-local date and time in Asia/Kolkata.
 *
 * @param {Date} [date=new Date()]
 * @returns {{ date: string, time: string, year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
const getClinicDateTime = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD
    time: `${parts.hour}:${parts.minute}:${parts.second}`, // HH:MM:SS
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
};

/**
 * Converts a slot_date (YYYY-MM-DD) and time (HH:MM or HH:MM:SS) in Asia/Kolkata
 * to an absolute UTC timestamp in milliseconds.
 *
 * @param {string} slotDate - Format YYYY-MM-DD
 * @param {string} time - Format HH:MM or HH:MM:SS
 * @returns {number} Timestamp in milliseconds
 */
const getAppointmentStartTimestamp = (slotDate, time) => {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  return new Date(`${slotDate}T${normalizedTime}+05:30`).getTime();
};

/**
 * Verifies whether a given slot date and start time is in the past
 * relative to the clinic's local time (Asia/Kolkata).
 *
 * @param {string} slotDate - Format YYYY-MM-DD
 * @param {string} startTime - Format HH:MM or HH:MM:SS
 * @returns {boolean} True if the slot is in the past
 */
const isSlotInPast = (slotDate, startTime) => {
  const slotStartMs = getAppointmentStartTimestamp(slotDate, startTime);
  return slotStartMs <= Date.now();
};

module.exports = {
  CLINIC_TIMEZONE,
  getClinicDateTime,
  getAppointmentStartTimestamp,
  isSlotInPast,
};
