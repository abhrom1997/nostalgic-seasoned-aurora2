const express = require('express');
const fetch = require('node-fetch');
const Airtable = require('airtable');
const dotenv = require('dotenv');
const crypto = require('crypto');
const https = require('https');

dotenv.config(); // Load environment variables

const app = express();
app.use(express.json());

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const VIEW_NAME = process.env.AIRTABLE_VIEW_NAME;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(BASE_ID);

const PHONEPE_BASE_URL = 'https://mercury-t2.phonepe.com';
const SALT_KEY = 'e5cf908d-dfcc-4332-872d-9ef35d30ac92';
const SALT_INDEX = '1';
const MERCHANT_ID = 'GREENWHEELSTRAVEL';

// ✅ **Log collection for Airtable to retrieve later**
const logs = [];

function logMessage(message) {
    console.log(message);
    logs.push(message);
}

// ✅ **Keep connections alive**
app.use((req, res, next) => {
    res.setHeader('Connection', 'keep-alive'); // Prevent premature socket closure
    next();
});

// ✅ **Increase timeout handling to prevent socket hang-ups**
const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`✅ Server running on port ${server.address().port}`);
});

server.timeout = 120000; // ✅ Set timeout to 120 seconds

// **Generate X-VERIFY Header for PhonePe API Requests**
function generateXVerify(path) {
    const hash = crypto.createHash('sha256').update(path + SALT_KEY).digest('hex');
    return `${hash}###${SALT_INDEX}`;
}

