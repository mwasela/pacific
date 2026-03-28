const express = require('express');
const axios = require('axios');
const router = express.Router();
const Transaction = require('../model/Transaction');
const fs = require('fs');
const { Console } = require('console');
dotenv = require('dotenv');
dotenv.config();

// Middleware to get M-Pesa Access Token
// const getAccessToken = async (req, res, next) => {
//     const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
//     try {
//         const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
//             headers: { Authorization: `Basic ${auth}` }
//         });
//         req.token = response.data.access_token;
//         next();
//     } catch (error) {
//         res.status(500).json({ error: "Failed to authenticate with Safaricom" });
//     }
// };

const getAccessToken = async (req, res, next) => {
    // 1. Ensure your .env contains the Sandbox Consumer Key and Secret
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');

    try {
        // 2. Updated URL from 'api' to 'sandbox'
        const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: {
                Authorization: `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });

        req.token = response.data.access_token;
        next();
    } catch (error) {
        // 3. Log the specific error for easier debugging in your terminal
        console.error("M-Pesa Auth Error:", error.response ? error.response.data : error.message);

        res.status(500).json({
            error: "Failed to authenticate with Safaricom",
            details: error.response ? error.response.data.errorMessage : "Network Error"
        });
    }
};
// POST: /payment/pay
// router.post('/pay', getAccessToken, async (req, res) => {
//     const { number_plate, phone_number } = req.body;

//     //check if valid kenyan phone number
//     const phoneRegex = /^(2547|07)\d{8}$/;
//     if (!phoneRegex.test(phone_number)) {
//         return res.status(400).json({ error: "Invalid Kenyan phone number." });
//     }


//     //plate should only contain letters and numbers not more tha 8 characters
//     const plateRegex = /^[A-Z0-9]{1,8}$/i;
//     if (!plateRegex.test(number_plate)) {
//         return res.status(400).json({ error: "Invalid number plate." });
//     }


//     const amount = 10; // Set your parking fee here
//     const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
//     const password = Buffer.from(`${process.env.MPESA_PAYBILL}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

//     try {
//         //generate temp checkout ID from phone number and timestamp
//         const tempCheckoutID = `${phone_number}_${timestamp}`;

//         const record = await Transaction.create({
//             number_plate,
//             phone_number,
//             amount,
//             status: 'PENDING',
//             checkoutID: tempCheckoutID, // You should update this with the actual checkout ID from the response
//             Transaction_timestamp: new Date()
//         });

//         //write transaction to txt file
//         fs.appendFile('transactions.txt', JSON.stringify(record) + '\n', (err) => {
//             if (err) console.error("Failed to save transaction data.");
//         });

//         // 2. Initiate STK Push
//         const stkResponse = await axios.post(
//             'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', // Changed to sandbox
//             {
//                 BusinessShortCode: process.env.MPESA_SHORTCODE, // Use 174379 for Sandbox
//                 Password: password,
//                 Timestamp: timestamp,
//                 TransactionType: "CustomerPayBillOnline",
//                 Amount: amount,
//                 PartyA: phone_number,
//                 PartyB: process.env.MPESA_PAYBILL,
//                 PhoneNumber: phone_number,
//                 CallBackURL: "https://4704-197-248-235-117.ngrok-free.app/mpesa/callback",
//                 AccountReference: number_plate,
//                 TransactionDesc: `Parking fee for ${number_plate}`
//             },
//             {
//                 headers: {
//                     'Authorization': `Bearer ${req.token}`,
//                     'Content-Type': 'application/json'
//                 }
//             }
//         );


//         //update transaction with actual checkout ID from response
//         record.checkoutID = stkResponse.data.CheckoutRequestID;
//         await record.save();

//         //load stkpayload to txt file
//         fs.appendFile('stk_payloads.txt', JSON.stringify(stkResponse.data) + '\n', (err) => {
//             if (err) console.error("Failed to save STK payload data.");
//         });

//         console.log("response from mpesa:", stkResponse.data);

//         res.status(200).json({ message: "STK Push initiated", checkoutID: stkResponse.data.CheckoutRequestID });
//     } catch (error) {

//         console.error("Error processing payment:", error);

//         //write error to txt file
//         fs.appendFile('errors.txt', JSON.stringify({ error: error.message, timestamp: new Date() }) + '\n', (err) => {
//             if (err) console.error("Failed to save error data.");
//         });

//         res.status(500).json({ error: error.message });
//     }
// });

router.post('/pay', getAccessToken, async (req, res) => {
    try {
        let { number_plate, phone_number } = req.body;

        // 1. Sanitize & Validate Phone Number (Convert 07... to 2547...)
        if (phone_number.startsWith('0')) {
            phone_number = '254' + phone_number.substring(1);
        }
        
        const phoneRegex = /^(2547|2541)\d{8}$/;
        if (!phoneRegex.test(phone_number)) {
            return res.status(400).json({ error: "Invalid Kenyan phone number. Use 2547XXXXXXXX format." });
        }

        // 2. Validate Number Plate
        const plateRegex = /^[A-Z0-9]{1,8}$/i;
        if (!plateRegex.test(number_plate)) {
            return res.status(400).json({ error: "Invalid number plate." });
        }

        // 3. M-Pesa Constants (Use Sandbox defaults if .env is missing them)
        const shortCode = process.env.MPESA_SHORTCODE || "174379";
        const passkey = process.env.MPESA_PASSKEY; // Get from Daraja Sandbox tab
        const amount = 1; // Testing with 1 Shilling

        // 4. Generate Strict 14-digit Timestamp (YYYYMMDDHHMMSS)
        const date = new Date();
        const timestamp = 
            date.getFullYear() +
            ("0" + (date.getMonth() + 1)).slice(-2) +
            ("0" + date.getDate()).slice(-2) +
            ("0" + date.getHours()).slice(-2) +
            ("0" + date.getMinutes()).slice(-2) +
            ("0" + date.getSeconds()).slice(-2);

        // 5. Generate Password (Base64 of ShortCode + Passkey + Timestamp)
        const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

        // 6. Create local pending transaction record
        const tempCheckoutID = `TEMP_${phone_number}_${timestamp}`;
        const record = await Transaction.create({
            number_plate: number_plate.toUpperCase(),
            phone_number,
            amount,
            status: 'PENDING',
            checkoutID: tempCheckoutID,
            Transaction_timestamp: new Date()
        });

        // 7. Initiate STK Push
        const stkResponse = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: shortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: amount,
                PartyA: phone_number,
                PartyB: shortCode, 
                PhoneNumber: phone_number,
                CallBackURL: "https://api.eastafricanparking.com/mpesa/callback",
                AccountReference: number_plate.toUpperCase(),
                TransactionDesc: `Parking fee for ${number_plate}`
            },
            {
                headers: {
                    'Authorization': `Bearer ${req.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // 8. Update record with actual Safaricom CheckoutRequestID
        record.checkoutID = stkResponse.data.CheckoutRequestID;
        await record.save();

        // 9. Logging
        fs.appendFileSync('stk_payloads.txt', JSON.stringify(stkResponse.data) + '\n');
        console.log("M-Pesa Response:", stkResponse.data);

        res.status(200).json({ 
            message: "STK Push initiated", 
            checkoutID: stkResponse.data.CheckoutRequestID 
        });

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error("Payment Error:", error);

        fs.appendFileSync('errors.txt', JSON.stringify({ error: errorData, timestamp: new Date() }) + '\n');

        res.status(error.response ? error.response.status : 500).json({ 
            error: "Payment initiation failed", 
            details: errorData 
        });
    }
});

module.exports = router;