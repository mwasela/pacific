const express = require('express');
const { Op, fn, col, literal } = require('sequelize');
const router = express.Router();
const Transaction = require('../model/Transaction');
const Visits = require('../model/Visits');
const authenticateToken = require('../middleware/auth');

const parseDateRange = (req) => {
    const { from, to } = req.query;
    const where = {};

    if (from || to) {
        where[Op.and] = [];

        if (from) {
            const fromDate = new Date(from);
            if (!Number.isNaN(fromDate.getTime())) {
                where[Op.and].push({ Transaction_timestamp: { [Op.gte]: fromDate } });
            }
        }

        if (to) {
            const toDate = new Date(to);
            if (!Number.isNaN(toDate.getTime())) {
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
            const fromDate = new Date(from);
            if (!Number.isNaN(fromDate.getTime())) {
                where[Op.and].push({ visit_timestamp: { [Op.gte]: fromDate } });
            }
        }

        if (to) {
            const toDate = new Date(to);
            if (!Number.isNaN(toDate.getTime())) {
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

module.exports = router;