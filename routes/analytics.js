const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const Transaction = require('../model/Transaction');
const dayjs = require('dayjs');
const Visits = require('../model/Visits');
const Viplogs = require('../model/Viplogs');
const { getTransactionsByVisitRange } = require('../services/transactionService');
const authenticateToken = require('../middleware/auth');
const moment = require('moment');

const MPESA_TRANSACTION_CONDITION = `transaction_code IS NOT NULL AND transaction_code NOT LIKE 'MANUAL_PAY_%' AND transaction_code NOT LIKE 'VIP%' AND transaction_code NOT LIKE 'FREE_EXIT_%'`;

// Helper: Get current time in Nairobi (UTC+3)
const getNairobiNow = () => {
    const now = new Date();
    now.setHours(now.getHours() + 3);
    return now;
};

// Helper: Get today's date in Nairobi timezone
const getNairobiToday = () => {
    const nairobiNow = getNairobiNow();
    return new Date(nairobiNow.getFullYear(), nairobiNow.getMonth(), nairobiNow.getDate(), 0, 0, 0, 0);
};

const parseQueryDate = (value, endOfDay = false) => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const year = Number(dateOnlyMatch[1]);
        const month = Number(dateOnlyMatch[2]) - 1;
        const day = Number(dateOnlyMatch[3]);
        return endOfDay
            ? new Date(year, month, day, 23, 59, 59, 999)
            : new Date(year, month, day, 0, 0, 0, 0);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
};

const parseDateRange = (req) => {
    const { from, to } = req.query;
    const where = {};

    if (from || to) {
        where[Op.and] = [];

        if (from) {
            const fromDate = parseQueryDate(from);
            if (fromDate) {
                where[Op.and].push({ Transaction_timestamp: { [Op.gte]: fromDate } });
            }
        }

        if (to) {
            const toDate = parseQueryDate(to, true);
            if (toDate) {
                where[Op.and].push({ Transaction_timestamp: { [Op.lte]: toDate } });
            }
        }

        if (where[Op.and].length === 0) {
            delete where[Op.and];
        }
    }

    return where;
};

const parseVisitDateRange = (req) => {
    const { from, to } = req.query;
    const where = {};

    if (from || to) {
        where[Op.and] = [];

        if (from) {
            const fromDate = parseQueryDate(from);
            if (fromDate) {
                where[Op.and].push({ visit_timestamp: { [Op.gte]: fromDate } });
            }
        }

        if (to) {
            const toDate = parseQueryDate(to, true);
            if (toDate) {
                where[Op.and].push({ visit_timestamp: { [Op.lte]: toDate } });
            }
        }

        if (where[Op.and].length === 0) {
            delete where[Op.and];
        }
    }

    return where;
};

