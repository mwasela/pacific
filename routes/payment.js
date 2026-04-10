const express = require('express');
const axios = require('axios');
const { Op } = require('sequelize');
const router = express.Router();
const Transaction = require('../model/Transaction');
const fs = require('fs');
const Visits = require('../model/Visits');
const VIP = require('../model/VIP');
const Setup = require('../model/Setup');
const { Console } = require('console');
const Vippayments = require('../model/Vippayments');
const AuthenticateToken = require('../middleware/auth');
dotenv = require('dotenv');
dotenv.config();


callback_url = "https://a7ea-102-209-18-114.ngrok-free.app";
prod_callback_url = "https://api.eastafricanparking.com/mpesa/callback";
vip_callback_url = "https://api.eastafricanparking.com/mpesa/callback/vip";

const CHARGE_CRON_INTERVAL_MS = 60 * 1000;
let pendingChargesCronHandle = null;

const NAIROBI_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const FREE_MINUTES = 30;
const FIRST_HOUR_MINUTES = 60;
const THIRD_HOUR_MINUTES = 180;
const FIRST_HOUR_RATE = 50;
const THIRD_HOUR_RATE = 100;
const EXTRA_HOURLY_RATE = 50;
const DAYTIME_CAP = 600;
const OVERNIGHT_BASE_RATE = 1000;

const calculateChargeFromVisitTime = (visitTimestamp, now = new Date()) => {
    const visitTime = new Date(visitTimestamp);

    // Backward compatibility: older entries were stored as now+3h.
    let effectiveVisitTime = visitTime;
    let elapsedTime = now.getTime() - effectiveVisitTime.getTime();
    if (elapsedTime < 0) {
        const legacyVisitTime = new Date(visitTime.getTime() - (3 * 60 * 60 * 1000));
        const legacyElapsed = now.getTime() - legacyVisitTime.getTime();
        if (legacyElapsed >= 0) {
            effectiveVisitTime = legacyVisitTime;
            elapsedTime = legacyElapsed;
        }
    }

    const elapsedMinutes = Math.max(0, Math.ceil(elapsedTime / (1000 * 60)));
    const elapsedHours = Math.max(0, Math.ceil(elapsedMinutes / 60));

    const nowNairobiMs = now.getTime() + NAIROBI_UTC_OFFSET_MS;
    const visitNairobiMs = effectiveVisitTime.getTime() + NAIROBI_UTC_OFFSET_MS;
    const nowNairobiDay = Math.floor(nowNairobiMs / DAY_IN_MS);
    const visitNairobiDay = Math.floor(visitNairobiMs / DAY_IN_MS);
    const isOvernight = elapsedTime > 0 && nowNairobiDay > visitNairobiDay;

    let amount;
    if (isOvernight) {
        const overnightDays = nowNairobiDay - visitNairobiDay;
        amount = overnightDays * OVERNIGHT_BASE_RATE;
    } else if (elapsedMinutes <= FREE_MINUTES) {
        amount = 0;
    } else if (elapsedMinutes <= FIRST_HOUR_MINUTES) {
        amount = FIRST_HOUR_RATE;
    } else if (elapsedMinutes <= THIRD_HOUR_MINUTES) {
        amount = THIRD_HOUR_RATE;
    } else {
        const extraHours = Math.ceil((elapsedMinutes - THIRD_HOUR_MINUTES) / 60);
        amount = THIRD_HOUR_RATE + (extraHours * EXTRA_HOURLY_RATE);
        amount = Math.min(amount, DAYTIME_CAP);
    }

    return {
        amount,
        elapsedHours
    };
};

const recalculatePendingVisitsCharges = async () => {
    try {
        const pendingVisits = await Visits.findAll({
            where: { status: '1' },
            order: [['visit_timestamp', 'DESC']]
        });

        if (pendingVisits.length === 0) {
            return;
        }

        const visitIds = pendingVisits.map((visit) => visit.id);
        const recentTransactions = await Transaction.findAll({
            where: {
                visit_id: { [Op.in]: visitIds }
            },
            order: [['visit_id', 'ASC'], ['createdAt', 'DESC']]
        });

        const latestTransactionByVisitId = new Map();
        for (const transaction of recentTransactions) {
            if (!latestTransactionByVisitId.has(transaction.visit_id)) {
                latestTransactionByVisitId.set(transaction.visit_id, transaction);
            }
        }

        for (const visit of pendingVisits) {
            const transaction = latestTransactionByVisitId.get(visit.id);

            if (!transaction || transaction.status === 'COMPLETED') {
                continue;
            }

            const { amount, elapsedHours } = calculateChargeFromVisitTime(visit.visit_timestamp);
            const normalizedHours = elapsedHours < 1 ? 1 : elapsedHours;

            let visitChanged = false;
            if (visit.amount !== amount) {
                visit.amount = amount;
                visitChanged = true;
            }
            if (visit.hours !== normalizedHours) {
                visit.hours = normalizedHours;
                visitChanged = true;
            }

            if (visitChanged) {
                await visit.save();
            }

            if (transaction.amount !== amount) {
                transaction.amount = amount;
                await transaction.save();
            }
        }
    } catch (error) {
        console.error('Pending visits charge cron failed:', error.message);
    }
};

