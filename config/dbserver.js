const sequelize = require('sequelize');
const dotenv = require('dotenv');

dotenv.config();


const sequelizeServer = new sequelize(process.env.DB_SERVER_NAME, process.env.DB_SERVER_USER, process.env.DB_SERVER_PASSWORD, {
    host: process.env.DB_SERVER_HOST,
    port: 1433, // Default SQL Server port
    dialect: 'mssql',
    logging: false,
    timezone: '+03:00', // Set the timezone to UTC+3
    timeout: 10000, // Set the timeout to 10 seconds
});


module.exports = sequelizeServer;

