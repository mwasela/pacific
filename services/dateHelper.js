const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

/**
 * Normalizes input date strings into full Start-of-Day and End-of-Day Date objects.
 * Handles inputs like "2026-07-23" -> Start: 2026-07-23 00:00:00, End: 2026-07-23 23:59:59.999
 */
function parseDateRange(from, to) {
    // Fallback to today if dates are missing
    const startDate = from 
        ? dayjs(from).startOf('day').toDate() 
        : dayjs().startOf('day').toDate();

    const endDate = to 
        ? dayjs(to).endOf('day').toDate() 
        : dayjs().endOf('day').toDate();

    return { startDate, endDate };
}

module.exports = { parseDateRange };