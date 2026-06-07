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
const AuthenticateToken = require('../middleware/auth');
const authenticateToken = require('../middleware/auth');
const Confee = require('../model/Confee');



dotenv.config();

const PAID_EXIT_GRACE_MINUTES = 20;
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

const parseMpesaTransactionDate = (rawDateValue) => {
    const raw = String(rawDateValue || '').trim();
    if (!/^\d{14}$/.test(raw)) {
        return null;
    }

    const year = Number(raw.substring(0, 4));
    const monthIndex = Number(raw.substring(4, 6)) - 1;
    const day = Number(raw.substring(6, 8));
    const hour = Number(raw.substring(8, 10));
    const minute = Number(raw.substring(10, 12));
    const second = Number(raw.substring(12, 14));

    // Safaricom timestamps are Nairobi local time (UTC+3), so convert to UTC instant.
    return new Date(Date.UTC(year, monthIndex, day, hour - 3, minute, second));
};

const calculateChargeFromTimestamp = (startTimestamp, endTimestamp = new Date()) => {
    const startTime = new Date(startTimestamp);
    const endTime = new Date(endTimestamp);

    let effectiveStartTime = startTime;
    let elapsedTime = endTime.getTime() - effectiveStartTime.getTime();

    // Backward compatibility: older entries were stored as now+3h.
    if (elapsedTime < 0) {
        const legacyStartTime = new Date(startTime.getTime() - (3 * 60 * 60 * 1000));
        const legacyElapsed = endTime.getTime() - legacyStartTime.getTime();
        if (legacyElapsed >= 0) {
            effectiveStartTime = legacyStartTime;
            elapsedTime = legacyElapsed;
        }
    }

    const elapsedMinutes = Math.max(0, Math.ceil(elapsedTime / (1000 * 60)));
    const elapsedHours = Math.max(0, Math.ceil(elapsedMinutes / 60));

    const endNairobiMs = endTime.getTime() + NAIROBI_UTC_OFFSET_MS;
    const startNairobiMs = effectiveStartTime.getTime() + NAIROBI_UTC_OFFSET_MS;
    const endNairobiDay = Math.floor(endNairobiMs / DAY_IN_MS);
    const startNairobiDay = Math.floor(startNairobiMs / DAY_IN_MS);
    const isOvernight = elapsedTime > 0 && endNairobiDay > startNairobiDay;

    let amount;
    if (isOvernight) {
        const overnightDays = endNairobiDay - startNairobiDay;
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
        elapsedMinutes,
        elapsedHours
    };
};