router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        let visitWhere = parseVisitDateRange(req);

        // 1. Check if the parsed object is empty safely
        const hasFilters = visitWhere && (visitWhere[Op.and] || Object.keys(visitWhere).length > 0);

        if (!hasFilters) {
            const now = getNairobiNow();
            // Default: today (00:00 to now) - in Nairobi timezone
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

            visitWhere = {
                visit_timestamp: {
                    [Op.between]: [todayStart, now]
                }
            };
        }

        // 2. Fixed Debug Logging Check
        let dateRangeDebug = 'Custom / Complex Filter';
        let transactionStartDate, transactionEndDate;

        if (visitWhere.visit_timestamp && visitWhere.visit_timestamp[Op.between]) {
            const range = visitWhere.visit_timestamp[Op.between];
            transactionStartDate = range[0];
            transactionEndDate = range[1];
            dateRangeDebug = `${range[0].toISOString()} to ${range[1].toISOString()}`;
        } else if (visitWhere[Op.and]) {
            dateRangeDebug = `Custom range (${visitWhere[Op.and].length} filters)`;
            // If no explicit date range found, extract from dateRangeWhere (which was parsed from req.query)
            if (!transactionStartDate || !transactionEndDate) {
                const now = getNairobiNow();
                transactionStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                transactionEndDate = now;
            }
        } else {
            // Fallback: today's date range
            const now = getNairobiNow();
            transactionStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            transactionEndDate = now;
        }
        console.log('Dashboard date range:', dateRangeDebug);
        console.log('Transaction date range:', transactionStartDate?.toISOString(), 'to', transactionEndDate?.toISOString());


        // 3. Combine filters safely
        const closedPaidVisitWhere = {
            ...visitWhere,
            status: "0",
            paid_status: "0"
        };

        // Filters for unpaid visits
        const unpaidVisitWhere = {
            ...visitWhere,
            paid_status: { [Op.ne]: "1" }
        };

        const [
            totalTransactions,
            transactionData,
            uniquePlates,
            pendingExits,
            pendingUnpaidAmount,
            completedSessions,
            thisMonthRevenue
        ] = await Promise.all([
            Visits.count({
                where: visitWhere
            }),
            // Get revenue breakdown from Transaction table (source of truth)
            Transaction.findAll({
                where: {
                    status: 'COMPLETED',
                    Transaction_timestamp: {
                        [Op.between]: [transactionStartDate, transactionEndDate]
                    }
                },
                attributes: [
                    [fn('SUM', col('amount')), 'total_amount'],
                    [fn('SUM', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN amount ELSE 0 END`)), 'manual_revenue'],
                    [fn('SUM', literal(`CASE WHEN ${MPESA_TRANSACTION_CONDITION} THEN amount ELSE 0 END`)), 'mpesa_revenue']
                ],
                raw: true
            }),
            Visits.count({
                where: closedPaidVisitWhere,
                distinct: true,
                col: 'id'
            }),
            Visits.count({
                where: {
                    ...visitWhere,
                    exit_timestamp: null
                }
            }),
            Visits.sum('amount', {
                where: unpaidVisitWhere
            }),
            Visits.count({
                where: {
                    ...closedPaidVisitWhere,
                    exit_timestamp: { [Op.ne]: null }
                }
            }),
            // This month's revenue (from 1st of current month to now)
            Transaction.sum('amount', {
                where: {
                    status: 'COMPLETED',
                    Transaction_timestamp: {
                        [Op.between]: [
                            new Date(getNairobiNow().getFullYear(), getNairobiNow().getMonth(), 1, 0, 0, 0, 0),
                            getNairobiNow()
                        ]
                    }
                }
            })
        ]);

        const txData = transactionData[0] || {};
        const totalAmount = Number(txData.total_amount || 0);

        console.log('Transaction query result:', {
            total_amount: txData.total_amount,
            manual_revenue: txData.manual_revenue,
            mpesa_revenue: txData.mpesa_revenue
        });

        res.json({
            total_transactions: totalTransactions,
            total_amount: totalAmount,
            unique_plates: uniquePlates,
            pending_exits: pendingExits,
            pending_unpaid_amount: Number(pendingUnpaidAmount || 0),
            completed_sessions: completedSessions,
            this_months: Number(thisMonthRevenue || 0)
        });
    } catch (error) {
        console.error('Error fetching dashboard analytics:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard analytics' });
    }
});

router.get('/transactions-series', authenticateToken, async (req, res) => {
    try {
        const { bucket = 'day' } = req.query;
        const transactionWhere = parseDateRange(req);

        // Add COMPLETED status filter to exclude failed/pending transactions
        transactionWhere.status = 'COMPLETED';

        const bucketFormats = {
            hour: '%Y-%m-%d %H:00:00',
            day: '%Y-%m-%d',
            week: '%Y-%u',
            month: '%Y-%m'
        };

        const dateFormat = bucketFormats[bucket] || bucketFormats.day;

        const series = await Transaction.findAll({
            where: transactionWhere,
            attributes: [
                [fn('DATE_FORMAT', col('Transaction_timestamp'), dateFormat), 'bucket'],
                [fn('COUNT', col('id')), 'total_transactions'],
                [fn('SUM', col('amount')), 'total_amount']
            ],
            group: [literal('bucket')],
            order: [literal('bucket ASC')],
            raw: true
        });

        res.json({
            bucket,
            points: series.map((point) => ({
                bucket: point.bucket,
                total_transactions: Number(point.total_transactions || 0),
                total_amount: Number(point.total_amount || 0)
            }))
        });
    } catch (error) {
        console.error('Error fetching transactions series:', error);
        res.status(500).json({ error: 'Failed to fetch transactions series' });
    }
});

// additional route to show revenue, with time range filter, so amount returned would be the sum of all transactions in the time range, will recieve from and to from frontend query params
// router.get('/revenue', authenticateToken, async (req, res) => {
//     try {
//         const paidStatusRaw = typeof req.query.paid_status === 'string' ? req.query.paid_status.trim() : undefined;
//         const freeVisitRaw = typeof req.query.free_visit === 'string' ? req.query.free_visit.trim() : undefined;
//         const manualPayRaw = typeof req.query.manual_pay === 'string' ? req.query.manual_pay.trim() : undefined;
//         const vipPayRaw = typeof req.query.vip_pay === 'string' ? req.query.vip_pay.trim() : undefined;
//         const visitStatusRaw = typeof req.query.visit_status === 'string' ? req.query.visit_status.trim() : undefined;
//         const numberPlateQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';



//         if (typeof paidStatusRaw !== 'undefined' && paidStatusRaw !== '0' && paidStatusRaw !== '1') {
//             return res.status(400).json({ error: 'Invalid paid_status. Use 0 or 1' });
//         }

//         if (typeof freeVisitRaw !== 'undefined' && freeVisitRaw !== '0' && freeVisitRaw !== '1') {
//             return res.status(400).json({ error: 'Invalid free_visit. Use 0 or 1' });
//         }

//         if (typeof manualPayRaw !== 'undefined' && manualPayRaw !== '0' && manualPayRaw !== '1') {
//             return res.status(400).json({ error: 'Invalid manual_pay. Use 0 or 1' });
//         }

//         if (typeof vipPayRaw !== 'undefined' && vipPayRaw !== '0' && vipPayRaw !== '1') {
//             return res.status(400).json({ error: 'Invalid vip_pay. Use 0 or 1' });
//         }

//         if (typeof visitStatusRaw !== 'undefined' && visitStatusRaw !== '0' && visitStatusRaw !== '1') {
//             return res.status(400).json({ error: 'Invalid visit_status. Use 0 or 1' });
//         }

//         const dateRangeWhere = parseDateRange(req);
//         const transactionFilters = dateRangeWhere[Op.and] ? [...dateRangeWhere[Op.and]] : [];

//         if (numberPlateQuery && numberPlateQuery.length > 0) {
//             transactionFilters.push({
//                 number_plate: {
//                     [Op.like]: `%${numberPlateQuery}%`
//                 }
//             });
//         }
//         if (typeof manualPayRaw !== 'undefined') {
//             transactionFilters.push(
//                 manualPayRaw === '1'
//                     ? { transaction_code: { [Op.like]: 'MANUAL_PAY_%' } }
//                     : { transaction_code: { [Op.notLike]: 'MANUAL_PAY_%' } }
//             );
//         }

//         if (typeof vipPayRaw !== 'undefined') {
//             transactionFilters.push(
//                 vipPayRaw === '1'
//                     ? { transaction_code: { [Op.like]: 'VIP%' } }
//                     : { transaction_code: { [Op.notLike]: 'VIP%' } }
//             );
//         }

//         const transactionWhere = transactionFilters.length > 0
//             ? { [Op.and]: transactionFilters }
//             : {};

//         const visitAndFilters = [];

//         if (typeof paidStatusRaw !== 'undefined' || typeof freeVisitRaw !== 'undefined' || typeof visitStatusRaw !== 'undefined') {

//             if (typeof paidStatusRaw !== 'undefined') {
//                 visitAndFilters.push({ paid_status: Number(paidStatusRaw) });
//             }

//             if (typeof freeVisitRaw !== 'undefined') {
//                 visitAndFilters.push(
//                     freeVisitRaw === '0'
//                         ? { amount: { [Op.eq]: 0 } }
//                         : { amount: { [Op.gt]: 0 } }
//                 );
//             }

//             if (typeof visitStatusRaw !== 'undefined') {
//                 visitAndFilters.push(
//                     visitStatusRaw === '1'
//                         ? { exit_timestamp: null }
//                         : { exit_timestamp: { [Op.ne]: null } }
//                 );
//             }

//         }

//         const visitWhere = visitAndFilters.length > 1
//             ? { [Op.and]: visitAndFilters }
//             : visitAndFilters[0];

//         const visitBaseWhere = visitAndFilters.filter((filter) => !Object.prototype.hasOwnProperty.call(filter, 'exit_timestamp'));
//         const openVisitsWhere = [...visitBaseWhere, { exit_timestamp: null }];
//         const completedVisitsWhere = [...visitBaseWhere, { exit_timestamp: { [Op.ne]: null } }];

//         const queryOptions = {
//             where: transactionWhere,
//             ...(visitWhere
//                 ? {
//                     include: [
//                         {
//                             model: Visits,
//                             attributes: [],
//                             where: visitWhere,
//                             required: true
//                         }
//                     ]
//                 }
//                 : {})
//         };

//         const [totalRevenue, uniquePlates, rawVisitRecords, openVisitRecords, completedVisitRecords] = await Promise.all([
//             Transaction.sum('Transaction.amount', queryOptions),
//             Transaction.count({
//                 ...queryOptions,
//                 distinct: true,
//                 col: 'number_plate'
//             }),
//             Transaction.count({
//                 ...queryOptions,
//                 col: 'id'
//             }),
//             Transaction.count({
//                 where: transactionWhere,
//                 distinct: true,
//                 col: 'id',
//                 include: [
//                     {
//                         model: Visits,
//                         attributes: [],
//                         where: openVisitsWhere.length > 1 ? { [Op.and]: openVisitsWhere } : openVisitsWhere[0],
//                         required: true
//                     }
//                 ]
//             }),
//             Transaction.count({
//                 where: transactionWhere,
//                 distinct: true,
//                 col: 'id',
//                 include: [
//                     {
//                         model: Visits,
//                         attributes: [],
//                         where: completedVisitsWhere.length > 1 ? { [Op.and]: completedVisitsWhere } : completedVisitsWhere[0],
//                         required: true
//                     }
//                 ]
//             })
//         ]);

//         res.json({
//             total_revenue: Number(totalRevenue || 0),
//             unique_number_plates: uniquePlates,
//             number_plate_total_amount: numberPlateQuery ? Number(totalRevenue || 0) : null,
//             raw_visit_records: rawVisitRecords,
//             open_visit_records: openVisitRecords,
//             completed_visit_records: completedVisitRecords
//         });
//     }
//     catch (error) {
//         console.error('Error fetching revenue analytics:', error);
//         res.status(500).json({ error: 'Failed to fetch revenue analytics' });
//     }
// });
router.get('/revenue', authenticateToken, async (req, res) => {
    try {
        // 1. Sanitize query inputs safely
        const paidStatusRaw = typeof req.query.paid_status === 'string' ? req.query.paid_status.trim() : undefined;
        const freeVisitRaw = typeof req.query.free_visit === 'string' ? req.query.free_visit.trim() : undefined;
        const manualPayRaw = typeof req.query.manual_pay === 'string' ? req.query.manual_pay.trim() : undefined;
        const vipPayRaw = typeof req.query.vip_pay === 'string' ? req.query.vip_pay.trim() : undefined;
        const visitStatusRaw = typeof req.query.visit_status === 'string' ? req.query.visit_status.trim() : undefined;
        const vehicleNumberQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';

        // Input Validations
        if (paidStatusRaw && paidStatusRaw !== '0' && paidStatusRaw !== '1') return res.status(400).json({ error: 'Invalid paid_status. Use 0 or 1' });
        if (freeVisitRaw && freeVisitRaw !== '0' && freeVisitRaw !== '1') return res.status(400).json({ error: 'Invalid free_visit. Use 0 or 1' });
        if (manualPayRaw && manualPayRaw !== '0' && manualPayRaw !== '1') return res.status(400).json({ error: 'Invalid manual_pay. Use 0 or 1' });
        if (vipPayRaw && vipPayRaw !== '0' && vipPayRaw !== '1') return res.status(400).json({ error: 'Invalid vip_pay. Use 0 or 1' });
        if (visitStatusRaw && visitStatusRaw !== '0' && visitStatusRaw !== '1') return res.status(400).json({ error: 'Invalid visit_status. Use 0 or 1' });

        // 2. Build Transaction filters (primary source)
        const transactionFilters = [];
        transactionFilters.push({ status: 'COMPLETED' });

        // Date range filter on Transaction_timestamp
        let { from, to } = req.query;
        let startDate, endDate;

        if (from && to) {
            const fromDate = parseQueryDate(from);
            const toDate = parseQueryDate(to, true);
            if (fromDate && toDate) {
                startDate = fromDate;
                endDate = toDate;
            } else {
                // Invalid dates provided, use default
                const now = getNairobiNow();
                endDate = new Date(now);
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 30);
            }
        } else {
            // Default: last 30 days (matches /summary default) - in Nairobi timezone
            const now = getNairobiNow();
            endDate = new Date(now);
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 30);
        }

        transactionFilters.push({
            Transaction_timestamp: {
                [Op.between]: [startDate, endDate]
            }
        });

        // Number plate filter (direct on Transaction)
        if (vehicleNumberQuery) {
            transactionFilters.push({ number_plate: { [Op.like]: `%${vehicleNumberQuery}%` } });
        }

        // Payment type filters (manual vs mpesa)
        if (manualPayRaw !== undefined) {
            transactionFilters.push(
                manualPayRaw === '1'
                    ? { transaction_code: { [Op.like]: 'MANUAL_PAY_%' } }
                    : { transaction_code: { [Op.notLike]: 'MANUAL_PAY_%' } }
            );
        }

        // VIP filter
        if (vipPayRaw !== undefined) {
            transactionFilters.push(
                vipPayRaw === '1'
                    ? { transaction_code: { [Op.like]: 'VIP%' } }
                    : { transaction_code: { [Op.notLike]: 'VIP%' } }
            );
        }

        // Build Visit filters for eager loading
        const visitFilters = [];
        visitFilters.push({ status: 0 });

        if (paidStatusRaw !== undefined) {
            visitFilters.push({ paid_status: paidStatusRaw });
        }

        if (freeVisitRaw !== undefined) {
            visitFilters.push(freeVisitRaw === '1' ? { amount: 0 } : { amount: { [Op.gt]: 0 } });
        }

        if (visitStatusRaw !== undefined) {
            visitFilters.push(visitStatusRaw === '1' ? { exit_timestamp: null } : { exit_timestamp: { [Op.ne]: null } });
        }

        const transactionWhere = transactionFilters.length > 0 ? { [Op.and]: transactionFilters } : {};
        const visitWhere = visitFilters.length > 0 ? { [Op.and]: visitFilters } : {};

        // 3. Execute queries using Transaction table as primary source with Visits eager load
        const [totalRevenue, uniquePlates, rawVisitRecords, openVisitRecords, completedVisitRecords] = await Promise.all([
            // Total revenue from COMPLETED transactions
            Transaction.sum('amount', { where: transactionWhere }),

            // Unique number plates from COMPLETED transactions
            Transaction.count({
                where: transactionWhere,
                distinct: true,
                col: 'number_plate'
            }),

            // Raw visit records - count transactions (each transaction ties to one visit)
            Transaction.count({ where: transactionWhere }),

            // Open visit records - transactions with associated visits still in parking
            Transaction.count({
                where: transactionWhere,
                include: [{
                    model: Visits,
                    attributes: [],
                    where: { ...visitWhere, exit_timestamp: null },
                    required: true
                }]
            }),

            // Completed visit records - transactions with associated visits that have exited
            Transaction.count({
                where: transactionWhere,
                include: [{
                    model: Visits,
                    attributes: [],
                    where: { ...visitWhere, exit_timestamp: { [Op.ne]: null } },
                    required: true
                }]
            })
        ]);

        // 4. Return matching metric outputs (maintain frontend compatibility)
        res.json({
            total_revenue: Number(totalRevenue || 0),
            unique_number_plates: uniquePlates,
            number_plate_total_amount: vehicleNumberQuery ? Number(totalRevenue || 0) : null,
            raw_visit_records: rawVisitRecords,
            open_visit_records: openVisitRecords,
            completed_visit_records: completedVisitRecords
        });

    } catch (error) {
        console.error('Error fetching revenue analytics:', error);
        res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
});


//get a daily income report summary for a given specific date, if no date is provided, use today as default, 
//when date is recieved, fix time start from midnight to 23:59:59 of that day, and return the total income for that day for transactions that have been completed, and also return the total number of transactions for that day, 
//it should have the total amout for mpesa, total amount of manual payments, total amount of vip payments, and total amount of free visits, and also return the total number of unique number plates for that day, and also return the total number of paid completed visits for that day
router.get('/daily-income', authenticateToken, async (req, res) => {

    try {
        const { date } = req.query;
        let startDate, endDate;

        if (date) {
            const parsedDate = parseQueryDate(date);
            startDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 0, 0, 0);
            endDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 23, 59, 59);
        } else {
            const today = getNairobiNow();
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
            endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        }

        const dailyIncome = await Transaction.findAll({
            where: {
                status: 'COMPLETED',
                Transaction_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            },
            attributes: [
                [fn('SUM', col('amount')), 'total_income'],
                [fn('COUNT', col('id')), 'total_transactions'],
                [fn('SUM', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN amount ELSE 0 END`)), 'total_manual_payments'],
                [fn('SUM', literal(`CASE WHEN ${MPESA_TRANSACTION_CONDITION} THEN amount ELSE 0 END`)), 'total_mpesa_payments'],
                [fn('COUNT', literal(`DISTINCT CASE WHEN ${MPESA_TRANSACTION_CONDITION} THEN number_plate END`)), 'unique_number_plates'],
            ],
            raw: true
        });

        const totalPaidCompletedVisits = await Visits.count({
            where: {
                exit_timestamp: { [Op.ne]: null },
                paid_status: '1',
                visit_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        res.json({
            date: startDate.toISOString().split('T')[0],
            total_income: Number(dailyIncome[0].total_income || 0),
            total_transactions: Number(dailyIncome[0].total_transactions || 0),
            total_manual_payments: Number(dailyIncome[0].total_manual_payments || 0),
            total_mpesa_payments: Number(dailyIncome[0].total_mpesa_payments || 0),
            total_paid_completed_visits: totalPaidCompletedVisits
        });
    } catch (error) {
        console.error('Error fetching daily income report:', error);
        res.status(500).json({ error: 'Failed to fetch daily income report' });
    }
});


//endpoint for traffic distribution per time slot (hourly), shows entries, exits, and income per slot
//time range filter: from and to query params, defaults to past 24 hours
//useful for identifying peak traffic hours and revenue distribution
router.get('/income-per-slot', authenticateToken, async (req, res) => {
    try {
        // Parse time range, default to past 24 hours
        let { from, to } = req.query;
        let startDate, endDate;

        if (from && to) {
            startDate = parseQueryDate(from);
            endDate = parseQueryDate(to, true);
            if (!startDate || !endDate) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
            }
        } else {
            // Default to past 24 hours - in Nairobi timezone
            endDate = getNairobiNow();
            startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        }

        // Get entries per hourly time slot
        const entries = await Visits.findAll({
            where: {
                // Only consider paid visits for income
                visit_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            },
            attributes: [
                [fn('DATE_FORMAT', col('visit_timestamp'), '%Y-%m-%d %H:00:00'), 'time_slot'],
                [fn('COUNT', col('id')), 'entry_count']
            ],
            group: [literal('time_slot')],
            raw: true
        });

        // Get exits per hourly time slot
        const exits = await Visits.findAll({
            where: {
                exit_timestamp: {
                    [Op.between]: [startDate, endDate],
                    [Op.ne]: null
                }
            },
            attributes: [
                [fn('DATE_FORMAT', col('exit_timestamp'), '%Y-%m-%d %H:00:00'), 'time_slot'],
                [fn('COUNT', col('id')), 'exit_count']
            ],
            group: [literal('time_slot')],
            raw: true
        });

        // Get income per hourly time slot (from closed/paid visits only, matching dashboard logic)
        const income = await Visits.findAll({
            where: {
                status: "0",
                paid_status: "0",
                visit_timestamp: {
                    [Op.between]: [startDate, endDate]
                }
            },
            attributes: [
                [fn('DATE_FORMAT', col('visit_timestamp'), '%Y-%m-%d %H:00:00'), 'time_slot'],
                [fn('SUM', col('amount')), 'total_income'],
                [fn('COUNT', col('id')), 'transaction_count']
            ],
            group: [literal('time_slot')],
            raw: true
        });

        // Merge entries, exits, and income data by time slot
        const slotMap = {};

        entries.forEach(entry => {
            slotMap[entry.time_slot] = {
                time_slot: entry.time_slot,
                entries: Number(entry.entry_count || 0),
                exits: 0,
                total_income: 0,
                transaction_count: 0
            };
        });

        exits.forEach(exit => {
            if (slotMap[exit.time_slot]) {
                slotMap[exit.time_slot].exits = Number(exit.exit_count || 0);
            } else {
                slotMap[exit.time_slot] = {
                    time_slot: exit.time_slot,
                    entries: 0,
                    exits: Number(exit.exit_count || 0),
                    total_income: 0,
                    transaction_count: 0
                };
            }
        });

        income.forEach(inc => {
            if (slotMap[inc.time_slot]) {
                slotMap[inc.time_slot].total_income = Number(inc.total_income || 0);
                slotMap[inc.time_slot].transaction_count = Number(inc.transaction_count || 0);
            } else {
                slotMap[inc.time_slot] = {
                    time_slot: inc.time_slot,
                    entries: 0,
                    exits: 0,
                    total_income: Number(inc.total_income || 0),
                    transaction_count: Number(inc.transaction_count || 0)
                };
            }
        });

        // Convert to sorted array
        const timeSeries = Object.values(slotMap).sort((a, b) =>
            new Date(a.time_slot) - new Date(b.time_slot)
        );

        res.json({
            time_range: {
                from: startDate.toISOString(),
                to: endDate.toISOString()
            },
            data: timeSeries
        });
    } catch (error) {
        console.error('Error fetching traffic per time slot:', error);
        res.status(500).json({ error: 'Failed to fetch traffic per time slot' });
    }
});

