const express = require('express');
const router = express.Router();
const Confee = require('../model/Confee');
const Visits = require('../model/Visits');
const authenticateToken = require('../middleware/auth');


// relationships
Confee.belongsTo(Visits, { foreignKey: 'visit_id' });


//get all confee entries
router.get('/', authenticateToken, async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;

    try {
        const { count, rows } = await Confee.findAndCountAll({
            include: [{
                model: Visits
            }],
            limit,
            offset,
            order: [['id', 'DESC']]
        });
        
        res.json({
            data: rows,
            total: count
        });
    } catch (error) {
        console.error('Error fetching confee entries:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// router.get('/', authenticateToken, async (req, res) => {
//     //pagination and sorting
//     const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
//     const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
//     const offset = (page - 1) * limit;


//     try {
//         const confeeEntries = await Confee.findAll({
//             include: [{
//                 model: Visits
//             }],
//             limit,
//             offset,
//             order: [['id', 'DESC']]
//         });
//         res.json(confeeEntries);
//     } catch (error) {
//         console.error('Error fetching confee entries:', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });

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