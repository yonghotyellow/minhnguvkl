const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const passport = require('passport');
const app = express();
const port = 5000;

// Set views directory for EJS templates
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve static files from the views folder
app.use(express.static(path.join(__dirname, 'views')));

// Parse form data (URL-encoded)
app.use(express.urlencoded({ extended: false }));

app.use(express.static('public', {
    setHeaders: function (res, path) {
        if (path.match('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));


// app.use(passport.initialize());
// app.use(passport.session());

const OAuth2Data = require('./client_secret.json');
const CLIENT_ID = OAuth2Data.web.client_id;
const CLIENT_SECRET = OAuth2Data.web.client_secret;
const REDIRECT_URI = OAuth2Data.web.redirect_uris[0];
const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

var authed = false;

function authenticateUser(ress) {
    console.log('Authentication triggered');
    if (authed) return;
    // Redirect to Google's authorization endpoint
    const url = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.profile"
    });
    authed = true;
    console.log(authed);
    ress.redirect(url); // Redirect the user to Google's authorization page
}

app.get('/oauth2callback', (req, res) => {
    const code = req.query.code; // Extract authorization code from query string

    if (code) {
        oAuth2Client.getToken(code, (err, tokens) => {
            if (err) {
                console.error('Error getting tokens:', err);
                res.send('Error during authentication'); // Handle error appropriately
            } else {
                oAuth2Client.setCredentials(tokens);
                authed = true; // Set authed flag to indicate successful authentication

                // Redirect back to the main page after successful authentication
                res.redirect('/upload');
            }
        });
    } else {
        console.error('No authorization code received.');
        res.send('Authentication failed: No code received'); // Handle error
    }
});

app.get('/google/callback', (req, res) => {
    const code = req.query.code; // Extract authorization code from query string

    if (code) {
        oAuth2Client.getToken(code, (err, tokens) => {
            if (err) {
                console.error('Error getting tokens:', err);
                res.send('Error during authentication'); // Handle error appropriately
            } else {
                oAuth2Client.setCredentials(tokens);
                authed = true; // Set authed flag to indicate successful authentication
                console.log("redirect to upload");
                // Redirect back to the main page after successful authentication
                res.redirect('/upload');
            }
        });
    } else {
        console.error('No authorization code received.');
        res.send('Authentication failed: No code received'); // Handle error
    }
});

app.get('/', (req, res) => {
    res.render('index', { authed, authenticateUser }); // Render the index.ejs template
});

app.post('/upload', (req, res) => {
    const { videoName, description, tags, driveLink } = req.body;
    if (authed) {
        res.send('Upload start');
        const videoData = {
            name: videoName,
            description: description,
            tags: tags.split(','), // Split tags string into an array
            driveLink: driveLink,
        };
        let videoHistory = [];

        try {
            // Read existing data (if the file exists)
            let historyData;
            try {
                historyData = fs.readFileSync('./history.json', 'utf8');
            } catch (error) {
                // File may not exist, continue with empty array
            }

            // Parse the JSON data (if it's not an empty string)
            if (historyData) {
                videoHistory = JSON.parse(historyData);
            }

            // Append new video data to the existing array
            videoHistory.push(videoData);

            // Create JSON string from new data with newline
            const jsonString = '\n' + JSON.stringify(videoHistory, null, 2);

            // Append the entire string (including newline) to the file
            fs.writeFile('./history.json', jsonString, (err) => {
                if (err) {
                    console.error('Error writing video data to JSON file:', err);
                    res.status(500).send('Error saving upload history.');
                } else {
                    console.log('Video data saved to history.json');
                    res.send('Video upload successful!');
                }
            });
        } catch (error) {
            console.error('Error processing video data:', error);
            res.status(500).send('Error saving upload history.');
        }

        try {
            // 1. Extract file ID from Drive link (if necessary)
            const fileId = extractFileIdFromDriveLink(driveLink);

            // 2. Download video using OAuth 2.0 authorization
            const videoBuffer = downloadVideoFromDrive(fileId);

            // 3. Create directory and save video (with proper error handling)
            saveVideoToFile(videoName, videoBuffer);

            // 4. Append video data to history.json (using the existing code)
            // ... (your existing code for appending videoData)

            res.send('Video upload successful!');
        } catch (error) {
            console.error('Error processing video data:', error);
            res.status(500).send('Error saving upload history.');
        }
        res.send('Upload successful!');
    }
    else {
        // res.send('Authentication failed. Please try again.');
        authenticateUser(res);
        res.redirect('/google/callback');
    }
});

// Route to read video history (/history)
app.get('/history', (req, res) => {
    try {
        const historyData = fs.readFileSync('./history.json', 'utf8');
        const videoHistory = JSON.parse(historyData);
        res.json(videoHistory); // Send video history as JSON response
    } catch (error) {
        console.error(error);
        res.status(500).send('Error retrieving video history.'); // Handle errors
    }
});

// Function to extract file ID from Drive link (optional)
async function extractFileIdFromDriveLink(driveLink) {
    const url = new URL(driveLink);
    const pathSegments = url.pathname.split('/');

    // Assuming the file ID is the second segment after 'd/'
    const fileId = pathSegments[1];

    if (!fileId) {
        throw new Error('Invalid Drive link format. Missing file ID.');
    }

    return fileId;
}

// Function to download video using OAuth 2.0 authorization
async function downloadVideoFromDrive(fileId, oAuth2Client) {
    // Ensure oAuth2Client has valid credentials (handle missing tokens elsewhere)

    const drive = google.drive({ version: 'v3', auth: oAuth2Client });

    try {
        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        const chunks = [];

        for await (const chunk of response.data) {
            chunks.push(chunk);
        }
        console.log("download");
        return Buffer.concat(chunks);
    } catch (error) {
        if (error.code) { // Check for Google Drive API specific errors
            console.error(`Drive API error: ${error.code} - ${error.message}`);
        } else {
            console.error('Error downloading video from Drive:', error);
        }
        throw error; // Re-throw the error for further handling
    }
}

async function saveVideoToFile(videoName, videoBuffer) {
    const videoFolderPath = path.join(__dirname, 'video'); // Path to the video folder

    // Check if the video folder exists
    if (!fs.existsSync(videoFolderPath)) {
        try {
            await fs.promises.mkdir(videoFolderPath); // Create the folder if it doesn't exist
            console.log('Video folder created.');
        } catch (error) {
            console.error('Error creating video folder:', error);
            throw error; // Re-throw the error to be handled in the main function
        }
    }

    const videoFilePath = path.join(videoFolderPath, videoName); // Full path to the video file

    try {
        await fs.promises.writeFile(videoFilePath, videoBuffer); // Write the video data to the file
        console.log(`Video saved to: ${videoFilePath}`);
    } catch (error) {
        console.error('Error saving video file:', error);
        throw error; // Re-throw the error to be handled in the main function
    }
}

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