// Helper function to calculate date range based on period
const getPeriodDateRange = (period) => {
    const endDate = getNairobiNow();
    let startDate = getNairobiNow();

    switch (period) {
        case '24h':
            startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '1m':
            startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        default:
            startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
    }

    return { startDate, endDate };
};

// Summary endpoint for period statistics (24h, 7d, 1m)
// router.get('/summary', authenticateToken, async (req, res) => {
//     try {
//         const { from, to } = req.query;
//         let startDate, endDate;

//         if (from && to) {
//             // Validate and parse provided dates
//             startDate = dayjs(from, 'YYYY-MM-DD').toDate();
//             endDate = dayjs(to, 'YYYY-MM-DD').endOf('day').toDate();

//             if (!startDate.getTime() || !endDate.getTime()) {
//                 return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
//             }
//         } else {
//             // Default: today (00:00 to now) - in Nairobi timezone
//             const now = getNairobiNow();
//             endDate = new Date(now);
//             startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
//         }

//         // Base where clause for date range only (for counting all entries)
//         const dateRangeWhere = {
//             visit_timestamp: {
//                 [Op.between]: [startDate, endDate]
//             }
//         };

//         // Query all needed data in parallel
//         const [
//             totalExits,
//             pendingExits,
//             allEntries,
//             manualAndMpesaData,
//             vipLogsCount
//         ] = await Promise.all([
//             // Total Exits (all visits that have exited, regardless of payment status)
//             Visits.count({
//                 where: {
//                     ...dateRangeWhere,
//                     exit_timestamp: { [Op.ne]: null }
//                 }
//             }),

