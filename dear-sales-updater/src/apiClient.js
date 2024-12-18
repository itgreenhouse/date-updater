// src/apiClient.js
const axios = require('axios');
require('dotenv').config();


const dearApiClient = axios.create({
    baseURL: process.env.DEAR_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'api-auth-accountid': process.env.DEAR_CLIENT_ID,
      'api-auth-applicationkey': process.env.DEAR_CLIENT_SECRET
    }
  });

module.exports = { dearApiClient };