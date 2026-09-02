// const express = require('express');
// const router = express.Router();
// const sequelizeServer = require('../config/dbserver');
// const VIP = require('../model/VIP');
// const authenticateToken = require('../middleware/auth');
// const Viplogs = require('../model/Viplogs');
// const { Op, QueryTypes } = require('sequelize');
// const cron = require('node-cron');

// // High-water mark state tracking
// let lastVipSyncDate = new Date('2025-01-01T00:00:00Z');
// let lastLogSyncId = 0;


// function parseValidExpiry(dateStr) {
//   if (!dateStr) return new Date('2099-12-31');
//   const parsed = new Date(dateStr);
//   if (isNaN(parsed.getTime()) || parsed.getFullYear() > 2100) {
//     return new Date('2099-12-31');
//   }
//   return parsed;
// }

// /**
//  * 1. Poll On-Prem Server for New and Updated Tenants / VIPs
//  */
// async function syncTenants() {
//   try {
//     // Convert Date object to MSSQL-safe ISO string format
//     const formattedSyncDate = lastVipSyncDate.toISOString().slice(0, 19).replace('T', ' ');

//     const rawCustomers = await sequelizeServer.query(
//       `SELECT code, name, plate, phone, email, validity_dt, create_dt 
//        FROM park_customer 
//        WHERE create_dt > :lastSync 
//        ORDER BY create_dt ASC`,
//       {
//         replacements: { lastSync: formattedSyncDate },
//         type: QueryTypes.SELECT
//       }
//     );


//     console.log(`[Tenant Sync]: Fetched ${rawCustomers.length} records from On-Prem Server since ${formattedSyncDate}`);

//     if (!rawCustomers || rawCustomers.length === 0) return;

//     for (const customer of rawCustomers) {
//       const nameParts = (customer.name || 'Tenant User').trim().split(/\s+/);
//       const fname = nameParts[0] || 'Tenant';
//       const lname = nameParts.slice(1).join(' ') || 'User';

//       const email = customer.email || `${customer.code.toLowerCase().trim()}@tenant.local`;
//       const phone_number = customer.phone || customer.code.trim();
//       const vehicle_number = customer.plate ? customer.plate.trim() : `NOPLATE-${customer.code.trim()}`;
//       const expiry = parseValidExpiry(customer.validity_dt);

//       const existingVip = await VIP.findOne({
//         where: {
//           [Op.or]: [{ code: customer.code.trim() }, { vehicle_number }]
//         }
//       });

//       if (existingVip) {
//         await existingVip.update({
//           fname,
//           lname,
//           phone_number,
//           vehicle_number,
//           vip_expiry: expiry,
//           vip_status: 1
//         });
//       } else {
//         await VIP.create({
//           code: customer.code.trim(),
//           fname,
//           lname,
//           email,
//           phone_number,
//           vehicle_number,
//           vip_expiry: expiry,
//           vip_status: 1
//         });
//       }

//       // Track high-water mark safely
//       if (customer.create_dt) {
//         const itemDate = new Date(customer.create_dt);
//         if (!isNaN(itemDate.getTime()) && itemDate > lastVipSyncDate) {
//           lastVipSyncDate = itemDate;
//         }
//       }
//     }
//   } catch (error) {
//     console.error('[Tenant Sync Error]:', error.message);
//   }
// }


// /**
//  * Poll On-Prem Server for Parking Entries and Exits
//  */
// async function syncEntryExitLogs() {
//   try {
//     const logs = await sequelizeServer.query(
//       `SELECT id, customer_code, plate, action_type, record_time
//        FROM (
//          SELECT 
//            id, 
//            cust_code AS customer_code, 
//            plate, 
//            0 AS action_type, 
//            in_time AS record_time 
//          FROM park_carin
         
//          UNION ALL
         
//          SELECT 
//            id, 
//            cust_code AS customer_code, 
//            plate, 
//            1 AS action_type, 
//            out_time AS record_time 
//          FROM park_carout
//        ) AS combined_logs
//        WHERE id > :lastId 
//        ORDER BY id ASC`,
//       {
//         replacements: { lastId: lastLogSyncId },
//         type: QueryTypes.SELECT
//       }
//     );

