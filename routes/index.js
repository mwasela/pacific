var express = require('express');
var router = express.Router();
const fs = require('fs');
const axios = require('axios');
const Transaction = require('../model/Transaction');
const dotenv = require('dotenv');
dotenv.config();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Pacific Gateway' });
});


router.post('/mpesa/callback', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const checkoutID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;
    const MpesaReceiptNumber = callbackData.MpesaReceiptNumber;
    const transactiondate = callbackData.TransactionDate;


    if (resultCode === 0) {
        // 1. Find the record in your DB using checkoutID
        const transaction = await Transaction.findOne({ where: { checkoutID } });

        if (!transaction) {
            console.error("Transaction not found for checkoutID:", checkoutID);
            return res.status(404).json({ error: "Transaction not found" });
        }

        transaction.status = 'COMPLETED';
        transaction.transaction_code = MpesaReceiptNumber;
        transaction.Transaction_timestamp = new Date(transactiondate);
        await transaction.save();


        //create txt file if not exists
        if (!fs.existsSync('mpesa_callbacks.txt')) {
            fs.writeFileSync('mpesa_callbacks.txt', '');
        }

        //save to txt file
        fs.appendFile('mpesa_callbacks.txt', JSON.stringify(callbackData) + '\n', (err) => {
            if (err) console.error("Failed to save callback data.");
        });
  

        try {
            await axios.post('https://pacific-api.medicisecure.com/barrier/open', {
                success: true,
                plate: transaction.number_plate,
                action: "paid"

            });
            console.log("Barrier command sent successfully.");
        } catch (err) {
            console.error("Failed to signal barrier.");
        }
    } else {
        console.log(`Transaction failed with code ${resultCode}`);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});





module.exports = router;