const calculatePostValidationOverstayCharge = (paymentTimestamp, endTimestamp = new Date()) => {
    const paidAt = new Date(paymentTimestamp);
    const endTime = new Date(endTimestamp);

    if (Number.isNaN(paidAt.getTime())) {
        return {
            amount: 0,
            elapsedMinutes: 0,
            elapsedHours: 0,
            withinGrace: true
        };
    }

    const graceEndsAt = new Date(paidAt.getTime() + (PAID_EXIT_GRACE_MINUTES * 60 * 1000));
    const overstayMs = endTime.getTime() - graceEndsAt.getTime();

    if (overstayMs <= 0) {
        return {
            amount: 0,
            elapsedMinutes: 0,
            elapsedHours: 0,
            withinGrace: true
        };
    }

    // Once grace expires, billing starts immediately (no additional free window).
    const elapsedMinutes = Math.max(0, Math.ceil(overstayMs / (1000 * 60)));
    const elapsedHours = Math.max(0, Math.ceil(elapsedMinutes / 60));

    let amount;
    if (elapsedMinutes <= FIRST_HOUR_MINUTES) {
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
        elapsedMinutes,
        elapsedHours,
        withinGrace: false
    };
};

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
        const mpesaPaymentDate = parseMpesaTransactionDate(getValue('TransactionDate'));
        
        try {
            const transaction = await Vippayments.findOne({ where: { checkoutID } });
            if (!transaction) {
                console.error("Transaction not found for checkoutID:", checkoutID);
                return res.status(404).json({ error: "Transaction not found" });
            }

            transaction.status = 'COMPLETED';
            transaction.transaction_code = mpesaReceipt;
            transaction.payment_timestamp = mpesaPaymentDate || new Date();
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
        const mpesaPaymentDate = parseMpesaTransactionDate(getValue('TransactionDate'));

        try {
            const transaction = await Transaction.findOne({ where: { checkoutID } });

            if (!transaction) {
                console.error("Transaction not found for checkoutID:", checkoutID);
                return res.status(404).json({ error: "Transaction not found" });
            }

            const confeeRecord = await Confee.findOne({ where: { visit_id: transaction.visit_id } });
            
            if (confeeRecord) {
                confeeRecord.status = 1;
                await confeeRecord.save();
                console.log(`Confee record updated for visit_id ${transaction.visit_id}`);
            } else {
                console.error("Confee record not found for visit_id:", transaction.visit_id);
            }

            // Update record
            transaction.status = 'COMPLETED';
            transaction.transaction_code = mpesaReceipt;
            transaction.payment_timestamp = mpesaPaymentDate || new Date();
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


router.post('/api/user/updatepaymenttime', authenticateToken, async (req, res) => {
    const { ticket_id, visit_id } = req.body;
    const now = new Date();

    const ticketIdStr = ticket_id === undefined || ticket_id === null
        ? ''
        : String(ticket_id).trim();

    if (!ticketIdStr && !visit_id) {
        return res.status(400).json({ error: "ticket_id or visit_id is required" });
    }

    try {
        const visitWhere = { status: '1' };
        if (visit_id) {
            visitWhere.id = visit_id;
        } else {
            visitWhere.ticket_id = ticketIdStr;
        }

        // Find active visit, then update financial state based on current charge.
        const visit = await Visits.findOne({
            where: visitWhere,
            order: [['visit_timestamp', 'DESC']]
        });

        if (!visit) {
            return res.status(404).json({ error: "Active visit not found" });
        }

        const transaction = await Transaction.findOne({ where: { visit_id: visit.id }, order: [['createdAt', 'DESC']] });
        if (!transaction) {
            return res.status(404).json({ error: "Transaction not found for this visit" });
        }

        const chargeAtValidation = calculateChargeFromTimestamp(visit.visit_timestamp, now);
        const withinFreeWindow = chargeAtValidation.elapsedMinutes <= FREE_MINUTES;

        if (withinFreeWindow) {
            visit.amount = 0;
            visit.hours = chargeAtValidation.elapsedHours < 1 ? 1 : chargeAtValidation.elapsedHours;
            visit.paid_status = '0';
            await visit.save();

            transaction.amount = 0;
            transaction.status = 'COMPLETED';
            transaction.payment_timestamp = now;
            if (!transaction.transaction_code) {
                transaction.transaction_code = `FREE_EXIT_${visit.id}_${Date.now()}`;
            }
            await transaction.save();

            return res.json({
                message: "Ticket validated for free exit. Grace period started.",
                within_free_window: true,
                grace_minutes: PAID_EXIT_GRACE_MINUTES,
                visit,
                transaction
            });
        }

        // Outside free window: compute required payment and keep transaction pending.
        visit.amount = chargeAtValidation.amount;
        visit.hours = chargeAtValidation.elapsedHours < 1 ? 1 : chargeAtValidation.elapsedHours;
        visit.paid_status = chargeAtValidation.amount > 0 ? '1' : '0';
        await visit.save();

        transaction.amount = chargeAtValidation.amount;
        transaction.status = chargeAtValidation.amount > 0 ? 'PEND' : 'COMPLETED';
        if (chargeAtValidation.amount > 0) {
            transaction.transaction_code = null;
            transaction.payment_timestamp = null;
        } else {
            transaction.payment_timestamp = now;
        }
        await transaction.save();

        return res.status(400).json({
            message: "Ticket is outside free window. Payment required before exit.",
            within_free_window: false,
            amount_due: chargeAtValidation.amount,
            elapsed_minutes: chargeAtValidation.elapsedMinutes,
            visit,
            transaction
        });
    } catch (error) {
        console.error("Error updating payment timestamp:", error);
        res.status(500).json({ error: "Failed to update payment timestamp" });
    }
});


router.post('/api/vehicle/entry', async (req, res) => {

    const { vehicle_number, ticket_id } = req.body;
    // Store in UTC and convert only when displaying.
    const visit_timestamp = new Date();

    try {
        const normalizedVehicleNumber =
            typeof vehicle_number === 'string' && vehicle_number.trim()
                ? vehicle_number.trim().toUpperCase()
                : '';

        const activeVip = normalizedVehicleNumber
            ? await VIP.findOne({ where: { vehicle_number: normalizedVehicleNumber, vip_status: 1 } })
            : null;
        const isVipEntry = Boolean(activeVip);
        const resolvedTicketId = ticket_id
            ? String(ticket_id).trim()
            : (isVipEntry ? `VIP_${Date.now()}_${normalizedVehicleNumber || 'NO_PLATE'}` : '');

        if (!resolvedTicketId) {
            return res.status(400).json({
                success: false,
                message: "ticket_id is required"
            });
        }

        const visit = await Visits.create({
            vehicle_number: normalizedVehicleNumber,
            ticket_id: resolvedTicketId,
            paid_status: isVipEntry ? '0' : '1',
            visit_timestamp: visit_timestamp,
            amount: isVipEntry ? 0 : 0, // VIP entries start with 0 amount, will be updated on exit if needed
            hours: 1,
            status: '1',
            user_type: isVipEntry ? 2 : 0
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
            status: isVipEntry ? 'COMPLETED' : 'PEND',
            transaction_code: isVipEntry ? `VIP_PASS_${visit.id}_${Date.now()}` : null,
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
        const normalizedVehicleNumber =
            typeof vehicle_number === 'string' && vehicle_number.trim()
                ? vehicle_number.trim().toUpperCase()
                : '';
        const ticketIdStr = ticket_id === undefined || ticket_id === null
            ? ''
            : String(ticket_id).trim();

        if (!ticketIdStr && !normalizedVehicleNumber) {
            return res.status(400).json({
                status: {
                    faultcode: "-1",
                    message: "Vehicle exit not successful",
                    detail: "ticket_id or vehicle_number is required."
                }
            });
        }

        let visit;

        if (ticketIdStr) {
            const visitWhere = { ticket_id: ticketIdStr, status: '1' };
            if (normalizedVehicleNumber) {
                visitWhere.vehicle_number = normalizedVehicleNumber;
            }

            visit = await Visits.findOne({
                where: visitWhere,
                order: [['visit_timestamp', 'DESC']]
            });

            if (!visit) {
                const historicalWhere = { ticket_id: ticketIdStr };
                if (normalizedVehicleNumber) {
                    historicalWhere.vehicle_number = normalizedVehicleNumber;
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
        } else {
            const vipByPlate = await VIP.findOne({ where: { vehicle_number: normalizedVehicleNumber, vip_status: 1 } });

            if (!vipByPlate) {
                return res.status(400).json({
                    status: {
                        faultcode: "-1",
                        message: "Vehicle exit not successful",
                        detail: "ticket_id is required for non-VIP vehicles."
                    }
                });
            }

            visit = await Visits.findOne({
                where: { vehicle_number: normalizedVehicleNumber, status: '1' },
                order: [['visit_timestamp', 'DESC']]
            });

            if (!visit) {
                return res.status(404).json({
                    status: {
                        faultcode: "-1",
                        message: "Vehicle exit not successful",
                        detail: "Active VIP visit not found."
                    }
                });
            }
        }

        const vipVehicleNumber = normalizedVehicleNumber || (visit.vehicle_number || '');
        const isVip = vipVehicleNumber
            ? await VIP.findOne({ where: { vehicle_number: vipVehicleNumber, vip_status: 1 } })
            : null;

        // Active VIP exits immediately without further payment checks.
        if (isVip) {
            const vipTransaction = await Transaction.findOne({
                where: { visit_id: visit.id },
                order: [['createdAt', 'DESC']]
            });

            const durationMs = exit_timestamp - visit.visit_timestamp;
            const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));

            visit.exit_timestamp = exit_timestamp;
            visit.hours = durationHours;
            visit.amount = 0;
            visit.status = '0';
            visit.paid_status = '0';
            await visit.save();

            if (vipTransaction && vipTransaction.status !== 'COMPLETED') {
                vipTransaction.amount = 0;
                vipTransaction.status = 'COMPLETED';
                vipTransaction.payment_timestamp = exit_timestamp;
                await vipTransaction.save();
            }

            return res.json(visit);
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

        if (transaction.status === 'COMPLETED') {
            const paymentReference = transaction.payment_timestamp || transaction.Transaction_timestamp;

            if (paymentReference) {
                const chargeAtValidation = calculateChargeFromTimestamp(visit.visit_timestamp, paymentReference);
                const validatedWithinFreeWindow = chargeAtValidation.elapsedMinutes <= FREE_MINUTES;
                const paidAmount = Number(transaction.amount) || 0;

                let amountDue = 0;
                let dueHours = 0;
                let dueMessage = '';

                if (validatedWithinFreeWindow) {
                    const overstayCharge = calculatePostValidationOverstayCharge(paymentReference, exit_timestamp);
                    amountDue = overstayCharge.amount;
                    dueHours = overstayCharge.elapsedHours;
                    dueMessage = "Additional payment required. Ticket exceeded 20-minute validation grace period.";
                } else {
                    // Validation happened after free window; no grace applies.
                    const currentCharge = calculateChargeFromTimestamp(visit.visit_timestamp, exit_timestamp);
                    amountDue = Math.max(0, currentCharge.amount - paidAmount);
                    dueHours = currentCharge.elapsedHours;
                    dueMessage = "Additional payment required. Ticket was validated after 30-minute free window, so grace period is not applicable.";
                }

                if (amountDue > 0) {
                    visit.amount = amountDue;
                    visit.hours = dueHours < 1 ? 1 : dueHours;
                    visit.paid_status = '1';
                    await visit.save();

                    transaction.amount = amountDue;
                    transaction.status = 'PEND';
                    transaction.transaction_code = null;
                    transaction.payment_timestamp = null;
                    await transaction.save();

                    return res.status(400).json({
                        status: {
                            faultcode: "-1",
                            message: "Vehicle exit not successful",
                            detail: dueMessage,
                            ticket_id: visit.ticket_id,
                            amount_due: amountDue
                        }
                    });
                }
            }
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

//change visit status to paid for manual cash payments
router.post('/visits/manual', async (req, res) => {
    const ticket_id = req.body.ticket_id;
    const manual_pay = req.body.manual_pay;
    const paymentTimestamp = new Date();

    // Normalize numeric and string ticket IDs to a safe comparable value.
    const ticketIdStr = ticket_id === undefined || ticket_id === null
        ? ''
        : String(ticket_id).trim();

    if (!ticketIdStr) {
        return res.status(400).json({ error: "ticket_id is required" });
    }

    if (!manual_pay) {
        return res.status(400).json({ error: "manual_pay must be true" });
    }

    //if manual_pay is true, mark as aid and update everything as if it was paid via mpesa to allow vehicle to exit when called via /exit
    try {
        const visit = await Visits.findOne({
            where: { ticket_id: ticketIdStr},
                //status: 1 },
            order: [['visit_timestamp', 'DESC']]
        });

        if (!visit) {
            return res.status(404).json({ error: "Visit not found" });
        }

        const transaction = await Transaction.findOne({
            where: { visit_id: visit.id },
            order: [['createdAt', 'DESC']]
        });

        if (!transaction) {
            return res.status(404).json({ error: "Transaction not found for this visit" });
        }

        visit.paid_status = '0';
        await visit.save();

        transaction.status = 'COMPLETED';
        transaction.transaction_code = `MANUAL_PAY_${visit.ticket_id}_${transaction.id}`;
        transaction.payment_timestamp = paymentTimestamp;
        await transaction.save();

        res.json({
            message: "Visit payment status updated successfully",
            visit,
            transaction
        });
    } catch (error) {
        console.log("Error updating visit payment status:", error);
        res.status(500).json({ error: "Failed to update visit payment status" });
    }
});



module.exports = router;
