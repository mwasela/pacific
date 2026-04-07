const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');


const VIP = sequelizeInstance.define('VIP', {
    fname: {
        type: DataTypes.STRING,
        allowNull: false
    },
    lname: {
        type: DataTypes.STRING,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    phone_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    vehicle_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    vip_status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    vip_expiry: {
        type: DataTypes.DATE,
        allowNull: false,
        //default now
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: true
});

sequelizeInstance.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("VIP table synced successfully.");
}).catch(err => {
    console.error("Failed to sync VIP table:", err);
});

module.exports = VIP;