// ✅ **Fetch all records with correct pagination handling**
async function fetchAllRecords() {
    let allRecords = [];
    let offset = null;

    try {
        do {
            let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?view=${VIEW_NAME}`;
            if (offset) url += `&offset=${offset}`;

            logMessage(`🔄 Fetching records with offset: ${offset || "First Request (No Offset)"}`);

            let response = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } });

            let responseData = await response.json();
            if (responseData.error) {
                logMessage(`❌ Error fetching records: ${responseData.error.message}`);
                break;
            }

            if (!responseData.records || responseData.records.length === 0) {
                logMessage(`⚠️ No records found for view: ${VIEW_NAME}`);
                break;
            }

            allRecords.push(...responseData.records);
            logMessage(`✅ Stored Records Count: ${allRecords.length}`);

            offset = responseData.offset || null;

        } while (offset);

        logMessage(`✅ Final Total Records Fetched: ${allRecords.length}`);
        return allRecords;
    } catch (error) {
        logMessage(`❌ Error fetching all records: ${error.message}`);
        return [];
    }
}

// ✅ **Fetch Payment Status from PhonePe**
async function fetchPaymentStatus(transactionId) {
    const path = `/v3/transaction/${MERCHANT_ID}/${transactionId}/status`;
    const url = `${PHONEPE_BASE_URL}${path}`;
    const xVerify = generateXVerify(path);
    //await base(TABLE_NAME).update(record.id, { "X-Verify Status Check": xVerify });
    //await base(TABLE_NAME).update(record.id, { "Request URL": url });
    
    

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'mercury-t2.phonepe.com',
            port: 443,
            path: path,
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify }
        };

        const request = https.request(options, (response) => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
                logMessage(`✅ Raw Response for ${transactionId}: ${data}`);
                resolve({ rawResponse: data, xVerify: xVerify, url: url });
            });
        });

        request.on('error', (error) => {
            logMessage(`❌ Error fetching payment status for ${transactionId}: ${error.message}`);
            reject(error);
        });

        request.end();
    });
}

/*// ✅ **Process payments in batches & update Airtable with a delay**
async function processBatch(recordsBatch) {
    for (let record of recordsBatch) {
        let transactionId = record.fields['merchantOrderId'];
        if (!transactionId) continue;

        try {
            let rawResponse = await fetchPaymentStatus(transactionId);

            let status = rawResponse.rawResponse ? JSON.parse(rawResponse.rawResponse) : {};
            let paymentStatus = status.code === "PAYMENT_SUCCESS" ? "Paid" : "Pending";
            

            logMessage(`✅ Updating record ${record.id} with payment status: ${paymentStatus}`);
            
            await base(TABLE_NAME).update(record.id, { "Payment Status": paymentStatus });

            await new Promise(resolve => setTimeout(resolve, 500)); // ✅ Add delay before next update
        } catch (error) {
            logMessage(`❌ Error processing batch for record ${record.id}: ${error.message}`);
        }
    }
}*/
// ✅ Process payments in batches & update Airtable with a delay
async function processBatch(recordsBatch) {
    for (let record of recordsBatch) {
        let transactionId = record.fields['merchantOrderId'];
        if (!transactionId) continue;

        try {
            let rawResponse = await fetchPaymentStatus(transactionId);

            let status = rawResponse.rawResponse ? JSON.parse(rawResponse.rawResponse) : {};
            let paymentStatus;

            // ✅ Handle different payment statuses
            if (status.code === "PAYMENT_SUCCESS") {
                paymentStatus = "Paid";
            } else if (status.code === "PAYMENT_ERROR") {
                paymentStatus = "Failed & Cancelled";
            } else {
                paymentStatus = "Pending";
            }

            logMessage(`✅ Updating record ${record.id} with payment status: ${paymentStatus}`);

            await base(TABLE_NAME).update(record.id, {
                "Registration Payment Status": paymentStatus,
                "Registration Raw Payment Status Response": JSON.stringify(status),
                "Payment Response Code": status.code,
                "Status Message": status.message,
                "X-Verify Status Check": rawResponse.xVerify, // ✅ Now properly stored
                "Request URL": rawResponse.url // ✅ Now properly stored
            });
            //await base(TABLE_NAME).update(record.id, { "Payment Status": paymentStatus });
            //await base(TABLE_NAME).update(record.id, { "Raw Payment Status Response": JSON.stringify(status) });
            //await base(TABLE_NAME).update(record.id, { "Payment Response Code": status.code });
            //await base(TABLE_NAME).update(record.id, { "Status Message": status.message });
            
            
            // ✅ Add delay before next update
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            logMessage(`❌ Error processing batch for record ${record.id}: ${error.message}`);
        }
    }
}

app.get("/ping", (req, res) => res.status(200).send("Pong!"));

// ✅ **API Endpoint to Start Checking Payment Status**
app.post('/start-check', async (req, res) => {
    logMessage(`🔄 Fetching records only from view: ${VIEW_NAME}`);

    let allRecords = await fetchAllRecords();
    logMessage(`✅ Fetched ${allRecords.length} records from Airtable view ${VIEW_NAME}`);
    res.json({ success: true, message: `✅ Fetched ${allRecords.length} records from Airtable view ${VIEW_NAME}` });

    let batchSize = 5;
    for (let i = 0; i < allRecords.length; i += batchSize) {
        let batch = allRecords.slice(i, i + batchSize);
        await processBatch(batch);
    }

    logMessage(`✅ Bulk payment status check completed!`);
    res.send({ success: true });
});

// ✅ **API Endpoint to Fetch Logs**
app.get('/logs', (req, res) => {
    res.json({ logs });
});

app.get('/check-status/:recordId', async (req, res) => {
    const recordId = req.params.recordId;
    logMessage(`🔄 Fetching transaction status for record: ${recordId}`);

    let record = await base(TABLE_NAME).find(recordId).catch(() => null);

    if (!record) {
        logMessage(`❌ Record ${recordId} not found in Airtable.`);
        return res.status(404).json({ error: "Record not found" });
    }

    let transactionId = record.fields['Unique ID'];
    if (!transactionId) {
        logMessage(`⚠️ No merchantOrderId found for record ${recordId}.`);
        return res.status(400).json({ error: "Missing transaction ID" });
    }

    let rawResponse = await fetchPaymentStatus(transactionId);
    logMessage(`✅ Retrieved transaction status for ${transactionId}: ${rawResponse.rawResponse}`);
    let status = rawResponse.rawResponse ? JSON.parse(rawResponse.rawResponse) : {};
    let paymentStatus;

    // ✅ Determine payment status
    if (status.code === "PAYMENT_SUCCESS") {
        paymentStatus = "Paid";
    } else if (status.code === "PAYMENT_ERROR") {
        paymentStatus = "Failed & Cancelled";
    } else {
        paymentStatus = "Pending";
    }

    // ✅ Update Airtable with the fetched status
    try {
        await base(TABLE_NAME).update(recordId, {
                "Registration Payment Status": paymentStatus,
                "Registration Raw Payment Status Response": JSON.stringify(status),
                "Payment Response Code": status.code,
                "Status Message": status.message,
                "X-Verify Status Check": rawResponse.xVerify, // ✅ Now properly stored
                "Request URL": rawResponse.url // ✅ Now properly stored
            });
        logMessage(`✅ Updated Airtable record ${recordId} with payment status: ${paymentStatus}`);
    } catch (error) {
        logMessage(`❌ Error updating Airtable record ${recordId}: ${error.message}`);
    }

    // ✅ Send JSON response back to API caller
    res.json({ recordId, transactionId, status: rawResponse.rawResponse });
});

    

setInterval(() => {
    fetch('https://your-project.glitch.me/')
        .then(res => console.log('Self-ping successful:', res.status))
        .catch(err => console.error('Ping error:', err));
}, 25000); // Ping every 5 minutes


