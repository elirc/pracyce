const dotenv = require('dotenv');

dotenv.config();

const config = {
  port: Number(process.env.PORT || 4200),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5176'
};

module.exports = config;