//             // Pending Exits (all visits still pending exit, any status)
//             Visits.count({
//                 where: {
//                     ...dateRangeWhere,
//                     exit_timestamp: null
//                 }
//             }),

//             // All Entries (all visits in period, any status)
//             Visits.count({ where: dateRangeWhere }),

//             // Manual and Mpesa revenue/exits breakdown (only COMPLETED transactions)
//             // This is the source of truth for collected revenue and paid exit counts
//             Transaction.findAll({
//                 where: {
//                     status: 'COMPLETED',
//                     Transaction_timestamp: {
//                         [Op.between]: [startDate, endDate]
//                     }
//                 },
//                 attributes: [
//                     [fn('SUM', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN amount ELSE 0 END`)), 'manual_revenue'],
//                     [fn('SUM', literal(`CASE WHEN transaction_code NOT LIKE 'MANUAL_PAY_%' AND transaction_code NOT LIKE 'VIP%' THEN amount ELSE 0 END`)), 'mpesa_revenue'],
//                     [fn('COUNT', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN 1 END`)), 'manual_exits'],
//                     [fn('COUNT', literal(`CASE WHEN transaction_code NOT LIKE 'MANUAL_PAY_%' AND transaction_code NOT LIKE 'VIP%' THEN 1 END`)), 'mpesa_exits']
//                 ],
//                 raw: true
//             }),

