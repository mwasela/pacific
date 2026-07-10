const express = require('express');
const router = express.Router();
const Manual = require('../model/manual');
const Users = require('../model/Users');
const authenticateToken = require('../middleware/auth');

//get all manual entries
router.get('/', authenticateToken, async (req, res) => {
    try {
        const manualEntries = await Manual.findAll({
            include: [{
                model: Users,
                as: 'user'
            }]
        });
        res.json(manualEntries);
    } catch (error) {
        console.error('Error fetching manual entries:', error);
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
router.post('/', authenticateToken, async (req, res) => {

    try {
        const { number_plate, reason, status } = req.body;

        const user_id = req.user.id; // Assuming the user ID is available in the request object after authentication

        const newManualEntry = await Manual.create({
            user_id,
            number_plate,
            reason,
            status
        });

        res.status(201).json(newManualEntry);
    } catch (error) {
        console.error('Error creating manual entry:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


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