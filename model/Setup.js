const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');
const dotenv = require('dotenv');
const { status } = require('express/lib/response');
dotenv.config();

const Setup = sequelizeInstance.define('Setup', {
    parking_capacity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    parking_location: {
        type: DataTypes.STRING,
        allowNull: false
    },
    parking_rate_monthly: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: process.env.MONTHLY_PARKING_RATE
    },
    status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
}, {
    timestamps: true
});

sequelizeInstance.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("Setup table synced successfully.");
}).catch(err => {
    console.error("Failed to sync Setup table:", err);
});


module.exports = Setup;
