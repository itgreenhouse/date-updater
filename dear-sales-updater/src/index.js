// server.js
const express = require('express');
const { fetchSaleList, fetchSale, fetchAndUpdateSales, startScheduler } = require('./dearApi');

const app = express();
const PORT = process.env.PORT || 3000;


app.get('/', async (req, res) => {
    try {
        const tasks = await startScheduler();
        // // const tasks = await fetchSaleList();
        // const tasks = await fetchSale('e1033342-19b0-4117-893a-765b3a1cc981');
        res.json({ success: true, data: tasks });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error fetching tasks from Limble' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});