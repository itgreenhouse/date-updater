// src/dearApi.js
const { dearApiClient } = require('./apiClient');
const moment = require('moment-timezone');

function getCurrentTimestamps() {
    const nowEST = moment.tz('America/New_York'); // Get current time in EST (or EDT if DST)
    const fiveMinutesAgoEST = nowEST.clone().subtract(5, 'minutes'); // Check for orders that came in within the last 5 minutes, since the last time the program ran

    // Convert EST to UTC
    const createdSinceEST = nowEST.subtract(1, 'days').format('YYYY-MM-DD'); // Date in EST, subtract 1 to account for midnight orders that could have been backdated
    const updatedSinceEST = fiveMinutesAgoEST.toISOString(); // ISO string in EST

    return {
        createdSince: createdSinceEST, // Use EST date
        updatedSince: updatedSinceEST, // Use EST to stay consistent
    };
}

// fetches the list of sales based on when they were created and when they were last updated
async function fetchSaleList() {
    try {
        const { createdSince, updatedSince } = getCurrentTimestamps();

        console.log('Order Created:', createdSince);
        console.log('Last Updated:', updatedSince);

        // fetch list of sale IDs using a GET request
        const response = await dearApiClient.get(
            `/saleList?Page=1&Limit=1000&CreatedSince=${createdSince}&UpdatedSince=${updatedSince}&OrderLocationID=${process.env.ORDER_LOCATION_ID}`
        );
        const data = response.data;

        // filters for orders made through Shopify that are still valid/in progress
        const filteredSales = data.SaleList.filter(sale => sale.Status !== 'VOIDED' && sale.SourceChannel === 'Shopify');

        const saleIds = filteredSales.map(sale => sale.SaleID);

        return saleIds;
    } catch (error) {
        console.error('Error fetching sale list from DEAR:', error);
        throw error;
    }
}

// Fetches sales based on an inputted sale ID
async function fetchSale(SaleID) {
    try {
        const response = await dearApiClient.get(`/sale?ID=${SaleID}&CombineAdditionalCharges=true`);
        return response.data;
    } catch (error) {
        console.error('Error fetching sale from DEAR:', error);
        throw error;
    }
}

// Extracts a delivery date from the sale notes/comments
function extractDeliveryDate(note) {
    if (note) { // Check if note (comments) is empty, if so return null
        const match = note.match(/Delivery-Date:\s*([\d/]+)/); // Searches the notes for the value within the format "Delivery-Date: ...etc." using a regex pattern
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
 
    return null; // Return null if note == null, meaning there are no comments.
}

async function updateSaleShipBy(saleDetail, baseNote) {
    var { ID, Customer, CustomerID, DeliveryDate, ShipBy, TaxRule, PriceTier } = saleDetail;
    var newNote = baseNote;

    console.log(`Customer: ${Customer}, DeliveryDate: ${DeliveryDate}, ShipBy: ${ShipBy}`);

    // Normalize both dates for comparison (strip milliseconds and timezone)
    const normalizedDeliveryDate = DeliveryDate
        ? new Date(DeliveryDate).toISOString().split('.')[0] + "Z" // Ensure both have UTC timezone
        : null;
    const normalizedShipBy = ShipBy
        ? new Date(ShipBy).toISOString().split('.')[0] + "Z"
        : null;

    // Band-aid fix: if DeliveryDate falls before ShipBy (invoice) date, set DeliveryDate = ShipBy + 1 to account for staging and to prevent
    //               unfulfilled orders to be missed by staging.
    // Includes edge cases: when baseNote is null because the comments (note) is empty, or if Deliverydate is null because there's no date in
    //                      the comments, just add 1 to the invoice date
    if (normalizedDeliveryDate < normalizedShipBy || DeliveryDate == null || baseNote == null) {
        // Invalid Date flag since DeliveryDate gets updated later
        let invalidDate = false;
        if (DeliveryDate == null) {
            invalidDate = true;
        }
        
        // Debugging block
        if (normalizedDeliveryDate < normalizedShipBy) {
            console.log(`Customer: ${Customer} has a DeliveryDate set before their ShipBy Date. Replacing with new date.`);
        } else if (baseNote == null) {
            console.log("Comments are empty. Adding new date.");
        } else if (DeliveryDate == null) {
            console.log("No valid delivery date found");
        } else {
            console.error("Condition errored out in an unlikely way, check for edge case.");
        }

        // If any of the above conditions are true, replace DeliveryDate with ShipBy + 1 for staging purposes
        // edit made: do not chain together toISOString with setDate(), operates on the wrong return value.
        ShipBy = new Date(ShipBy);
        ShipBy.setDate(ShipBy.getDate() + 1);
        DeliveryDate = ShipBy.toISOString().split("T")[0];
        let splitDeliveryDate = DeliveryDate.split("-");
        let formattedDeliveryDate = splitDeliveryDate[0] + "/" + splitDeliveryDate[1] + "/" + splitDeliveryDate[2];

        if (baseNote && !invalidDate) {
            // replaces all instances of Delivery Dates in the DEAR sale notes with the proper delivery date, catches all characters until the next line break (\n).
            newNote = baseNote.replaceAll(/Delivery-Date[:\s]*([^\n]*)/g,"Delivery-Date: " + formattedDeliveryDate);
        } else if (baseNote && invalidDate) {
            // if there's no delivery date in the notes, attach new delivery date to the original notes
            newNote = "Delivery-Date: " + formattedDeliveryDate + "\n" + baseNote;
        } else {
            // if there's no notes, create them
            newNote = "Delivery-Date: " + formattedDeliveryDate + "\n";
        }
    }

    // Skip update if DeliveryDate is already equal to ShipBy
    if (normalizedDeliveryDate === normalizedShipBy) {
        console.log(`Customer: ${Customer} already has ShipBy equal to DeliveryDate. Skipping update.`);
        return;
    }

    // This is the sale payload that gets sent back to the api client when it sends the PUT request
    // Full list of sale properties can be found in the Cin7 Core API Docs, under Sale -> PUT 
    const body = {
        ID,
        Customer,
        CustomerID,
        ShipBy: DeliveryDate,
        TaxRule,
        PriceTier,
        Note: newNote
    };

    try {
        const response = await dearApiClient.put('/sale', body);
        console.log(`Successfully updated ShipBy for Sale ID: ${ID}`);
    } catch (error) {
        console.error(`Error updating ShipBy for Sale ID: ${ID}:`, error.response?.data || error.message);
    }
}

// Combines the above functions to update sales
// Flow: fetch sale list -> fetch sale by ID -> extract delivery date via notes -> based on the sale notes and the potential delivery date within it
async function fetchAndUpdateSales() {
    try {
        const saleIds = await fetchSaleList();
        for (const saleId of saleIds) {
            try {
                const saleData = await fetchSale(saleId);
                const baseNote = saleData.Note;

                // Extract the Delivery-Date from Note field
                const deliveryDate = extractDeliveryDate(baseNote);

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
                await updateSaleShipBy(saleDetail, baseNote);

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