//             // VIP Logs count for tenant exits in the period
//             require('../model/Viplogs').count({
//                 where: {
//                     createdAt: {
//                         [Op.between]: [startDate, endDate]
//                     }
//                 }
//             })
//         ]);

//         const transactionData = manualAndMpesaData[0] || {};

//         // Collected revenue is the sum of manual + mpesa revenues from Transaction table
//         const manualRevenue = Number(transactionData.manual_revenue || 0);
//         const mpesaRevenue = Number(transactionData.mpesa_revenue || 0);
//         const collectedRevenue = manualRevenue + mpesaRevenue;
//         const manualExits = Number(transactionData.manual_exits || 0);
//         const mpesaExits = Number(transactionData.mpesa_exits || 0);
//         const paidExits = manualExits + mpesaExits;
//         const unpaidExits = totalExits - paidExits; // Exits without completed payments

//         res.json({
//             time_range: {
//                 from: startDate.toISOString(),
//                 to: endDate.toISOString()
//             },
//             collected_revenue: collectedRevenue,
//             successful_exits: Number(totalExits || 0),
//             unpaid_exits: unpaidExits,
//             pending_exits: Number(pendingExits || 0),
//             all_entries: Number(allEntries || 0),
//             manual_revenue: manualRevenue,
//             mpesa_revenue: mpesaRevenue,
//             manual_exits: manualExits,
//             mpesa_exits: mpesaExits,
//             tenant_exits: Number(vipLogsCount || 0)
//         });
//     } catch (error) {
//         console.error('Error fetching summary analytics:', error);
//         res.status(500).json({ error: 'Failed to fetch summary analytics' });
//     }
// });


