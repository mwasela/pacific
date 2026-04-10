var express = require('express');
var router = express.Router();
const fs = require('fs');
const axios = require('axios');
const Transaction = require('../model/Transaction');
const dotenv = require('dotenv');
const VIP = require('../model/VIP');
const Vippayments = require('../model/Vippayments');
const { console } = require('inspector');
const Visits = require('../model/Visits');



dotenv.config();

/* GET home page. */
router.get('/', function (req, res, next) {
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


router.post('/mpesa/callback/vip', async (req, res) => {
    const callbackData = req.body.Body.stkCallback;
    const checkoutID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;
    
    if (resultCode === 0) {
        const metadata = callbackData.CallbackMetadata.Item;
        const getValue = (name) => metadata.find(item => item.Name === name)?.Value;
        
        const mpesaReceipt = getValue('MpesaReceiptNumber');
        const rawDate = getValue('TransactionDate').toString();
        const formattedDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)} ${rawDate.substring(8, 10)}:${rawDate.substring(10, 12)}:${rawDate.substring(12, 14)}`;
        
        try {
            const transaction = await Vippayments.findOne({ where: { checkoutID } });
            if (!transaction) {
                console.error("Transaction not found for checkoutID:", checkoutID);
                return res.status(404).json({ error: "Transaction not found" });
            }

            transaction.status = 'COMPLETED';
            transaction.transaction_code = mpesaReceipt;
            transaction.Transaction_timestamp = new Date(formattedDate);
            await transaction.save();


            const VIPRecord = await VIP.findOne({ where: { vehicle_number: transaction.number_plate } });
            if (VIPRecord) {
                //add 30 days to todays date for vip expiry
                VIPRecord.vip_expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await VIPRecord.save();
                console.log(`VIP status updated for plate ${transaction.number_plate}, VIP expiry set to ${VIPRecord.vip_expiry}`);
            } else {
                console.error("VIP record not found for plate:", transaction.number_plate);
            }

            console.log(`VIP Transaction ${mpesaReceipt} saved for plate ${transaction.number_plate}`);
        } catch (dbError) {
            console.error("Database Error:", dbError.message);
        }
    } else {
        //fs write
        fs.appendFile('vip_failed_transactions.log', `VIP Transaction ${checkoutID} failed with code ${resultCode}\n`, (err) => {
            if (err) console.error("Error writing to log file:", err);
        });

        console.log(`VIP Transaction ${checkoutID} failed with code ${resultCode}`);
    }
    
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });

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

            //update visit record to mark as paid
            const visit = await Visits.findOne({ where: { id: transaction.visit_id } });
            if (visit) {
                visit.paid_status = '0'; // Mark as paid
                await visit.save();
                console.log(`Visit ${visit.id} marked as paid.`);
            } else {
                console.error("Visit not found for visit_id:", transaction.visit_id);
            }


        } catch (dbError) {
            console.error("Database or Barrier Error:", dbError.message);
        }
    } else {
        console.log(`Transaction ${checkoutID} failed with code ${resultCode}`);
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});


router.post('/api/vehicle/entry', async (req, res) => {

    const { vehicle_number, ticket_id } = req.body;
    // Store in UTC and convert only when displaying.
    const visit_timestamp = new Date();

    try {
        if (!ticket_id) {
            return res.status(400).json({
                success: false,
                message: "ticket_id is required"
            });
        }

        const normalizedVehicleNumber =
            typeof vehicle_number === 'string' && vehicle_number.trim()
                ? vehicle_number.trim().toUpperCase()
                : '';

        const visit = await Visits.create({
            vehicle_number: normalizedVehicleNumber,
            ticket_id: ticket_id,
            paid_status: '1',
            visit_timestamp: visit_timestamp,
            amount: 5,
            hours: 1,
            status: '1',
            user_type: 0
        });

        console.log("Visit record created:", visit.toJSON());

        visit.message = "Success";
        //IF USER = 0 NORMAL USER, 1 STAFF, 2 VIP
        if (visit.user_type === 0) {
            visit.user_type = 'Normal User';
        } else if (visit.user_type === 1) {
            visit.user_type = 'Staff';
            // visit.amount = 0;
            // visit.message = "Welcome Staff!";
        } else if (visit.user_type === 2) {
            visit.user_type = 'VIP';
            // visit.amount = 0;
            // visit.message = "Welcome VIP!";
        }

        //create a transaction record for this visit with status PENDING
        await Transaction.create({
            visit_id: visit.id,
            number_plate: visit.vehicle_number || '',
            phone_number: '',
            amount: visit.amount,
            status: 'PEND',
            checkoutID: `PV_${visit.id}_${Date.now()}`,
            Transaction_timestamp: visit.visit_timestamp,
            payment_timestamp: visit.visit_timestamp // Initialize with visit timestamp, will be updated on payment confirmation
        });

        console.log(`Vehicle entry recorded for ${visit.vehicle_number || 'NO_PLATE'} at ${visit.visit_timestamp}`);

        res.json(visit);
    } catch (error) {
        console.error("Error recording vehicle entry:", error);
        res.status(500).json({ success: false, message: error.message });
    }

});


router.post('/api/vehicle/exit', async (req, res) => {

    const { vehicle_number, ticket_id } = req.body;
    const exit_timestamp = new Date();

    try {
        if (!ticket_id) {
            return res.status(400).json({
                status: {
                 faultcode: "-1",
                    message: "Vehicle exit not successful",
                    detail: "ticket_id is required."
                }
            });
        }

        const visitWhere = { ticket_id: ticket_id, status: '1' };
        if (vehicle_number) {
            visitWhere.vehicle_number = vehicle_number;
        }

        const visit = await Visits.findOne({
            where: visitWhere,
            order: [['visit_timestamp', 'DESC']]
        });

        if (!visit) {
            const historicalWhere = { ticket_id: ticket_id };
            if (vehicle_number) {
                historicalWhere.vehicle_number = vehicle_number;
            }

            const historicalVisit = await Visits.findOne({
                where: historicalWhere,
                order: [['visit_timestamp', 'DESC']]
            });

            if (historicalVisit) {
                return res.status(400).json({
                    status: {
                        faultcode: "-1",
                        message: "Vehicle exit not successful",
                        detail: "ticket expired"
                    }
                });
            }

            return res.status(404).json({
                status: {
                    faultcode: "-1",
                    message: "Vehicle exit not successful",
                    detail: "Vehicle not found in the system."
                }
            });
        }

        //pull transaction record for this visit
        const transaction = await Transaction.findOne({
            where: { visit_id: visit.id },
            order: [['createdAt', 'DESC']]
        });

        if (!transaction) {
            console.error("Transaction not found for visit_id:", visit.id);
            return res.status(404).json({ error: "Transaction not found for this visit" });
        }


        const isFreeExit = Number(visit.amount) === 0;

        //check if transaction is paid for non-zero visits
        if (!isFreeExit && transaction.status !== 'COMPLETED') {
            return res.status(400).json({
                status: {
                    faultcode: "-1",
                    message: "Vehicle exit not successful",
                    detail: "Payment not completed for this visit."
                }
            });
        }

        // For free visits, mark transaction as completed to keep records consistent.
        if (isFreeExit && transaction.status !== 'COMPLETED') {
            transaction.status = 'COMPLETED';
            transaction.payment_timestamp = exit_timestamp;
            await transaction.save();
        }

        //update visit record with exit timestamp and calculate hours and amount
        const durationMs = exit_timestamp - visit.visit_timestamp;
        const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));
      

        visit.exit_timestamp = exit_timestamp;
        visit.hours = durationHours;
        visit.status = '0'; // Mark visit as completed
        visit.paid_status = '0'; // Mark as paid for simplicity, in real case you would check payment status
        await visit.save();

        console.log(`Vehicle exit recorded for ${visit.vehicle_number} at ${exit_timestamp}`);
        //write to transaction log file
        const logEntry = `Vehicle: ${visit.vehicle_number}, Entry: ${visit.visit_timestamp}, Exit: ${visit.exit_timestamp}, Duration: ${visit.hours} hours, Amount: ${visit.amount}\n`;

        fs.appendFile('transaction_log.txt', logEntry, (err) => {
            if (err) {
                console.error("Failed to write to log file:", err);
            } else {
                console.log("Transaction logged successfully.");
            }
        });

        res.json(visit);

    } catch (error) {
        console.error("Error recording vehicle exit:", error);
        res.status(500).json({ success: false, message: "Failed to record vehicle exit" });
    }
});




module.exports = router;
