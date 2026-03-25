const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');


const Transaction = sequelize.define('Transaction', {
    transaction_code: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    number_plate: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phone_number: {
        type: DataTypes.STRING,
        allowNull: false
    },
    amount: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 1.0
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
    }
}, {
    timestamps: true
});


sequelize.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("Transaction table synced successfully.");
}).catch(err => {
    console.error("Failed to sync Transaction table:", err);        

})

module.exports = Transaction;