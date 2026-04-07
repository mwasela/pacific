const express = require('express');
const router = express.Router();
const Vippayments = require('../model/Vippayments');
const AuthenticateToken = require('../middleware/auth');


// Get all VIP payments
router.get('/', AuthenticateToken, async (req, res) => {
    try {
        const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 0, 100) : undefined;
        const sort = req.query.sort || 'createdAt:desc';
        const [sortFieldRaw, sortDirectionRaw] = sort.split(':');
        const allowedSortFields = ['transaction_code', 'number_plate', 'amount', 'createdAt'];
        const sortField = allowedSortFields.includes(sortFieldRaw) ? sortFieldRaw : 'createdAt';
        const sortDirection = String(sortDirectionRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const queryOptions = {
            order: [[sortField, sortDirection]],
        };

        if (limit && limit > 0) {
            queryOptions.limit = limit;
        }
        
        const payments = await Vippayments.findAll(queryOptions);
        res.json(payments);
    } catch (error) {
        console.error("Error fetching VIP payments:", error);
        res.status(500).json({ error: "Failed to fetch VIP payments" });
    }
});

module.exports = router;