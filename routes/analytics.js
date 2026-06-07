const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const Transaction = require('../model/Transaction');
const Visits = require('../model/Visits');
const authenticateToken = require('../middleware/auth');

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
        const transactionWhere = parseDateRange(req);
        const visitWhere = parseVisitDateRange(req);

        const [
            totalTransactions,
            totalAmount,
            uniquePlates,
            pendingExits,
            pendingUnpaidAmount,
            completedSessions
        ] = await Promise.all([
            Transaction.count({ where: transactionWhere }),
            Transaction.sum('amount', { where: transactionWhere }),
            Transaction.count({
                where: transactionWhere,
                distinct: true,
                col: 'number_plate'
            }),
            Visits.count({
                where: {
                    ...visitWhere,
                    exit_timestamp: null
                }
            }),
            Visits.sum('amount', {
                where: {
                    ...visitWhere,
                    paid_status: '1'
                }
            }),
            Visits.count({
                where: {
                    ...visitWhere,
                    exit_timestamp: { [Op.ne]: null }
                }
            })
        ]);

        res.json({
            total_transactions: totalTransactions,
            total_amount: Number(totalAmount || 0),
            unique_plates: uniquePlates,
            pending_exits: pendingExits,
            pending_unpaid_amount: Number(pendingUnpaidAmount || 0),
            completed_sessions: completedSessions
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
router.get('/revenue', authenticateToken, async (req, res) => {
    try {
        const paidStatusRaw = typeof req.query.paid_status === 'string' ? req.query.paid_status.trim() : undefined;
        const freeVisitRaw = typeof req.query.free_visit === 'string' ? req.query.free_visit.trim() : undefined;
        const manualPayRaw = typeof req.query.manual_pay === 'string' ? req.query.manual_pay.trim() : undefined;
        const vipPayRaw = typeof req.query.vip_pay === 'string' ? req.query.vip_pay.trim() : undefined;
        const visitStatusRaw = typeof req.query.visit_status === 'string' ? req.query.visit_status.trim() : undefined;
        const numberPlateQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';
        
        

        if (typeof paidStatusRaw !== 'undefined' && paidStatusRaw !== '0' && paidStatusRaw !== '1') {
            return res.status(400).json({ error: 'Invalid paid_status. Use 0 or 1' });
        }

        if (typeof freeVisitRaw !== 'undefined' && freeVisitRaw !== '0' && freeVisitRaw !== '1') {
            return res.status(400).json({ error: 'Invalid free_visit. Use 0 or 1' });
        }

        if (typeof manualPayRaw !== 'undefined' && manualPayRaw !== '0' && manualPayRaw !== '1') {
            return res.status(400).json({ error: 'Invalid manual_pay. Use 0 or 1' });
        }

        if (typeof vipPayRaw !== 'undefined' && vipPayRaw !== '0' && vipPayRaw !== '1') {
            return res.status(400).json({ error: 'Invalid vip_pay. Use 0 or 1' });
        }

        if (typeof visitStatusRaw !== 'undefined' && visitStatusRaw !== '0' && visitStatusRaw !== '1') {
            return res.status(400).json({ error: 'Invalid visit_status. Use 0 or 1' });
        }

        const dateRangeWhere = parseDateRange(req);
        const transactionFilters = dateRangeWhere[Op.and] ? [...dateRangeWhere[Op.and]] : [];

        if (numberPlateQuery && numberPlateQuery.length > 0) {
            transactionFilters.push({
                number_plate: {
                    [Op.like]: `%${numberPlateQuery}%`
                }
            });
        }
        if (typeof manualPayRaw !== 'undefined') {
            transactionFilters.push(
                manualPayRaw === '1'
                    ? { transaction_code: { [Op.like]: 'MANUAL_PAY_%' } }
                    : { transaction_code: { [Op.notLike]: 'MANUAL_PAY_%' } }
            );
        }

        if (typeof vipPayRaw !== 'undefined') {
            transactionFilters.push(
                vipPayRaw === '1'
                    ? { transaction_code: { [Op.like]: 'VIP%' } }
                    : { transaction_code: { [Op.notLike]: 'VIP%' } }
            );
        }

        const transactionWhere = transactionFilters.length > 0
            ? { [Op.and]: transactionFilters }
            : {};

        const visitAndFilters = [];

        if (typeof paidStatusRaw !== 'undefined' || typeof freeVisitRaw !== 'undefined' || typeof visitStatusRaw !== 'undefined') {

            if (typeof paidStatusRaw !== 'undefined') {
                visitAndFilters.push({ paid_status: Number(paidStatusRaw) });
            }

            if (typeof freeVisitRaw !== 'undefined') {
                visitAndFilters.push(
                    freeVisitRaw === '0'
                        ? { amount: { [Op.eq]: 0 } }
                        : { amount: { [Op.gt]: 0 } }
                );
            }

            if (typeof visitStatusRaw !== 'undefined') {
                visitAndFilters.push(
                    visitStatusRaw === '1'
                        ? { exit_timestamp: null }
                        : { exit_timestamp: { [Op.ne]: null } }
                );
            }

        }

        const visitWhere = visitAndFilters.length > 1
            ? { [Op.and]: visitAndFilters }
            : visitAndFilters[0];

        const visitBaseWhere = visitAndFilters.filter((filter) => !Object.prototype.hasOwnProperty.call(filter, 'exit_timestamp'));
        const openVisitsWhere = [...visitBaseWhere, { exit_timestamp: null }];
        const completedVisitsWhere = [...visitBaseWhere, { exit_timestamp: { [Op.ne]: null } }];

        const queryOptions = {
            where: transactionWhere,
            ...(visitWhere
                ? {
                    include: [
                        {
                            model: Visits,
                            attributes: [],
                            where: visitWhere,
                            required: true
                        }
                    ]
                }
                : {})
        };

        const [totalRevenue, uniquePlates, rawVisitRecords, openVisitRecords, completedVisitRecords] = await Promise.all([
            Transaction.sum('Transaction.amount', queryOptions),
            Transaction.count({
                ...queryOptions,
                distinct: true,
                col: 'number_plate'
            }),
            Transaction.count({
                ...queryOptions,
                col: 'id'
            }),
            Transaction.count({
                where: transactionWhere,
                distinct: true,
                col: 'id',
                include: [
                    {
                        model: Visits,
                        attributes: [],
                        where: openVisitsWhere.length > 1 ? { [Op.and]: openVisitsWhere } : openVisitsWhere[0],
                        required: true
                    }
                ]
            }),
            Transaction.count({
                where: transactionWhere,
                distinct: true,
                col: 'id',
                include: [
                    {
                        model: Visits,
                        attributes: [],
                        where: completedVisitsWhere.length > 1 ? { [Op.and]: completedVisitsWhere } : completedVisitsWhere[0],
                        required: true
                    }
                ]
            })
        ]);

        res.json({
            total_revenue: Number(totalRevenue || 0),
            unique_number_plates: uniquePlates,
            number_plate_total_amount: numberPlateQuery ? Number(totalRevenue || 0) : null,
            raw_visit_records: rawVisitRecords,
            open_visit_records: openVisitRecords,
            completed_visit_records: completedVisitRecords
        });
    }
    catch (error) {
        console.error('Error fetching revenue analytics:', error);
        res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
});

module.exports = router;