const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');

const Visits = sequelizeInstance.define('Visits', {
    vehicle_number: {
        type: DataTypes.STRING,
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


sequelizeInstance.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("Visits table synced successfully.");
}).catch(err => {
    console.error("Failed to sync Visits table:", err);
})

module.exports = Visits;    