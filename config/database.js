const sequelize = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();


const sequelizeInstance = new sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false
});


module.exports = sequelizeInstance;