//     if (!logs || logs.length === 0) return;

//     for (const log of logs) {
//       const matchVip = await VIP.findOne({
//         where: {
//           [Op.or]: [
//             { code: log.customer_code ? log.customer_code.trim() : '' },
//             { vehicle_number: log.plate ? log.plate.trim() : '' }
//           ]
//         }
//       });

//       if (matchVip) {
//         await Viplogs.create({
//           vip_id: matchVip.id,
//           number_plate: log.plate ? log.plate.trim() : matchVip.vehicle_number,
//           action: log.action_type, // 0 = IN (park_carin), 1 = OUT (park_carout)
//           createdAt: new Date(log.record_time)
//         });
//       }

//       lastLogSyncId = log.id;
//     }
//   } catch (error) {
//     console.error('[Log Sync Error]:', error.message);
//   }

// }


// // Background poll jobs
// cron.schedule('*/30 * * * * *', syncTenants);
// //cron.schedule('*/10 * * * * *', syncEntryExitLogs);

// // Manual trigger endpoints (protected by auth middleware)
// router.post('/sync/tenants', authenticateToken, async (req, res) => {
//   await syncTenants();
//   res.json({ message: 'Tenant sync executed successfully.' });
// });

// router.post('/sync/logs', authenticateToken, async (req, res) => {
//   await syncEntryExitLogs();
//   res.json({ message: 'Log sync executed successfully.' });
// });

// module.exports = router;


const express = require('express');
const router = express.Router();
const sequelizeServer = require('../config/dbserver');
const VIP = require('../model/VIP');
const authenticateToken = require('../middleware/auth');
const Viplogs = require('../model/Viplogs');
const { Op, QueryTypes } = require('sequelize');
const cron = require('node-cron');

// High-water mark state tracking
let lastVipSyncDate = new Date('2000-01-01T00:00:00Z');
let lastInSyncTime = new Date('2000-01-01T00:00:00Z');
let lastOutSyncTime = new Date('2000-01-01T00:00:00Z');

/**
 * Parses validity dates safely and handles abnormal MSSQL default years (e.g., 5992-06-02)
 */
function parseValidExpiry(dateStr) {
  if (!dateStr) return new Date('2099-12-31');
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime()) || parsed.getFullYear() > 2100) {
    return new Date('2099-12-31');
  }
  return parsed;
}

/**
 * Helper to format JS Date into MSSQL-compatible string ('YYYY-MM-DD HH:mm:ss')
 */
