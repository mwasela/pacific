const express = require('express');
const router = express.Router();
const Viplogs = require('../model/Viplogs');
const VIP = require('../model/VIP');
const AuthenticateToken = require('../middleware/auth');
const { Op } = require('sequelize');


//relationship between Viplogs and VIP
Viplogs.belongsTo(VIP, { foreignKey: 'vip_id', targetKey: 'id' });

// Get all VIP logs
router.get('/', AuthenticateToken, async (req, res) => {
    try {
        const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10) || 10, 100) : 10;
        const sort = req.query.sort || 'createdAt:desc';
        const [sortFieldRaw, sortDirectionRaw] = sort.split(':');
        const allowedSortFields = ['vip_id', 'number_plate', 'action', 'createdAt'];
        const sortField = allowedSortFields.includes(sortFieldRaw) ? sortFieldRaw : 'createdAt';
        const sortDirection = String(sortDirectionRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const queryOptions = {
            include: [{
                model: VIP
            }],
            order: [[sortField, sortDirection]],
        };

        // Initialize where clause
        const whereConditions = {};

        // Add date range filter if start_time and end_time are provided
        if (req.query.start_time || req.query.end_time) {
            let startDate = req.query.start_time ? new Date(req.query.start_time) : new Date(0);
            let endDate = req.query.end_time ? new Date(req.query.end_time) : new Date();

            // Validate dates
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format (e.g., 2026-01-15T10:30:00Z)' });
            }

            // Convert UTC times to Nairobi local time (UTC+3) for database comparison
            // Database stores timestamps in local time without timezone info
            const NAIROBI_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
            startDate = new Date(startDate.getTime() + NAIROBI_UTC_OFFSET_MS);
            endDate = new Date(endDate.getTime() + NAIROBI_UTC_OFFSET_MS);

            whereConditions.createdAt = {
                [Op.between]: [startDate, endDate]
            };
        }

        // Add number_plate filter if provided
        if (req.query.number_plate) {
            whereConditions.number_plate = req.query.number_plate;
        }

        // Only add where clause if there are conditions
        if (Object.keys(whereConditions).length > 0) {
            queryOptions.where = whereConditions;
        }

        if (limit && limit > 0) {
            queryOptions.limit = limit;
        }

        const vipLogs = await Viplogs.findAll(queryOptions);
        res.json(vipLogs);
    } catch (error) {
        console.error("Error fetching VIP logs:", error);
        res.status(500).json({ error: "Failed to fetch VIP logs" });
    }
});

//get Viplogs by createdAt date range
router.get('/date-range', AuthenticateToken, async (req, res) => {
    try {
        let { startDate, endDate } = req.query;

        // If not provided, use today midnight to current time
        if (!startDate || !endDate) {
            const today = new Date();
            const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
            startDate = todayMidnight;
            endDate = new Date();
        } else {
            startDate = new Date(startDate);
            endDate = new Date(endDate);
        }

        const vipLogs = await Viplogs.findAll({
            where: {
                createdAt: {
                    [Op.between]: [startDate, endDate]
                }
            },
            include: [{
                model: VIP
            }],
            order: [['createdAt', 'DESC']]
        });

        if (vipLogs.length === 0) {
            return res.status(404).json({ error: 'No VIP logs found for the specified date range' });
        }

        res.json(vipLogs);
    } catch (error) {
        console.error("Error fetching VIP logs by date range:", error);
        res.status(500).json({ error: "Failed to fetch VIP logs by date range" });
    }
});

//get VIP logs by vip_id
router.get('/:vip_id', AuthenticateToken, async (req, res) => {
    try {
        const vipId = req.params.vip_id;
        const vipLogs = await Viplogs.findAll({
            where: { vip_id: vipId },
            include: [{
                model: VIP
            }],
            order: [['createdAt', 'DESC']]
        }); 

        if (vipLogs.length === 0) {
            return res.status(404).json({ error: 'No VIP logs found for the specified VIP ID' });
        }

        res.json(vipLogs);
    } catch (error) {
        console.error("Error fetching VIP logs by VIP ID:", error);
        res.status(500).json({ error: "Failed to fetch VIP logs by VIP ID" });
    }
});

module.exports = router;