const startPendingChargesCron = () => {
    if (pendingChargesCronHandle) {
        return;
    }

    // Run once immediately, then every 60 seconds.
    recalculatePendingVisitsCharges();
    pendingChargesCronHandle = setInterval(recalculatePendingVisitsCharges, CHARGE_CRON_INTERVAL_MS);
    console.log('Pending visits charge cron started (60s interval).');
};

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


router.get('/charges', async (req, res) => {

    const ticket_id = req.query.ticket_id;

    try {

        if (!ticket_id) {
            return res.status(400).json({ error: "ticket_id is required." });
        }

        //check latest visit for this ticket
        const visit = await Visits.findOne({
            where: { ticket_id: ticket_id, status: '1' },
            order: [['visit_timestamp', 'DESC']]
        });

        if (!visit) {
            return res.status(404).json({ error: "No active visit found for this ticket ID." });
        }

        //pull associated transaction
        const transaction = await Transaction.findOne({
            where: { visit_id: visit.id },
            order: [['createdAt', 'DESC']]
        });

        if (!transaction) {
            return res.status(404).json({ error: "No transaction found for this ticket ID." });
        }

        const { amount, elapsedHours } = calculateChargeFromVisitTime(visit.visit_timestamp);
        if (transaction.amount !== amount) {
            transaction.amount = amount;
            await transaction.save();
        }

        //update visit record with calculated amount and hours
        const normalizedHours = elapsedHours < 1 ? 1 : elapsedHours;
        let visitChanged = false;
        if (visit.hours !== normalizedHours) {
            visit.hours = normalizedHours;
            visitChanged = true;
        }
        if (visit.amount !== amount) {
            visit.amount = amount;
            visitChanged = true;
        }
        if (visitChanged) {
            await visit.save();
        }

        res.json({
            ticket_id: visit.ticket_id,
            visit_timestamp: visit.visit_timestamp,
            elapsed_hours: elapsedHours,
            amount_due: amount,
            visit_id: visit.id
        });

    } catch (error) {
        console.error("Error fetching charges:", error);
        res.status(500).json({ error: "Failed to fetch charges" });
    }
});


