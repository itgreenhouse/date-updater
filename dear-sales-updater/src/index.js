// server.js
const express = require('express');
const { fetchSaleList, fetchSale, fetchAndUpdateSales, startScheduler } = require('./dearApi');

const app = express();
const PORT = process.env.PORT || 3000;


startScheduler();

app.get('/', (req, res) => {
    res.send('<h1>Cron job endpoint is working! Server is up!</h1>');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});