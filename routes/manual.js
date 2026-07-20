const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const Manual = require('../model/manual');
const Users = require('../model/Users');
const Visits = require('../model/Visits');
const Transaction = require('../model/Transaction');
const VIP = require('../model/VIP');
const Viplogs = require('../model/Viplogs');

const openbarrier = require('../services/barrier');
const authenticateToken = require('../middleware/auth');

//post a new manual entry
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { number_plate, reason, barrier } = req.body;
        const user_id = req.user.userId; // Extract userId from JWT token payload

        console.log(`User ID: ${user_id}, Number Plate: ${number_plate}, Reason: ${reason}, Barrier: ${barrier}`);
        //check if there is an open visit for the same number plate
        const openVisit = await Visits.findOne({
            where: {
                vehicle_number: number_plate,
                status: '1' // '1' indicates an open visit
            }
        });

        // Only block barrier if there's an open visit with an unpaid transaction
        if (openVisit) {
            const unpaidTransaction = await Transaction.findOne({
                where: {
                    visit_id: openVisit.id,
                    status: { [Op.ne]: 'COMPLETED' } // Not completed = unpaid
                },
                order: [['createdAt', 'DESC']]
            });

            if (unpaidTransaction) {
                return res.status(400).json({ message: 'Cannot open barrier, payment required' });
            }
        }

        // Check if this vehicle is a VIP
        const vipRecord = await VIP.findOne({
            where: { vehicle_number: number_plate }
        });

        // If VIP, create a Viplogs entry first
        if (vipRecord) {
            await Viplogs.create({
                vip_id: vipRecord.id,
                number_plate: number_plate,
                action: 0  // 0 for entry
            });
        }

        //open barrier
        const command = await openbarrier(barrier);
        
        //create a new manual entry
        const newManualEntry = await Manual.create({
            user_id,
            number_plate,
            visit_id: openVisit ? openVisit.id : null,
            reason,
            barrier,
            status: 0
        });
        res.status(201).json(newManualEntry);
    } catch (error) {
        console.error('Error creating manual entry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//get all manual entries with filtering
router.get('/', authenticateToken, async (req, res) => {
    try {
        const whereConditions = {};
        
        // Filter by number plate
        if (req.query.number_plate) {
            whereConditions.number_plate = {
                [Op.like]: `%${req.query.number_plate}%`
            };
        }

        // Filter by date range
        if (req.query.start_date || req.query.end_date) {
            let startDate = req.query.start_date ? new Date(req.query.start_date) : new Date(0);
            let endDate = req.query.end_date ? new Date(req.query.end_date) : new Date();
            
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 format (e.g., 2026-07-18T00:00:00Z)' });
            }
            
            const NAIROBI_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
            startDate = new Date(startDate.getTime() + NAIROBI_UTC_OFFSET_MS);
            endDate = new Date(endDate.getTime() + NAIROBI_UTC_OFFSET_MS);
            
            whereConditions.createdAt = {
                [Op.between]: [startDate, endDate]
            };
        }

        const manualEntries = await Manual.findAll({
            where: Object.keys(whereConditions).length > 0 ? whereConditions : undefined,
            include: [{
                model: Users,
                as: 'user',
                attributes: { exclude: ['password'] }, // Exclude password field from the user object
                where: req.query.user ? { [Op.or]: [
                    { id: isNaN(req.query.user) ? null : parseInt(req.query.user) },
                    { username: { [Op.like]: `%${req.query.user}%` } }
                ]} : undefined,
                required: !!req.query.user // Only require user join if filtering by user
            }],
            order: [['createdAt', 'DESC']],
            limit: req.query.limit ? parseInt(req.query.limit) : 100
        });
        res.json(manualEntries);
    } catch (error) {
        console.error('Error fetching manual entries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//this route will open the barrier for a specific visit and update the transaction status to closed, similar to how
//the exit route in index.js works, update all fields in Visit and Transaction to reflect the exit, and also create a manual entry for the exit.
router.post('/visit', authenticateToken, async (req, res) => {
    try {
        const { visit_id, barrier, reason } = req.body;
        const user_id = req.user.userId;

        // Find the visit
        const visit = await Visits.findByPk(visit_id);

        if (!visit) {
            return res.status(404).json({ message: 'Visit not found' });
        }

        // Find the latest transaction for this visit
        const transaction = await Transaction.findOne({
            where: { visit_id: visit.id },
            order: [['createdAt', 'DESC']]
        });

        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found for this visit' });
        }

        // Check if this vehicle is a VIP
        const vipRecord = await VIP.findOne({
            where: { vehicle_number: visit.vehicle_number }
        });

        // If VIP, create a Viplogs entry first
        if (vipRecord) {
            await Viplogs.create({
                vip_id: vipRecord.id,
                number_plate: visit.vehicle_number,
                action: 1  // 1 for exit
            });
        }

        // Update the visit and transaction to reflect the exit
        visit.exit_time = new Date();
        visit.status = '0';
        await visit.save();

        transaction.exit_time = new Date();
        transaction.status = 'COMPLETED';
        await transaction.save();

        // Open the barrier
        const command = await openbarrier(barrier);

        // Create a manual entry for the exit
        const newManualEntry = await Manual.create({
            user_id,
            number_plate: visit.vehicle_number,
            visit_id: visit.id,
            reason: reason,
            barrier,
            status: 0
        });
        res.status(201).json(newManualEntry);
    } catch (error) {
        console.error('Error processing visit exit:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



//get manual entry by id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const manualEntry = await Manual.findByPk(req.params.id, {
            include: [{
                model: Users,
                as: 'user'
            }]
        });

        if (!manualEntry) {
            return res.status(404).json({ error: 'Manual entry not found' });
        }

        res.json(manualEntry);
    } catch (error) {
        console.error('Error fetching manual entry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//create a new manual entry
// router.post('/', authenticateToken, async (req, res) => {

//     try {
//         const { number_plate, reason, status } = req.body;

//         const user_id = req.user.id; // Assuming the user ID is available in the request object after authentication

//         const newManualEntry = await Manual.create({
//             user_id,
//             number_plate,
//             reason,
//             status
//         });

//         res.status(201).json(newManualEntry);
//     } catch (error) {
//         console.error('Error creating manual entry:', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });


//update a manual entry
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { user_id, number_plate, reason, status } = req.body;

        const manualEntry = await Manual.findByPk(req.params.id);
        if (!manualEntry) {
            return res.status(404).json({ error: 'Manual entry not found' });
        }

        manualEntry.user_id = user_id;
        manualEntry.number_plate = number_plate;
        manualEntry.reason = reason;
        manualEntry.status = status;
        await manualEntry.save();

        res.json(manualEntry);
    } catch (error) {
        console.error('Error updating manual entry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}); 



module.exports = router;