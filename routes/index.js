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


router.get('/status/:checkoutID', async (req, res) => {
    try {
        const transaction = await Transaction.findOne({
            where: { checkoutID: req.params.checkoutID }
        });

        if (!transaction) {
            return res.status(404).json({ status: 'NOT_FOUND' });
        }

        // Return the current status (PENDING, COMPLETED, or FAILED)
        res.json({ status: transaction.status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


router.post('/mpesa/callback', async (req, res) => {
    // Safaricom sends data nested in an array called CallbackMetadata
    const callbackData = req.body.Body.stkCallback;
    const checkoutID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    if (resultCode === 0) {
        // M-Pesa metadata is an array of objects { Name: '...', Value: '...' }
        const metadata = callbackData.CallbackMetadata.Item;
        
        // Helper to find values in the metadata array
        const getValue = (name) => metadata.find(item => item.Name === name)?.Value;

        const mpesaReceipt = getValue('MpesaReceiptNumber');
        const rawDate = getValue('TransactionDate').toString(); // e.g., "20260327134642"

        // Format the date: YYYY-MM-DD HH:mm:ss
        const formattedDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)} ${rawDate.substring(8, 10)}:${rawDate.substring(10, 12)}:${rawDate.substring(12, 14)}`;

        try {
            const transaction = await Transaction.findOne({ where: { checkoutID } });

            if (!transaction) {
                console.error("Transaction not found for checkoutID:", checkoutID);
                return res.status(404).json({ error: "Transaction not found" });
            }

            // Update record
            transaction.status = 'COMPLETED';
            transaction.transaction_code = mpesaReceipt;
            transaction.Transaction_timestamp = new Date(formattedDate); 
            await transaction.save();

            console.log(`Transaction ${mpesaReceipt} saved for plate ${transaction.number_plate}`);

            // Trigger the barrier
            await axios.post('https://pacific-api.medicisecure.com/barrier/open', {
                success: true,
                plate: transaction.number_plate,
                action: "paid"
            });
            
        } catch (dbError) {
            console.error("Database or Barrier Error:", dbError.message);
        }
    } else {
        console.log(`Transaction ${checkoutID} failed with code ${resultCode}`);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});





module.exports = router;
