const express = require('express');
const router = express.Router();
const Setup = require('../model/Setup');
const authenticateToken = require('../middleware/auth');

// Get setup details
router.get('/', authenticateToken, async (req, res) => {
    try {
        const setup = await Setup.findOne();
        if (!setup) {
            return res.status(404).json({ message: 'Setup details not found' });
        }
        res.json(setup);
    } catch (error) {
        console.error('Error fetching setup details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }   
});

// Update setup details
router.put('/:id', authenticateToken, async (req, res) => {
    const { parking_capacity, parking_location, parking_rate_monthly, hourly_rate, status } = req.body;
    try {
        let setup = await Setup.findByPk(req.params.id);
        if (!setup) {
            return res.status(404).json({ message: 'Setup details not found' });
        }
        setup.parking_capacity = parking_capacity;
        setup.parking_location = parking_location;
        setup.parking_rate_monthly = parking_rate_monthly;
        setup.hourly_rate = hourly_rate;
        setup.status = status;

        await setup.save();
        res.json(setup);
    } catch (error) {
        console.error('Error updating setup details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;