function toMssqlDateString(dateObj) {
  return dateObj.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 1. Poll On-Prem Server for New and Updated Tenants / VIPs (Unchanged)
 */
async function syncTenants() {
  try {
    const formattedSyncDate = toMssqlDateString(lastVipSyncDate);

    const rawCustomers = await sequelizeServer.query(
      `SELECT code, card_id, name, plate, phone, email, validity_dt, create_dt 
       FROM park_customer 
       WHERE create_dt > :lastSync 
       ORDER BY create_dt ASC`,
      {
        replacements: { lastSync: formattedSyncDate },
        type: QueryTypes.SELECT
      }
    );

    if (!rawCustomers || rawCustomers.length === 0) return;

    for (const customer of rawCustomers) {
      const nameParts = (customer.name || 'Tenant User').trim().split(/\s+/);
      const fname = nameParts[0] || 'Tenant';
      const lname = nameParts.slice(1).join(' ') || 'User';

      const card_number = customer.card_id ? customer.card_id.trim() : customer.code.trim();

      const email = customer.email || `${customer.code.toLowerCase().trim()}@tenant.local`;
      const phone_number = customer.phone || customer.code.trim();
      const vehicle_number = customer.plate ? customer.plate.trim() : `NOPLATE-${customer.code.trim()}`;
      const expiry = parseValidExpiry(customer.validity_dt);

      const existingVip = await VIP.findOne({
        where: {
          [Op.or]: [{ code: customer.code.trim() }, { vehicle_number }]
        }
      });

      if (existingVip) {
        await existingVip.update({
          fname,
          lname,
          phone_number,
          vehicle_number,
          card_number: card_number,
          vip_expiry: expiry,
          vip_status: 1
        });
      } else {
        await VIP.create({
          code: customer.code.trim(),
          fname,
          lname,
          email,
          card_number: card_number,
          phone_number,
          vehicle_number,
          vip_expiry: expiry,
          vip_status: 1
        });
      }

      if (customer.create_dt) {
        const itemDate = new Date(customer.create_dt);
        if (!isNaN(itemDate.getTime()) && itemDate > lastVipSyncDate) {
          lastVipSyncDate = itemDate;
        }
      }
    }
  } catch (error) {
    console.error('[Tenant Sync Error]:', error.message || error.original || error);
  }
}

/**
 * 2. Poll On-Prem Server for Parking Entries (park_carin) & Exits (park_carout)
 */
async function syncEntryExitLogs() {
  try {
    // --- STEP 2A: Sync Entries (park_carin -> action: 0) ---
    const formattedInSync = toMssqlDateString(lastInSyncTime);

    const inRecords = await sequelizeServer.query(
      `SELECT TOP (1000) cust_code, plate, in_time 
       FROM park_carin 
       WHERE in_time > :lastSync AND plate IS NOT NULL AND plate != '' 
       ORDER BY in_time DESC`,
      {
        replacements: { lastSync: formattedInSync },
        type: QueryTypes.SELECT
      }
    );

    for (const record of inRecords) {
      const matchVip = await VIP.findOne({
        where: {
          [Op.or]: [
            { code: record.cust_code ? record.cust_code.trim() : '' },
            { vehicle_number: record.plate ? record.plate.trim() : '' }
          ]
        }
      });

      if (matchVip) {
        await Viplogs.create({
          vip_id: matchVip.id,
          number_plate: record.plate.trim(),
          action: 0, // ENTRY
          createdAt: new Date(record.in_time)
        });
      }

      if (record.in_time) {
        const itemDate = new Date(record.in_time);
        if (!isNaN(itemDate.getTime()) && itemDate > lastInSyncTime) {
          lastInSyncTime = itemDate;
        }
      }
    }

    // --- STEP 2B: Sync Exits (park_carout -> action: 1) ---
    const formattedOutSync = toMssqlDateString(lastOutSyncTime);

    const outRecords = await sequelizeServer.query(
      `SELECT TOP (1000) cust_code, plate, out_time 
       FROM park_carout 
       WHERE out_time > :lastSync AND plate IS NOT NULL AND plate != '' 
       ORDER BY out_time DESC`,
      {
        replacements: { lastSync: formattedOutSync },
        type: QueryTypes.SELECT
      }
    );

    for (const record of outRecords) {
      const matchVip = await VIP.findOne({
        where: {
          [Op.or]: [
            { code: record.cust_code ? record.cust_code.trim() : '' },
            { vehicle_number: record.plate ? record.plate.trim() : '' }
          ]
        }
      });

      if (matchVip) {
        await Viplogs.create({
          vip_id: matchVip.id,
          number_plate: record.plate.trim(),
          action: 1, // EXIT
          createdAt: new Date(record.out_time)
        });
      }

      if (record.out_time) {
        const itemDate = new Date(record.out_time);
        if (!isNaN(itemDate.getTime()) && itemDate > lastOutSyncTime) {
          lastOutSyncTime = itemDate;
        }
      }
    }

    console.log(`[Log Sync]: Synced ${inRecords.length} entries and ${outRecords.length} exits. Last In Sync: ${formattedInSync}, Last Out Sync: ${formattedOutSync}`);

  } catch (error) {
    console.error('[Log Sync Error]:', error.message || error.original || error);
  }
}

// Background poll jobs
cron.schedule('*/5 * * * *', syncTenants);
cron.schedule('*/5 * * * *', syncEntryExitLogs);

// Manual trigger endpoints
router.post('/sync/tenants', authenticateToken, async (req, res) => {
  await syncTenants();
  res.json({ message: 'Tenant sync executed successfully.' });
});

router.post('/sync/logs', authenticateToken, async (req, res) => {
  await syncEntryExitLogs();
  res.json({ message: 'Log sync executed successfully.' });
});

module.exports = router;