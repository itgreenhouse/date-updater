// src/dearApi.js
const { dearApiClient } = require('./apiClient');
const moment = require('moment-timezone');

function getCurrentTimestamps() {
    const nowEST = moment.tz('America/New_York'); // Get current time in EST (or EDT if DST)
    const fiveMinutesAgoEST = nowEST.clone().subtract(5, 'minutes'); // Subtract 5 minutes

    // Convert EST to UTC
    const createdSinceEST = nowEST.format('YYYY-MM-DD'); // Date in EST
    const updatedSinceUTC = fiveMinutesAgoEST.utc().toISOString(); // ISO string in UTC

    return {
        createdSince: createdSinceEST, // Use EST date
        updatedSince: updatedSinceUTC, // Keep this in UTC
    };
}

async function fetchSaleList() {
    try {
        const { createdSince, updatedSince } = getCurrentTimestamps();

        const response = await dearApiClient.get(
            `/saleList?Page=1&Limit=1000&CreatedSince=${createdSince}&UpdatedSince=${updatedSince}&OrderLocationID=${process.env.ORDER_LOCATION_ID}`
        );
        const data = response.data;

        const filteredSales = data.SaleList.filter(sale => sale.Status !== 'VOIDED' && sale.SourceChannel === 'Shopify');

        const saleIds = filteredSales.map(sale => sale.SaleID);

        return saleIds;
    } catch (error) {
        console.error('Error fetching sale list from DEAR:', error);
        throw error;
    }
}

async function fetchSale(SaleID) {
    try {
        const response = await dearApiClient.get(`/sale?ID=${SaleID}&CombineAdditionalCharges=true`);
        return response.data;
    } catch (error) {
        console.error('Error fetching sale from DEAR:', error);
        throw error;
    }
}

function extractDeliveryDate(note) {
    const match = note.match(/Delivery-Date:\s*([\d/]+)/); // Searches the note (comments!) for the value within the format "Delivery-Date: ...etc." / [comment written 2025-03-06]
    if (match) {
        const dateParts = match[1].split('/'); // Split the extracted date (e.g., 2024/10/11)
        if (dateParts.length === 3) {
            const [year, month, day] = dateParts.map(Number); // Convert to numbers
            const date = new Date(Date.UTC(year, month - 1, day)); // Create a UTC Date object
            return date.toISOString(); // Convert to ISO 8601 format
        }
    }
    return null; // Return null if no valid date is found
}

async function updateSaleShipBy(saleDetail) {
    var { ID, Customer, CustomerID, DeliveryDate, ShipBy, TaxRule, PriceTier } = saleDetail;

    // Normalize both dates for comparison (strip milliseconds and timezone)
    const normalizedDeliveryDate = DeliveryDate
        ? new Date(DeliveryDate).toISOString().split('.')[0] + "Z" // Ensure both have UTC timezone
        : null;
    const normalizedShipBy = ShipBy
        ? new Date(ShipBy).toISOString().split('.')[0] + "Z"
        : null;


    // Band-aid fix: if DeliveryDate falls before ShipBy (invoice) date, set DeliveryDate = ShipBy + 1 to account for staging and to prevent
    //               unfulfilled orders to be missed by staging team.
    if (normalizedDeliveryDate < normalizedShipBy) {
        ShipBy = new Date(ShipBy)
        DeliveryDate = (ShipBy.setDate(ShipBy.getDate() + 1)).toISOString()
    }


    // Skip update if DeliveryDate is already equal to ShipBy
    if (normalizedDeliveryDate === normalizedShipBy) {
        console.log(`Customer: ${Customer} already has ShipBy equal to DeliveryDate. Skipping update.`);
        return;
    }

    const body = {
        ID,
        Customer,
        CustomerID,
        ShipBy: DeliveryDate,
        TaxRule,
        PriceTier
         // Use the original DeliveryDate here for the update
    };

    try {
        const response = await dearApiClient.put('/sale', body);
        console.log(`Successfully updated ShipBy for Sale ID: ${ID}`);
    } catch (error) {
        console.error(`Error updating ShipBy for Sale ID: ${ID}:`, error.response?.data || error.message);
    }
}


async function fetchAndUpdateSales() {
    try {
        const saleIds = await fetchSaleList();
        for (const saleId of saleIds) {
            try {
                const saleData = await fetchSale(saleId);

                // Extract the Delivery-Date from Note field
                const deliveryDate = extractDeliveryDate(saleData.Note);

                const saleDetail = {
                    ID: saleData.ID,
                    Customer: saleData.Customer,
                    CustomerID: saleData.CustomerID,
                    DeliveryDate: deliveryDate,
                    ShipBy: saleData.ShipBy || null,
                    TaxRule: saleData.TaxRule,
                    PriceTier: saleData.PriceTier // Get the current ShipBy date
                };

                // Update sale only if necessary
                await updateSaleShipBy(saleDetail);

                // Delay 1 second between calls to avoid hitting rate limits
                await delay(1000);
            } catch (error) {
                console.error(`Error processing Sale ID ${saleId}:`, error);
            }
        }
    } catch (error) {
        console.error('Error fetching and updating sales:', error);
        throw error;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function startScheduler() {
    console.log("Starting scheduler...");
    fetchAndUpdateSales(); // Run immediately on startup

    setInterval(() => {
        console.log(`Running fetchAndUpdateSales at ${new Date().toISOString()}`);
        fetchAndUpdateSales();
    }, 5 * 60 * 1000); // Run every 5 minutes
}


module.exports = { fetchAndUpdateSales, fetchSale, fetchSaleList, startScheduler };
