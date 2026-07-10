const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');
const Users = require('./Users');

const Manual = sequelizeInstance.define('Manual', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    number_plate: {
        type: DataTypes.STRING(30),
        allowNull: false
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
}, {
    timestamps: true,
});

// Define the association between Manual and Users
Manual.belongsTo(Users, { foreignKey: 'user_id', targetKey: 'id', as: 'user' });

module.exports = Manual;