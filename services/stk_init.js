const dotenv = require('dotenv');
dotenv.config();
const axios = require('axios');

const fetchAccessToken = async () => {
    const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.get('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
        headers: { Authorization: `Basic ${auth}` }
    });
    return response.data.access_token;
};

const shortCode = process.env.MPESA_SHORTCODE;
const passkey = process.env.MPESA_PASSKEY;
const prod_callback_url = "https://api.eastafricanparking.com/mpesa/callback";



async function initializeStk(amount, phoneNumber, timestamp) {
    try {
        
        // 1. Generate Password
        const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

        // 2. Prepare STK Push Request
        const stkRequestData = {
            "BusinessShortCode": shortCode,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": amount,
            "PartyA": phoneNumber,
            "PartyB": shortCode,
            "PhoneNumber": phoneNumber,
            "CallBackURL": prod_callback_url,
            "AccountReference": `Parking-${phoneNumber}`,
            "TransactionDesc": `Parking payment from ${phoneNumber}`
        };

        // 3. Send STK Push Request to M-Pesa API
        const token = await fetchAccessToken();
        const response = await axios.post('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', stkRequestData, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error("Error initializing STK Push:", error.response ? error.response.data : error.message);
        throw new Error("Failed to initialize payment. Please try again.");
    }
}

module.exports = initializeStk;
