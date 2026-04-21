const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');
const Visits = require('./Visits');


const Transaction = sequelize.define('Transaction', {
    transaction_code: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    visit_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    number_plate: {
        type: DataTypes.STRING(30),
        allowNull: false
    },
    phone_number: {
        type: DataTypes.STRING(15),
        allowNull: true
    },
    amount: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'PENDING'
    },  
    checkoutID: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    Transaction_timestamp: {
        type: DataTypes.DATE,
        allowNull: false
    },
    payment_timestamp: {
        type: DataTypes.DATE,
        allowNull: true // Will be set when payment is confirmed
    }
}, {
    timestamps: true,
    indexes: [
        {
            name: 'idx_transactions_createdat_id',
            fields: ['createdAt', 'id']
        },
        {
            name: 'idx_transactions_trx_timestamp_id',
            fields: ['Transaction_timestamp', 'id']
        },
        {
            name: 'idx_transactions_status_createdat_id',
            fields: ['status', 'createdAt', 'id']
        },
        {
            name: 'idx_transactions_visit_id',
            fields: ['visit_id']
        }
    ]
});

//A transaction belongs to a visit
Transaction.belongsTo(Visits, { foreignKey: 'visit_id' });

module.exports = Transaction;