const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');
const Visits = require('./Visits');

const Confee = sequelizeInstance.define('Confee', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    visit_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    con_fee: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    }
}, {
    timestamps: true
});

Confee.belongsTo(Visits, { foreignKey: 'visit_id' });

module.exports = Confee;