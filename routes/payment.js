const express = require('express');
const axios = require('axios');
const router = express.Router();
const Transaction = require('../model/Transaction');
const fs = require('fs');
const { Console } = require('console');
dotenv = require('dotenv');
dotenv.config();

// Middleware to get M-Pesa Access Token
const getAccessToken = async (req, res, next) => {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${auth}` }
        });
        req.token = response.data.access_token;
        next();
    } catch (error) {
        res.status(500).json({ error: "Failed to authenticate with Safaricom" });
    }
};



// const getAccessToken = async (req, res, next) => {
//     // 1. Ensure your .env contains the Sandbox Consumer Key and Secret
//     const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');

//     try {
//         // 2. Updated URL from 'api' to 'sandbox'
//         const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
//             headers: {
//                 Authorization: `Basic ${auth}`,
//                 'Accept': 'application/json'
//             }
//         });

//         req.token = response.data.access_token;
//         next();
//     } catch (error) {
//         // 3. Log the specific error for easier debugging in your terminal
//         console.error("M-Pesa Auth Error:", error.response ? error.response.data : error.message);

//         res.status(500).json({
//             error: "Failed to authenticate with Safaricom",
//             details: error.response ? error.response.data.errorMessage : "Network Error"
//         });
//     }
// };


// POST: /payment/pay
router.post('/pay', getAccessToken, async (req, res) => {
    try {
        let { number_plate, phone_number } = req.body;

        // 1. Sanitize & Validate Phone Number
        if (phone_number.startsWith('0')) {
            phone_number = '254' + phone_number.substring(1);
        }

        const phoneRegex = /^(2547|2541)\d{8}$/;
        if (!phoneRegex.test(phone_number)) {
            return res.status(400).json({ error: "Invalid Kenyan phone number." });
        }

        // 2. Validate Number Plate
        const plateRegex = /^[A-Z0-9]{1,8}$/i;
        if (!plateRegex.test(number_plate)) {
            return res.status(400).json({ error: "Invalid number plate." });
        }

        // 3. M-Pesa Constants
        const shortCode = process.env.MPESA_SHORTCODE || "174379";
        const passkey = process.env.MPESA_PASSKEY;
        const amount = 1;

        // 4. FIX: Generate Strict 14-digit Timestamp in Africa/Nairobi (UTC+3)
        // This ensures production (UTC) matches Safaricom (EAT)
        // 4. GENERATE TIMESTAMP (Forced UTC+3 for Nairobi)
        const now = new Date();
        // Add 3 hours (3 * 60 * 60 * 1000 ms) to the current UTC time
        const nairobiDate = new Date(now.getTime() + (3 * 60 * 60 * 1000));

        const timestamp =
            nairobiDate.getUTCFullYear().toString() +
            ("0" + (nairobiDate.getUTCMonth() + 1)).slice(-2) +
            ("0" + nairobiDate.getUTCDate()).slice(-2) +
            ("0" + nairobiDate.getUTCHours()).slice(-2) +
            ("0" + nairobiDate.getUTCMinutes()).slice(-2) +
            ("0" + nairobiDate.getUTCSeconds()).slice(-2);

        console.log("SENDING TIMESTAMP:", timestamp); // Should show roughly 202603280755xx

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
            Transaction_timestamp: nairobiDate // Internal DB can stay UTC
        });

        // 7. Initiate STK Push
        const stkResponse = await axios.post(
            'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: shortCode,
                Password: password,
                Timestamp: timestamp, // Now matches the EAT password hash
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

        res.status(200).json({
            message: "STK Push initiated",
            checkoutID: stkResponse.data.CheckoutRequestID
        });

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error("Payment Error:", errorData);
        res.status(error.response ? error.response.status : 500).json({
            error: "Payment initiation failed",
            details: errorData
        });
    }
});

module.exports = router;