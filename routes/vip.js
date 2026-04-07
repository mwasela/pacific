const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const VIP = require('../model/VIP');
const Setup = require('../model/Setup');

const hasVipExpired = (vip) => {
    if (!vip || !vip.vip_expiry) {
        return true;
    }

    return new Date(vip.vip_expiry).getTime() < Date.now();
};

// Get VIP details for all vehicles
router.get('/', authenticateToken, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const offset = (page - 1) * limit;

        const { count, rows } = await VIP.findAndCountAll({
            limit,
            offset,
            order: [['id', 'DESC']]
        });

        res.json({
            data: rows,
            pagination: {
                page,
                limit,
                total_items: count,
                total_pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching VIP details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//register a new VIP vehicle
router.post('/', authenticateToken, async (req, res) => {
    const {
        fname,
        lname,
        phone_number,
        email,
        vehicle_number,
    } = req.body;

    try {
        const vip = await VIP.create({
            fname,
            lname,
            phone_number,
            email,
            vehicle_number,
        });

        res.json(vip);
    } catch (error) {
        console.error('Error registering VIP vehicle:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

//update VIP details
router.put('/:id', authenticateToken, async (req, res) => {
    const vipId = req.params.id;
    const {
        fname,
        lname,
        phone_number,
        email,
        vehicle_number,
    } = req.body;

    try {
        const vip = await VIP.findByPk(vipId);
        if (!vip) {
            return res.status(404).json({ message: 'VIP vehicle not found' });
        }

        vip.fname = fname;
        vip.lname = lname;
        vip.phone_number = phone_number;
        vip.email = email;
        vip.vehicle_number = vehicle_number;
        await vip.save();
        res.json({ message: 'VIP vehicle updated successfully', vip });
    } catch (error) {
        console.error('Error updating VIP vehicle details:', error);
        res.status(500).json({ message: 'Internal server error' });

    }
});


router.post('/entry', async (req, res) => {
    const { vehicle_number } = req.body;
    try {
        const vip = await VIP.findOne({ where: { vehicle_number } });
        if (!vip) {
            return res.status(404).json({ message: 'VIP vehicle not found' });
        }
        if (hasVipExpired(vip)) {
            return res.status(400).json({ message: 'VIP vehicle membership has expired' });
        }
        res.json({ 
                message: 'VIP vehicle entry allowed', 
                number_plate: vip.vehicle_number,
                status: 1,
                success: 0
                
         });
    } catch (error) {
        console.error('Error checking VIP vehicle entry:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


router.post('/exit', async (req, res) => {
    const { vehicle_number } = req.body;
    try {
        const vip = await VIP.findOne({ where: { vehicle_number } });
        if (!vip) {
            return res.status(404).json({ message: 'VIP vehicle not found' });
        }
        if (hasVipExpired(vip)) {
            return res.status(400).json({ message: 'VIP vehicle membership has expired' });
        }
        res.json({
             message: 'VIP vehicle exit allowed', 
             number_plate: vip.vehicle_number,
             status: 2,
             success: 0
             });
    } catch (error) {
        console.error('Error checking VIP vehicle exit:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


module.exports = router;

