const express = require('express');
const router = express.Router();
const { col } = require('sequelize');
const Transaction = require('../model/Transaction');
const Visits = require('../model/Visits');
const AuthenticateToken = require('../middleware/auth');


router.get('/transactions', AuthenticateToken, async (req, res) => {
    try {
        const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 0, 100) : undefined;
        const sort = req.query.sort || 'createdAt:desc';
        const [sortFieldRaw, sortDirectionRaw] = sort.split(':');
        const allowedSortFields = ['Transaction_timestamp', 'createdAt', 'amount', 'status'];
        const sortField = allowedSortFields.includes(sortFieldRaw) ? sortFieldRaw : 'createdAt';
        const sortDirection = String(sortDirectionRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const queryOptions = {
            order: [[col(sortField), sortDirection]],
            include: [
                {
                    model: Visits,
                }
            ]
        };

        if (limit && limit > 0) {
            queryOptions.limit = limit;
        }

        const transactions = await Transaction.findAll(queryOptions);
        res.json(transactions);
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

