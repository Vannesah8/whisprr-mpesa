import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check
app.get("/", (req, res) => {
  res.send("💖 Whisprr M-Pesa Server is alive.");
});

// Get M-Pesa access token
async function getAccessToken() {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error("Missing consumer key or secret");
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const url = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return response.data.access_token;
  } catch (err) {
    throw new Error(`Token error: ${err.response?.data?.errorMessage || err.message}`);
  }
}

// Top-up endpoint (STK push)
app.post("/api/topup", async (req, res) => {
  try {
    const { phone, amount, userId } = req.body;

    if (!phone || !amount || !userId) {
      return res.status(400).json({ message: "Please provide phone, amount, and userId" });
    }

    const formattedPhone = phone.startsWith("254") ? phone : `254${phone.slice(-9)}`;

    console.log(`🔔 Top-up request: ${formattedPhone} for KES ${amount} by ${userId}`);

    const token = await getAccessToken();
    const shortcode = process.env.DARAJA_SHORTCODE;
    const passkey = process.env.DARAJA_PASSKEY;
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: parseInt(amount),
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: "https://<your-render-domain>.onrender.com/callback",
      AccountReference: `WHISPRR_${userId}`,
      TransactionDesc: `Whisprr Wallet Top-Up - User ${userId}`,
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    console.log("✅ M-Pesa response:", response.data);

    res.json({
      message: "STK push sent to your phone. Enter your PIN.",
      mpesa_response: response.data,
    });
  } catch (err) {
    console.error("🔥 Payment error:", err.response?.data || err.message);
    res.status(500).json({
      message: "Payment failed",
      error: err.response?.data?.errorMessage || err.message,
    });
  }
});

// M-Pesa callback
app.post("/callback", (req, res) => {
  console.log("📩 M-Pesa callback:", JSON.stringify(req.body, null, 2));

  const { ResultCode, ResultDesc, CallbackMetadata } = req.body.Body?.stkCallback || {};

  if (ResultCode === 0) {
    const metadata = CallbackMetadata.Item.reduce((acc, item) => {
      acc[item.Name] = item.Value;
      return acc;
    }, {});
    console.log(`✅ Payment successful: KES ${metadata.Amount} from ${metadata.PhoneNumber}, ID: ${metadata.MpesaReceiptNumber}`);
    // TODO: Add database update here
  } else {
    console.log(`❌ Payment failed: ${ResultDesc}`);
    // TODO: Add failure log here
  }

  res.status(200).send("OK");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Whisprr M-Pesa server running on port ${PORT}`);
});