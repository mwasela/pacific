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
    // vip_card_number: {
    //     type: DataTypes.STRING,
    //     allowNull: false,
    //     unique: true
    // },
    vip_expiry: {
        type: DataTypes.DATE,
        allowNull: false,
        //default now
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: true
});

module.exports = VIP;
