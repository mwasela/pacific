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

module.exports = Setup;
