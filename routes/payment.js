const express = require('express');
const axios = require('axios');
const router = express.Router();
const Transaction = require('../model/Transaction');
const fs = require('fs');
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

// POST: /payment/pay
router.post('/pay', async (req, res) => {
    const { number_plate, phone_number } = req.body;

    //check if valid kenyan phone number
    const phoneRegex = /^(2547|07)\d{8}$/;
    if (!phoneRegex.test(phone_number)) {
        return res.status(400).json({ error: "Invalid Kenyan phone number." });
    }


    //plate should only contain letters and numbers not more tha 8 characters
    const plateRegex = /^[A-Z0-9]{1,8}$/i;
    if (!plateRegex.test(number_plate)) {
        return res.status(400).json({ error: "Invalid number plate." });
    }


    const amount = 10; // Set your parking fee here
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const password = Buffer.from(`${process.env.MPESA_PAYBILL}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    try {
        //generate temp checkout ID from phone number and timestamp
        const tempCheckoutID = `${phone_number}_${timestamp}`;

        const record = await Transaction.create({
            number_plate,
            phone_number,
            amount,
            status: 'PENDING',
            checkoutID: tempCheckoutID, // You should update this with the actual checkout ID from the response
            Transaction_timestamp: new Date()
        });

        //write transaction to txt file
        fs.appendFile('transactions.txt', JSON.stringify(record) + '\n', (err) => {
            if (err) console.error("Failed to save transaction data.");
        });

        // 2. Initiate STK Push
        const stkResponse = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            BusinessShortCode: process.env.MPESA_PAYBILL,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: phone_number, // User's phone
            PartyB: process.env.MPESA_PAYBILL,
            PhoneNumber: phone_number,
            CallBackURL: "https://pacific-api.medicisecure.com/mpesa/callback",
            AccountReference: number_plate,
            TransactionDesc: `Parking fee for ${number_plate}`
        }, {
            headers: { Authorization: `Bearer ${process.env.TOKEN}` }
        });


        //update transaction with actual checkout ID from response
        record.checkoutID = stkResponse.data.CheckoutRequestID;
        await record.save();

        //load stkpayload to txt file
        fs.appendFile('stk_payloads.txt', JSON.stringify(stkResponse.data) + '\n', (err) => {
            if (err) console.error("Failed to save STK payload data.");
        });


        res.status(200).json({ message: "STK Push initiated", checkoutID: stkResponse.data.CheckoutRequestID });
    } catch (error) {

        //write error to txt file
        fs.appendFile('errors.txt', JSON.stringify({ error: error.message, timestamp: new Date() }) + '\n', (err) => {
            if (err) console.error("Failed to save error data.");
        });

        res.status(500).json({ error: error.message });
    }
});

module.exports = router;