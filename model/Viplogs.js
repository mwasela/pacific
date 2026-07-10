const sequelizeInstance = require('../config/database');
const { DataTypes } = require('sequelize');
const VIP = require('./VIP');

const Viplogs = sequelizeInstance.define('Viplogs', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    vip_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    number_plate: {
        type: DataTypes.STRING(30),
        allowNull: false
    },
    action: {   
        type: DataTypes.INTEGER,  // 0 for entry, 1 for exit
        allowNull: false
    },
}, {
    timestamps: true
});
// Define the association between Viplogs and VIP
Viplogs.belongsTo(VIP, { foreignKey: 'vip_id', targetKey: 'id'});

module.exports = Viplogs;
