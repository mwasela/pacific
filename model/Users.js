const { status } = require('express/lib/response');
const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');

const Users = sequelizeInstance.define('Users', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    phone_number: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    }
}, {
    timestamps: true
});

sequelizeInstance.sync({
    // force: true // Use with caution - this will drop the table if it already exists
    // alter: true // Use this in development to update the table structure without dropping it
}).then(() => {
    console.log("Users table synced successfully.");
}).catch(err => {
    console.error("Failed to sync Users table:", err);
});

module.exports = Users;