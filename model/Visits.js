const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');

const Visits = sequelizeInstance.define('Visits', {
    vehicle_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ticket_id:{
        type:DataTypes.STRING,
        //unique
        unique: true,
        allowNull: false
    },
    paid_status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '1'
    },
    visit_timestamp: {
        type: DataTypes.DATE,
        allowNull: false
    },
    exit_timestamp: {
        type: DataTypes.DATE,
        allowNull: true
    },
    amount: {
        type: DataTypes.FLOAT,
        allowNull: true,
       // defaultValue: ,
    },
    hours:{
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '1'
    },
    user_type: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
        //O:Normal user, 1:Staff, 2:VIP
    }
}, {
    timestamps: true
});

module.exports = Visits;    