import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import crypto from 'crypto';
import open from 'open';
import fs from 'fs';
import { OpenAI } from 'openai';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID;
const ETSY_REDIRECT_URI = process.env.ETSY_REDIRECT_URI;
const ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET;

const OAUTH_URL = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

let accessToken = "";

// 📌 Load token from file at startup
const TOKEN_FILE = './token.json';

const loadToken = () => {
    if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE));
        accessToken = data.access_token;
        console.log('Loaded access token from file.');
    } else {
        console.log('No token file found. Please authenticate.');
    }
};

// 📌 Save token to file
const saveToken = (token) => {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }, null, 2));
    console.log('Access token saved to file.');
};

// PKCE functions
const generateCodeVerifier = () => crypto.randomBytes(32).toString('base64url');
const generateCodeChallenge = (codeVerifier) => crypto.createHash('sha256').update(codeVerifier).digest('base64url');

let codeVerifier = "";  // Keep it simple for teaching purposes

// Step 1: Redirect User to Etsy Login
app.get('/login', (req, res) => {
    codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const authURL = `${OAUTH_URL}?response_type=code&client_id=${ETSY_CLIENT_ID}&redirect_uri=${encodeURIComponent(ETSY_REDIRECT_URI)}&scope=listings_r&state=randomstring&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    res.redirect(authURL);
});

// Step 2: Handle OAuth Callback & Exchange Code for Token
app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('No code received.');
    }

    try {
        const tokenResponse = await axios.post(TOKEN_URL, new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: ETSY_CLIENT_ID,
            redirect_uri: ETSY_REDIRECT_URI,
            code,
            code_verifier: codeVerifier,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        accessToken = tokenResponse.data.access_token;

        // 📌 Persist token here!
        saveToken(accessToken);

        res.send('Authentication successful! Token is saved. You can now fetch taxonomy.');
    } catch (error) {
        console.error('Error fetching access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed.');
    }
});

// Step 3: Fetch Etsy Taxonomy (Categories)
app.get('/taxonomy', async (req, res) => {
    if (!accessToken) {
        return res.send('Please authenticate first by visiting /login.');
    }

    try {
        const response = await axios.get('https://openapi.etsy.com/v3/application/seller-taxonomy/nodes', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'x-api-key': ETSY_CLIENT_ID
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching taxonomy:', error.response?.data || error.message);
        res.status(500).send('Failed to fetch taxonomy.');
    }
});

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 📌 ChatGPT Endpoint
app.get('/chatgpt', async (req, res) => {
    const prompt = req.query.prompt;

    if (!prompt) {
        return res.status(400).send('Please provide a prompt in the query string.');
    }

    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-3.5-turbo",
        });

        res.json({ 
            reply: completion.choices[0].message.content 
        });

    } catch (error) {
        console.error('Error calling ChatGPT API:', error.message);
        res.status(500).send('Failed to fetch response from ChatGPT.');
    }
});


// Start server and load token on startup
app.listen(PORT, () => {
    loadToken();
    console.log(`Server running on http://localhost:${PORT}`);
});
