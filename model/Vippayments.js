const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

const Vippayments = sequelize.define('Vippayments', {
    transaction_code: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
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
    timestamps: true
});

module.exports = Vippayments;