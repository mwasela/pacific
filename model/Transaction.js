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
    timestamps: true
});

//A transaction belongs to a visit
Transaction.belongsTo(Visits, { foreignKey: 'visit_id' });


sequelize.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("Transaction table synced successfully.");
}).catch(err => {
    console.error("Failed to sync Transaction table:", err);        

})

module.exports = Transaction;