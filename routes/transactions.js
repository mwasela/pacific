const express = require('express');
const router = express.Router();
const { Op, col } = require('sequelize');
const Transaction = require('../model/Transaction');
const Visits = require('../model/Visits');
const AuthenticateToken = require('../middleware/auth');


router.get('/transactions', AuthenticateToken, async (req, res) => {
    
    try {
        const hasLimitParam = typeof req.query.limit !== 'undefined';
        const hasPageSizeParam = typeof req.query.pageSize !== 'undefined';
        const hasCurrentParam = typeof req.query.current !== 'undefined';
        const hasCursorParam = typeof req.query.cursor !== 'undefined';
        const numberPlateQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';
        const paginationEnabled = hasLimitParam || hasCursorParam || (numberPlateQuery && (hasPageSizeParam || hasCurrentParam));
        const requestedLimit = parseInt(req.query.limit || req.query.pageSize, 10);
        const current = Math.max(parseInt(req.query.current, 10) || 1, 1);
        const limit = paginationEnabled
            ? Math.min(Math.max(requestedLimit || 20, 1), 100)
            : undefined;
        const sort = req.query.sort || 'createdAt:desc';
        const [sortFieldRaw, sortDirectionRaw] = sort.split(':');
        const allowedSortFields = ['Transaction_timestamp', 'createdAt', 'amount', 'status'];
        const cursorSortFields = ['Transaction_timestamp', 'createdAt'];
        const sortField = allowedSortFields.includes(sortFieldRaw) ? sortFieldRaw : 'createdAt';
        const sortDirection = String(sortDirectionRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const cursor = req.query.cursor;
        const cursorEnabled = cursorSortFields.includes(sortField);

        if (cursor && !cursorEnabled) {
            return res.status(400).json({ error: 'Cursor pagination is only supported for createdAt and Transaction_timestamp sorting' });
        }

        let where = undefined;
        if (cursor && cursorEnabled) {
            let parsedCursor;

            try {
                parsedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
            } catch (err) {
                return res.status(400).json({ error: 'Invalid cursor format' });
            }

            if (!parsedCursor || !parsedCursor.timestamp || !Number.isInteger(parsedCursor.id)) {
                return res.status(400).json({ error: 'Invalid cursor payload' });
            }

            const cursorTimestamp = new Date(parsedCursor.timestamp);
            if (Number.isNaN(cursorTimestamp.getTime())) {
                return res.status(400).json({ error: 'Invalid cursor timestamp' });
            }

            where = {
                [Op.or]: sortDirection === 'DESC'
                    ? [
                        { [sortField]: { [Op.lt]: cursorTimestamp } },
                        {
                            [sortField]: cursorTimestamp,
                            id: { [Op.lt]: parsedCursor.id }
                        }
                    ]
                    : [
                        { [sortField]: { [Op.gt]: cursorTimestamp } },
                        {
                            [sortField]: cursorTimestamp,
                            id: { [Op.gt]: parsedCursor.id }
                        }
                    ]
            };
        }

        if (numberPlateQuery) {
            const numberPlateFilter = {
                number_plate: {
                    [Op.like]: `%${numberPlateQuery}%`
                }
            };

            where = where
                ? { [Op.and]: [where, numberPlateFilter] }
                : numberPlateFilter;
        }

        let visitWhere;
        if (!numberPlateQuery) {
            const now = new Date();
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            visitWhere = {
                [Op.and]: [
                    {
                        createdAt: {
                            [Op.between]: [thirtyDaysAgo, now]
                        }
                    },
                    // { status: '0' },
                    // { paid_status: 0 }
                ]
            };
        } else {
            visitWhere = {
                [Op.and]: [
                    // { status: '0' },
                    // { paid_status: 0 }
                ]
            };
        }

        const queryOptions = {
            where,
            order: cursorEnabled
                ? [[col(sortField), sortDirection], ['id', sortDirection]]
                : [[col(sortField), sortDirection]],
            include: [
                {
                    model: Visits,
                    ...(visitWhere ? { where: visitWhere, required: true } : {})
                }
            ]
        };

        if (paginationEnabled && limit) {
            queryOptions.limit = cursorEnabled ? limit + 1 : limit;
        }

        if (paginationEnabled && !cursor) {
            queryOptions.offset = (current - 1) * limit;
        }

        if (paginationEnabled && !cursorEnabled) {
            const result = await Transaction.findAndCountAll({
                ...queryOptions,
                distinct: true
            });

            return res.json({
                data: result.rows,
                pagination: {
                    limit,
                    current,
                    total: result.count,
                    totalPages: Math.ceil(result.count / limit),
                    hasMore: current * limit < result.count,
                    nextCursor: null,
                    sort: `${sortField}:${sortDirection.toLowerCase()}`
                }
            });
        }

        const transactions = await Transaction.findAll(queryOptions);
        if (!paginationEnabled) {
            return res.json(transactions);
        }

        const hasMore = cursorEnabled ? transactions.length > limit : false;
        const pageData = hasMore ? transactions.slice(0, limit) : transactions;

        let nextCursor = null;
        if (cursorEnabled && hasMore && pageData.length > 0) {
            const lastRow = pageData[pageData.length - 1];
            const timestampValue = lastRow.get(sortField);
            if (timestampValue) {
                nextCursor = Buffer.from(JSON.stringify({
                    timestamp: new Date(timestampValue).toISOString(),
                    id: lastRow.id
                })).toString('base64');
            }
        }

        res.json({
            data: pageData,
            pagination: {
                limit,
                current,
                hasMore,
                nextCursor,
                sort: `${sortField}:${sortDirection.toLowerCase()}`
            }
        });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
});


router.get('/transactions/range', AuthenticateToken, async (req, res) => {
    
    try {
        const fromRaw = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
        const toRaw = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
        const paidStatusRaw = typeof req.query.paid_status === 'string' ? req.query.paid_status.trim() : undefined;
        const freeVisitRaw = typeof req.query.free_visit === 'string' ? req.query.free_visit.trim() : undefined;

        let fromDate;
        let toDate;

        if (typeof fromRaw !== 'undefined') {
            if (!fromRaw) {
                return res.status(400).json({ error: 'Invalid from date' });
            }
            fromDate = new Date(fromRaw);
            if (Number.isNaN(fromDate.getTime())) {
                return res.status(400).json({ error: 'Invalid from date' });
            }
        }

        if (typeof toRaw !== 'undefined') {
            if (!toRaw) {
                return res.status(400).json({ error: 'Invalid to date' });
            }
            toDate = new Date(toRaw);
            if (Number.isNaN(toDate.getTime())) {
                return res.status(400).json({ error: 'Invalid to date' });
            }
            // Extend to end of day so date-only inputs include the full day
            toDate.setHours(23, 59, 59, 999);
        }

        if (fromDate && toDate && fromDate > toDate) {
            return res.status(400).json({ error: 'from date cannot be greater than to date' });
        }

        if (typeof fromRaw === 'undefined' && typeof toRaw === 'undefined') {
            toDate = new Date();
            fromDate = new Date(toDate);
            fromDate.setDate(fromDate.getDate() - 30);
        }

        let visitDateWhere;
        if (fromDate && toDate) {
            visitDateWhere = {
                createdAt: {
                    [Op.between]: [fromDate, toDate]
                }
            };
        } else if (fromDate) {
            visitDateWhere = {
                createdAt: {
                    [Op.gte]: fromDate
                }
            };
        } else if (toDate) {
            visitDateWhere = {
                createdAt: {
                    [Op.lte]: toDate
                }
            };
        }

        let paidStatusWhere;
        if (typeof paidStatusRaw !== 'undefined') {
            if (paidStatusRaw !== '0' && paidStatusRaw !== '1') {
                return res.status(400).json({ error: 'Invalid paid_status. Use 0 or 1' });
            }

            paidStatusWhere = {
                paid_status: Number(paidStatusRaw)
            };
        }

        let freeVisitWhere;
        if (typeof freeVisitRaw !== 'undefined') {
            if (freeVisitRaw !== '0' && freeVisitRaw !== '1') {
                return res.status(400).json({ error: 'Invalid free_visit. Use 0 or 1' });
            }

            freeVisitWhere = freeVisitRaw === '0'
                ? {
                    amount: {
                        [Op.eq]: 0
                    }
                }
                : {
                    amount: {
                        [Op.gt]: 0
                    }
                };
        }

        let visitStatusWhere;
        const visitStatusRaw = typeof req.query.visit_status === 'string' ? req.query.visit_status.trim() : undefined;
        if (typeof visitStatusRaw !== 'undefined') {
            if (visitStatusRaw !== '0' && visitStatusRaw !== '1') {
                return res.status(400).json({ error: 'Invalid visit_status. Use 0 (completed) or 1 (open)' });
            }

            visitStatusWhere = {
                status: visitStatusRaw
            };
        }

        let visitWhere;
        if (visitDateWhere && paidStatusWhere && freeVisitWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, paidStatusWhere, freeVisitWhere, visitStatusWhere]
            };
        } else if (visitDateWhere && paidStatusWhere && freeVisitWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, paidStatusWhere, freeVisitWhere]
            };
        } else if (visitDateWhere && paidStatusWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, paidStatusWhere, visitStatusWhere]
            };
        } else if (visitDateWhere && freeVisitWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, freeVisitWhere, visitStatusWhere]
            };
        } else if (paidStatusWhere && freeVisitWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [paidStatusWhere, freeVisitWhere, visitStatusWhere]
            };
        } else if (visitDateWhere && paidStatusWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, paidStatusWhere]
            };
        } else if (visitDateWhere && freeVisitWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, freeVisitWhere]
            };
        } else if (visitDateWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [visitDateWhere, visitStatusWhere]
            };
        } else if (paidStatusWhere && freeVisitWhere) {
            visitWhere = {
                [Op.and]: [paidStatusWhere, freeVisitWhere]
            };
        } else if (paidStatusWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [paidStatusWhere, visitStatusWhere]
            };
        } else if (freeVisitWhere && visitStatusWhere) {
            visitWhere = {
                [Op.and]: [freeVisitWhere, visitStatusWhere]
            };
        } else {
            visitWhere = visitDateWhere || paidStatusWhere || freeVisitWhere || visitStatusWhere;
        }

        const hasLimitParam = typeof req.query.limit !== 'undefined';
        const hasPageSizeParam = typeof req.query.pageSize !== 'undefined';
        const hasCurrentParam = typeof req.query.current !== 'undefined';
        const hasCursorParam = typeof req.query.cursor !== 'undefined';
        const numberPlateQuery = typeof req.query.number_plate === 'string' ? req.query.number_plate.trim() : '';
        const paginationEnabled = hasLimitParam || hasCursorParam || (numberPlateQuery && (hasPageSizeParam || hasCurrentParam));
        const requestedLimit = parseInt(req.query.limit || req.query.pageSize, 10);
        const current = Math.max(parseInt(req.query.current, 10) || 1, 1);
        const limit = paginationEnabled
            ? Math.min(Math.max(requestedLimit || 20, 1), 100)
            : (!numberPlateQuery ? 400 : undefined);
        const sort = req.query.sort || 'createdAt:desc';
        const [sortFieldRaw, sortDirectionRaw] = sort.split(':');
        const allowedSortFields = ['Transaction_timestamp', 'createdAt', 'amount', 'status'];
        const cursorSortFields = ['Transaction_timestamp', 'createdAt'];
        const sortField = allowedSortFields.includes(sortFieldRaw) ? sortFieldRaw : 'createdAt';
        const sortDirection = String(sortDirectionRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const cursor = req.query.cursor;
        const cursorEnabled = cursorSortFields.includes(sortField);

        if (cursor && !cursorEnabled) {
            return res.status(400).json({ error: 'Cursor pagination is only supported for createdAt and Transaction_timestamp sorting' });
        }

        let where = undefined;
        if (cursor && cursorEnabled) {
            let parsedCursor;

            try {
                parsedCursor = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
            } catch (err) {
                return res.status(400).json({ error: 'Invalid cursor format' });
            }

            if (!parsedCursor || !parsedCursor.timestamp || !Number.isInteger(parsedCursor.id)) {
                return res.status(400).json({ error: 'Invalid cursor payload' });
            }

            const cursorTimestamp = new Date(parsedCursor.timestamp);
            if (Number.isNaN(cursorTimestamp.getTime())) {
                return res.status(400).json({ error: 'Invalid cursor timestamp' });
            }

            where = {
                [Op.or]: sortDirection === 'DESC'
                    ? [
                        { [sortField]: { [Op.lt]: cursorTimestamp } },
                        {
                            [sortField]: cursorTimestamp,
                            id: { [Op.lt]: parsedCursor.id }
                        }
                    ]
                    : [
                        { [sortField]: { [Op.gt]: cursorTimestamp } },
                        {
                            [sortField]: cursorTimestamp,
                            id: { [Op.gt]: parsedCursor.id }
                        }
                    ]
            };
        }

        if (numberPlateQuery) {
            const numberPlateFilter = {
                number_plate: {
                    [Op.like]: `%${numberPlateQuery}%`
                }
            };

            where = where
                ? { [Op.and]: [where, numberPlateFilter] }
                : numberPlateFilter;
        }

        const manualPayRaw = typeof req.query.manual_pay === 'string' ? req.query.manual_pay.trim() : undefined;
        if (typeof manualPayRaw !== 'undefined') {
            if (manualPayRaw !== '0' && manualPayRaw !== '1') {
                return res.status(400).json({ error: 'Invalid manual_pay. Use 0 or 1' });
            }

            const manualPayFilter = manualPayRaw === '1'
                ? { transaction_code: { [Op.like]: 'MANUAL_PAY_%' } }
                : { transaction_code: { [Op.notLike]: 'MANUAL_PAY_%' } };

            where = where
                ? { [Op.and]: [where, manualPayFilter] }
                : manualPayFilter;
        }

        const queryOptions = {
            where,
            order: cursorEnabled
                ? [[col(sortField), sortDirection], ['id', sortDirection]]
                : [[col(sortField), sortDirection]],
            include: [
                {
                    model: Visits,
                    ...(visitWhere ? { where: visitWhere, required: true } : {})
                }
            ]
        };

        if (paginationEnabled && limit) {
            queryOptions.limit = cursorEnabled ? limit + 1 : limit;
        }

        if (paginationEnabled && !cursor) {
            queryOptions.offset = (current - 1) * limit;
        }

        if (paginationEnabled && !cursorEnabled) {
            const result = await Transaction.findAndCountAll({
                ...queryOptions,
                distinct: true
            });

            return res.json({
                data: result.rows,
                pagination: {
                    limit,
                    current,
                    total: result.count,
                    totalPages: Math.ceil(result.count / limit),
                    hasMore: current * limit < result.count,
                    nextCursor: null,
                    sort: `${sortField}:${sortDirection.toLowerCase()}`
                }
            });
        }

        const transactions = await Transaction.findAll(queryOptions);
        if (!paginationEnabled) {
            return res.json(transactions);
        }

        const hasMore = cursorEnabled ? transactions.length > limit : false;
        const pageData = hasMore ? transactions.slice(0, limit) : transactions;

        let nextCursor = null;
        if (cursorEnabled && hasMore && pageData.length > 0) {
            const lastRow = pageData[pageData.length - 1];
            const timestampValue = lastRow.get(sortField);
            if (timestampValue) {
                nextCursor = Buffer.from(JSON.stringify({
                    timestamp: new Date(timestampValue).toISOString(),
                    id: lastRow.id
                })).toString('base64');
            }
        }

        res.json({
            data: pageData,
            pagination: {
                limit,
                current,
                hasMore,
                nextCursor,
                sort: `${sortField}:${sortDirection.toLowerCase()}`
            }
        });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ error: "Failed to fetch transactions" });
    }
});

//get all visits
router.get('/visits', AuthenticateToken, async (req, res) => {
    try {
        const visits = await Visits.findAll();  
        res.json(visits);
    } catch (error) {
        console.error("Error fetching visits:", error);
        res.status(500).json({ error: "Failed to fetch visits" });
    }
});


//edit a visit
router.put('/visits/:id', AuthenticateToken, async (req, res) => {
    const visitId = req.params.id;
    const { vehicle_number, ticket_id, amount } = req.body; 

    try {
        const visit = await Visits.findByPk(visitId);
        if (!visit) {
            return res.status(404).json({ error: "Visit not found" });
        }

        visit.vehicle_number = vehicle_number;
        visit.ticket_id = ticket_id;
        visit.amount = amount;
        await visit.save();

        res.json({ message: "Visit updated successfully", visit });
    } catch (error) {
        console.error("Error updating visit:", error);
        res.status(500).json({ error: "Failed to update visit" });
    }
});

module.exports = router;

