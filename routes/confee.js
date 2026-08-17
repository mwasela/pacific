const express = require('express');
const router = express.Router();
const { Op, fn, col, literal } = require('sequelize');
const Confee = require('../model/Confee');
const Visits = require('../model/Visits');
const authenticateToken = require('../middleware/auth');


// relationships
Confee.belongsTo(Visits, { foreignKey: 'visit_id' });

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
}

function endOfDay(date) {
    const value = new Date(date);
    value.setHours(23, 59, 59, 999);
    return value;
}

function parseDateValue(rawValue) {
    if (typeof rawValue !== 'string') {
        return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return {
        date: parsed,
        isDateOnly: DATE_ONLY_REGEX.test(trimmed)
    };
}


//get all confee entries
router.get('/', authenticateToken, async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const numberPlateQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';

    const startRaw = typeof req.query.start_date === 'string'
        ? req.query.start_date
        : typeof req.query.date === 'string'
            ? req.query.date
            : null;
    const endRaw = typeof req.query.end_date === 'string' ? req.query.end_date : null;

    const parsedStart = parseDateValue(startRaw);
    const parsedEnd = parseDateValue(endRaw);

    if (startRaw && !parsedStart) {
        return res.status(400).json({ error: 'Invalid start_date value' });
    }

    if (endRaw && !parsedEnd) {
        return res.status(400).json({ error: 'Invalid end_date value' });
    }

    let startDate = parsedStart ? new Date(parsedStart.date) : null;
    let endDate = parsedEnd ? new Date(parsedEnd.date) : null;

    if (!startDate && !endDate) {
        const today = new Date();
        startDate = startOfDay(today);
        endDate = endOfDay(today);
    }

    if (startDate && !endDate) {
        endDate = parsedStart?.isDateOnly ? endOfDay(startDate) : new Date(startDate);
    } else if (!startDate && endDate) {
        startDate = parsedEnd?.isDateOnly ? startOfDay(endDate) : new Date(endDate);
    }

    if (startDate && endDate) {
        if (parsedStart?.isDateOnly) {
            startDate = startOfDay(startDate);
        }

        if (parsedEnd?.isDateOnly || !parsedEnd) {
            endDate = endOfDay(endDate);
        }

        if (startDate > endDate) {
            return res.status(400).json({ error: 'start_date cannot be greater than end_date' });
        }
    }

    const visitFilters = [{
        visit_timestamp: {
            [Op.between]: [startDate, endDate]
        }
    }];

    if (numberPlateQuery) {
        visitFilters.push({
            vehicle_number: {
                [Op.like]: `%${numberPlateQuery}%`
            }
        });
    }

    const visitWhere = { [Op.and]: visitFilters };

        const buildVisitInclude = () => ({
            model: Visits,
            where: visitWhere,
            required: true
        });

    try {
        const { count, rows } = await Confee.findAndCountAll({
            include: [buildVisitInclude()],
            limit,
            offset,
            order: [['id', 'DESC']],
            distinct: true
        });

        const groupedSummaryRows = await Confee.findAll({
            attributes: [
                'status',
                [fn('COUNT', col('Confee.id')), 'recordCount'],
                [fn('COALESCE', fn('SUM', col('Confee.con_fee')), 0), 'amountSum']
            ],
            include: [buildVisitInclude()],
            group: ['Confee.status'],
            raw: true
        });

        let totalAmount = 0;
        let paidAmount = 0;
        let pendingAmount = 0;
        let paidCount = 0;
        let pendingCount = 0;

        for (const summaryRow of groupedSummaryRows) {
            const statusValue = Number(summaryRow.status);
            const recordCount = Number(summaryRow.recordCount || 0);
            const amountSum = Number(summaryRow.amountSum || 0);

            totalAmount += amountSum;

            if (statusValue === 1) {
                paidCount += recordCount;
                paidAmount += amountSum;
            } else if (statusValue === 0) {
                pendingCount += recordCount;
                pendingAmount += amountSum;
            }
        }

        const totalPages = Math.ceil(count / limit);
        
        res.json({
            data: rows,
            total: count,
            paidCount,
            pendingCount,
            stats: {
                scope: 'filtered_period',
                totalFees: count,
                totalAmount,
                averageFee: count > 0 ? Math.round(totalAmount / count) : 0,
                paidCount,
                pendingCount,
                totalPaidAmount: paidAmount,
                totalPendingAmount: pendingAmount
            },
            summary: {
                totalRecords: count,
                totalAmount,
                totalPaidAmount: paidAmount,
                totalPendingAmount: pendingAmount,
                paidCount,
                pendingCount,
                averageFee: count > 0 ? Math.round(totalAmount / count) : 0
            },
            filters: {
                start_date: startDate.toISOString(),
                end_date: endDate.toISOString(),
                number_plate: numberPlateQuery || null
            },
            pagination: {
                page,
                limit,
                total: count,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching confee entries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//get confee entry by id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const confeeEntry = await Confee.findByPk(req.params.id, {
            include: [{
                model: Visits
            }]
        });
        if (!confeeEntry) {
            return res.status(404).json({ error: 'Confee entry not found' });
        }

        res.json(confeeEntry);
    } catch (error) {
        console.error('Error fetching confee entry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;