router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const { from, to } = req.query;
        let startDate, endDate;

        if (from || to) {
            if (from) {
                startDate = new Date(from);
                if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'Invalid from date' });
            }
            if (to) {
                endDate = new Date(to);
                if (Number.isNaN(endDate.getTime())) return res.status(400).json({ error: 'Invalid to date' });
                endDate.setHours(23, 59, 59, 999);
            }
        } else {
            // Default: 30 days window or Today (00:00 to 23:59:59) matching base behavior
            const now = new Date();
            endDate = new Date(now.setHours(23, 59, 59, 999));
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
        }


        const vipLogs = await Viplogs.findAll({
            where: {
                createdAt: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });


        //console.log("startDate - endate", startDate, endDate);

        const vipLogsnumber = vipLogs.length;

        //console.log('VIP Logs Number:', vipLogsnumber);

        // Standardized createdAt filter to match base endpoint behavior
        const dateRangeWhere = {
            createdAt: {
                [Op.between]: [startDate, endDate]
            }
        };

        const [
            totalExits,
            pendingExits,
            allEntries,
            manualAndMpesaData,
            vipLogsCount
        ] = await Promise.all([
            Visits.count({
                where: { ...dateRangeWhere, exit_timestamp: { [Op.ne]: null } }
            }),

            Visits.count({
                where: { ...dateRangeWhere, exit_timestamp: null }
            }),

            Visits.count({ where: dateRangeWhere }),

            Transaction.findAll({
                where: {
                    status: 'COMPLETED',
                    createdAt: { [Op.between]: [startDate, endDate] } // Standardized to createdAt
                },
                attributes: [
                    [fn('SUM', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN amount ELSE 0 END`)), 'manual_revenue'],
                    [fn('SUM', literal(`CASE WHEN ${MPESA_TRANSACTION_CONDITION} THEN amount ELSE 0 END`)), 'mpesa_revenue'],
                    [fn('COUNT', literal(`CASE WHEN transaction_code LIKE 'MANUAL_PAY_%' THEN 1 END`)), 'manual_exits'],
                    [fn('COUNT', literal(`CASE WHEN ${MPESA_TRANSACTION_CONDITION} THEN 1 END`)), 'mpesa_exits']
                ],
                raw: true
            }),
            Viplogs.count({
                where: dateRangeWhere
            })
        ]);

        const transactionData = manualAndMpesaData[0] || {};
        const manualRevenue = Number(transactionData.manual_revenue || 0);
        const mpesaRevenue = Number(transactionData.mpesa_revenue || 0);
        const collectedRevenue = manualRevenue + mpesaRevenue;
        const manualExits = Number(transactionData.manual_exits || 0);
        const mpesaExits = Number(transactionData.mpesa_exits || 0);
        const paidExits = manualExits + mpesaExits;
        const unpaidExits = Number(totalExits || 0) - paidExits;

        res.json({
            time_range: {
                from: startDate.toISOString(),
                to: endDate.toISOString()
            },
            collected_revenue: collectedRevenue,
            successful_exits: Number(totalExits || 0),
            unpaid_exits: unpaidExits,
            pending_exits: Number(pendingExits || 0),
            all_entries: Number(allEntries || 0),
            manual_revenue: manualRevenue,
            mpesa_revenue: mpesaRevenue,
            manual_exits: manualExits,
            mpesa_exits: mpesaExits,
            tenant_exits: Number(vipLogsnumber || 0)
        });
    } catch (error) {
        console.error('Error fetching summary analytics:', error);
        res.status(500).json({ error: 'Failed to fetch summary analytics' });
    }
});


module.exports = router;