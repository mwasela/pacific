const Transaction = require('../model/Transaction');
const Visits = require('../model/Visits');
const { Op } = require('sequelize');
const { parseDateRange } = require('./dateHelper');

async function getTransactionsByVisitRange({ from, to, transactionWhere = {}, visitWhere = {} }) {
    const { startDate, endDate } = parseDateRange(from, to);

    return await Transaction.findAll({
        where: {
            status: 'COMPLETED', // Standardized baseline
            ...transactionWhere   // Custom Transaction filters (e.g., paymentMethod, userId)
        },
        include: [{
            model: Visits,
            required: true, // INNER JOIN to enforce Visit date scope
            where: {
                createdAt: {
                    [Op.between]: [startDate, endDate]
                },
                ...visitWhere // Custom Visit filters (e.g., zoneId, gateId, vehicleType)
            }
        }]
    });
}

module.exports = { getTransactionsByVisitRange };