router.post('/vip', AuthenticateToken, getAccessToken, async (req, res) => {
    const { vip_id, phone_number } = req.body

    //add +254 prefix to phone number if it starts with 0
    let formattedPhoneNumber = phone_number;
    if (phone_number.startsWith('0')) {
        formattedPhoneNumber = `254${phone_number.slice(1)}`;
    }

    try {
        const vip = await VIP.findByPk(vip_id);
        if (!vip) {
            return res.status(404).json({ error: "VIP vehicle not found." });
        }

        const Setupinfo = await Setup.findOne({
            where: { status: 0 }
        });

        const amount = Setupinfo.parking_rate_monthly;


        const transaction = await Vippayments.create({
          
            number_plate: vip.vehicle_number,
            amount: amount,
            phone_number: formattedPhoneNumber,
            status: 'PENDING',
            transaction_code: null,
            checkoutID: new Date().getTime().toString(),
            Transaction_timestamp: new Date(),
            payment_timestamp: new Date()
        });

        //initiate M-Pesa payment for the VIP subscription
        const shortCode = process.env.MPESA_SHORTCODE;
        const passkey = process.env.MPESA_PASSKEY;
        const now = new Date();
        const timestamp =
            now.getUTCFullYear().toString() +
            ("0" + (now.getUTCMonth() + 1)).slice(-2) +
            ("0" + now.getUTCDate()).slice(-2) +
            ("0" + now.getUTCHours()).slice(-2) +
            ("0" + now.getUTCMinutes()).slice(-2) +
            ("0" + now.getUTCSeconds()).slice(-2);

        const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

        const stkpush = await axios.post(
            'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: shortCode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: 2,
                PartyA: formattedPhoneNumber,
                PartyB: shortCode,
                PhoneNumber: formattedPhoneNumber,
                CallBackURL: vip_callback_url,
                AccountReference: `VIP_${vip.vehicle_number}`,
                TransactionDesc: `Monthly VIP Parking Subscription for ${vip.vehicle_number}`
            },
            {
                headers: {
                    'Authorization': `Bearer ${req.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        transaction.checkoutID = stkpush.data.CheckoutRequestID;
        await transaction.save();
        res.json({ message: "VIP subscription payment initiated.", checkoutID: transaction.checkoutID });
    }
    catch (error) {
        console.error("Error initiating VIP payment:", error);
        res.status(500).json({ error: "Failed to initiate VIP payment." });
    }
});



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
            let { ticket_id, phone_no } = req.body;

            let phone_number = phone_no;

            if (!phone_number) {
                return res.status(400).json({ error: "phone_no is required" });
            }

            phone_number = String(phone_number).trim();

            // 1. Sanitize & Validate Phone Number
            if (phone_number.startsWith('+254')) {
                phone_number = phone_number.substring(1);
            }
            if (phone_number.startsWith('0')) {
                phone_number = '254' + phone_number.substring(1);
            }

            const phoneRegex = /^(2547|2541)\d{8}$/;
            if (!phoneRegex.test(phone_number)) {
                return res.status(400).json({ error: "Invalid Kenyan phone number." });
            }

            if (!ticket_id) {
                return res.status(400).json({ error: "ticket_id is required" });
            }

            const visit = await Visits.findOne({
                where: { ticket_id: ticket_id, status: '1' },
                order: [['visit_timestamp', 'DESC']]
            });

            if (!visit) {
                return res.status(404).json({ error: "No active visit found for this ticket ID." });
            }

            //find transaction record for this visit
            const transaction = await Transaction.findOne({
                where: { visit_id: visit.id },
                order: [['createdAt', 'DESC']]
            });

            if (!transaction) {
                return res.status(404).json({ error: "No transaction found for this visit ID." });
            }

            transaction.phone_number = phone_number;
            await transaction.save();

            const number_plate = transaction.number_plate;
            const amount = transaction.amount;


            // // 3. M-Pesa Constants
            const shortCode = process.env.MPESA_SHORTCODE;
            const passkey = process.env.MPESA_PASSKEY;


            //if either shortcode or passkey is missing, return error
            if (!shortCode || !passkey) {
                console.error("M-Pesa Configuration Error: Missing Shortcode or Passkey");
                return res.status(500).json({ error: "Payment configuration error. Please contact support." });
            }

            // // 4. GENERATE TIMESTAMP (Forced UTC+3 for Nairobi)
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

            // console.log("SENDING TIMESTAMP:", timestamp); // Should show roughly 202603280755xx

            // // 5. Generate Password (Base64 of ShortCode + Passkey + Timestamp)
            const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

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
                    CallBackURL: prod_callback_url,
                    AccountReference: (number_plate || ticket_id).toUpperCase(),
                    TransactionDesc: `Parking fee for ${number_plate}`
                },
                {
                    headers: {
                        'Authorization': `Bearer ${req.token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // 8. Update record with actual Safaricom CheckoutRequestID and tranasaction time
            transaction.checkoutID = stkResponse.data.CheckoutRequestID;
            transaction.Transaction_timestamp = nairobiDate; // Use the same timestamp as the password generation time
            await transaction.save();

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

    //status called by user when supplying ticket_id to check if payment was successful
    router.get('/status', async (req, res) => {
        try {
            const ticket_id = req.query.ticket_id;

            // 1. Validate that ticket_id was actually provided
            if (!ticket_id) {
                return res.status(400).json({ error: "Ticket ID is required." });
            }

            // 2. Find the most recent visit for this ticket
            const curentVisit = await Visits.findOne({
                where: { ticket_id: ticket_id },
                order: [['visit_timestamp', 'DESC']]
            });

            if (!curentVisit) {
                return res.status(404).json({ error: "No visit found for this ticket ID." });
            }

            // 3. Find the most recent transaction linked to that visit
            const transaction = await Transaction.findOne({
                where: { visit_id: curentVisit.id },
                order: [['createdAt', 'DESC']]
            });

            if (!transaction) {
                return res.status(404).json({
                    error: "No transaction found for this visit.",
                    visit_id: curentVisit.id
                });
            }

            // 4. Return the consolidated status
            return res.json({
                ticket_id: ticket_id,
                paid_status: transaction.status, // Should return 'PENDING', 'COMPLETED', or 'FAILED'
                amount: curentVisit.amount,
                transaction_code: transaction.transaction_code || null, // Using the M-Pesa Receipt Number
                checkoutID: transaction.checkoutID,
                updatedAt: transaction.updatedAt
            });

        } catch (error) {
            console.error("Error fetching payment status:", error);
            return res.status(500).json({
                error: "Internal server error while checking status.",
                details: error.message
            });
        }
    });


    module.exports = router;
    module.exports.startPendingChargesCron = startPendingChargesCron;