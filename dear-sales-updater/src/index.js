// server.js
const express = require('express');
const { fetchSaleList, fetchSale, fetchAndUpdateSales, startScheduler } = require('./dearApi');

const app = express();
const PORT = process.env.PORT || 3000;


startScheduler();

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});